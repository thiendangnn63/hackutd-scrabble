import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WordEngine, canSpell, type Rack } from '../src/engine.js';
import { LookaheadStrategy } from '../src/lookahead.js';
import type { StrategyContext } from '../src/strategy.js';
function rack(letters: string): Rack { const r: Rack = new Map(); for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1); return r; }
function context(letters: string, overrides: Partial<StrategyContext> = {}): StrategyContext {
  return { myRack: rack(letters), myBalance: 100, remainingTiles: 40, auctionType: 'Vickrey', ...overrides };
}

test('lookahead keeps all bids integer, affordable, and skips final tile', () => {
  const bot = new LookaheadStrategy(new WordEngine(['AA', 'CAT', 'CATS', 'RATE', 'RATES', 'RETAINS', 'QI']));
  for (const money of [0, 1, 2, 10, 100]) for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const bid = bot.decideBid({ ...context('CATER', { myBalance: money }), letter: c });
    assert.ok(Number.isInteger(bid) && bid >= 0 && bid <= money);
    assert.equal(bot.decideBid({ ...context('CATER', { myBalance: money, remainingTiles: 0 }), letter: c }), 0);
  }
});

test('missing common letters have higher expected arrival value than equally scored rare letters', () => {
  const common = new LookaheadStrategy(new WordEngine(['AAAAE']));
  const rare = new LookaheadStrategy(new WordEngine(['AAAAQ']));
  // Compare normalized opportunity probabilities by removing the different scores.
  const c = common.analyze(context('AAAA', { observedPrices: [1] }));
  const q = rare.analyze(context('AAAA', { observedPrices: [1] }));
  assert.ok(c.optionScore / (10 - 1) > q.optionScore / (28 - 1));
});

test('two-complement future value vanishes when fewer auctions remain than missing tiles', () => {
  const bot = new LookaheadStrategy(new WordEngine(['CATER']));
  assert.ok(bot.analyze(context('CAT')).optionScore > 0);
  assert.equal(bot.analyze(context('CAT', { remainingTiles: 1 })).optionScore, 0);
});

test('endgame liquidates legal words and near-zero cash redeems capital', () => {
  const bot = new LookaheadStrategy(new WordEngine(['CAT', 'CATS', 'CATER', 'RETAINS']));
  const ctx = context('CATS', { remainingTiles: 0 });
  const word = bot.chooseWord(ctx);
  assert.ok(word && canSpell(word, ctx.myRack));
  assert.equal(bot.chooseWord(context('CAT', { myBalance: 1 })), 'CAT');
  assert.equal(bot.chooseWord(context('RETAINS')), 'RETAINS');
});

test('an affordable market floor reseeds an emptied rack after word redemption', () => {
  const bot = new LookaheadStrategy(new WordEngine(['AA', 'CAT', 'CATER']));
  assert.ok(bot.decideBid({ ...context('', { observedPrices: [9, 10, 11], myBalance: 104, remainingTiles: 63 }), letter: 'E' }) >= 10);
});

test('repeated complement letters use a two-arrival probability, not one', () => {
  const once = new LookaheadStrategy(new WordEngine(['AAAB']));
  const twice = new LookaheadStrategy(new WordEngine(['AAABB']));
  const a = once.analyze(context('AAA', { observedPrices: [1] }));
  const b = twice.analyze(context('AAA', { observedPrices: [1] }));
  assert.ok(a.optionScore / (9 - 1) > b.optionScore / (18 - 2));
});

test('known tile ownership rules out a completion requiring more than the entire bag', () => {
  const bot = new LookaheadStrategy(new WordEngine(['QIQQ']));
  assert.equal(bot.analyze(context('QI')).optionScore, 0);
});
