import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WordEngine } from '../src/engine.js';
import { Strategy, type StrategyContext } from '../src/strategy.js';
const frozen = { mode: 'market-convert' as const, floorMultiplier: 1, acquisitionReserve: 1.2, bidScale: 1.6, holdGain: 1.3, terminalSpend: false, letterPrices: true, lastUsableAllIn: true };
const rack = (letters: string) => { const r = new Map<string, number>(); for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1); return r; };
const ctx = (letters: string, changes: Partial<StrategyContext> = {}): StrategyContext => ({ myRack: rack(letters), myBalance: 100, remainingTiles: 30, auctionType: 'Vickrey', ...changes });
const engine = new WordEngine([]);
const base = new Strategy(engine, { ...frozen, qualityAcquisition: false });
const quality = new Strategy(engine, { ...frozen, qualityAcquisition: true });

test('extends the three-face acquisition prior to five through twelve held tiles', () => {
  for (const letters of ['AEINT', 'AEINTR', 'AAEEIINNTTRR']) {
    const input = { ...ctx(letters), letter: 'B' };
    assert.equal(quality.decideBid(input), 17);
    assert.ok(quality.decideBid(input) > base.decideBid(input));
  }
});

test('preserves small racks, oversized racks, duplicates, lack of vowels and lower-face bids', () => {
  for (const [letters, letter] of [['AEIN', 'B'], ['AAAEEEIIINNTR', 'B'], ['AEIBN', 'B'], ['BCDFG', 'H'], ['AEINT', 'D'], ['AEINT', 'A']]) {
    const input = { ...ctx(letters), letter };
    assert.equal(quality.decideBid(input), base.decideBid(input), `${letters}+${letter}`);
  }
});

test('keeps the validated Vickrey adjustment disabled for first-price auctions and the last seven rounds', () => {
  for (const remainingTiles of [0, 1, 2, 7]) {
    const input = { ...ctx('AEINT', { remainingTiles }), letter: 'B' };
    assert.equal(quality.decideBid(input), base.decideBid(input));
  }
  const input = { ...ctx('AEINT', { auctionType: 'FirstPrice' }), letter: 'B' };
  assert.equal(quality.decideBid(input), base.decideBid(input));
});

test('requires Q support and damps J and Z without a dictionary fit', () => {
  const unsupported = { ...ctx('AEINT'), letter: 'Q' };
  assert.equal(quality.decideBid(unsupported), base.decideBid(unsupported));
  assert.equal(quality.decideBid({ ...ctx('AEINU'), letter: 'Q' }), 38);
  assert.equal(quality.decideBid({ ...ctx('AEINT'), letter: 'J' }), 24);
  assert.equal(quality.decideBid({ ...ctx('AEINT'), letter: 'Z' }), 30);
  const fitted = new Strategy(new WordEngine(['JAB']), { ...frozen, qualityAcquisition: true });
  assert.equal(fitted.decideBid({ ...ctx('ABERT'), letter: 'J' }), 32);
});

test('quality remains within confirmed cash and the existing speculative cap', () => {
  for (const myBalance of [0, 1, 2, 10, 20, 100]) for (const letter of 'BCDFGHJKMPQVWXYZ') {
    const input = { ...ctx('AEINT', { myBalance }), letter };
    const bid = quality.decideBid(input);
    assert.ok(Number.isSafeInteger(bid) && bid >= 0 && bid <= myBalance);
    assert.ok(bid <= Math.floor(Math.max(1, myBalance * .38)));
  }
});

test('holding, last-usable override and public-history snapshots remain unchanged', () => {
  const words = new WordEngine(['CAT', 'CATS', 'BEATING']);
  const before = new Strategy(words, { ...frozen, qualityAcquisition: false });
  const after = new Strategy(words, { ...frozen, qualityAcquisition: true });
  const input = { ...ctx('CA', { remainingTiles: 1, myBalance: 47 }), letter: 'T' };
  assert.equal(after.decideBid(input), 47);
  assert.equal(after.decideBid(input), before.decideBid(input));
  for (const remainingTiles of [0, 1, 8, 30]) assert.equal(after.chooseWord(ctx('BEATING', { remainingTiles })), before.chooseWord(ctx('BEATING', { remainingTiles })));
  const history = [{ auctionId: '1', letter: 'B', paid: 12 }];
  quality.decideBid({ ...ctx('AEINT', { recentAuctionPrices: history }), letter: 'B' });
  assert.deepEqual(history, [{ auctionId: '1', letter: 'B', paid: 12 }]);
});
