/** Independent official-dictionary oracle and cold/warm/uncached strategy stress test.
 * Run: npx tsx scripts/verify-engine.ts --output=docs/performance-results.json
 * Seed is fixed; elapsed timings depend on hardware and process load.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { cpus, platform, arch } from 'node:os';
import { WordEngine, DEFAULT_BAG, scoreWord, canSpell, type Rack } from '../src/engine.js';
import { Strategy } from '../src/strategy.js';
const words = readFileSync('data/wordlist.txt', 'utf8').trim().split('\n').map(w => w.trim().toUpperCase());
let seed = 0x6e7a10;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const bag = Object.entries(DEFAULT_BAG).flatMap(([c, n]) => Array(n).fill(c));
const shuffle = () => { const a = [...bag]; for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
} return a; };
const rack = (s: string): Rack => { const r: Rack = new Map(); for (const c of s)
    r.set(c, (r.get(c) ?? 0) + 1); return r; };
const time = <T>(fn: () => T) => { const a = performance.now(); const value = fn(); return { ms: performance.now() - a, value }; };
const stats = (a: number[]) => { a.sort((x, y) => x - y); return { n: a.length, p50: a[Math.floor(a.length * .5)], p95: a[Math.floor(a.length * .95)], max: a.at(-1) }; };
const build = time(() => new WordEngine(words));
const e = build.value;
const strategy = new Strategy(e);
const pathological = [];
for (const n of [5, 10, 20, 30, 50, 98]) {
    const s = shuffle().slice(0, n).join('');
    const r = rack(s);
    const ctx = { myRack: r, myBalance: 100, remainingTiles: 30, auctionType: 'Vickrey' as const, letter: 'E' };
    const cold = time(() => ({ word: strategy.chooseWord(ctx), bid: strategy.decideBid(ctx) }));
    const warm = [];
    for (let j = 0; j < 25; j++)
        warm.push(time(() => { strategy.chooseWord(ctx); strategy.decideBid(ctx); }).ms);
    const uncached = new Strategy(new WordEngine(words, 0));
    const noCache = [];
    for (let j = 0; j < 10; j++)
        noCache.push(time(() => { uncached.chooseWord(ctx); uncached.decideBid(ctx); }).ms);
    pathological.push({ n, rack: s, coldMs: cold.ms, choices: cold.value, warm: stats(warm), noCache: stats(noCache) });
}
const dictionaryCanonical = new Map<string, string>();
for (const w of words) {
    const sig = [...w].sort().join('');
    const prior = dictionaryCanonical.get(sig);
    if (!prior || w < prior)
        dictionaryCanonical.set(sig, w);
}
const counted = [...dictionaryCanonical.values()].map(word => { const c = new Uint8Array(26); for (const x of word)
    c[x.charCodeAt(0) - 65]++; return { word, counts: c, score: scoreWord(word) }; });
const comparisons = [];
const topComparisons = [];
let queried = 0;
for (let i = 0; i < 100; i++) {
    const s = shuffle().slice(0, 2 + Math.floor(rand() * 29)).join('');
    const r = rack(s);
    const counts = new Uint8Array(26);
    for (const c of s)
        counts[c.charCodeAt(0) - 65]++;
    const oracle = time(() => { const ready: string[] = []; const near: string[] = []; for (const item of counted) {
        let misses = 0;
        let missing = '';
        for (let j = 0; j < 26; j++) {
            const d = item.counts[j] - counts[j];
            if (d > 0) {
                misses += d;
                if (misses > 1)
                    break;
                missing += String.fromCharCode(65 + j).repeat(d);
            }
        }
        if (misses === 0)
            ready.push(item.word);
        else if (misses === 1)
            near.push(item.word + ':' + missing);
    } return { ready: ready.sort(), near: near.sort() }; });
    const indexed = time(() => ({ ready: e.playable(r).map(x => x.word).sort(), near: e.completions(r, 1).map(x => x.word + ':' + x.missing).sort() }));
    assert.deepEqual(indexed.value, oracle.value, `rack ${i} ${s}`);
    queried += indexed.value.ready.length + indexed.value.near.length;
    comparisons.push({ n: s.length, oracleMs: oracle.ms, indexedMs: indexed.ms });
    const naiveTop = time(() => {
        let ready: null | {
            word: string;
            score: number;
        } = null;
        let near: null | {
            word: string;
            score: number;
            missing: string;
        } = null;
        const better = (a: {
            word: string;
            score: number;
        }, b: null | {
            word: string;
            score: number;
        }) => !b || a.score > b.score || (a.score === b.score && (a.word.length > b.word.length || (a.word.length === b.word.length && a.word < b.word)));
        for (const item of counted) {
            let misses = 0;
            let missing = '';
            for (let j = 0; j < 26; j++) {
                const d = item.counts[j] - counts[j];
                if (d > 0) {
                    misses += d;
                    if (misses > 1)
                        break;
                    missing += String.fromCharCode(65 + j).repeat(d);
                }
            }
            if (misses === 0 && better(item, ready))
                ready = { word: item.word, score: item.score };
            else if (misses === 1 && better(item, near))
                near = { word: item.word, score: item.score, missing };
        }
        return { ready, near };
    });
    const indexedTop = time(() => ({ ready: e.best(r), near: e.bestCompletion(r) }));
    assert.deepEqual(indexedTop.value, naiveTop.value);
    topComparisons.push({ n: s.length, oracleMs: naiveTop.ms, indexedMs: indexedTop.ms });
}
const matches = Array.from({ length: 4 }, (_, i) => ({ myRack: rack(shuffle().slice(0, 7 + i * 3).join('')), myBalance: 100, remainingTiles: 20, auctionType: 'Vickrey' as const, letter: 'E' }));
const multiStrategy = new Strategy(new WordEngine(words));
const batch = [];
for (let i = 0; i < 100; i++)
    batch.push(time(() => { for (const ctx of matches) {
        multiStrategy.chooseWord(ctx);
        multiStrategy.decideBid(ctx);
    } }).ms);
const pathologicalMatches = Array.from({ length: 4 }, (_, i) => ({ myRack: rack(shuffle().slice(0, [20, 30, 50, 98][i]).join('')), myBalance: 100, remainingTiles: 20, auctionType: 'Vickrey' as const, letter: 'E' }));
const pathologicalStrategy = new Strategy(new WordEngine(words));
const pathologicalBatch = [];
for (let i = 0; i < 25; i++)
    pathologicalBatch.push(time(() => { for (const ctx of pathologicalMatches) {
        pathologicalStrategy.chooseWord(ctx);
        pathologicalStrategy.decideBid(ctx);
    } }).ms);
const endgame = [];
for (const n of [20, 30, 50, 98]) {
    const initial = shuffle().slice(0, n).join('');
    const tiles = rack(initial);
    const elapsed = [];
    const played = [];
    let score = 0;
    while (true) {
        const choice = time(() => strategy.chooseWord({ myRack: tiles, myBalance: 100, remainingTiles: 0, auctionType: 'Vickrey' }));
        elapsed.push(choice.ms);
        if (!choice.value)
            break;
        assert.ok(canSpell(choice.value, tiles));
        played.push(choice.value);
        score += scoreWord(choice.value);
        for (const letter of choice.value)
            tiles.set(letter, tiles.get(letter)! - 1);
        assert.ok(played.length <= Math.floor(n / 2), 'word liquidation must make progress');
    }
    endgame.push({ initialTiles: n, words: played.length, score, totalCpuMs: elapsed.reduce((a, b) => a + b, 0), latency: stats(elapsed) });
}
const shortAuctionEndgame = [];
const uncachedShortStrategy = new Strategy(new WordEngine(words, 0));
for (const n of [20, 30, 50, 98]) {
    const tiles = rack(shuffle().slice(0, n).join(''));
    const elapsed = [];
    const played = [];
    let score = 0;
    while (true) {
        const choice = time(() => uncachedShortStrategy.chooseWord({ myRack: tiles, myBalance: 100, remainingTiles: 0, auctionType: 'Vickrey', auctionDurationMs: 100 }));
        elapsed.push(choice.ms);
        if (!choice.value) break;
        assert.ok(canSpell(choice.value, tiles));
        played.push(choice.value);
        score += scoreWord(choice.value);
        for (const letter of choice.value) tiles.set(letter, tiles.get(letter)! - 1);
        assert.ok(played.length <= Math.floor(n / 2), 'short-auction fallback must make progress');
    }
    shortAuctionEndgame.push({ initialTiles: n, auctionDurationMs: 100, words: played.length, score, totalCpuMs: elapsed.reduce((a, b) => a + b, 0), latency: stats(elapsed) });
}
const malformed = time(() => new WordEngine(['aa', ' AA ', 'a', 'X-Y', 'CAFÉ', 'DOG\0', '42', 'CAT', 'cat', '', 'A'.repeat(5000)]));
const result = { host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model }, strategy: strategy.mode, endgame, shortAuctionEndgame, seed: '0x6e7a10', node: process.version, words: e.wordCount, signatures: e.signatureCount, buildMs: build.ms, pathological, randomizedOracle: { racks: 100, matchedResults: queried, oracle: stats(comparisons.map(c => c.oracleMs)), indexed: stats(comparisons.map(c => c.indexedMs)) }, fourMatches: stats(batch), fourPathologicalMatches: stats(pathologicalBatch), randomizedTop: { oracle: stats(topComparisons.map(c => c.oracleMs)), indexed: stats(topComparisons.map(c => c.indexedMs)) }, malformed: { buildMs: malformed.ms, wordCount: malformed.value.wordCount, best: malformed.value.best(rack('AACAT')) } };
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
if (output)
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
