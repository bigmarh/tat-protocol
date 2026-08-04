import { Transaction, tokenClassOf, effectiveTokenClass } from '../src/Transaction';
import type { PocketState } from '../src/Pocket';

const ISSUER = 'issuer-pubkey';
const CHANGE_KEY = 'change-pubkey';

/**
 * A token that decodes the way selection reads one — an unsigned JWT shape whose
 * payload carries an amount and a class. Selection never verifies a signature,
 * so a real one would only slow the test down without exercising anything more.
 */
function token(amount: number, tokenClass: string | null): string {
    const payload: Record<string, unknown> = { amount };
    if (tokenClass !== null) {
        payload.data_uri = JSON.stringify({ class: tokenClass, cycles: 0, issuedAt: 1 });
    }
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `header.${b64}.signature`;
}

/** A pocket holding the given (amount, class) tokens for one issuer. */
function stateWith(held: Array<[number, string | null]>): PocketState {
    const tokens = new Map<string, string>();
    const index = new Map<number, string[]>();
    held.forEach(([amount, cls], i) => {
        const hash = `hash-${i}`;
        tokens.set(hash, token(amount, cls));
        index.set(amount, [...(index.get(amount) ?? []), hash]);
    });
    return {
        tatIndex: new Map(),
        tokenIndex: new Map([[ISSUER, index]]),
        tokens: new Map([[ISSUER, tokens]]),
    } as unknown as PocketState;
}

function spend(
    held: Array<[number, string | null]>,
    amount: number,
    tokenClass?: string | null,
): { tx: Transaction; ins: string[]; outs: Array<{ to: string; amount: number }> } {
    const tx = new Transaction('transfer', stateWith(held), [], CHANGE_KEY);
    tx.ofClass(tokenClass ?? null);
    tx.to(ISSUER, 'recipient', amount);
    const [, built] = tx.build();
    return { tx, ins: built.ins, outs: built.outs };
}

/** The classes the selected inputs actually carry. */
function classesOf(ins: string[]): string[] {
    return [...new Set(ins.map(effectiveTokenClass))].sort();
}

