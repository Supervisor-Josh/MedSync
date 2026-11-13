import Dexie from 'dexie';

export const db = new Dexie('MedSyncOfflineDB');

db.version(1).stores({
  resources: 'id, name, category, quantity, min_threshold, version, updated_at',
  outbox: '++local_op_id, action, resource_id, base_version, payload, timestamp'
});
