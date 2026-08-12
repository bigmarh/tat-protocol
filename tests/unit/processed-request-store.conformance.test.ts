import { describeProcessedRequestStoreConformance } from '../conformance/processed-request-store.js';
import {
  MemoryProcessedRequestStore,
  SqliteProcessedRequestStore,
} from '@tat-protocol/storage';
import type { SqliteDatabaseHandle } from '@tat-protocol/storage';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describeProcessedRequestStoreConformance('MemoryProcessedRequestStore', async () => ({
  store: new MemoryProcessedRequestStore(),
}));

describeProcessedRequestStoreConformance(
  'SqliteProcessedRequestStore (file, WAL)',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tat-claims-'));
    const db = new DatabaseSync(join(dir, 'forge.db')) as unknown as SqliteDatabaseHandle;
    const store = new SqliteProcessedRequestStore(db);
    return {
      store,
      cleanup: async () => {
        await store.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }
);

describe('SqliteProcessedRequestStore durability', () => {
  it('survives a restart, so a redelivered event cannot mint again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tat-claims-restart-'));
    const path = join(dir, 'forge.db');
    const id = 'ab'.repeat(32);
    try {
      const first = new SqliteProcessedRequestStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle
      );
      expect(await first.tryClaim(id)).toBe(true);
      await first.close();

      const second = new SqliteProcessedRequestStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle
      );
      // The whole point: an in-memory filter forgets this and the forge mints
      // a second time when the relay redelivers after a restart.
      expect(await second.tryClaim(id)).toBe(false);
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an id that is not a Nostr event id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tat-claims-bad-'));
    try {
      const store = new SqliteProcessedRequestStore(
        new DatabaseSync(join(dir, 'f.db')) as unknown as SqliteDatabaseHandle
      );
      await expect(store.tryClaim('nope')).rejects.toThrow(/event id/i);
      await store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