describe('class-aware token selection', () => {
    it('reads a class off a token, and treats an untagged one as purchased', () => {
        expect(tokenClassOf(token(5, 'bonus'))).toBe('bonus');
        expect(tokenClassOf(token(5, null))).toBeNull();
        expect(effectiveTokenClass(token(5, null))).toBe('purchased');
    });

    it('never mixes classes, even when no class was asked for', () => {
        // 10 bonus + 10 purchased covers 15 only by pooling, which the bank would
        // merge down to bonus — taking the purchased change with it.
        expect(() =>
            spend(
                [
                    [10, 'bonus'],
                    [10, 'purchased'],
                ],
                15,
            ),
        ).toThrow(/any one class/);
    });

    it('explains that classes cannot be pooled only when pooling would have paid', () => {
        expect(() =>
            spend(
                [
                    [10, 'bonus'],
                    [10, 'purchased'],
                ],
                15,
            ),
        ).toThrow(/cannot be split across classes/);

        // Short overall — the no-mixing rule is not the reason, so saying it
        // would just read as an excuse.
        expect(() =>
            spend(
                [
                    [2, 'bonus'],
                    [3, 'purchased'],
                ],
                50,
            ),
        ).toThrow(/hold purchased 3, bonus 2\.$/);
    });

    it('spends purchased before bonus when either would cover it', () => {
        const { tx, ins } = spend(
            [
                [20, 'bonus'],
                [20, 'purchased'],
            ],
            10,
        );
        expect(tx.selectedClass).toBe('purchased');
        expect(classesOf(ins)).toEqual(['purchased']);
    });

    it('spends bonus last, whatever else is held', () => {
        // Bonus poisons any pot it enters — the bank merges a payment down to
        // the most restrictive input, so one bonus token turns a whole table's
        // payouts bonus and its winner cannot buy into a purchased-only game.
        const held: Array<[number, string | null]> = [
            [20, 'purchased'],
            [20, 'bonus'],
            [20, 'voucher'],
            [20, 'loan'],
        ];
        expect(spend(held, 10).tx.selectedClass).toBe('purchased');
        expect(
            spend(held.filter(([, c]) => c !== 'purchased'), 10).tx.selectedClass,
        ).toBe('voucher');
        expect(
            spend(
                held.filter(([, c]) => c !== 'purchased' && c !== 'voucher'),
                10,
            ).tx.selectedClass,
        ).toBe('loan');
        // Only when nothing else will do.
        expect(spend([[20, 'bonus']], 10).tx.selectedClass).toBe('bonus');
    });

    it('skips a preferred class that cannot cover the amount on its own', () => {
        const { tx, ins } = spend(
            [
                [5, 'purchased'],
                [20, 'bonus'],
            ],
            10,
        );
        expect(tx.selectedClass).toBe('bonus');
        expect(classesOf(ins)).toEqual(['bonus']);
    });

    it('reaches for an unfamiliar class only when no known one will do', () => {
        // A class this client has never heard of stays spendable — a stale
        // client must not strand funds — but does not get spent ahead of one it
        // can reason about.
        expect(
            spend(
                [
                    [20, 'rebate'],
                    [20, 'purchased'],
                ],
                10,
            ).tx.selectedClass,
        ).toBe('purchased');

        expect(
            spend(
                [
                    [20, 'rebate'],
                    [5, 'purchased'],
                ],
                10,
            ).tx.selectedClass,
        ).toBe('rebate');
    });

    it('does not spend a big token of a preferred class when a smaller class fits exactly', () => {
        // Regression. Choosing the class by preference and only then fitting
        // denominations sent 100 BB to pay 10, with 90 BB riding on a change
        // delivery, while two purchased 5s sat beside it.
        const { tx, ins, outs } = spend(
            [
                [100, 'bonus'],
                [5, 'purchased'],
                [5, 'purchased'],
            ],
            10,
        );
        expect(tx.selectedClass).toBe('purchased');
        expect(ins).toHaveLength(2);
        expect(outs.filter((o) => o.to === CHANGE_KEY)).toEqual([]);
    });

    it('takes the smaller overshoot when no class fits exactly', () => {
        const { tx, outs } = spend(
            [
                [100, 'bonus'],
                [12, 'purchased'],
            ],
            10,
        );
        expect(tx.selectedClass).toBe('purchased');
        expect(outs).toContainEqual({ issuer: ISSUER, to: CHANGE_KEY, amount: 2 });
    });

    it('still prefers the most usable class when the fits are equally good', () => {
        // Preference is a tie-break, not a licence to overshoot — but it is
        // still a preference, and equal fits are exactly when it should apply.
        const { tx } = spend(
            [
                [10, 'bonus'],
                [10, 'purchased'],
            ],
            10,
        );
        expect(tx.selectedClass).toBe('purchased');
    });

    it('overshoots a requested class rather than silently paying from another', () => {
        // The caller named a class; a tighter fit elsewhere is not theirs to
        // take. Change is the lesser problem next to paying in a class the
        // recipient will refuse.
        const { tx, outs } = spend(
            [
                [100, 'purchased'],
                [10, 'bonus'],
            ],
            10,
            'purchased',
        );
        expect(tx.selectedClass).toBe('purchased');
        expect(outs).toContainEqual({ issuer: ISSUER, to: CHANGE_KEY, amount: 90 });
    });

    it('honours an explicitly requested class over the preference order', () => {
        const { tx, ins } = spend(
            [
                [20, 'bonus'],
                [20, 'purchased'],
            ],
            10,
            'purchased',
        );
        expect(tx.selectedClass).toBe('purchased');
        expect(classesOf(ins)).toEqual(['purchased']);
    });

    it('reports a shortfall against the class that was asked for', () => {
        expect(() =>
            spend(
                [
                    [50, 'bonus'],
                    [5, 'purchased'],
                ],
                10,
                'purchased',
            ),
        ).toThrow(/Not enough "purchased" BotBucks: need 10, hold 5/);
    });

    it('groups untagged tokens with purchased ones so they spend together', () => {
        const { tx, ins } = spend(
            [
                [6, null],
                [6, 'purchased'],
            ],
            10,
            'purchased',
        );
        expect(tx.selectedClass).toBe('purchased');
        expect(ins).toHaveLength(2);
    });

    it('sends change back in the same class, by taking it from the same bucket', () => {
        const { tx, ins, outs } = spend(
            [
                [20, 'bonus'],
                [20, 'purchased'],
            ],
            15,
        );
        expect(tx.selectedClass).toBe('purchased');
        expect(classesOf(ins)).toEqual(['purchased']);
        expect(outs).toContainEqual({ issuer: ISSUER, to: CHANGE_KEY, amount: 5 });
    });

    it('ignores an index entry with no token behind it rather than failing the payment', () => {
        const state = stateWith([
            [10, 'purchased'],
            [10, 'purchased'],
        ]);
        // Simulate a stale index: the hash is listed but the JWT is gone.
        state.tokens.get(ISSUER)!.delete('hash-1');

        const tx = new Transaction('transfer', state, [], CHANGE_KEY);
        tx.to(ISSUER, 'recipient', 10);
        const [, built] = tx.build();
        expect(built.ins).toHaveLength(1);
    });
});
