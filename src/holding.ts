import { WordEngine, type Rack } from './engine.js';
import { Strategy, type StrategyContext } from './strategy.js';

export type HoldingVariant = 'leave' | 'partition' | 'six-patient' | 'six-cash' | 'six-score';
const LEAVE_VALUE: Readonly<Record<string, number>> = {
  A: 2.0, B: 1.1, C: 1.5, D: 1.5, E: 2.2, F: 1.0, G: 1.2, H: 1.5,
  I: 1.8, J: 0.3, K: 0.7, L: 1.7, M: 1.3, N: 1.8, O: 1.8, P: 1.2,
  Q: 0.1, R: 1.9, S: 2.8, T: 1.9, U: 1.2, V: 0.6, W: 0.7, X: 1.0, Y: 1.0, Z: 0.6,
};

/** Holding-only experiments. All variants inherit the unchanged market-all bidder. */
export class HoldingStrategy extends Strategy {
  constructor(engine: WordEngine, readonly variant: HoldingVariant) {
    super(engine, { mode: 'market-all', holdGain: variant === 'six-patient' ? 1.12 : variant === 'six-cash' ? 2 : 1.5 });
  }

  private leaveValue(rack: Rack): number {
    let equity = 0;
    let vowels = 0;
    let tiles = 0;
    for (const [letter, count] of rack) {
      if (count <= 0) continue;
      tiles += count;
      if ('AEIOU'.includes(letter)) vowels += count;
      for (let n = 0; n < count; n++) equity += (LEAVE_VALUE[letter] ?? 0) / (1 + n * 0.8);
    }
    if (vowels === 0 || vowels === tiles) equity *= 0.55;
    return Math.max(equity, this.engine.best(rack)?.score ?? 0, (this.engine.bestCompletion(rack, 1)?.score ?? 0) * 0.4);
  }

  override chooseWord(ctx: StrategyContext): string | null {
    const ordinary = super.chooseWord(ctx);
    if (this.variant === 'six-patient' || this.variant === 'six-cash') return ordinary;
    const best = this.engine.best(ctx.myRack);
    if (!best || ctx.remainingTiles <= 7 || ctx.myBalance <= 8) return ordinary;
    if (this.variant === 'six-score') {
      if (best.word.length !== 6 || ctx.myBalance < 22) return ordinary;
      const next = this.engine.bestCompletion(ctx.myRack, 1);
      return next && next.score - best.score >= 8 ? null : best.word;
    }
    if (!ordinary) return null;
    const tiles = [...ctx.myRack.values()].reduce((a, b) => a + b, 0);
    if (this.variant === 'partition') {
      if (tiles < 9 || (ctx.auctionDurationMs !== undefined && ctx.auctionDurationMs < 250)) return ordinary;
      const plan = this.engine.liquidation(ctx.myRack, 1000);
      return plan.score > best.score + 2 ? plan.words[0] ?? ordinary : ordinary;
    }
    if (this.variant === 'leave') {
      let choice = ordinary;
      let greatest = -Infinity;
      for (const candidate of this.engine.playable(ctx.myRack).slice(0, 16)) {
        if (candidate.score < best.score * 0.75 || candidate.word.length < 4) continue;
        const leave = new Map(ctx.myRack);
        for (const letter of candidate.word) leave.set(letter, leave.get(letter)! - 1);
        const value = candidate.score + this.leaveValue(leave) * 0.55;
        if (value > greatest) { greatest = value; choice = candidate.word; }
      }
      return choice;
    }
    return ordinary;
  }
}
