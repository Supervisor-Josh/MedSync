import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { db } from './db';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle, Database } from 'lucide-react';

const API_BASE = 'http://localhost:8000/api';

export default function App() {
  const [resources, setResources] = useState([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [conflictModal, setConflictModal] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); triggerSync(); };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    loadData();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadData = async () => {
    try {
      if (navigator.onLine) {
        const res = await axios.get(`${API_BASE}/resources`);
        setResources(res.data);
        await db.resources.clear();
        await db.resources.bulkPut(res.data);
      } else {
        const localResources = await db.resources.toArray();
        setResources(localResources);
      }
    } catch (err) {
      console.warn("Server unreachable. Loading from local Dexie DB...", err);
      const localResources = await db.resources.toArray();
      setResources(localResources);
    }
    updateOutboxCount();
  };

  const updateOutboxCount = async () => {
    const count = await db.outbox.count();
    setOutboxCount(count);
  };

  const handleQuantityChange = async (resource, delta) => {
    const newQty = Math.max(0, resource.quantity + delta);
    const updatedResource = { ...resource, quantity: newQty, version: resource.version };

    setResources(resources.map(r => r.id === resource.id ? updatedResource : r));
    await db.resources.put(updatedResource);

    await db.outbox.add({
      op_id: `op_${Date.now()}`,
      action: 'UPDATE',
      resource_id: resource.id,
      base_version: resource.version,
      payload: { quantity: newQty },
      timestamp: new Date().toISOString()
    });

    updateOutboxCount();
    setStatusMessage('Change saved locally (Queued in Outbox)');

    if (navigator.onLine) {
      triggerSync();
    }
  };

  const triggerSync = async () => {
    if (syncing || !navigator.onLine) return;
    setSyncing(true);
    setStatusMessage('Syncing with server...');

    try {
      const actions = await db.outbox.toArray();
      if (actions.length === 0) {
        setSyncing(false);
        setStatusMessage('All data synchronized.');
        return;
      }

      const payload = {
        client_id: 'kliniki_rural_01',
        actions: actions.map(a => ({
          op_id: a.op_id,
          resource_id: a.resource_id,
          action: a.action,
          base_version: a.base_version,
          delta_qty: a.payload.quantity,
          payload: a.payload
        }))
      };

      const response = await axios.post(`${API_BASE}/sync/push`, payload);

      if (response.data.status === 'CONFLICT') {
        setConflictModal(response.data);
        setStatusMessage('Sync paused: Conflict detected.');
      } else {
        await db.outbox.clear();
        await loadData();
        setStatusMessage('Sync completed successfully!');
      }
    } catch (err) {
      console.error('Sync failed:', err);
      setStatusMessage('Sync failed. Retrying when online.');
    } finally {
      setSyncing(false);
    }
  };

  const resolveConflict = async (strategy) => {
    if (!conflictModal) return;

    try {
      const localAttemptQty = conflictModal.client_attempt.payload.quantity;
      const serverQty = conflictModal.server_state.quantity;
      const delta = localAttemptQty - serverQty;

      await axios.post(`${API_BASE}/sync/resolve-conflict`, {
        resource_id: conflictModal.resource_id,
        resolution_strategy: strategy,
        local_delta: delta
      });

      await db.outbox.clear();
      setConflictModal(null);
      await loadData();
      setStatusMessage('Conflict resolved successfully.');
      triggerSync();
    } catch (err) {
      console.error('Failed to resolve conflict', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-6 font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-teal-700 flex items-center gap-2">
              <Database className="w-7 h-7" /> MedSync Rural Clinic Tracker
            </h1>
            <p className="text-sm text-slate-500">Offline-First Inventory & Conflict Resolution Engine</p>
          </div>
          <div className="flex items-center gap-4">
            <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {isOnline ? 'Online' : 'Offline Mode'}
            </span>
            <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-lg font-medium">
              Outbox Queue: <strong>{outboxCount}</strong> pending
            </div>
            <button 
              onClick={triggerSync}
              disabled={!isOnline || syncing}
              className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> Sync Now
            </button>
          </div>
        </header>

        {statusMessage && (
          <div className="mb-4 p-3 bg-teal-50 border border-teal-200 text-teal-800 rounded-lg text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-teal-600" /> {statusMessage}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
                <th className="p-4">Item Name</th>
                <th className="p-4">Category</th>
                <th className="p-4">Quantity</th>
                <th className="p-4">Min Threshold</th>
                <th className="p-4">Version</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {resources.map((item) => {
                const isLow = item.quantity <= item.min_threshold;
                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-semibold text-slate-800">{item.name}</td>
                    <td className="p-4 text-sm text-slate-600">{item.category}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-md text-sm font-bold ${isLow ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                        {item.quantity} {isLow && '⚠️ Low'}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-500">{item.min_threshold}</td>
                    <td className="p-4 text-xs font-mono text-slate-400">v{item.version}</td>
                    <td className="p-4 text-right space-x-2">
                      <button 
                        onClick={() => handleQuantityChange(item, -1)}
                        className="bg-rose-50 text-rose-600 hover:bg-rose-100 px-3 py-1 rounded-md text-sm font-bold transition"
                      >
                        - Dispense
                      </button>
                      <button 
                        onClick={() => handleQuantityChange(item, +10)}
                        className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1 rounded-md text-sm font-bold transition"
                      >
                        + Restock
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {conflictModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl border border-slate-200">
              <div className="flex items-center gap-3 text-amber-600 mb-4">
                <AlertTriangle className="w-8 h-8" />
                <h3 className="text-xl font-bold text-slate-900">Version Conflict Detected (409)</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Another clinic worker updated <strong>{conflictModal.server_state.name}</strong> on the server while offline. Choose how to resolve this:
              </p>
              
              <div className="bg-slate-50 p-4 rounded-xl text-xs space-y-1 mb-6 border border-slate-200 font-mono">
                <div>Server Quantity: <strong>{conflictModal.server_state.quantity}</strong> (v{conflictModal.server_state.version})</div>
                <div>Your Offline Action Qty: <strong>{conflictModal.client_attempt.payload.quantity}</strong></div>
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => resolveConflict('smart_delta_merge')}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white py-2.5 rounded-xl font-medium text-sm transition"
                >
                  Merge Quantities (Smart Delta Merge)
                </button>
                <button 
                  onClick={() => resolveConflict('keep_local')}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white py-2.5 rounded-xl font-medium text-sm transition"
                >
                  Overwrite with My Local Value
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
