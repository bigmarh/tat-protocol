// Amounts are positive safe integers, and that is now checked rather than
// assumed.
//
// The intent was always integers — BotBank's own agent skill states
// "divisibility: integer (no fractional BB)" — but nothing enforced it. Every
// amount check in the protocol was `Number.isFinite(x) && x > 0`, which accepts
// 0.5. So the exactness the conservation arithmetic depends on was an
// assumption the code never verified.
import 'jest';
import { isValidTokenAmount, invalidTokenAmountReason } from '@tat-protocol/utils';
import '@tat-protocol/nwpc';
import { FungibleForge } from '@tat-protocol/forge';
import type { StorageInterface } from '@tat-protocol/storage';
import { Token } from '@tat-protocol/token';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

const OWNER_SK = '44'.repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const BOB = 'b'.repeat(64);

class MemStore implements StorageInterface {
  private m = new Map<string, string>();
  async getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  async removeItem(k: string) {
    this.m.delete(k);
  }
  async clear() {
    this.m.clear();
  }
}

describe('why integers: float sums are not exact', () => {
  it('demonstrates the drift the enforcement removes', () => {
    // The conservation check is `outputTotal > inputTotal`. With fractional
    // amounts the sums are not exact, so a transfer can output marginally more
    // than its inputs and still pass.
    const inputTotal = 0.1 + 0.2;
    expect(inputTotal).toBeGreaterThan(0.3);
    expect(inputTotal).toBe(0.30000000000000004);
    // 0.30000000000000004 is not > 0.30000000000000004, so an output claiming
    // the drifted total passes the check while exceeding the true input value.
    expect(0.30000000000000004 > inputTotal).toBe(false);

    // With integers the same sums are exact, at any magnitude below 2^53.
    expect(1 + 2).toBe(3);
    expect(Number.MAX_SAFE_INTEGER - 1 + 1).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('shows why the bound is isSafeInteger and not isInteger', () => {
    // Past 2^53 integers stop being exactly representable, so sums lose
    // precision the same way fractions do.
    expect(Number.isInteger(2 ** 53 + 1)).toBe(true);
    expect(2 ** 53 + 1).toBe(2 ** 53);
    expect(Number.isSafeInteger(2 ** 53 + 1)).toBe(false);
  });
});

describe('isValidTokenAmount', () => {
  it.each([1, 2, 100, 1_000_000, Number.MAX_SAFE_INTEGER])('accepts %p', (v) => {
    expect(isValidTokenAmount(v)).toBe(true);
    expect(invalidTokenAmountReason(v)).toBeNull();
  });

  it.each([
    [0, /greater than zero/i],
    [-1, /greater than zero/i],
    [0.5, /whole number/i],
    [1.5, /whole number/i],
    [1.0000000001, /whole number/i],
    [NaN, /finite/i],
    [Infinity, /finite/i],
    [-Infinity, /finite/i],
    [Number.MAX_SAFE_INTEGER + 2, /too large/i],
  ])('rejects %p', (v, pattern) => {
    expect(isValidTokenAmount(v)).toBe(false);
    expect(invalidTokenAmountReason(v)).toMatch(pattern);
  });

  it.each([['5', /must be a number/i], [null, /must be a number/i], [undefined, /must be a number/i]])(
    'rejects the non-number %p',
    (v, pattern) => {
      expect(isValidTokenAmount(v)).toBe(false);
      expect(invalidTokenAmountReason(v)).toMatch(pattern);
    }
  );

  it('explains the fraction case in a way a caller can act on', () => {
    // "issue a smaller unit" is the actual remedy — a mint needing cents should
    // issue cents and display dollars, the way Bitcoin issues satoshis.
    expect(invalidTokenAmountReason(0.5)).toMatch(/smaller unit/i);
  });
});

describe('the forge rejects fractional amounts end to end', () => {
  function makeForge() {
    const forge = new FungibleForge({
      owner: OWNER,
      keys: { secretKey: OWNER_SK, publicKey: OWNER },
      storage: new MemStore(),
      totalSupply: 0,
      relays: [],
    } as any) as any;
    forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
    return forge;
  }

  async function fungibleToken(amount: number): Promise<Token> {
    const t = new Token();
    await t.build({
      token_type: 'FUNGIBLE' as any,
      payload: { iss: OWNER, iat: Math.floor(Date.now() / 1000), amount } as any,
    });
    return t;
  }

  it('rejects a fractional transfer INPUT', async () => {
    const forge = makeForge();
    const err = await forge.validateFungibleTransfer(
      [await fungibleToken(0.3)],
      [{ to: BOB, amount: 1 } as any]
    );
    expect(err).toMatch(/positive/i);
  });

  it('rejects a fractional transfer OUTPUT', async () => {
    const forge = makeForge();
    const err = await forge.validateFungibleTransfer(
      [await fungibleToken(100)],
      [{ to: BOB, amount: 0.5 } as any]
    );
    expect(err).toMatch(/positive/i);
  });

  it('rejects the drift case specifically', async () => {
    // Two fractional inputs whose float sum exceeds their true sum, against an
    // output claiming the drifted total. Before enforcement this passed.
    const forge = makeForge();
    const err = await forge.validateFungibleTransfer(
      [await fungibleToken(0.1), await fungibleToken(0.2)],
      [{ to: BOB, amount: 0.30000000000000004 } as any]
    );
    expect(err).not.toBeNull();
  });

  it('still accepts ordinary whole-number transfers', async () => {
    const forge = makeForge();
    const err = await forge.validateFungibleTransfer(
      [await fungibleToken(100)],
      [{ to: BOB, amount: 40 } as any]
    );
    expect(err).toBeNull();
  });

  it('accepts amounts at the top of the exact range', async () => {
    const forge = makeForge();
    const err = await forge.validateFungibleTransfer(
      [await fungibleToken(Number.MAX_SAFE_INTEGER)],
      [{ to: BOB, amount: Number.MAX_SAFE_INTEGER } as any]
    );
    expect(err).toBeNull();
  });
});
