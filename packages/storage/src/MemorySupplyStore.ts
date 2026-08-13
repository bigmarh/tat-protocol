import { SupplyStore } from './SupplyStore.js';
import { invalidTokenAmountReason } from '@tat-protocol/utils';

interface SupplyRow {
  issued: number;
  nextAssetId: number;
  maxSupply: number | null;
}

/**
 * In-memory {@link SupplyStore}.
 *
 * Atomic but NOT durable — a restart forgets how much has been issued, which
 * resets the cap to full headroom. That makes this a test backend; a mint with
 * a real cap wants the SQLite one.
 *
 * Atomicity holds for the same reason as the other in-memory stores: the
 * compare and the write below have no `await` between them, so nothing can
 * interleave on a single-threaded event loop.
 */
export class MemorySupplyStore implements SupplyStore {
  private rows = new Map<string, SupplyRow>();

  constructor(seed: Record<string, { issued?: number; maxSupply?: number | null }> = {}) {
    for (const [keysetId, values] of Object.entries(seed)) {
      this.rows.set(keysetId, {
        issued: values.issued ?? 0,
        nextAssetId: 0,
        maxSupply: values.maxSupply ?? null,
      });
    }
  }

  private assertAmount(amount: number): void {
    // Same rule as the mint path: positive safe integers keep `issued` exact.
    const reason = invalidTokenAmountReason(amount);
    if (reason) {
      throw new Error(`SupplyStore: ${reason} (got ${amount})`);
    }
  }

  private rowFor(keysetId: string): SupplyRow {
    let row = this.rows.get(keysetId);
    if (!row) {
      row = { issued: 0, nextAssetId: 0, maxSupply: null };
      this.rows.set(keysetId, row);
    }
    return row;
  }

  async tryIssue(keysetId: string, amount: number): Promise<number | null> {
    this.assertAmount(amount);
    const row = this.rowFor(keysetId);
    // No await between the check and the write — see the class comment.
    if (row.maxSupply !== null && row.issued + amount > row.maxSupply) {
      return null;
    }
    row.issued += amount;
    return row.issued;
  }

  async recordRedemption(keysetId: string, amount: number): Promise<number> {
    this.assertAmount(amount);
    const row = this.rowFor(keysetId);
    // Clamped at zero: redeeming more than was ever issued is a bug upstream,
    // and letting issued go negative would silently hand the mint extra
    // headroom above its cap.
    row.issued = Math.max(0, row.issued - amount);
    return row.issued;
  }

  async nextAssetId(keysetId: string): Promise<number> {
    const row = this.rowFor(keysetId);
    const id = row.nextAssetId;
    row.nextAssetId += 1;
    return id;
  }

  async getIssued(keysetId: string): Promise<number> {
    return this.rowFor(keysetId).issued;
  }

  async getMaxSupply(keysetId: string): Promise<number | null> {
    return this.rowFor(keysetId).maxSupply;
  }

  async setMaxSupply(keysetId: string, maxSupply: number | null): Promise<void> {
    const row = this.rowFor(keysetId);
    if (maxSupply !== null && maxSupply < row.issued) {
      throw new Error(`SupplyStore: cap ${maxSupply} is below the ${row.issued} already issued`);
    }
    row.maxSupply = maxSupply;
  }
}
