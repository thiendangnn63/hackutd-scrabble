import { DEFAULT_BAG, WordEngine, type Rack, type WordMatch } from './engine.js';
import type { StrategyContext } from './strategy.js';

interface Option { missing: string; score: number }
interface Features { best: WordMatch | null; tiles: number; vowels: number; equity: number; options: Option[] }
export interface LookaheadOptions { marginalScale?: number; holdThreshold?: number; horizon?: number }
export interface RackAnalysis { readyScore: number; optionScore: number; expectedScore: number; marketPrice: number; tiles: number }
const VOWELS = new Set('AEIOU');
// Acquisition usefulness, rather than face value, gives stranded Q/J a small baseline.
const TILE_EQUITY: Readonly<Record<string, number>> = {
  A: 2.4, B: 1.5, C: 2.4, D: 2.2, E: 2.6, F: 1.6, G: 1.8, H: 2.0, I: 2.1,
  J: 0.6, K: 1.2, L: 2.2, M: 1.9, N: 2.5, O: 2.2, P: 1.8, Q: 0.3,
  R: 2.5, S: 3.0, T: 2.5, U: 1.6, V: 1.2, W: 1.3, X: 1.6, Y: 1.5, Z: 1.0,
};

/** Experimental two-complement expected-value policy; uses no private information.
 * Missing-letter opportunities are grouped by inventory to avoid counting anagrams
 * as separate chances. Chance estimates deliberately remain approximate: private
 * initial deals and opponents' choices prevent exact bag or winning probabilities.
 */
export class LookaheadStrategy {
  private readonly cache = new Map<string, Features>();
  private readonly marginalScale: number;
  private readonly holdThreshold: number;
  private readonly horizon: number;
  constructor(readonly engine: WordEngine, options: LookaheadOptions = {}) {
    this.marginalScale = options.marginalScale ?? 1.5;
    this.holdThreshold = options.holdThreshold ?? 2.5;
    this.horizon = options.horizon ?? 30;
  }

