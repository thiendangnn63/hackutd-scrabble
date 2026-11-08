import { LETTER_VALUE } from './engine.js';
import type { StrategyContext } from './strategy.js';

/** Completed public auctions, ordered oldest to newest within one match. */
export interface PublicAuctionPrice { auctionId: string; letter: string; paid: number }
export interface LetterPriceFeatures {
  baseBid: number; face: number; have: number; readyGain: number;
  tiles: number; vowels: number; cashCap: number;
}
const bucket = (face: number): number => face >= 8 ? 8 : face >= 3 ? 3 : face;
const median = (values: number[]): number => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Pure letter-price reservation adjustment using explicit completed-auction data.
 * Duplicate event delivery and repeated decisions cannot accumulate observations.
 * The caller supplies only this match's history; no state survives between calls.
 */
export function letterPriceBid(
  ctx: StrategyContext & { letter: string; recentAuctionPrices?: readonly PublicAuctionPrice[] },
  features: LetterPriceFeatures,
): number {
  const balance = Number.isFinite(ctx.myBalance) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(ctx.myBalance))) : 0;
  const letter = typeof ctx.letter === 'string' ? ctx.letter.toUpperCase() : '';
  const gain = Number.isFinite(features.readyGain) ? features.readyGain : 0;
  if (!balance || !Number.isFinite(ctx.remainingTiles) || ctx.remainingTiles <= 0 || !/^[A-Z]$/.test(letter)) return 0;
  if (ctx.remainingTiles === 1 && gain <= 0) return 0;
  const cap = Number.isFinite(features.cashCap) ? Math.max(0, Math.min(balance, features.cashCap)) : 0;
  let bid = Number.isFinite(features.baseBid) ? Math.max(0, Math.min(balance, cap, features.baseBid)) : 0;
  const face = features.face;
  if (!Number.isFinite(face) || face <= 0) return Math.floor(bid);
  const seen = new Set<string>();
  const history: Array<{ letter: string; paid: number }> = [];
  for (const row of ctx.recentAuctionPrices ?? []) {
    if (!row || typeof row.auctionId !== 'string' || !row.auctionId.trim() || typeof row.letter !== 'string') continue;
    const id = row.auctionId.trim();
    const closedLetter = row.letter.toUpperCase();
    if (!/^[A-Z]$/.test(closedLetter) || !Number.isSafeInteger(row.paid) || row.paid <= 0 || seen.has(id)) continue;
    seen.add(id);
    history.push({ letter: closedLetter, paid: row.paid });
  }
  const all = history.slice(-20).map(row => row.paid);
  const global = all.length ? median(all) : 12;
  const localPrices = history.filter(row => bucket(LETTER_VALUE[row.letter]) === bucket(face)).map(row => row.paid);
  const weight = localPrices.length / (localPrices.length + 3);
  const local = localPrices.length ? median(localPrices) : global;
  const prior = global * (1 + 0.1 * (face - 1));
  const quote = weight * local + (1 - weight) * prior + 1;
  const balanced = 'AEIOU'.includes(letter)
    ? features.vowels / Math.max(1, features.tiles) < 0.6
    : features.vowels > 0;
  if (features.have <= 1 && balanced && (letter !== 'Q' || (ctx.myRack.get('U') ?? 0) > 0 || gain > 0)) {
    const affordable = balance / Math.max(2, ctx.remainingTiles / 6 * 1.2);
    const capacity = Math.max(affordable, 3 * face + 4);
    bid = Math.max(bid, Math.min(cap, quote, capacity));
  }
  return Math.max(0, Math.floor(Math.min(balance, cap, bid)));
}
