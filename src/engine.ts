/** Official no-blank Scrabble tile values and 98-tile distribution. */
export const LETTER_VALUE: Readonly<Record<string, number>> = Object.freeze({
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1,
  J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10,
  R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
});
export const DEFAULT_BAG: Readonly<Record<string, number>> = Object.freeze({
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9,
  J: 1, K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1,
  R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
});
export type Rack = Map<string, number>;
export interface WordMatch { word: string; score: number }
export interface Completion extends WordMatch { missing: string }
export interface Liquidation { score: number; words: string[]; exact: boolean; states: number }
interface TrieNode { children: number[]; entry?: WordMatch; bound?: WordMatch }
interface CountedWord extends WordMatch { counts: number[]; letters: number[] }

const ASCII_A = 65;
const VALUES = Array.from({ length: 26 }, (_, n) => LETTER_VALUE[String.fromCharCode(ASCII_A + n)]);

/** Payout follows the server's integer truncation, including odd half points. */
export function scoreWord(raw: string): number {
  const word = raw.toUpperCase();
  if (!/^[A-Z]+$/.test(word)) return 0;
  let face = 0;
  for (const char of word) face += LETTER_VALUE[char];
  const multiplier = word.length >= 7 ? 3 : word.length === 6 ? 2.5 : word.length === 5 ? 2 : word.length === 4 ? 1.5 : 1;
  return Math.floor(face * multiplier);
}

export function canSpell(raw: string, rack: Rack): boolean {
  const word = raw.toUpperCase();
  if (!/^[A-Z]+$/.test(word)) return false;
  const used = new Map<string, number>();
  for (const char of word) {
    const count = (used.get(char) ?? 0) + 1;
    if (count > (rack.get(char) ?? 0)) return false;
    used.set(char, count);
  }
  return true;
}

function rackCounts(rack: Rack): number[] {
  return Array.from({ length: 26 }, (_, n) => {
    const count = rack.get(String.fromCharCode(ASCII_A + n)) ?? 0;
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  });
}
function countsKey(counts: number[]): string { return counts.join(','); }
function fits(word: CountedWord, counts: number[]): boolean {
  for (const i of word.letters) if (word.counts[i] > counts[i]) return false;
  return true;
}
function rank(a: WordMatch, b: WordMatch): number {
  return b.score - a.score || b.word.length - a.word.length || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0);
}

/**
 * Sorted-letter trie: each rack visits only compatible signature prefixes.
 * Anagrams have identical payouts/consumption; retain one lexical representative.
 * This avoids scanning the 173k-word dictionary in an auction callback.
 */
export class WordEngine {
  private readonly nodes: TrieNode[] = [{ children: [] }];
  private readonly cache = new Map<string, readonly Completion[]>();
  private cacheWeight = 0;
  private readonly liquidationCache = new Map<string, Liquidation>();
  private readonly topCache = new Map<string, Completion | null>();
  readonly wordCount: number;
  readonly signatureCount: number;
  constructor(words: readonly string[], private readonly cacheSize = 2048) {
    const normalized = new Set(words.filter(word => typeof word === 'string').map(word => word.trim()).filter(word => /^[A-Za-z]{2,98}$/.test(word)).map(word => word.toUpperCase()));
    this.wordCount = normalized.size;
    let signatures = 0;
    for (const word of normalized) {
      const letters = [...word].map(c => c.charCodeAt(0) - ASCII_A).sort((a, b) => a - b);
      let nodeId = 0;
      const ancestry = [0];
      for (const letter of letters) {
        const children = this.nodes[nodeId].children;
        let childId: number | undefined;
        for (let i = 0; i < children.length; i += 2) {
          if (children[i] === letter) { childId = children[i + 1]; break; }
        }
        if (childId === undefined) {
          childId = this.nodes.length;
          this.nodes.push({ children: [] });
          children.push(letter, childId);
        }
        nodeId = childId;
        ancestry.push(nodeId);
      }
      const candidate = Object.freeze({ word, score: scoreWord(word) });
      for (const id of ancestry) {
        const bound = this.nodes[id].bound;
        if (!bound || rank(candidate, bound) < 0) this.nodes[id].bound = candidate;
      }
      const old = this.nodes[nodeId].entry;
      if (!old) signatures++;
      if (!old || word < old.word) this.nodes[nodeId].entry = candidate;
    }
    this.signatureCount = signatures;
    // Visit the most promising subtree first. Top-only queries can then prune
    // every branch whose best possible payout/tiebreak cannot beat the incumbent.
    for (const node of this.nodes) {
      if (node.children.length < 4) continue;
      const pairs: [number, number][] = [];
      for (let i = 0; i < node.children.length; i += 2) pairs.push([node.children[i], node.children[i + 1]]);
      pairs.sort((a, b) => rank(this.nodes[a[1]].bound!, this.nodes[b[1]].bound!));
      node.children = pairs.flat();
    }
  }