  private features(rack: Rack): Features {
    const key = [...rack].filter(([, count]) => count > 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([letter, count]) => `${letter}${count}`).join('');
    const cached = this.cache.get(key);
    if (cached) return cached;
    let tiles = 0;
    let vowels = 0;
    let equity = 0;
    for (const [letter, count] of rack) {
      if (!Number.isFinite(count) || count <= 0) continue;
      tiles += count;
      if (VOWELS.has(letter)) vowels += count;
      for (let n = 0; n < count; n++) equity += (TILE_EQUITY[letter] ?? 0) / (1 + n * 0.65);
    }
    const groups = new Map<string, number>();
    // Large mature racks should be cashed; avoid a huge two-away enumeration.
    for (const completion of this.engine.completions(rack, tiles < 11 ? 2 : 1)) {
      if (completion.score > (groups.get(completion.missing) ?? 0)) groups.set(completion.missing, completion.score);
    }
    const features = { best: this.engine.best(rack), tiles, vowels, equity, options: [...groups].map(([missing, score]) => ({ missing, score })) };
    this.cache.set(key, features);
    if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value!);
    return features;
  }

  private market(ctx: StrategyContext): number {
    const prices = (ctx.observedPrices ?? []).slice(-20).filter(p => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
    return prices.length ? prices[Math.floor(prices.length / 2)] : 3;
  }

  analyze(ctx: StrategyContext): RackAnalysis {
    const f = this.features(ctx.myRack);
    const market = this.market(ctx);
    const remaining = Math.max(0, ctx.remainingTiles);
    const draws = Math.min(remaining, this.horizon);
    const affordableFutureTiles = Math.max(0, ctx.myBalance) / (market + 1);
    const winningShare = Math.min(0.45, Math.max(0.12, affordableFutureTiles / Math.max(6, remaining) * 1.5));
    const ready = f.best?.score ?? 0;
    const options = f.options.flatMap(option => {
      if (option.missing.length > remaining) return [];
      let probability = 1;
      let cost = 0;
      for (let i = 0; i < option.missing.length;) {
        const letter = option.missing[i];
        let n = 1;
        while (option.missing[i + n] === letter) n++;
        // Poisson count model for future opportunities, including repeated needs.
        const availableUpperBound = Math.max(0, (DEFAULT_BAG[letter] ?? 0) - (ctx.myRack.get(letter) ?? 0));
        if (n > availableUpperBound) { probability = 0; break; }
        const lambda = draws * availableUpperBound / Math.max(1, 98 - f.tiles) * winningShare;
        probability *= n === 1 ? -Math.expm1(-lambda) : 1 - Math.exp(-lambda) * (1 + lambda);
        cost += n * market;
        i += n;
      }
      const gain = Math.max(0, option.score - ready - cost);
      return gain > 0 && probability > 0 ? [{ gain, probability }] : [];
    }).sort((a, b) => b.gain - a.gain);
    // Expected best improvement from alternative completion routes. These events
    // overlap, so taper later alternatives rather than adding their raw values.
    let noEarlierCompletion = 1;
    let optionScore = 0;
    for (let i = 0; i < Math.min(24, options.length); i++) {
      const option = options[i];
      const probability = option.probability * (i < 4 ? 1 : 0.65);
      optionScore += noEarlierCompletion * probability * option.gain;
      noEarlierCompletion *= 1 - probability;
    }
    return { readyScore: ready, optionScore, expectedScore: ready + optionScore + f.equity * 0.5, marketPrice: market, tiles: f.tiles };
  }

  decideBid(ctx: StrategyContext & { letter: string }): number {
    const balance = Number.isFinite(ctx.myBalance) ? Math.max(0, Math.floor(ctx.myBalance)) : 0;
    const letter = ctx.letter.toUpperCase();
    if (balance === 0 || ctx.remainingTiles <= 0 || !/^[A-Z]$/.test(letter)) return 0;
    const before = this.analyze(ctx);
    const afterRack = new Map(ctx.myRack);
    afterRack.set(letter, (afterRack.get(letter) ?? 0) + 1);
    const after = this.analyze({ ...ctx, myRack: afterRack });
    const gain = Math.max(0, after.expectedScore - before.expectedScore);
    const immediateGain = Math.max(0, after.readyScore - before.readyScore);
    if (ctx.remainingTiles === 1 && immediateGain === 0) return 0;
    const f = this.features(ctx.myRack);
    const have = ctx.myRack.get(letter) ?? 0;
    const ratio = f.vowels / Math.max(1, f.tiles);
    const balanced = VOWELS.has(letter) ? ratio < 0.6 : ratio > 0.2;
    const futureWins = Math.max(2, ctx.remainingTiles / Math.max(2, (ctx.opponentCount ?? 5) + 1) * 0.65);
    const affordable = balance / futureWins;
    let value = 1.5 + gain * this.marginalScale + immediateGain * 0.3 - Math.max(0, have - 1) * 2;
    // Paid prices are observable in both formats. The floor recycles initial
    // capital into a new seed rack even after a profitable word empties it.
    if (have <= 1 && balanced && (!'JQXZ'.includes(letter) || immediateGain > 0)) value = Math.max(value, Math.min(before.marketPrice + 1, affordable));
    if ('JQXZ'.includes(letter) && immediateGain === 0 && gain < 1) value = Math.min(value, 1);
    if (ctx.remainingTiles <= 7 && immediateGain > 0) value = Math.max(value, immediateGain * 2.2);
    if (ctx.auctionType === 'FirstPrice') value *= 0.85;
    const capFraction = ctx.remainingTiles <= 5 ? 1 : ctx.remainingTiles <= 15 ? 0.65 : 0.38;
    return Math.max(0, Math.min(balance, Math.floor(value), Math.floor(Math.max(1, balance * capFraction))));
  }

  chooseWord(ctx: StrategyContext): string | null {
    const f = this.features(ctx.myRack);
    if (!f.best) return null;
    if (ctx.remainingTiles <= 3) {
      if (ctx.auctionDurationMs !== undefined && ctx.auctionDurationMs < 250) return f.best.word;
      return this.engine.liquidation(ctx.myRack).words[0] ?? null;
    }
    if (f.best.word.length >= 7 || f.tiles >= 12) return f.best.word;
    const value = this.analyze(ctx);
    const capitalUrgency = ctx.myBalance < value.marketPrice * 2 + 3;
    if (capitalUrgency && f.best.word.length >= 3) return f.best.word;
    if (ctx.myBalance <= 3 || ctx.remainingTiles <= 7) return f.best.word;
    return value.optionScore > Math.max(this.holdThreshold, f.best.score * 0.12) ? null : f.best.word;
  }
}
