import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LETTER_VALUE } from '../src/engine.js';
import { letterPriceBid, type LetterPriceFeatures, type PublicAuctionPrice } from '../src/letter-price.js';
import type { StrategyContext } from '../src/strategy.js';
const ctx = (changes: Partial<StrategyContext & { letter: string; recentAuctionPrices: readonly PublicAuctionPrice[] }> = {}) => ({
  myRack: new Map([['A', 1], ['T', 1]]), myBalance: 100, remainingTiles: 30,
  auctionType: 'Vickrey' as const, letter: 'B', recentAuctionPrices: [] as readonly PublicAuctionPrice[], ...changes,
});
const features = (changes: Partial<LetterPriceFeatures> = {}): LetterPriceFeatures => ({ baseBid: 3, face: 3, have: 0, readyGain: 0, tiles: 2, vowels: 1, cashCap: 38, ...changes });
const prices: PublicAuctionPrice[] = [
  { auctionId: '1', letter: 'A', paid: 8 }, { auctionId: '2', letter: 'B', paid: 12 },
  { auctionId: '3', letter: 'C', paid: 18 }, { auctionId: '4', letter: 'E', paid: 10 },
];

test('shrinks the letter-class median toward the global face-value prior', () => {
  // Global upper median12; class3 median18,n2; quote16.84; capacity16.666.
  assert.equal(letterPriceBid(ctx({ recentAuctionPrices: prices }), features()), 16);
  assert.equal(letterPriceBid(ctx(), features()), 15);
});

test('repeated calls and duplicate events are deterministic and do not mutate history', () => {
  const history = Object.freeze(prices.map(row => Object.freeze({ ...row })));
  const input = ctx({ recentAuctionPrices: history });
  const first = letterPriceBid(input, features());
  assert.equal(letterPriceBid(input, features()), first);
  assert.equal(letterPriceBid(ctx({ recentAuctionPrices: [...history, ...history] }), features()), first);
  assert.deepEqual(history, prices);
});

test('new explicit auction IDs alone add observations, regardless of previous calls or skipped bids', () => {
  const history = [{ auctionId: '1', letter: 'A', paid: 4 }];
  const input = ctx({ myBalance: 1000, recentAuctionPrices: history });
  letterPriceBid(ctx({ letter: 'Z', observedPrices: [99] }), features({ face: 10 }));
  const first = letterPriceBid(input, features({ cashCap: 380 }));
  const duplicate = letterPriceBid({ ...input, recentAuctionPrices: [...history, { auctionId: '1', letter: 'Q', paid: 99 }] }, features({ cashCap: 380 }));
  assert.equal(duplicate, first);
  const next = { ...input, recentAuctionPrices: [...history, { auctionId: '2', letter: 'B', paid: 20 }] };
  assert.ok(letterPriceBid(next, features({ cashCap: 380 })) > first);
  // A fresh process/caller using the same full public history gets the same bid.
  assert.equal(letterPriceBid(next, features({ cashCap: 380 })), letterPriceBid(structuredClone(next), features({ cashCap: 380 })));
});

test('rejects malformed/nonpositive payments without claiming their IDs', () => {
  const malformed = [
    { auctionId: '5', letter: 'B', paid: NaN }, { auctionId: '6', letter: 'B', paid: Infinity },
    { auctionId: '7', letter: 'B', paid: -2 }, { auctionId: '8', letter: 'B', paid: 0 },
    { auctionId: '9', letter: 'B', paid: 1.5 }, { auctionId: '', letter: 'B', paid: 90 },
    { auctionId: '10', letter: 'WORD', paid: 90 },
  ];
  assert.equal(letterPriceBid(ctx({ recentAuctionPrices: [...malformed, ...prices] }), features()), 16);
  assert.equal(letterPriceBid(ctx({ recentAuctionPrices: [{ auctionId: '1', letter: 'A', paid: NaN }, ...prices] }), features()), 16);
});

test('uses only last20 unique positive payments for global median, but all class observations', () => {
  const history: PublicAuctionPrice[] = [
    ...Array.from({ length: 25 }, (_, i) => ({ auctionId: `old${i}`, letter: 'B', paid: 30 })),
    ...Array.from({ length: 20 }, (_, i) => ({ auctionId: `new${i}`, letter: 'A', paid: 4 })),
  ];
  // n25class3 median30, global4, prior4.8 => quote28.3; capacity is loose.
  assert.equal(letterPriceBid(ctx({ myBalance: 1000, recentAuctionPrices: history }), features({ cashCap: 380 })), 28);
});

test('respects balance/cap, skips final and speculative penultimate tiles, and supports Q only with U or a ready gain', () => {
  assert.equal(letterPriceBid(ctx({ remainingTiles: 0 }), features()), 0);
  assert.equal(letterPriceBid(ctx({ remainingTiles: 1 }), features()), 0);
  assert.ok(letterPriceBid(ctx({ remainingTiles: 1 }), features({ readyGain: 1 })) > 0);
  assert.equal(letterPriceBid(ctx({ myBalance: 2 }), features({ cashCap: 100 })), 2);
  assert.equal(letterPriceBid(ctx(), features({ cashCap: 7 })), 7);
  assert.equal(letterPriceBid(ctx(), features({ baseBid: NaN, cashCap: NaN })), 0);
  assert.equal(letterPriceBid(ctx({ letter: 'Q' }), features({ face: 10 })), 3);
  assert.ok(letterPriceBid(ctx({ letter: 'Q', myRack: new Map([['U', 1]]) }), features({ face: 10 })) > 3);
  assert.ok(letterPriceBid(ctx({ letter: 'Q' }), features({ face: 10, readyGain: 1 })) > 3);
  assert.equal(letterPriceBid(ctx(), features({ have: 2 })), 3);
});

test('matches the original stateful formula on a normal once-per-auction stream', () => {
  const history: PublicAuctionPrice[] = [];
  const buckets = new Map<number, number[]>();
  const observed: number[] = [];
  const bucket = (face: number) => face >= 8 ? 8 : face >= 3 ? 3 : face;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const letters = 'ETAOINSHRDLUCMFPGWYBVKXJQZ';
  for (let i = 0; i < 68; i++) {
    if (i > 0) {
      const letter = letters[(i - 1) % letters.length], paid = 3 + (i * 7) % 23;
      history.push({ auctionId: String(i), letter, paid }); observed.push(paid);
      const key = bucket(LETTER_VALUE[letter]);
      buckets.set(key, [...(buckets.get(key) ?? []), paid]);
    }
    const letter = letters[i % letters.length], face = LETTER_VALUE[letter];
    const local = buckets.get(bucket(face)) ?? [], all = observed.slice(-20);
    const global = all.length ? med(all) : 12, weight = local.length / (local.length + 3);
    const quote = weight * (local.length ? med(local) : global) + (1 - weight) * global * (1 + .1 * (face - 1)) + 1;
    const expected = Math.floor(Math.min(100, Math.max(3, Math.min(38, quote, Math.max(100 / 6, 3 * face + 4)))));
    const input = ctx({ letter, myRack: new Map([['U', 1], ['T', 1]]), recentAuctionPrices: history });
    assert.equal(letterPriceBid(input, features({ face })), expected, `auction ${i}, letter ${letter}`);
  }
});