  private query(rack: Rack, missingLimit: number): readonly Completion[] {
    const counts = rackCounts(rack);
    const key = `${missingLimit}:${countsKey(counts)}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached);
      return cached;
    }
    const found: Completion[] = [];
    const visit = (nodeId: number, missing: string): void => {
      const node = this.nodes[nodeId];
      if (node.entry) found.push(Object.freeze({ ...node.entry, missing }));
      const children = node.children;
      for (let i = 0; i < children.length; i += 2) {
        const letter = children[i];
        if (counts[letter] > 0) {
          counts[letter]--;
          visit(children[i + 1], missing);
          counts[letter]++;
        } else if (missing.length < missingLimit) {
          visit(children[i + 1], missing + String.fromCharCode(ASCII_A + letter));
        }
      }
    };
    visit(0, '');
    found.sort(rank);
    if (this.cacheSize > 0) {
      this.cache.set(key, found);
      this.cacheWeight += found.length;
      // A rack may have tens of thousands of completions; bound rows as well
      // as keys so extended tournaments/simulations cannot grow the cache forever.
      while (this.cache.size > this.cacheSize || this.cacheWeight > 200_000) {
        const oldest = this.cache.keys().next().value!;
        this.cacheWeight -= this.cache.get(oldest)!.length;
        this.cache.delete(oldest);
      }
    }
    return found;
  }

  /** One valid representative for every playable letter multiset, highest payout first. */
  playable(rack: Rack): WordMatch[] {
    return this.query(rack, 0).map(({ word, score }) => ({ word, score }));
  }
  /** Only words needing 1..maxMissing tiles. Already playable words are excluded. */
  completions(rack: Rack, maxMissing = 1): Completion[] {
    const limit = Math.max(0, Math.min(2, Math.floor(maxMissing)));
    if (limit === 0) return [];
    return this.query(rack, limit).filter(entry => entry.missing.length > 0).map(entry => ({ ...entry }));
  }
  private top(rack: Rack, missingLimit: number): Completion | null {
    const counts = rackCounts(rack);
    const key = `${missingLimit}:${countsKey(counts)}`;
    if (this.topCache.has(key)) {
      const cached = this.topCache.get(key)!;
      this.topCache.delete(key); this.topCache.set(key, cached);
      return cached ? { ...cached } : null;
    }
    let best: Completion | null = null;
    const visit = (nodeId: number, missing: string): void => {
      const node = this.nodes[nodeId];
      if (best && node.bound && rank(node.bound, best) >= 0) return;
      if (node.entry && (missingLimit === 0 || missing.length > 0) && (!best || rank(node.entry, best) < 0)) {
        best = { ...node.entry, missing };
      }
      const children = node.children;
      for (let i = 0; i < children.length; i += 2) {
        const letter = children[i];
        if (counts[letter] > 0) {
          counts[letter]--;
          visit(children[i + 1], missing);
          counts[letter]++;
        } else if (missing.length < missingLimit) {
          visit(children[i + 1], missing + String.fromCharCode(ASCII_A + letter));
        }
      }
    };
    visit(0, '');
    if (this.cacheSize > 0) {
      this.topCache.set(key, best);
      if (this.topCache.size > this.cacheSize) this.topCache.delete(this.topCache.keys().next().value!);
    }
    return best ? { ...(best as Completion) } : null;
  }
  best(rack: Rack): WordMatch | null {
    const best = this.top(rack, 0);
    return best ? { word: best.word, score: best.score } : null;
  }
  /** Same result as completions(rack, maxMissing)[0], without materializing/sorting all matches. */
  bestCompletion(rack: Rack, maxMissing = 1): Completion | null {
    const limit = Math.max(0, Math.min(2, Math.floor(maxMissing)));
    return limit === 0 ? null : this.top(rack, limit);
  }

  /**
   * Maximum payout from disjoint words, preserving exact repeated-letter counts.
   * Search is exact until stateBudget (default 4,000) or 250k candidate checks
   * are exhausted; then return
   * the best valid plan found, marked exact=false. Cache only completed searches.
   */
  liquidation(rack: Rack, stateBudget = 4000): Liquidation {
    const counts = rackCounts(rack);
    const initialKey = countsKey(counts);
    const cached = this.liquidationCache.get(initialKey);
    if (cached) return { ...cached, words: [...cached.words] };
    const candidates: CountedWord[] = this.query(rack, 0).map(({ word, score }) => {
      const wordCounts = Array(26).fill(0) as number[];
      for (const letter of word) wordCounts[letter.charCodeAt(0) - ASCII_A]++;
      return { word, score, counts: wordCounts, letters: wordCounts.map((count, i) => count > 0 ? i : -1).filter(i => i >= 0) };
    });
    const memo = new Map<string, { score: number; words: string[] }>();
    let states = 0;
    let checks = 0;
    let exact = true;
    const greedy = (): { score: number; words: string[] } => {
      const remaining = [...counts];
      const words: string[] = [];
      let score = 0;
      for (const candidate of candidates) {
        while (fits(candidate, remaining)) {
          for (const i of candidate.letters) remaining[i] -= candidate.counts[i];
          words.push(candidate.word); score += candidate.score;
        }
      }
      return { score, words };
    };
    const search = (): { score: number; words: string[] } => {
      const key = countsKey(counts);
      const known = memo.get(key);
      if (known) return known;
      states++;
      if (states > Math.max(1, stateBudget)) {
        exact = false;
        // A legal greedy fallback keeps the result useful when racks are huge.
        return greedy();
      }
      let best = { score: 0, words: [] as string[] };
      const upperBound = counts.reduce((sum, count, i) => sum + count * VALUES[i] * 3, 0);
      for (const candidate of candidates) {
        if (++checks > 250_000) {
          exact = false;
          const fallback = greedy();
          if (fallback.score > best.score) best = fallback;
          break;
        }
        if (!fits(candidate, counts)) continue;
        for (const i of candidate.letters) counts[i] -= candidate.counts[i];
        const tail = search();
        for (const i of candidate.letters) counts[i] += candidate.counts[i];
        const score = candidate.score + tail.score;
        if (score > best.score) best = { score, words: [candidate.word, ...tail.words] };
        if (best.score === upperBound || !exact) break;
      }
      memo.set(key, best);
      return best;
    };
    const plan = search();
    const result = { ...plan, exact, states };
    if (exact && this.cacheSize > 0) {
      this.liquidationCache.set(initialKey, result);
      if (this.liquidationCache.size > this.cacheSize) this.liquidationCache.delete(this.liquidationCache.keys().next().value!);
    }
    return { ...result, words: [...result.words] };
  }
}
