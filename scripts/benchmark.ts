/** Seeded paired matches against heterogeneous policies; no private opponent data enters a policy. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WordEngine, DEFAULT_BAG, canSpell, scoreWord, type Rack } from '../src/engine.js';
import { Strategy, type StrategyMode, type StrategyContext } from '../src/strategy.js';
import { LookaheadStrategy } from '../src/lookahead.js';
type CandidateMode = StrategyMode | 'lookahead' | 'lookahead-bid' | 'floor-1.2' | 'reserve-0.5' | 'reserve-0.8' | 'terminal-spend';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('npm run benchmark -- [--games 24] [--seed 1701] [--output docs/benchmark-results.json] [--scenario mixed|selfplay|face|fixed|fixed-high|vowel|idle|value|allformat|pressure|strongmixed|market-selfplay] [--candidates aggressive,starter] [--phases both|tuning|holdout] [--formats Vickrey,FirstPrice]\nRuns each candidate on paired shuffled bags against five mixed opponents in both auction types. Uses separate seed ranges for tuning/holdout and rotates seats.');
  process.exit(0);
}
const arg = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const games = Number(arg('--games', '24'));
const seed = Number(arg('--seed', '1701'));
if (!Number.isSafeInteger(games) || games < 1 || !Number.isSafeInteger(seed) || seed < 0) throw new Error('Invalid --games or --seed');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setup = performance.now();
const words = fs.readFileSync(path.join(root, 'data/wordlist.txt'), 'utf8').split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(Boolean);
const engine = new WordEngine(words);
const setupMs = performance.now() - setup;
const allModes: CandidateMode[] = ['starter', 'greedy', 'hoard', 'adaptive', 'aggressive', 'patient', 'market', 'market-focused', 'market-all', 'market-budget', 'market-pressure', 'market-margin', 'lookahead', 'lookahead-bid', 'floor-1.2', 'reserve-0.5', 'reserve-0.8', 'terminal-spend'];
const candidates = arg('--candidates', allModes.join(',')).split(',') as CandidateMode[];
if(candidates.some(mode => !allModes.includes(mode))) throw new Error('Unknown --candidates mode');
const scenario = arg('--scenario','mixed');
if(!['mixed','selfplay','face','fixed','fixed-high','vowel','idle','value','allformat','pressure','strongmixed','market-selfplay'].includes(scenario)) throw new Error('Unknown --scenario');
const formats=arg('--formats','Vickrey,FirstPrice').split(',') as Array<'Vickrey'|'FirstPrice'>;
if(formats.some(f=>f!=='Vickrey'&&f!=='FirstPrice')) throw new Error('Unknown --formats');
const phaseFilter = arg('--phases','both');
if(!['both','tuning','holdout'].includes(phaseFilter)) throw new Error('Unknown --phases');
const latency: number[] = [];
const latencyByMode: Record<string, number[]> = {};
let activeMode = '';
const timed = <T>(fn: () => T): T => { const t = performance.now(); const value = fn(); const ms = performance.now() - t; latency.push(ms); (latencyByMode[activeMode] ??= []).push(ms); return value; };
function rng(seed: number) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
interface Policy { decideBid(ctx: StrategyContext & {letter:string}): number; chooseWord(ctx: StrategyContext): string|null }
interface Player { rack: Rack; balance: number; score: number; strategy: Policy; prices: number[]; wins:number; paid:number }
function rivalPolicy(kind: string): Policy {
  return {
    decideBid(ctx) {
      if(kind==='idle' || ctx.remainingTiles<=0) return 0;
      const face = scoreWord(ctx.letter);
      const value = kind==='fixed-high'?18:kind==='fixed'?12:kind==='vowel'?('AEIOU'.includes(ctx.letter)?15:face+3):face*2+4;
      if(kind==='value') {
        const after=new Map(ctx.myRack); after.set(ctx.letter,(after.get(ctx.letter)??0)+1);
        const gain=(engine.best(after)?.score??0)-(engine.best(ctx.myRack)?.score??0);
        return Math.max(0,Math.floor(Math.min(ctx.myBalance*.4,Math.max(face*2+3,gain*2,ctx.myBalance/Math.max(2,ctx.remainingTiles/8)))));
      }
      return Math.min(Math.floor(ctx.myBalance),value);
    },
    chooseWord(ctx) {
      if(kind==='idle') return null;
      const best=engine.best(ctx.myRack);
      if(!best) return null;
      if(ctx.remainingTiles<=3) return engine.liquidation(ctx.myRack).words[0]??null;
      return best.word.length>=5 || ctx.myBalance<12 || ctx.remainingTiles<=7?best.word:null;
    },
  };
}
interface MatchResult { score: number; place: number; win: number; lead: number; balance: number; unplayed: number; auctionsWon:number; totalPaid:number }
function makePolicy(mode:CandidateMode): Policy {
  if(mode==='floor-1.2') return new Strategy(engine,{mode:'market-all',floorMultiplier:1.2});
  if(mode==='reserve-0.5') return new Strategy(engine,{mode:'market-all',acquisitionReserve:.5});
  if(mode==='reserve-0.8') return new Strategy(engine,{mode:'market-all',acquisitionReserve:.8});
  if(mode==='terminal-spend') return new Strategy(engine,{mode:'market-all',terminalSpend:true});
  if(mode==='lookahead') return new LookaheadStrategy(engine);
  if(mode==='lookahead-bid') { const bidder=new LookaheadStrategy(engine); const holder=new Strategy(engine,'market-all'); return {decideBid:ctx=>bidder.decideBid(ctx),chooseWord:ctx=>holder.chooseWord(ctx)}; }
  return new Strategy(engine,mode);
}
function runMatch(mode: CandidateMode, seed: number, seat: number, auctionType: 'Vickrey' | 'FirstPrice', lineup: number): MatchResult {
  activeMode = mode;
  const random = rng(seed);
  const bag: string[] = [];
  for (const [letter, count] of Object.entries(DEFAULT_BAG)) for (let n = 0; n < count; n++) bag.push(letter);
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  // Two opponent sets stress cash recycling and deliberate word accumulation.
  const opponents: StrategyMode[][] = [
    ['starter', 'greedy', 'hoard', 'adaptive', 'greedy'],
    ['adaptive', 'aggressive', 'patient', 'hoard', 'greedy'],
  ];
  let oi = 0;
  const players: Player[] = Array.from({ length: 6 }, (_, i) => ({ rack: new Map(), balance: 100, score: 0, strategy: i === seat ? makePolicy(mode) : scenario === 'mixed' ? new Strategy(engine,opponents[lineup][oi++]) : scenario==='selfplay'?new Strategy(engine,'aggressive'):scenario==='market-selfplay'?new Strategy(engine,'market-all'):scenario==='allformat'?new Strategy(engine,'market-budget'):scenario==='pressure'?new Strategy(engine,'market-pressure'):scenario==='strongmixed'?[new Strategy(engine,'market-budget'),new Strategy(engine,'market-pressure'),rivalPolicy('value')][(oi++)%3]:rivalPolicy(scenario), prices: [], wins:0, paid:0 }));
  for (const p of players) for (let n = 0; n < 5; n++) { const c = bag.pop()!; p.rack.set(c, (p.rack.get(c) ?? 0) + 1); }
  function context(p: Player, remainingTiles: number, letter?: string): StrategyContext {
    return { myRack: p.rack, myBalance: p.balance, myScore: p.score, remainingTiles, letter, auctionType, opponentCount: 5, opponentScores: players.filter(o => o !== p).map(o => o.score), observedPrices: p.prices };
  }
  function play(p: Player, remainingTiles: number, target: boolean) {
    for (let n = 0; n < 25; n++) {
      const word = target ? timed(() => p.strategy.chooseWord(context(p, remainingTiles))) : p.strategy.chooseWord(context(p, remainingTiles));
      if (!word) return;
      if (!canSpell(word, p.rack)) throw new Error(`Illegal word ${word}`);
      const reward = scoreWord(word);
      p.score += reward; p.balance += reward;
      for (const c of word) { const left = p.rack.get(c)! - 1; if (left) p.rack.set(c, left); else p.rack.delete(c); }
    }
    throw new Error('Word loop exceeded');
  }
  while (bag.length) {
    const letter = bag.pop()!;
    const remaining = bag.length;
    // Real clients have the entire open-auction window to flush old rack.
    for (let i = 0; i < 6; i++) play(players[i], remaining, i === seat);
    const bids = players.map((p, i) => {
      const ctx = { ...context(p, remaining, letter), letter };
      const bid = i === seat ? timed(() => p.strategy.decideBid(ctx)) : p.strategy.decideBid(ctx);
      if (!Number.isSafeInteger(bid) || bid < 0 || bid > p.balance) throw new Error(`Illegal bid ${bid}`);
      return bid;
    });
    const top = Math.max(...bids);
    if (top > 0) {
      const tied = bids.map((b, i) => b === top ? i : -1).filter(i => i !== -1);
      const winner = tied[Math.floor(random() * tied.length)];
      const sorted = [...bids].sort((a, b) => b - a);
      const paid = auctionType === 'FirstPrice' ? top : Math.max(1, sorted[1]);
      players[winner].balance -= paid;
      players[winner].wins++; players[winner].paid+=paid;
      players[winner].rack.set(letter, (players[winner].rack.get(letter) ?? 0) + 1);
      for (const p of players) p.prices.push(paid);
    }
    // The server draws the NEXT tile in this same transaction. The next
    // loop opening models the client's reaction with the updated bagTotal.
    // After the last award there is no next opening and no word opportunity.
  }
  const p = players[seat];
  const ahead = players.filter(o => o.score > p.score).length;
  const ties = players.filter(o => o.score === p.score).length;
  return { auctionsWon:p.wins,totalPaid:p.paid,score: p.score, place: ahead + 1, win: ahead === 0 ? 1 / ties : 0, lead:ahead===0?1:0, balance: p.balance, unplayed: [...p.rack.values()].reduce((a,b) => a+b,0) };
}
interface Aggregate { games: number; meanScore: number; meanPlace: number; firstPlaceShare: number; tiedLeadRate:number; meanBalance: number; meanUnplayedTiles: number; scoreStdErr: number;meanAuctionsWon:number;meanTotalPaid:number }
function summarize(results: MatchResult[]): Aggregate {
  const mean = (key: keyof MatchResult) => results.reduce((sum, r) => sum + r[key], 0) / results.length;
  const score = mean('score');
  const variance = results.reduce((sum, r) => sum + (r.score - score) ** 2, 0) / Math.max(1, results.length - 1);
  return { meanAuctionsWon:mean('auctionsWon'),meanTotalPaid:mean('totalPaid'),games: results.length, meanScore: mean('score'), meanPlace: mean('place'), firstPlaceShare: mean('win'), tiedLeadRate:mean('lead'), meanBalance: mean('balance'), meanUnplayedTiles: mean('unplayed'), scoreStdErr: Math.sqrt(variance/results.length) };
}
const started = performance.now();
const phases: Record<string, Record<string, Record<string, Aggregate>>> = {};
for (const [phase, offset] of [['tuning', 0], ['holdout', 100000]] as const) {
  if(phaseFilter!=='both' && phaseFilter!==phase) continue;
  phases[phase] = {};
  for (const auctionType of formats) {
    phases[phase][auctionType] = {};
    for (const mode of candidates) {
      const results: MatchResult[] = [];
      for (let n = 0; n < games; n++) results.push(runMatch(mode, seed + offset + n, n % 6, auctionType, n % 2));
      const summary = summarize(results);
      phases[phase][auctionType][mode] = summary;
      console.log(`${phase} ${auctionType} ${mode}: score=${summary.meanScore.toFixed(2)} place=${summary.meanPlace.toFixed(2)} wins=${(100*summary.firstPlaceShare).toFixed(1)}%`);
    }
  }
}
latency.sort((a,b) => a-b);
const percentile = (q: number) => latency[Math.min(latency.length - 1, Math.floor(latency.length * q))];
const latencyStats = (samples: number[]) => { samples.sort((a,b) => a-b); const q = (p: number) => samples[Math.min(samples.length-1,Math.floor(samples.length*p))]; return { samples:samples.length,p50:q(.5),p95:q(.95),p99:q(.99),max:samples.at(-1) }; };
// A separate uncached run prevents warmed paired-match caches from hiding CPU cost.
const coldEngine = new WordEngine(words, 0);
const coldStrategy = new Strategy(coldEngine);
const coldLatency: number[] = [];
const coldRandom = rng(seed + 900000);
const coldBag = Object.entries(DEFAULT_BAG).flatMap(([c,n]) => Array<string>(n).fill(c));
for(let n=0;n<96;n++) {
  const rack: Rack = new Map();
  const available=[...coldBag];
  for(let j=0;j<5+n%12;j++) { const i=Math.floor(coldRandom()*available.length); const c=available.splice(i,1)[0]; rack.set(c,(rack.get(c)??0)+1); }
  const ctx: StrategyContext = {myRack:rack,myBalance:100,remainingTiles:30,auctionType:n%2?'Vickrey':'FirstPrice'};
  let t=performance.now(); coldStrategy.chooseWord(ctx); coldLatency.push(performance.now()-t);
  t=performance.now(); coldStrategy.decideBid({...ctx,letter:coldBag[Math.floor(coldRandom()*coldBag.length)]}); coldLatency.push(performance.now()-t);
}
const report = {
  schemaVersion: 1, seed, scenario, phaseFilter, formats, gamesPerCandidatePerFormatPerPhase: games, candidates,
  dictionaryWords: words.length, setupMs,
  elapsedMs: performance.now() - started,
  decisionLatencyMs: { samples: latency.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: latency.at(-1) },
  decisionLatencyByModeMs: Object.fromEntries(Object.entries(latencyByMode).map(([mode,samples]) => [mode,latencyStats(samples)])),
  coldDefaultDecisionLatencyMs: latencyStats(coldLatency),
  methodology: 'Six real-client policies, five hidden dealt tiles, seeded 98-tile bag, seat rotation, selected opponent scenario (mixed uses two heterogeneous lineups), paired seeds across candidates, disjoint tuning/holdout seed ranges, random bid ties, reserve 1, floor rewards, no-bid discard, final-tile unusable. Immediate idealized client reactions; no network/SDK timing modeled. No policy sees opponents racks or future bag.',
  phases,
};
const output = path.resolve(root, arg('--output', 'docs/benchmark-results.json'));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n');
console.log(`Saved ${output}; p99=${report.decisionLatencyMs.p99.toFixed(3)}ms; elapsed=${(report.elapsedMs/1000).toFixed(1)}s`);
