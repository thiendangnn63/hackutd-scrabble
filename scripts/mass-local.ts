/** Credential-free, reproducible full-match cohort evaluator. No production/network actions. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { performance } from 'node:perf_hooks';
import { WordEngine, DEFAULT_BAG, scoreWord, canSpell, type Rack } from '../src/engine.js';
import { Strategy, type StrategyOptions, type StrategyContext, type StrategyMode } from '../src/strategy.js';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('nice -n 10 node --import tsx scripts/mass-local.ts --start=13 --end=26 --games=100 --seed=1760001 --output=.research/cohort1-local.json\n--start inclusive; --end EXCLUSIVE. All cohorts must share --seed for paired unique-config comparisons.');process.exit(0);}
const arg=(name:string,fallback:string)=>args.find(a=>a.startsWith(`${name}=`))?.slice(name.length+1)??fallback;
const startIndex=Number(arg('--start','0')),endIndex=Number(arg('--end','40')),games=Number(arg('--games','100')),seedBase=Number(arg('--seed','1760001'));
const output=arg('--output','.research/cohort-local.json');
if(![startIndex,endIndex,games,seedBase].every(Number.isSafeInteger)||startIndex<0||endIndex<=startIndex||games<1||seedBase<0)throw new Error('Invalid cohort arguments');
interface Profile{botId:string;label:string;policy:StrategyMode;policyLabel?:string;options?:StrategyOptions}
const profiles:Profile[]=JSON.parse(fs.readFileSync('.research/bot-profiles.json','utf8'));
if(endIndex>profiles.length)throw new Error('End exceeds profile count');
const optionsFor=(p:Profile):StrategyOptions=>({mode:p.policy,floorMultiplier:p.policy==='market-margin'?1.2:p.policy==='market-budget'?1.5:p.policy==='market-pressure'?2:1,acquisitionReserve:.65,bidScale:1.6,holdGain:1.5,terminalSpend:false,...p.options});
const configKey=(p:Profile)=>JSON.stringify(optionsFor(p));
const representative=new Map<string,string>();for(const p of profiles)if(!representative.has(configKey(p)))representative.set(configKey(p),p.botId);
const started=performance.now(),cpuStart=process.cpuUsage();
const engine=new WordEngine(fs.readFileSync('data/wordlist.txt','utf8').split(/\r?\n/));
const preprocessingMs=performance.now()-started;
function random(seed:number){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export interface Policy{chooseWord(ctx:StrategyContext):string|null;decideBid(ctx:StrategyContext&{letter:string}):number}
interface Player{rack:Rack;cash:number;score:number;policy:Policy;prices:number[];won:number;paid:number}
export interface MatchResult{seed:number;seedKind:'independent'|'paired';scenario:string;seat:number;score:number;place:number;first:boolean;outright:boolean;last:boolean;strictLast:boolean;cash:number;tilesWon:number;paid:number;unplayed:number;opponentScores:number[];elapsedMs:number}
export const scenarios=['convert-selfplay','strong-mixed','empirical-price-pressure'];
function empirical(offset:number):Policy{
 const holding=new Strategy(engine,'market-convert');
 return{chooseWord:c=>holding.chooseWord(c),decideBid:c=>{
  if(c.remainingTiles<=0||c.myBalance<=0)return 0;
  const after=new Map(c.myRack);after.set(c.letter,(after.get(c.letter)??0)+1);
  const ready=(engine.best(after)?.score??0)-(engine.best(c.myRack)?.score??0);
  const prices=(c.observedPrices??[]).slice(-16).filter(p=>p>0).sort((a,b)=>a-b),median=prices.length?prices[Math.floor(prices.length/2)]:11;
  const face=scoreWord(c.letter);let quote=Math.max(3*face+8+offset,median*1.12+1,ready*1.7);
  if(c.letter==='Q'&&!(c.myRack.get('U')??0)&&ready<=0)quote=Math.min(quote,10);
  if(c.remainingTiles===1&&ready<=0)return 0;
  return Math.max(0,Math.floor(Math.min(c.myBalance,quote)));
 }};
}
export function stats(rows:MatchResult[]){
 const n=rows.length,mean=(key:'score'|'place'|'cash'|'tilesWon'|'paid'|'unplayed'|'elapsedMs')=>n?rows.reduce((s,r)=>s+r[key],0)/n:0;
 const avg=mean('score'),variance=n>1?rows.reduce((s,r)=>s+(r.score-avg)**2,0)/(n-1):0;
 return{games:n,meanScore:avg,scoreStdErr:Math.sqrt(variance/Math.max(1,n)),meanPlace:mean('place'),firstPlaces:rows.filter(r=>r.first).length,outrightWins:rows.filter(r=>r.outright).length,sharedFirsts:rows.filter(r=>r.first&&!r.outright).length,winRate:n?rows.filter(r=>r.first).length/n:0,lastPlaces:rows.filter(r=>r.last).length,strictLasts:rows.filter(r=>r.strictLast).length,lastRate:n?rows.filter(r=>r.last).length/n:0,meanCash:mean('cash'),meanTilesWon:mean('tilesWon'),meanPaid:mean('paid'),meanUnplayedTiles:mean('unplayed'),meanMatchElapsedMs:mean('elapsedMs')};
}
function latencyStats(times:number[]){times.sort((a,b)=>a-b);const q=(p:number)=>times[Math.min(times.length-1,Math.floor(times.length*p))]??0;return{samples:times.length,p50:q(.5),p95:q(.95),p99:q(.99),max:times.at(-1)??0};}
export function playMatch(options:StrategyOptions,seed:number,seat:number,scenarioIndex:number,seedKind:'independent'|'paired',latencies:number[],heroPolicy?:Policy):MatchResult{
 const t=performance.now(),rand=random(seed),bag=Object.entries(DEFAULT_BAG).flatMap(([c,n])=>Array<string>(n).fill(c));
 for(let i=bag.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
 let oi=0;const mixed:Policy[]=[new Strategy(engine,'market-convert'),new Strategy(engine,{mode:'market-convert',floorMultiplier:1.2,acquisitionReserve:1}),new Strategy(engine,'market-margin'),new Strategy(engine,'market-quality'),empirical(1)];
 const ps:Player[]=Array.from({length:6},(_,i)=>({rack:new Map(),cash:100,score:0,policy:i===seat?(heroPolicy??new Strategy(engine,options)):scenarioIndex===0?new Strategy(engine,'market-convert'):scenarioIndex===1?mixed[oi++]:empirical(oi++-1),prices:[],won:0,paid:0}));
 // Server deals five consecutive private draws to each player.
 for(const p of ps)for(let n=0;n<5;n++){const c=bag.pop()!;p.rack.set(c,(p.rack.get(c)??0)+1);}
 const recentAuctionPrices:Array<{auctionId:string;letter:string;paid:number}>=[];
 let closedAuctionOrdinal=0;
 const context=(p:Player,remainingTiles:number):StrategyContext=>({myRack:p.rack,myBalance:p.cash,myScore:p.score,remainingTiles,auctionType:'Vickrey',auctionDurationMs:1000,opponentCount:5,observedPrices:p.prices,recentAuctionPrices,opponentScores:ps.filter(o=>o!==p).map(o=>o.score)});
 const timed=<T>(fn:()=>T):T=>{const start=performance.now();const value=fn();latencies.push(performance.now()-start);return value;};
 while(bag.length){const letter=bag.pop()!,remaining=bag.length;
  // The previous award and current draw are one server transaction. The final
  // award has no subsequent opening, so no real client can redeem its tile.
  for(let pi=0;pi<6;pi++){const p=ps[pi];for(let w=0;w<50;w++){const c=context(p,remaining),word=pi===seat?timed(()=>p.policy.chooseWord(c)):p.policy.chooseWord(c);if(!word)break;if(!canSpell(word,p.rack))throw new Error(`Illegal word ${word}`);const reward=scoreWord(word);p.cash+=reward;p.score+=reward;for(const c of word){const n=p.rack.get(c)!-1;if(n)p.rack.set(c,n);else p.rack.delete(c);}if(w===49)throw new Error('Word loop exceeded');}}
  const bids=ps.map((p,pi)=>{const c={...context(p,remaining),letter};const bid=pi===seat?timed(()=>p.policy.decideBid(c)):p.policy.decideBid(c);if(!Number.isSafeInteger(bid)||bid<0||bid>p.cash)throw new Error(`Illegal bid ${bid}`);return bid;});
  const top=Math.max(...bids);if(top>0){const tied=bids.flatMap((b,i)=>b===top?[i]:[]),winner=tied[Math.floor(rand()*tied.length)],sorted=[...bids].sort((a,b)=>b-a),paid=Math.max(1,sorted[1]),p=ps[winner];p.cash-=paid;p.won++;p.paid+=paid;p.rack.set(letter,(p.rack.get(letter)??0)+1);for(const p of ps)p.prices.push(paid);recentAuctionPrices.push({auctionId:String(++closedAuctionOrdinal),letter,paid});}
  // No-bid draws are consumed, as in the pinned module.
 }
 const p=ps[seat],opponents=ps.filter(o=>o!==p),ahead=opponents.filter(o=>o.score>p.score).length;
 return{seed,seedKind,scenario:scenarios[scenarioIndex],seat,score:p.score,place:ahead+1,first:ahead===0,outright:ahead===0&&opponents.every(o=>o.score<p.score),last:opponents.every(o=>o.score>=p.score),strictLast:opponents.every(o=>o.score>p.score),cash:p.cash,tilesWon:p.won,paid:p.paid,unplayed:[...p.rack.values()].reduce((s,n)=>s+n,0),opponentScores:opponents.map(o=>o.score),elapsedMs:performance.now()-t};
}
const scorecards:unknown[]=[];
function save(complete:boolean,error?:string){const cpu=process.cpuUsage(cpuStart);const report={schemaVersion:1,createdAt:new Date().toISOString(),complete,error,startIndex,endIndexExclusive:endIndex,gamesPerProfile:games,seedBase,format:'Vickrey',scenarios,preprocessingMs,elapsedMs:performance.now()-started,cpuMs:(cpu.user+cpu.system)/1000,rssMb:process.memoryUsage().rss/1048576,methodology:'Actual independent full matches for every profile. Semantic duplicate-policy replicas use disjoint bot-ID-offset seeds for all games. Each first representative of a unique configuration uses independent seeds in its first half and shared paired seeds in its second half; paired unique configurations are correlated comparisons, not independent replicates. Seat rotations match on paired seeds. Five active rivals; no idle cases. Default 98-tile bag, five consecutive private dealt tiles, cash100, exact dictionary/floor rewards, reserve1/random ties, no-bid consumption, unusable final real-client award. Idealized immediate network reactions. Policies never receive rival racks/future draws. No production changes.',scorecards};fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
try{
 for(let index=startIndex;index<endIndex;index++){
  const profile=profiles[index],t=performance.now(),cpu=process.cpuUsage(),latencies:number[]=[],rows:MatchResult[]=[],isRepresentative=representative.get(configKey(profile))===profile.botId;
  for(let n=0;n<games;n++){
   const paired=isRepresentative&&n>=Math.ceil(games/2),seed=paired?seedBase+10000000+n-Math.ceil(games/2):seedBase+Number(profile.botId)*1000+n;
   const seat=paired?(n-Math.ceil(games/2))%6:(n+Number(profile.botId))%6;
   rows.push(playMatch(optionsFor(profile),seed,seat,n%3,paired?'paired':'independent',latencies));
  }
  const used=process.cpuUsage(cpu);const card={index,botId:profile.botId,label:profile.label,policy:profile.policy,policyLabel:profile.policyLabel??profile.policy,options:optionsFor(profile),semanticConfigKey:configKey(profile),representativeBotId:representative.get(configKey(profile)),summary:stats(rows),byScenario:Object.fromEntries(scenarios.map(s=>[s,stats(rows.filter(r=>r.scenario===s))])),independent:stats(rows.filter(r=>r.seedKind==='independent')),paired:stats(rows.filter(r=>r.seedKind==='paired')),decisionLatencyMs:latencyStats(latencies),elapsedMs:performance.now()-t,cpuMs:(used.user+used.system)/1000,matches:rows};
  scorecards.push(card);save(false);console.log(JSON.stringify({index,botId:profile.botId,policyLabel:card.policyLabel,...card.summary,cpuMs:card.cpuMs}));
  if(process.memoryUsage().rss>768*1048576)throw new Error('Stopped at RSS safety limit (768MiB)');
 }
 save(true);console.log(`Completed ${scorecards.length} profiles × ${games} games; saved ${output}`);
}catch(error){save(false,String(error));throw error;}

}
