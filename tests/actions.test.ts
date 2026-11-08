import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionLoop, rackKey, type MatchView, type Policy, type Transport } from '../src/actions.js';
import { canSpell, type Rack } from '../src/engine.js';

function rack(letters: string): Rack {
  const out: Rack = new Map();
  for (const letter of letters) out.set(letter, (out.get(letter) ?? 0) + 1);
  return out;
}

function view(changes: Partial<MatchView> = {}): MatchView {
  return {
    matchId: 1n, myRack: rack('CATDOG'), myBalance: 100,
    remainingTiles: 20, auctionType: 'Vickrey',
    auction: { id: 10n, letter: 'S', closesAtMs: 10_000 },
    ...changes,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(policyChanges: Partial<Policy> = {}) {
  const words: Array<ReturnType<typeof deferred> & { matchId: bigint; word: string }> = [];
  const bids: Array<ReturnType<typeof deferred> & { auctionId: bigint; amount: number }> = [];
  const policy: Policy = {
    chooseWord: () => null,
    decideBid: () => 3,
    ...policyChanges,
  };
  const transport: Transport = {
    submitWord(matchId, word) {
      const call = { ...deferred(), matchId, word };
      words.push(call);
      return call.promise;
    },
    submitBid(auctionId, amount) {
      const call = { ...deferred(), auctionId, amount };
      bids.push(call);
      return call.promise;
    },
  };
  return { loop: new ActionLoop(policy, transport, () => {}), words, bids };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('duplicate event ticks submit one bid before and after acknowledgement', async () => {
  const { loop, bids } = harness();
  const match = view();
  for (let n = 0; n < 10; n++) loop.tick([match], 1_000);
  assert.equal(bids.length, 1);
  assert.deepEqual([bids[0].auctionId, bids[0].amount], [10n, 3]);
  bids[0].resolve();
  await settle();
  for (let n = 0; n < 10; n++) loop.tick([match], 1_100);
  assert.equal(bids.length, 1);
});

test('word acknowledgement before the authoritative rack update cannot spend the old rack twice', async () => {
  const { loop, words } = harness({ chooseWord: ctx => canSpell('ACT', ctx.myRack) ? 'ACT' : null });
  const initial = view({ myRack: rack('CATCAT') });
  loop.tick([initial], 1_000);
  for (let n = 0; n < 5; n++) loop.tick([initial], 1_001);
  assert.equal(words.length, 1);
  words[0].resolve();
  await settle();
  loop.tick([initial], 1_100);
  assert.equal(words.length, 1);
  loop.tick([view({ myRack: rack('CAT') })], 1_101);
  assert.equal(words.length, 2);
  assert.deepEqual(words.map(call => call.word), ['ACT', 'ACT']);
});

test('rack events received while a word is pending wait for its acknowledgement', async () => {
  const { loop, words, bids } = harness({
    chooseWord: ctx => canSpell('ACT', ctx.myRack) ? 'ACT' : canSpell('DOG', ctx.myRack) ? 'DOG' : null,
  });
  loop.tick([view()], 1_000);
  loop.tick([view({ myRack: rack('DOG'), myBalance: 105 })], 1_010);
  assert.equal(words.length, 1);
  assert.equal(bids.length, 0);
  words[0].resolve();
  await settle();
  loop.tick([view({ myRack: rack('DOG'), myBalance: 105 })], 1_020);
  assert.equal(words.length, 2);
  assert.equal(words[1].word, 'DOG');
  assert.equal(bids.length, 0);
  words[1].resolve();
  await settle();
  loop.tick([view({ myRack: rack(''), myBalance: 110 })], 1_030);
  assert.equal(words.length, 2);
  assert.equal(bids.length, 1);
});

test('bid transport receives only finite nonnegative integer amounts within confirmed cash', () => {
  for (const proposed of [NaN, Infinity, -Infinity, -10, -0.5, 0, 0.9, 2.9, 1e100]) {
    for (const balance of [0, 1, 2.8, 100, NaN, Infinity, -5]) {
      const { loop, bids } = harness({ decideBid: () => proposed });
      loop.tick([view({ myBalance: balance })], 1_000);
      for (const call of bids) {
        assert.ok(Number.isSafeInteger(call.amount) && call.amount >= 0,
          `proposed=${proposed}, balance=${balance}, emitted=${call.amount}`);
        const validCash = Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
        assert.ok(call.amount <= validCash,
          `proposed=${proposed}, balance=${balance}, emitted=${call.amount}`);
      }
    }
  }
});

test('the final auction skips a fresh bid and withdraws an earlier positive bid', async () => {
  let policyCalls = 0;
  const { loop, bids } = harness({ decideBid: () => { policyCalls++; return 20; } });
  loop.tick([view({ remainingTiles: 0 })], 1_000);
  assert.equal(bids.length, 0);
  assert.equal(policyCalls, 0);
  loop.reset();
  loop.tick([view({ remainingTiles: 1 })], 1_010);
  assert.equal(bids.length, 1);
  assert.equal(bids[0].amount, 20);
  bids[0].resolve();
  await settle();
  loop.tick([view({ remainingTiles: 0 })], 1_020);
  assert.equal(bids.length, 2);
  assert.equal(bids[1].amount, 0);
  assert.equal(policyCalls, 1);
  bids[1].resolve();
  await settle();
  loop.tick([view({ remainingTiles: 0 })], 1_030);
  assert.equal(bids.length, 2);
});

test('bids are suppressed for expired auctions and the final 75ms safety window', () => {
  for (const closesAtMs of [900, 1_000, 1_074]) {
    const { loop, bids } = harness();
    loop.tick([view({ auction: { id: 10n, letter: 'S', closesAtMs } })], 1_000);
    assert.equal(bids.length, 0, `deadline ${closesAtMs}`);
  }
  const { loop, bids } = harness();
  loop.tick([view({ auction: { id: 10n, letter: 'S', closesAtMs: 1_100 } })], 1_000);
  assert.equal(bids.length, 1);
});

test('a decision that exhausts the auction window never sends a late bid', t => {
  let monotonic = 0;
  t.mock.method(performance, 'now', () => monotonic);
  const { loop, bids } = harness({ decideBid: () => { monotonic = 40; return 10; } });
  loop.tick([view({ auction: { id: 10n, letter: 'S', closesAtMs: 1_100 } })], 1_000);
  assert.equal(bids.length, 0);
});

test('short configured auctions use a proportionate margin and recheck after computation', t => {
  let monotonic = 0;
  t.mock.method(performance, 'now', () => monotonic);
  const { loop, bids } = harness();
  loop.tick([view({ auction: { id: 10n, letter: 'S', closesAtMs: 1_040, durationMs: 50 } })], 1_000);
  assert.equal(bids.length, 1);
  const slow = harness({ decideBid: () => { monotonic = 36; return 3; } });
  slow.loop.tick([view({ auction: { id: 10n, letter: 'S', closesAtMs: 1_040, durationMs: 50 } })], 1_000);
  assert.equal(slow.bids.length, 0);
});

test('a failed word retries after backoff without requiring a rack event', async t => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const { loop, words } = harness({ chooseWord: () => 'ACT' });
  loop.tick([view()]);
  words[0].reject(new Error('temporary transport failure'));
  await settle();
  now = 1_249;
  loop.tick([view()]);
  assert.equal(words.length, 1);
  now = 1_250;
  loop.tick([view()]);
  assert.equal(words.length, 2);
});

test('a failed bid retries after backoff without requiring a table event', async t => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const { loop, bids } = harness();
  loop.tick([view()]);
  bids[0].reject(new Error('temporary transport failure'));
  await settle();
  now = 1_149;
  loop.tick([view()]);
  assert.equal(bids.length, 1);
  now = 1_150;
  loop.tick([view()]);
  assert.equal(bids.length, 2);
  assert.equal(bids[1].amount, 3);
});

test('match and auction locks do not suppress independent active matches', async () => {
  const { loop, words, bids } = harness({ chooseWord: ctx => canSpell('ACT', ctx.myRack) ? 'ACT' : null });
  const first = view({ myRack: rack('CAT') });
  const second = view({ matchId: 2n, myRack: rack('ZZ'), auction: { id: 20n, letter: 'E', closesAtMs: 10_000 } });
  loop.tick([first, second], 1_000);
  assert.deepEqual(words.map(call => call.matchId), [1n]);
  assert.deepEqual(bids.map(call => call.auctionId), [20n]);
  loop.tick([first, second], 1_010);
  assert.equal(words.length, 1);
  assert.equal(bids.length, 1);
  words[0].resolve();
  bids[0].resolve();
  await settle();
  // Removing match 1 retires its locks without clearing match 2's bid.
  loop.tick([second], 1_020);
  assert.equal(bids.length, 1);
  const third = view({ matchId: 3n, myRack: rack('ZZ'), auction: { id: 30n, letter: 'A', closesAtMs: 10_000 } });
  loop.tick([second, third], 1_030);
  assert.deepEqual(bids.map(call => call.auctionId), [20n, 30n]);
});

test('rack fingerprints ignore row order and zero-count deletion artifacts', () => {
  assert.equal(rackKey(new Map([['T', 1], ['A', 1], ['C', 1], ['Z', 0]])), rackKey(rack('CAT')));
  assert.notEqual(rackKey(rack('CAT')), rackKey(rack('CAAT')));
});

test('reset allows a reconnected process to reassess the current auction', async () => {
  const { loop, bids } = harness();
  loop.tick([view()], 1_000);
  bids[0].resolve();
  await settle();
  loop.tick([view()], 1_010);
  assert.equal(bids.length, 1);
  loop.reset();
  loop.tick([view()], 1_020);
  assert.equal(bids.length, 2);
});
