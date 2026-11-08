import { WordEngine, LETTER_VALUE, type Rack } from './engine.js';
import { letterPriceBid, type PublicAuctionPrice } from './letter-price.js';

export interface StrategyContext {
  myRack: Rack;
  myBalance: number;
  /** Public bagTotal: excludes the tile in the currently open auction. */
  remainingTiles: number;
  auctionType: 'Vickrey' | 'FirstPrice';
  letter?: string;
  myScore?: number;
  opponentScores?: number[];
  opponentCount?: number;
  observedPrices?: number[];
  auctionDurationMs?: number;
  recentAuctionPrices?: readonly PublicAuctionPrice[];
}
export type StrategyMode = 'starter' | 'greedy' | 'hoard' | 'adaptive' | 'aggressive' | 'patient' | 'market' | 'market-focused' | 'market-all' | 'market-budget' | 'market-pressure' | 'market-margin' | 'market-quality' | 'market-convert';
export interface StrategyOptions { mode?: StrategyMode; bidScale?: number; holdGain?: number; floorMultiplier?: number; acquisitionReserve?: number; terminalSpend?: boolean; letterPrices?: boolean }

const VOWELS = new Set('AEIOU');
const size = (rack: Rack): number => [...rack.values()].reduce((a, b) => a + b, 0);

/** Deterministic, local indexed search: no LLM/network calls in the auction loop. */
export class Strategy {
  readonly mode: StrategyMode;
  private readonly bidScale: number;
  private readonly holdGain: number;
  private readonly floorMultiplier?: number;
  private readonly acquisitionReserve: number;
  private readonly terminalSpend: boolean;
  private readonly useLetterPrices: boolean;
  constructor(readonly engine: WordEngine, options: StrategyOptions | StrategyMode = {}) {
    if (typeof options === 'string') options = { mode: options };
    this.mode = options.mode ?? 'market-convert';
    this.floorMultiplier=options.floorMultiplier;
    this.acquisitionReserve=options.acquisitionReserve??0.65;
    this.terminalSpend=options.terminalSpend??false;
    this.useLetterPrices=options.letterPrices??false;
    this.bidScale = options.bidScale ?? ((this.mode === 'aggressive' || this.mode === 'market' || this.mode === 'market-focused' || this.mode.startsWith('market-')) ? 1.6 : this.mode === 'patient' ? 0.8 : 1.15);
    this.holdGain = options.holdGain ?? (this.mode === 'patient' ? 1.12 : (this.mode === 'aggressive' || this.mode === 'market' || this.mode === 'market-focused' || this.mode.startsWith('market-')) ? 1.5 : 1.3);
  }

