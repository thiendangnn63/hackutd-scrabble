import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WordEngine, canSpell, scoreWord, DEFAULT_BAG, type Rack } from '../src/engine.js';

function rack(letters: string): Rack {
  const out: Rack = new Map();
  for (const letter of letters) out.set(letter, (out.get(letter) ?? 0) + 1);
  return out;
}

test('server payouts floor half points and cap multiplier at seven letters', () => {
  assert.equal(scoreWord('AA'), 2);
  assert.equal(scoreWord('RATE'), 6);
  assert.equal(scoreWord('BAKE'), 15);
  assert.equal(scoreWord('CATS'), 9);
  assert.equal(scoreWord('CATER'), 14);
  assert.equal(scoreWord('CARTED'), 22);
  assert.equal(scoreWord('RETAINS'), 21);
  assert.equal(scoreWord('TRAINERS'), 24);
  assert.equal(scoreWord('NOT-A-WORD'), 0);
});

test('official bag has 98 tiles and no blanks', () => {
  assert.equal(Object.values(DEFAULT_BAG).reduce((sum, count) => sum + count, 0), 98);
  assert.equal(DEFAULT_BAG.Q, 1);
  assert.equal(DEFAULT_BAG['?'], undefined);
});

test('rack matching consumes repeated letters and leaves original rack intact', () => {
  const tiles = rack('BALON');
  assert.equal(canSpell('BALL', tiles), false);
  assert.equal(canSpell('BALON', tiles), true);
  assert.deepEqual(tiles, rack('BALON'));
});

test('dictionary filters invalid entries and deduplicates equivalent anagrams', () => {
  const engine = new WordEngine(['cat', 'ACT', ' CAT ', 'A', 'DOG!', '', 'AA']);
  assert.equal(engine.wordCount, 3);
  assert.equal(engine.signatureCount, 2);
  assert.deepEqual(engine.playable(rack('CAT')), [{ word: 'ACT', score: 5 }]);
  assert.deepEqual(engine.best(rack('AA')), { word: 'AA', score: 2 });
  assert.equal(engine.best(rack('X')), null);
});

test('best chooses payout instead of length and includes two-letter words', () => {
  const engine = new WordEngine(['RETAIN', 'AX', 'ZA', 'QI']);
  assert.equal(engine.best(rack('RETAINAX'))?.word, 'RETAIN');
  assert.equal(new WordEngine(['RATE', 'AX']).best(rack('RATEX'))?.word, 'AX');
});

test('one- and two-tile completions count exact deficits and exclude playable words', () => {
  const engine = new WordEngine(['BALLOON', 'BALL', 'BOON', 'AA']);
  assert.deepEqual(engine.completions(rack('BALON'), 1).map(({ word, missing }) => ({ word, missing })), [
    { word: 'BALL', missing: 'L' }, { word: 'BOON', missing: 'O' }, { word: 'AA', missing: 'A' },
  ]);
  assert.deepEqual(engine.completions(rack('BALON'), 2).find(c => c.word === 'BALLOON')?.missing, 'LO');
  assert.equal(engine.completions(rack('BALL'), 1).some(c => c.word === 'BALL'), false);
  assert.deepEqual(engine.completions(rack('BALON'), 0), []);
});

test('liquidation finds disjoint partition beating the longest word', () => {
  const engine = new WordEngine(['RATES', 'AX', 'ET', 'RS']);
  const result = engine.liquidation(rack('RATESX'));
  assert.equal(result.score, scoreWord('AX') + scoreWord('ET') + scoreWord('RS'));
  assert.equal(result.exact, true);
  const remaining = rack('RATESX');
  for (const word of result.words) {
    assert.equal(canSpell(word, remaining), true);
    for (const letter of word) remaining.set(letter, remaining.get(letter)! - 1);
  }
});

test('liquidation allows repeated words with enough letters and marks bounded search', () => {
  const engine = new WordEngine(['AA', 'AB', 'BA', 'BB']);
  assert.equal(engine.liquidation(rack('AAAA')).score, 4);
  const bounded = engine.liquidation(rack('AAAABBBB'), 1);
  assert.equal(bounded.exact, false);
  assert.ok(bounded.score > 0);
});

