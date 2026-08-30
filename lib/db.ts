import Dexie, { type Table } from 'dexie';
import type { QueuedCapture } from './types';

class CalliadDB extends Dexie {
  queue!: Table<QueuedCapture>;

  constructor() {
    super('calliad');
    this.version(1).stores({
      queue: 'local_id, synced, created_at',
    });
  }
}

export const db = new CalliadDB();

export async function enqueue(entry: Omit<QueuedCapture, 'synced'>): Promise<string> {
  await db.queue.add({ ...entry, synced: false });
  return entry.local_id;
}

export async function getPendingQueue(): Promise<QueuedCapture[]> {
  return db.queue.where('synced').equals(0).toArray();
}

export async function markSynced(local_id: string): Promise<void> {
  await db.queue.update(local_id, { synced: true });
}
