import test from 'node:test';
import assert from 'node:assert/strict';
import { WordEngine, canSpell } from '../src/engine.js';
import { Strategy, type StrategyContext } from '../src/strategy.js';
const engine = new WordEngine(['AT','CAT','CATS','CAST','SCAT','ACT','ACTS','CART','CARTS','CATER','CRATE','TRACE','REACT','TRACES','CATERS','REACTS','RECAST','QUIZ','QUIZZES','QUIZZER']);
const rack = (s: string) => { const r = new Map<string,number>(); for(const c of s) r.set(c,(r.get(c)??0)+1); return r; };
const ctx = (letters: string, changes: Partial<StrategyContext> = {}): StrategyContext => ({myRack:rack(letters),myBalance:100,remainingTiles:30,auctionType:'Vickrey',...changes});
test('every bidder respects integer balance and unusable final tile', () => {
  for(const mode of ['starter','greedy','hoard','adaptive','aggressive','patient','market','market-focused','market-all','market-budget','market-pressure','market-margin'] as const) {
    const bot = new Strategy(engine,mode);
    for(const money of [0,1,2,10,100]) for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const bid = bot.decideBid({...ctx('CAT',{myBalance:money}),letter});
      assert.ok(Number.isSafeInteger(bid) && bid>=0 && bid<=money);
      assert.equal(bot.decideBid({...ctx('CAT',{myBalance:money,remainingTiles:0}),letter}),0);
    }
  }
});
test('endgame liquidates playable words and never invents letters', () => {
  const bot = new Strategy(engine);
  let r=rack('CATSCAT');
  for(let i=0;i<10;i++) {
    const word=bot.chooseWord({...ctx('',{remainingTiles:0}),myRack:r});
    if(word===null) break;
    assert.ok(canSpell(word,r));
    for(const c of word) r.set(c,r.get(c)!-1);
  }
  assert.equal(engine.best(r),null);
});
test('mature seven-letter word is redeemed before waiting for speculative gains', () => {
  const bot=new Strategy(engine);
  assert.equal(bot.chooseWord(ctx('QUIZZES')),'QUIZZES');
});
test('first price shading reduces the same reservation bid', () => {
  const bot=new Strategy(engine);
  const v=bot.decideBid({...ctx('CAT'),letter:'S'});
  const f=bot.decideBid({...ctx('CAT',{auctionType:'FirstPrice'}),letter:'S'});
  assert.ok(f<=v && v>0);
});
test('liquidity fallback redeems a short word', () => {
  const bot=new Strategy(engine);
  assert.ok(bot.chooseWord(ctx('CAT',{myBalance:2}))!==null);
});
test('completing a valuable word is worth more than a dead duplicate', () => {
  const bot=new Strategy(engine);
  assert.ok(bot.decideBid({...ctx('QUIZZE'),letter:'S'})>bot.decideBid({...ctx('QUIZZE'),letter:'Q'}));
});

test('original market policy keeps Vickrey reservation values and uses price history only for first-price', () => {
  const market=new Strategy(engine,'market');
  const plain=new Strategy(engine,'aggressive');
  assert.equal(market.mode,'market');
  const v={...ctx('CAT',{observedPrices:Array(10).fill(12)}),letter:'S'};
  assert.equal(market.decideBid(v),plain.decideBid(v));
  const f={...v,auctionType:'FirstPrice' as const};
  assert.ok(market.decideBid(f)>plain.decideBid(f));
});

test('sub-250ms auctions use fast legal best-word endgame fallback', () => {
  const shortEngine=new WordEngine(['CAT','CATS','AT']);
  shortEngine.liquidation=()=>{throw new Error('partition should not run in a fast auction');};
  const bot=new Strategy(shortEngine);
  const word=bot.chooseWord(ctx('CATS',{remainingTiles:0,auctionDurationMs:100}));
  assert.equal(word,'CATS');
});

test('all-format floors restart a depleted Vickrey rack using public prices', () => {
  const emptyEngine=new WordEngine(['AT','CAT','CATS']);
  const old=new Strategy(emptyEngine,'market');
  const all=new Strategy(emptyEngine,'market-all');
  const margin=new Strategy(emptyEngine,'market-margin');
  const state={...ctx('R',{myBalance:104,remainingTiles:63,observedPrices:Array(20).fill(12)}),letter:'E'};
  assert.ok(old.decideBid(state)<10);
  assert.equal(all.decideBid(state),13);
  assert.equal(margin.decideBid(state),15);
});
test('new acquisition floors do not buy a penultimate tile with no playable gain', () => {
  const bot=new Strategy(engine,'market-all');
  assert.equal(bot.decideBid({...ctx('',{remainingTiles:1,observedPrices:[20,20,20]}),letter:'Q'}),0);
});

test('selected default applies acquisition floors to both auction formats', () => {
  const bot=new Strategy(engine);
  assert.equal(bot.mode,'market-all');
});
