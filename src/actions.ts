import type { Rack } from './engine.js';
import type { StrategyContext } from './strategy.js';

export interface MatchView extends StrategyContext {
  matchId: bigint;
  auction?: { id: bigint; letter: string; closesAtMs: number; durationMs?: number };
}

export interface Policy {
  chooseWord(ctx: StrategyContext): string | null;
  decideBid(ctx: StrategyContext & { letter: string }): number;
}

export interface Transport {
  submitWord(matchId: bigint, word: string): Promise<void>;
  submitBid(auctionId: bigint, amount: number): Promise<void>;
}

export function rackKey(rack: Rack): string {
  return [...rack].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, count]) => `${letter}${count}`).join('');
}

/** Coalesced table events call tick only after the SDK applies the transaction.
 * A word stays locked until the authoritative rack changes, even if its reducer
 * acknowledgement arrives before the subscription update. */
export class ActionLoop {
  private words = new Map<bigint, { rack: string; pending: boolean; retryAt: number; succeeded: boolean }>();
  private bids = new Map<bigint, { fingerprint: string; amount: number; pending: boolean; retryAt: number }>();

  constructor(private policy: Policy, private transport: Transport,
    private log: (message: string) => void = console.log) {}

  reset(): void { this.words.clear(); this.bids.clear(); }

  tick(matches: readonly MatchView[], now = Date.now()): void {
    const started = performance.now();
    const currentTime = () => now + Math.max(0, performance.now() - started);
    const active = new Set(matches.map(m => m.matchId));
    const auctions = new Set(matches.flatMap(m => m.auction ? [m.auction.id] : []));
    for (const id of this.words.keys()) if (!active.has(id)) this.words.delete(id);
    for (const id of this.bids.keys()) if (!auctions.has(id)) this.bids.delete(id);

    for (const match of matches) {
      const key = rackKey(match.myRack);
      const prior = this.words.get(match.matchId);
      // Never choose a second word from a pre-acknowledgement rack snapshot.
      const canPlay = !prior || (!prior.pending && (prior.rack !== key || (!prior.succeeded && now >= prior.retryAt)));
      if (canPlay) {
        const word = this.policy.chooseWord(match);
        if (word) {
          if (match.auction && match.auction.closesAtMs - currentTime() < 10) continue;
          const attempt = { rack: key, pending: true, retryAt: 0, succeeded: false };
          this.words.set(match.matchId, attempt);
          this.log(`match ${match.matchId}: play ${word}`);
          void this.transport.submitWord(match.matchId, word).then(() => {
            attempt.pending = false; attempt.succeeded = true;
          }, error => {
            attempt.pending = false; attempt.retryAt = Date.now() + 250;
            this.log(`word rejected in match ${match.matchId}: ${String(error)}`);
          });
          // Wait for the new balance/rack before pricing this auction.
          continue;
        }
      }
      // A word in flight can replenish the balance; price from confirmed state.
      if (prior?.pending) continue;
      const auction = match.auction;
      const margin = Math.min(75, Math.max(5, (auction?.durationMs ?? 1000) * 0.1));
      if (!auction || auction.closesAtMs - currentTime() < margin) continue;
      const fingerprint = `${key}:${match.myBalance}:${match.remainingTiles}`;
      const previousBid = this.bids.get(auction.id);
      if (previousBid?.pending || (previousBid?.fingerprint === fingerprint && now < previousBid.retryAt)) continue;
      const proposed = match.remainingTiles === 0 ? 0 : this.policy.decideBid({ ...match, letter: auction.letter });
      // Search and earlier matches can consume part of the auction window.
      if (auction.closesAtMs - currentTime() < margin) continue;
      const balance = Number.isFinite(match.myBalance) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(match.myBalance))) : 0;
      const amount = Number.isFinite(proposed) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(proposed), balance)) : 0;
      if ((!previousBid && amount === 0) || previousBid?.amount === amount) {
        this.bids.set(auction.id, { fingerprint, amount, pending: false, retryAt: Infinity });
        continue;
      }
      const attempt = { fingerprint, amount, pending: true, retryAt: Infinity };
      this.bids.set(auction.id, attempt);
      this.log(`match ${match.matchId}: bid ${amount} on ${auction.letter}`);
      void this.transport.submitBid(auction.id, amount).then(() => {
        attempt.pending = false;
      }, error => {
        attempt.pending = false; attempt.amount = -1; attempt.retryAt = Date.now() + 150;
        this.log(`bid rejected in match ${match.matchId}: ${String(error)}`);
      });
    }
  }
}
