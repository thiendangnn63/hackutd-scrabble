import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WordEngine } from '../src/engine.js';
import { Strategy, type StrategyContext } from '../src/strategy.js';
const engine = new WordEngine(['AT', 'CAT', 'CATS', 'CART', 'CARTS', 'CATER', 'RETAINS', 'QUIZ']);
const frozen = { mode: 'market-convert' as const, floorMultiplier: 1, acquisitionReserve: 1.2, bidScale: 1.6, holdGain: 1.3, terminalSpend: false, letterPrices: true };
const rack = (letters: string) => { const r = new Map<string, number>(); for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1); return r; };
const context = (letters: string, changes: Partial<StrategyContext> = {}): StrategyContext => ({
  myRack: rack(letters), myBalance: 47, remainingTiles: 1, auctionType: 'Vickrey',
  observedPrices: [8, 12, 10], recentAuctionPrices: [{ auctionId: '1', letter: 'A', paid: 8 }, { auctionId: '2', letter: 'B', paid: 12 }, { auctionId: '3', letter: 'E', paid: 10 }], ...changes,
});
const base = new Strategy(engine, { ...frozen, lastUsableAllIn: false });
const terminal = new Strategy(engine, { ...frozen, lastUsableAllIn: true });

test('last usable positive completion bids all confirmed spendable cash in both formats', () => {
  for (const auctionType of ['Vickrey', 'FirstPrice'] as const) for (const myBalance of [0, 1, 2, 17, 47, 100]) {
    const ctx = { ...context('CA', { auctionType, myBalance }), letter: 'T' };
    assert.equal(terminal.decideBid(ctx), myBalance);
  }
  assert.equal(terminal.decideBid({ ...context('UIZ'), letter: 'Q' }), 47);
});

test('unusable final auction is skipped even for a valuable ready word', () => {
  for (const myBalance of [0, 1, 47, 100]) assert.equal(terminal.decideBid({ ...context('UIZ', { remainingTiles: 0, myBalance }), letter: 'Q' }), 0);
});

test('no positive ready gain preserves baseline behavior and never goes all in speculatively', () => {
  for (const letters of ['', 'ZZ', 'CAT']) for (const letter of 'BEJ') {
    const ctx = { ...context(letters), letter };
    assert.equal(terminal.decideBid(ctx), base.decideBid(ctx));
  }
});

test('earlier auctions retain exactly the frozen letter-price bids', () => {
  for (const remainingTiles of [2, 3, 5, 15, 30, 60]) for (const letters of ['', 'CA', 'CART', 'UIZ']) {
    for (const myBalance of [2, 17, 100]) for (const auctionType of ['Vickrey', 'FirstPrice'] as const) for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const ctx = { ...context(letters, { remainingTiles, myBalance, auctionType }), letter };
      assert.equal(terminal.decideBid(ctx), base.decideBid(ctx));
    }
  }
});

test('terminal override cannot mutate or misattribute public price history', () => {
  const ctx = context('CA', { remainingTiles: 20 });
  const history = structuredClone(ctx.recentAuctionPrices);
  const prior = terminal.decideBid({ ...ctx, letter: 'B' });
  terminal.decideBid({ ...ctx, remainingTiles: 1, letter: 'T' });
  assert.equal(terminal.decideBid({ ...ctx, letter: 'B' }), prior);
  assert.deepEqual(ctx.recentAuctionPrices, history);
});

test('terminal decisions remain finite affordable nonnegative integers', () => {
  for (const myBalance of [NaN, Infinity, -1, 0, 0.9, 1.9, 19.9]) {
    const bid = terminal.decideBid({ ...context('CA', { myBalance }), letter: 'T' });
    assert.ok(Number.isSafeInteger(bid) && bid >= 0);
    assert.ok(bid <= (Number.isFinite(myBalance) ? Math.max(0, Math.floor(myBalance)) : 0));
  }
});