  decideBid(ctx: StrategyContext & { letter: string }): number {
    const balance = Number.isFinite(ctx.myBalance) ? Math.max(0, Math.floor(ctx.myBalance)) : 0;
    const letter = ctx.letter.toUpperCase();
    // The final tile is awarded in the same transaction that ends the game.
    if (ctx.remainingTiles <= 0 || balance === 0 || !/^[A-Z]$/.test(letter)) return 0;
    const have = ctx.myRack.get(letter) ?? 0;
    const face = LETTER_VALUE[letter] ?? 0;
    if (this.mode === 'starter' || this.mode === 'greedy' || this.mode === 'hoard') {
      return Math.min(balance, face + (have === 0 ? 2 : 0));
    }
    const before = this.engine.best(ctx.myRack)?.score ?? 0;
    const afterRack = new Map(ctx.myRack);
    afterRack.set(letter, have + 1);
    const afterBest = this.engine.best(afterRack);
    const after = afterBest?.score ?? 0;
    const nearBefore = this.engine.bestCompletion(ctx.myRack, 1)?.score ?? 0;
    const nearAfter = this.engine.bestCompletion(afterRack, 1)?.score ?? 0;
    const tiles = size(ctx.myRack);
    let vowels = 0;
    for (const [c, n] of ctx.myRack) if (VOWELS.has(c)) vowels += n;
    const vowelRatio = vowels / Math.max(1, tiles);
    const balanceBonus = VOWELS.has(letter)
      ? Math.max(-2, (0.42 - vowelRatio) * 12)
      : Math.max(-2, (vowelRatio - 0.5) * 8);
    const horizon = Math.min(1, ctx.remainingTiles / 14);
    // A near completion has option value, discounted as opportunities disappear.
    const potentialBefore = Math.max(before, nearBefore * 0.65 * horizon);
    const potentialAfter = Math.max(after, nearAfter * 0.65 * horizon);
    const marginal = Math.max(0, potentialAfter - potentialBefore);
    const readyGain = Math.max(0, after - before);
    const duplicatePenalty = Math.max(0, have - 1) * 2;
    const useful = nearAfter > 0 || after > 0;
    let value = (useful ? 3.5 : 1.5) + balanceBonus + marginal * this.bidScale + readyGain * 0.32 - duplicatePenalty;
    // Expensive deadwood should be bought only when it helps an actual word.
    if ('JQXZ'.includes(letter) && readyGain === 0 && nearAfter <= nearBefore) value = Math.min(value, 1);
    // Experimental public-match challenger: after redeeming a word, seed the
    // next rack with some scoring power instead of buying only cheap vowels.
    // The normal cash-fraction cap below still applies to this reservation.
    if ((this.mode === 'market-quality' || this.mode === 'market-convert') && tiles <= 4 && ctx.remainingTiles >= 10 && have === 0 && face >= 3) {
      const improvesCompletion = readyGain > 0 || nearAfter > nearBefore;
      const qSupported = letter !== 'Q' || (ctx.myRack.get('U') ?? 0) > 0 || improvesCompletion;
      if (qSupported) {
        let flexibility = 1;
        if (letter === 'J' && (ctx.myRack.get('O') ?? 0) === 0 && !improvesCompletion) flexibility = 0.75;
        if (letter === 'Z' && !improvesCompletion) flexibility = 0.8;
        if (tiles >= 3 && vowels === 0) flexibility *= 0.75;
        value = Math.max(value, (3 * face + 8) * flexibility);
      }
    }
    // Initial cash is useful only if spent. Loosen reserves near the finish,
    // but preserve enough liquidity for several future complement auctions.
    const capFraction = ctx.remainingTiles <= 5 ? 1 : ctx.remainingTiles <= 15 ? 0.65 : 0.38;
    if (ctx.remainingTiles <= 7 && readyGain > 0) value = Math.max(value, readyGain * 2.2);
    const newMarket = this.mode === 'market-all' || this.mode === 'market-budget' || this.mode === 'market-pressure' || this.mode === 'market-margin' || this.mode === 'market-quality' || this.mode === 'market-convert';
    if (ctx.auctionType === 'FirstPrice') value *= 0.7;
    if ((ctx.auctionType === 'FirstPrice' && (this.mode === 'market' || this.mode === 'market-focused')) || newMarket) {
      const prices=(ctx.observedPrices??[]).slice(-20).filter(p=>Number.isFinite(p)&&p>0).sort((a,b)=>a-b);
      const market=prices.length ? prices[Math.floor(prices.length/2)] : 3;
      let expectedWins=Math.max(2,ctx.remainingTiles/Math.max(2,(ctx.opponentCount??5)+1)*this.acquisitionReserve);
      if(this.mode==='market-budget'||this.mode==='market-pressure') {
        // A recently emptied rack needs a new seed, even when no near-word
        // exists yet. Otherwise successful redemption can freeze the bidder.
        if(tiles<4) expectedWins=Math.min(expectedWins,Math.max(2,7-tiles));
      }
      const affordable=balance/expectedWins;
      const balanced=VOWELS.has(letter)?vowelRatio<0.6:vowelRatio>0.2;
      const focused=this.mode!=='market-focused'||marginal>0||readyGain>0||(VOWELS.has(letter)&&vowelRatio<0.25);
      if(focused && have<=1 && balanced && (!'JQXZ'.includes(letter)||readyGain>0)) {
        const premium=this.floorMultiplier??(ctx.auctionType==='Vickrey' && this.mode==='market-margin'?1.2:ctx.auctionType==='Vickrey' && this.mode==='market-budget'?1.5:ctx.auctionType==='Vickrey' && this.mode==='market-pressure'?2:1);
        const budgetScale=this.mode==='market-pressure'?1.5:this.mode==='market-budget'?1.25:1;
        value=Math.max(value,Math.min(market*premium+1,affordable*budgetScale));
      }
    }
    if(newMarket && this.terminalSpend && ctx.remainingTiles<=10 && readyGain>0) {
      const remainingWins=Math.max(1,ctx.remainingTiles/Math.max(2,(ctx.opponentCount??5)+1));
      value=Math.max(value,balance/remainingWins);
    }
    if(newMarket && ctx.remainingTiles===1 && readyGain===0) return 0;
    let cashCap = Math.max(1, balance * capFraction);
    // Public match 47181 demonstrated a cash-positive seven-letter completion
    // blocked by the speculative 38% cap. Release credit only against an
    // immediately playable six-plus-letter payout, never against a near-word.
    if (this.mode === 'market-convert' && readyGain > 0 && afterBest && afterBest.word.length >= 6) {
      cashCap = Math.max(cashCap, Math.min(balance, afterBest.score));
    }
    const baseBid = Math.min(balance, Math.max(0, Math.floor(Math.min(value, cashCap))));
    return this.useLetterPrices ? letterPriceBid({ ...ctx, letter }, { baseBid, face, have, readyGain, tiles, vowels, cashCap }) : baseBid;
  }

  chooseWord(ctx: StrategyContext): string | null {
    const best = this.engine.best(ctx.myRack);
    if (best === null) return null;
    if (ctx.remainingTiles <= 3) {
      // Configurable fast matches leave too little time for bounded partition
      // search on pathological racks; redeem the best legal word immediately.
      if(ctx.auctionDurationMs!==undefined && ctx.auctionDurationMs<250) return best.word;
      return this.engine.liquidation(ctx.myRack).words[0] ?? null;
    }
    if (this.mode === 'starter') {
      const playable = this.engine.playable(ctx.myRack);
      let longest = playable[0];
      for (const candidate of playable) if (candidate.word.length > longest.word.length || (candidate.word.length === longest.word.length && candidate.word < longest.word)) longest = candidate;
      return longest.word;
    }
    if (this.mode === 'greedy') return best.word;
    if (this.mode === 'hoard') return best.word.length >= 7 || ctx.myBalance < 8 || ctx.remainingTiles <= 8 ? best.word : null;
    if (best.word.length >= 7 || ctx.myBalance <= 8 || ctx.remainingTiles <= 7) return best.word;
    const tiles = size(ctx.myRack);
    const next = this.engine.bestCompletion(ctx.myRack, 1);
    // Wait only for a material length/score gain; sell mature words and avoid
    // stranding capital in an ever-growing rack of incompatible letters.
    if (best.word.length >= 6 && (!next || next.score < best.score * this.holdGain)) return best.word;
    if (tiles >= 12 || (best.word.length >= 4 && (!next || next.score < best.score * 1.08))) return best.word;
    if (ctx.myBalance < 22 && best.word.length >= 4) return best.word;
    return null;
  }
}
