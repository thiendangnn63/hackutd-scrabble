import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WordEngine, canSpell, type Rack } from '../src/engine.js';
import { Strategy, type StrategyContext } from '../src/strategy.js';
import { HoldingStrategy, type HoldingVariant } from '../src/holding.js';
const variants: HoldingVariant[] = ['leave', 'partition', 'six-patient', 'six-cash', 'six-score'];
const engine = new WordEngine(['AA', 'AX', 'CAT', 'CATS', 'CATER', 'CARTED', 'RETAINS', 'RATES', 'TRAINERS', 'ET', 'RS']);
function rack(letters: string): Rack { const r: Rack = new Map(); for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1); return r; }
function context(letters: string, overrides: Partial<StrategyContext> = {}): StrategyContext {
  return { myRack: rack(letters), myBalance: 100, remainingTiles: 40, auctionType: 'Vickrey', observedPrices: [9, 10, 11], ...overrides };
}

test('holding experiments preserve exactly the production bidding policy', () => {
  const base = new Strategy(engine, 'market-all');
  for (const variant of variants) {
    const candidate = new HoldingStrategy(engine, variant);
    for (const letters of ['', 'CAT', 'CARTED', 'RETAINSX']) for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const auctionType of ['Vickrey', 'FirstPrice'] as const) {
        const ctx = { ...context(letters, { auctionType }), letter };
        assert.equal(candidate.decideBid(ctx), base.decideBid(ctx), `${variant} ${letters} ${letter} ${auctionType}`);
      }
    }
  }
});

test('every holding experiment makes legal progress and flushes at the deadline', () => {
  for (const variant of variants) {
    const candidate = new HoldingStrategy(engine, variant);
    for (const letters of ['CARTED', 'RETAINS', 'TRAINERSAX']) {
      const ctx = context(letters, { remainingTiles: 0 });
      let count = 0;
      while (true) {
        const word = candidate.chooseWord(ctx);
        if (!word) break;
        assert.ok(canSpell(word, ctx.myRack));
        for (const letter of word) ctx.myRack.set(letter, ctx.myRack.get(letter)! - 1);
        assert.ok(++count <= letters.length / 2);
      }
      assert.ok(count > 0);
    }
  }
});