test('cached results cannot be poisoned by array or result mutation', () => {
  const engine = new WordEngine(['CAT', 'AA']);
  engine.playable(rack('CAT')).pop();
  assert.equal(engine.best(rack('CAT'))?.word, 'CAT');
  const first = engine.liquidation(rack('AAAA'));
  first.words.length = 0;
  assert.deepEqual(engine.liquidation(rack('AAAA')).words, ['AA', 'AA']);
});

test('indexed playable and completion queries agree with an independent multiset oracle', () => {
  const dictionary = ['AA', 'AB', 'BA', 'BB', 'ABC', 'AABC', 'CAB', 'BAD', 'DAB', 'CABB', 'DAD', 'ADDED'];
  const engine = new WordEngine(dictionary, 0);
  const canonical = new Map<string, string>();
  for (const word of dictionary) {
    const key = [...word].sort().join('');
    const prior = canonical.get(key);
    if (!prior || word < prior) canonical.set(key, word);
  }
  for (let mask = 0; mask < 256; mask++) {
    let remainder = mask;
    let letters = '';
    for (const letter of 'ABCD') {
      letters += letter.repeat(remainder % 4);
      remainder = Math.floor(remainder / 4);
    }
    const tiles = rack(letters);
    for (const limit of [0, 1, 2]) {
      const expected = [...canonical.values()].flatMap(word => {
        const available = [...letters];
        let missing = '';
        for (const letter of [...word].sort()) {
          const index = available.indexOf(letter);
          if (index >= 0) available.splice(index, 1);
          else missing += letter;
        }
        return missing.length <= limit && (limit === 0 || missing.length > 0) ? [`${word}:${missing}`] : [];
      }).sort();
      const actual = limit === 0
        ? engine.playable(tiles).map(entry => `${entry.word}:`).sort()
        : engine.completions(tiles, limit).map(entry => `${entry.word}:${entry.missing}`).sort();
      assert.deepEqual(actual, expected, `rack=${letters}, missingLimit=${limit}`);
    }
  }
});

test('liquidation matches an independent subset partition oracle for every small rack', () => {
  const words = ['AA', 'AB', 'BB', 'ABC', 'AAC', 'BC'];
  const engine = new WordEngine(words);
  const solve = (letters: string): number => {
    let best = 0;
    for (const word of words) {
      const remaining = [...letters];
      let valid = true;
      for (const letter of word) {
        const index = remaining.indexOf(letter);
        if (index < 0) { valid = false; break; }
        remaining.splice(index, 1);
      }
      if (valid) best = Math.max(best, scoreWord(word) + solve(remaining.join('')));
    }
    return best;
  };
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) {
    const letters = 'A'.repeat(a) + 'B'.repeat(b) + 'C'.repeat(c);
    const result = engine.liquidation(rack(letters));
    assert.equal(result.exact, true);
    assert.equal(result.score, solve(letters), letters);
  }
});

test('top-only search preserves full-query payout, length, and lexical ranking', () => {
  const engine = new WordEngine(['AA', 'AB', 'BA', 'BBA', 'ABC', 'BCD', 'ABCD', 'DAB', 'ADDED']);
  for (const letters of ['AA', 'AB', 'ABC', 'AABBCCD', 'ADDE', 'X', '']) {
    const tiles = rack(letters);
    assert.deepEqual(engine.best(tiles), engine.playable(tiles)[0] ?? null);
    for (const missing of [1, 2]) {
      assert.deepEqual(engine.bestCompletion(tiles, missing), engine.completions(tiles, missing)[0] ?? null);
    }
  }
});

test('dictionary rejects non-ASCII expansion and physically impossible huge words', () => {
  const engine = new WordEngine(['faß', 'CAT', 'AA', 'A'.repeat(99), 'ÅA', 'DOG\0']);
  assert.equal(engine.wordCount, 2);
  assert.equal(engine.best(rack('FASS')), null);
});
