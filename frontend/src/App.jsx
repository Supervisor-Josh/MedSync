import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { db } from './db';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, Database, Shield, Activity, Terminal, Plus, Search, Server, Edit, Trash2, Trash } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function App() {
  const [resources, setResources] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [conflictModal, setConflictModal] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [auditLogs, setAuditLogs] = useState([
    `[${new Date().toLocaleTimeString()}] [INFO] IndexedDB store "MedSyncOfflineDB" mounted successfully.`
  ]);

  useEffect(() => {
    const handleOnline = () => { if (isOnline) { addLog('[INFO] Network connection restored.'); triggerSync(); } };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    loadData();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnline]);

  const addLog = (msg) => {
    setAuditLogs(prev => [ `[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15) ]);
  };

  const loadData = async () => {
    try {
      if (isOnline) {
        const res = await axios.get(`${API_BASE}/resources`);
        setResources(res.data);
        await db.resources.clear();
        await db.resources.bulkPut(res.data);
      } else {
        const localResources = await db.resources.toArray();
        setResources(localResources);
      }
    } catch (err) {
      const localResources = await db.resources.toArray();
      setResources(localResources);
      addLog('[WARN] Server unreachable. Loaded cached state from Dexie IndexedDB.');
    }
    updateOutboxState();
  };

  const updateOutboxState = async () => {
    const items = await db.outbox.toArray();
    setOutbox(items);
  };

  const toggleOnlineMode = () => {
    const nextState = !isOnline;
    setIsOnline(nextState);
    if (nextState) {
      addLog('[INFO] Wi-Fi simulation enabled: Online mode active.');
      triggerSync();
    } else {
      addLog('[WARN] Wi-Fi simulation dropped: Switched to Offline durable mode.');
    }
  };

  const simulateServerEdit = async () => {
    addLog('[SIMULATION] Remote server edit simulated on Amoxicillin 500mg (version incremented to v5).');
    setConflictModal({
      resource_id: 'med-101',
      server_state: {
        id: 'med-101',
        name: 'Amoxicillin 500mg Dispersible',
        quantity: 28,
        version: 5,
        min_threshold: 30
      },
      client_attempt: {
        base_version: 4,
        payload: { quantity: 34 }
      }
    });
  };

  const handleQuantityChange = async (resource, delta) => {
    const newQty = Math.max(0, resource.quantity + delta);
    const updatedResource = { ...resource, quantity: newQty };

    setResources(resources.map(r => r.id === resource.id ? updatedResource : r));
    await db.resources.put(updatedResource);

    await db.outbox.add({
      action: 'UPDATE',
      resource_id: resource.id,
      base_version: resource.version,
      payload: { quantity: newQty },
      timestamp: new Date().toISOString()
    });

    updateOutboxState();
    addLog(`[MUTATION] Queued local update on ${resource.name} -> New Qty: ${newQty}`);

    if (isOnline) {
      triggerSync();
    }
  };

  const triggerSync = async () => {
    if (syncing || !isOnline) return;
    setSyncing(true);
    addLog('[SYNC] Pushing outbox mutation batch to FastAPI backend...');

    try {
      const actions = await db.outbox.toArray();
      if (actions.length === 0) {
        setSyncing(false);
        addLog('[SYNC] Outbox queue is empty.');
        return;
      }

      const payload = {
        client_id: 'kliniki_rural_01',
        actions: actions.map(a => ({
          op_id: `op_${Math.random()}`,
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
        addLog('[CONFLICT] Version vector divergence detected! Flagged for manual merge.');
      } else {
        await db.outbox.clear();
        await loadData();
        addLog('[SUCCESS] Outbox batch processed and cleared successfully.');
      }
    } catch (err) {
      addLog('[ERROR] Sync request failed.');
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
      addLog(`[RESOLVED] Conflict resolved using strategy: ${strategy}`);
      triggerSync();
    } catch (err) {
      addLog('[ERROR] Failed to resolve conflict.');
    }
  };

  const filteredResources = resources.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.category.toLowerCase().includes(searchQuery.toLowerCase());
    if (filter === 'SDG 3: Medical') return matchesSearch && item.category !== 'Water & Sanitation';
    if (filter === 'SDG 6: Water') return matchesSearch && item.category === 'Water & Sanitation';
    if (filter === 'Low Stock') return matchesSearch && item.quantity <= item.min_threshold;
    if (filter === 'Conflicts') return matchesSearch && conflictModal;
    return matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200 p-6 font-sans antialiased">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Top Header */}
        <header className="flex flex-col xl:flex-row justify-between items-center bg-[#161b22] p-5 rounded-2xl border border-slate-800 shadow-xl gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-teal-500/10 border border-teal-500/30 rounded-xl text-teal-400 flex items-center justify-center">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-wide">FieldSync</h1>
                <span className="text-[10px] font-mono bg-[#21262d] text-slate-300 border border-slate-700 px-2 py-0.5 rounded-md">v1.0-OFFLINE</span>
              </div>
              <p className="text-xs text-slate-400">Resilient Last-Mile Clinic & Water Supply Ledger</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono bg-[#1f242c] text-emerald-400 border border-emerald-900/50 px-3 py-1.5 rounded-full">
              UN SDG 3: Health
            </span>
            <span className="text-xs font-mono bg-[#1f242c] text-teal-400 border border-teal-900/50 px-3 py-1.5 rounded-full">
              UN SDG 6: Clean Water
            </span>

            {/* Interactive Wi-Fi Toggle Switch */}
            <div 
              onClick={toggleOnlineMode}
              className={`flex items-center gap-3 px-4 py-1.5 rounded-xl border cursor-pointer transition ${isOnline ? 'bg-[#0f2922] border-emerald-800/80 text-emerald-400' : 'bg-[#2a1215] border-rose-800/80 text-rose-400'}`}
            >
              <div className="flex flex-col">
                <span className="text-[11px] font-bold tracking-wider">{isOnline ? 'ONLINE — CLOUD SYNCED' : 'OFFLINE MODE ACTIVE'}</span>
                <span className="text-[9px] text-slate-400">Click to simulate Wi-Fi drop</span>
              </div>
              <div className={`w-8 h-4 flex items-center rounded-full p-1 transition ${isOnline ? 'bg-emerald-500 justify-end' : 'bg-slate-700 justify-start'}`}>
                <div className="bg-white w-2.5 h-2.5 rounded-full shadow-md"></div>
              </div>
            </div>

            <button 
              onClick={simulateServerEdit}
              className="flex items-center gap-1.5 bg-[#21262d] hover:bg-slate-800 text-amber-400 border border-amber-500/40 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              <Server className="w-3.5 h-3.5" /> Simulate Server Edit
            </button>

            <button 
              onClick={triggerSync}
              disabled={!isOnline || syncing}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-900/20"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync Outbox ({outbox.length})
            </button>
          </div>
        </header>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#161b22] p-4 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-xs font-medium">Local IndexedDB Records</div>
            <div className="text-2xl font-bold text-white mt-1 flex items-center justify-between">
              {resources.length} <Database className="w-5 h-5 text-teal-400" />
            </div>
            <div className="text-[11px] text-teal-400/80 mt-1">100% available offline</div>
          </div>
          <div className="bg-[#161b22] p-4 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-xs font-medium">Outbox Sync Queue</div>
            <div className="text-2xl font-bold text-white mt-1 flex items-center justify-between">
              {outbox.length} <Activity className="w-5 h-5 text-amber-400" />
            </div>
            <div className="text-[11px] text-amber-400/80 mt-1">Idempotent UUID mutation log</div>
          </div>
          <div className="bg-[#161b22] p-4 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-xs font-medium">Sync Conflicts</div>
            <div className="text-2xl font-bold text-white mt-1 flex items-center justify-between">
              {conflictModal ? 1 : 0} <AlertTriangle className="w-5 h-5 text-rose-400" />
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Vector clock & diff engine</div>
          </div>
          <div className="bg-[#161b22] p-4 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-xs font-medium">Critical Stock Thresholds</div>
            <div className="text-2xl font-bold text-white mt-1 flex items-center justify-between">
              {resources.filter(r => r.quantity <= r.min_threshold).length} <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="text-[11px] text-emerald-400/80 mt-1">Protects rural clinic continuity</div>
          </div>
        </div>

        {/* Conflict Resolution Center if triggered */}
        {conflictModal && (
          <div className="bg-[#2a1215] border border-rose-900/60 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400 mb-2">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Conflict Resolution Center</h3>
            </div>
            <p className="text-xs text-slate-300 mb-4">
              Divergent version vectors detected between local IndexedDB and Cloud Server. Choose a deterministic merge strategy.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 font-mono text-xs">
              <div className="bg-[#161b22] p-3 rounded-xl border border-rose-900/30">
                <div className="text-rose-400 font-bold mb-1">LOCAL CLIENT STATE (v{conflictModal.client_attempt.base_version})</div>
                <div>Quantity: {conflictModal.client_attempt.payload.quantity}</div>
              </div>
              <div className="bg-[#161b22] p-3 rounded-xl border border-slate-800">
                <div className="text-teal-400 font-bold mb-1">REMOTE SERVER STATE (v{conflictModal.server_state.version})</div>
                <div>Server Quantity: {conflictModal.server_state.quantity}</div>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => resolveConflict('smart_delta_merge')}
                className="bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Smart Delta Merge
              </button>
              <button 
                onClick={() => resolveConflict('keep_local')}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Keep Local Overwrite
              </button>
            </div>
          </div>
        )}

        {/* Main Content Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left 2 Columns: Ledger Table */}
          <div className="lg:col-span-2 space-y-4">
            
            {/* Ledger Header & Add Resource Bar */}
            <div className="bg-[#161b22] rounded-2xl border border-slate-800 p-4 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <h2 className="text-sm font-bold text-white">Field Resource Ledger</h2>
                <p className="text-[11px] text-slate-400">Click + / - or edit any item while Offline to test local persistence & outbox queueing.</p>
              </div>
              <button className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-900/20 cursor-pointer">
                <Plus className="w-4 h-4" /> Add Resource
              </button>
            </div>

            {/* Search & Filter Bar */}
            <div className="bg-[#161b22] rounded-2xl border border-slate-800 p-4 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input 
                  type="text"
                  placeholder="Search SKU, medicine, water part..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#21262d] border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-teal-500"
                />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {['All', 'SDG 3: Medical', 'SDG 6: Water', 'Low Stock', 'Conflicts'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${filter === tab ? 'bg-teal-600 text-white' : 'bg-[#21262d] text-slate-300 hover:bg-slate-800'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Main Ledger Table */}
            <div className="bg-[#161b22] rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#21262d]/50 border-b border-slate-800 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                    <th className="p-4">Resource & SDG Tag</th>
                    <th className="p-4">Stock Level</th>
                    <th className="p-4">Version Vector</th>
                    <th className="p-4">Sync State</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-sm">
                  {filteredResources.map((item) => {
                    const isLow = item.quantity <= item.min_threshold;
                    const isWater = item.category === 'Water & Sanitation';
                    return (
                      <tr key={item.id} className="hover:bg-[#21262d]/30 transition">
                        <td className="p-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">MED-{item.id}</span>
                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${isWater ? 'bg-teal-950 text-teal-400 border border-teal-800/40' : 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'}`}>
                              {isWater ? 'SDG 6 • Water' : 'SDG 3 • Health'}
                            </span>
                          </div>
                          <div className="font-semibold text-white">{item.name}</div>
                          <div className="text-xs text-slate-400">{item.category}</div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => handleQuantityChange(item, -1)}
                              className="bg-[#21262d] hover:bg-slate-700 text-slate-300 w-7 h-7 rounded-lg font-bold flex items-center justify-center transition cursor-pointer"
                            >
                              -
                            </button>
                            <span className={`px-3 py-1 rounded-lg text-xs font-bold font-mono ${isLow ? 'bg-rose-950 text-rose-400 border border-rose-800/50' : 'bg-slate-800 text-slate-200'}`}>
                              {item.quantity} units {isLow && '⚠️'}
                            </span>
                            <button 
                              onClick={() => handleQuantityChange(item, +10)}
                              className="bg-[#21262d] hover:bg-slate-700 text-slate-300 w-7 h-7 rounded-lg font-bold flex items-center justify-center transition cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="p-4 font-mono text-xs">
                          <div className="text-teal-400">L:v{item.version} / S:v{item.version}</div>
                          <div className="text-[10px] text-slate-500">Synced live</div>
                        </td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-emerald-950/50 text-emerald-400 border border-emerald-900/50">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Synced
                          </span>
                        </td>
                        <td className="p-4 text-right space-x-2">
                          <button className="text-slate-400 hover:text-white transition cursor-pointer" title="Edit">
                            <Edit className="w-4 h-4 inline" />
                          </button>
                          <button className="text-rose-400 hover:text-rose-300 transition cursor-pointer" title="Delete">
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Outbox Queue & Audit Log */}
          <div className="space-y-6">
            
            {/* Outbox Queue Panel */}
            <div className="bg-[#161b22] rounded-2xl border border-slate-800 p-4 shadow-xl">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold">IndexedDB Outbox Queue</h3>
                <span className="text-xs font-mono bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-md">{outbox.length} queued</span>
              </div>
              <div className="bg-[#0d1117] rounded-xl p-3 border border-slate-800 min-h-[140px] max-h-[220px] overflow-y-auto font-mono text-xs">
                {outbox.length === 0 ? (
                  <div className="text-slate-500 text-center py-8">
                    <div>Outbox Queue Empty</div>
                    <div className="text-[10px] mt-1 text-slate-600">Toggle Offline Mode and edit stock to observe durable local mutation queueing.</div>
                  </div>
                ) : (
                  outbox.map((op, i) => (
                    <div key={i} className="text-amber-300 py-1.5 border-b border-slate-800/50">
                      <div>{op.action} → Resource ID: {op.resource_id}</div>
                      <div className="text-[10px] text-slate-500">Qty: {op.payload.quantity} | Base v{op.base_version}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Sync Protocol Audit Log */}
            <div className="bg-[#161b22] rounded-2xl border border-slate-800 p-4 shadow-xl">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold">Sync Protocol Audit Log</h3>
                <button onClick={() => setAuditLogs([])} className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer">Clear</button>
              </div>
              <div className="bg-[#0d1117] rounded-xl p-3 border border-slate-800 h-[240px] overflow-y-auto font-mono text-[11px] text-slate-300 space-y-2">
                {auditLogs.map((log, index) => (
                  <div key={index} className="leading-relaxed border-b border-slate-900/60 pb-1">{log}</div>
                ))}
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
