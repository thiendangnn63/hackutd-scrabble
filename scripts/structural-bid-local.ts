/** Credential-free, reproducible full-match cohort evaluator. No production/network actions. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { performance } from 'node:perf_hooks';
import { WordEngine, DEFAULT_BAG, scoreWord, canSpell, type Rack, LETTER_VALUE } from '../src/engine.js';
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
interface Policy{chooseWord(ctx:StrategyContext):string|null;decideBid(ctx:StrategyContext&{letter:string}):number}
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
 const context=(p:Player,remainingTiles:number):StrategyContext=>({myRack:p.rack,myBalance:p.cash,myScore:p.score,remainingTiles,auctionType:'Vickrey',auctionDurationMs:1000,opponentCount:5,observedPrices:p.prices,opponentScores:ps.filter(o=>o!==p).map(o=>o.score)});
 const timed=<T>(fn:()=>T):T=>{const start=performance.now();const value=fn();latencies.push(performance.now()-start);return value;};
 while(bag.length){const letter=bag.pop()!,remaining=bag.length;
  // The previous award and current draw are one server transaction. The final
  // award has no subsequent opening, so no real client can redeem its tile.
  for(let pi=0;pi<6;pi++){const p=ps[pi];for(let w=0;w<50;w++){const c=context(p,remaining),word=pi===seat?timed(()=>p.policy.chooseWord(c)):p.policy.chooseWord(c);if(!word)break;if(!canSpell(word,p.rack))throw new Error(`Illegal word ${word}`);const reward=scoreWord(word);p.cash+=reward;p.score+=reward;for(const c of word){const n=p.rack.get(c)!-1;if(n)p.rack.set(c,n);else p.rack.delete(c);}if(w===49)throw new Error('Word loop exceeded');}}
  const bids=ps.map((p,pi)=>{const c={...context(p,remaining),letter};const bid=pi===seat?timed(()=>p.policy.decideBid(c)):p.policy.decideBid(c);if(!Number.isSafeInteger(bid)||bid<0||bid>p.cash)throw new Error(`Illegal bid ${bid}`);return bid;});
  const top=Math.max(...bids);if(top>0){const tied=bids.flatMap((b,i)=>b===top?[i]:[]),winner=tied[Math.floor(rand()*tied.length)],sorted=[...bids].sort((a,b)=>b-a),paid=Math.max(1,sorted[1]),p=ps[winner];p.cash-=paid;p.won++;p.paid+=paid;p.rack.set(letter,(p.rack.get(letter)??0)+1);for(const p of ps)p.prices.push(paid);}
  // No-bid draws are consumed, as in the pinned module.
 }
 const p=ps[seat],opponents=ps.filter(o=>o!==p),ahead=opponents.filter(o=>o.score>p.score).length;
 return{seed,seedKind,scenario:scenarios[scenarioIndex],seat,score:p.score,place:ahead+1,first:ahead===0,outright:ahead===0&&opponents.every(o=>o.score<p.score),last:opponents.every(o=>o.score>=p.score),strictLast:opponents.every(o=>o.score>p.score),cash:p.cash,tilesWon:p.won,paid:p.paid,unplayed:[...p.rack.values()].reduce((s,n)=>s+n,0),opponentScores:opponents.map(o=>o.score),elapsedMs:performance.now()-t};
}

// Experiment wrappers only: production source and current selected config are untouched.
const selected=JSON.parse(fs.readFileSync('docs/selected-config.json','utf8'));
const currentOptions:StrategyOptions={mode:'market-convert',...selected.options};
const variants=['credit-five','quality-all-racks','quality-plus-credit','letter-price','letter-price-plus-credit','reserve-schedule'] as const;
type Variant=typeof variants[number];
export class BidExperiment implements Policy{
 private readonly base:Strategy;
 private readonly early:Strategy;
 private readonly late:Strategy;
 private previous='';private priceCount=0;private readonly prices=new Map<number,number[]>();
 constructor(readonly variant:Variant, options:StrategyOptions=currentOptions, private readonly wordEngine:WordEngine=engine){this.base=new Strategy(wordEngine,options);this.early=new Strategy(wordEngine,{...options,acquisitionReserve:1.8});this.late=new Strategy(wordEngine,{...options,acquisitionReserve:.65});}
 chooseWord(c:StrategyContext){return this.base.chooseWord(c);}
 decideBid(c:StrategyContext&{letter:string}){
  let bid=(this.variant==='reserve-schedule'?(c.remainingTiles>40?this.early:c.remainingTiles<20?this.late:this.base):this.base).decideBid(c);
  if(c.remainingTiles<=0||c.myBalance<=0)return 0;
  const face=LETTER_VALUE[c.letter],have=c.myRack.get(c.letter)??0;
  const after=new Map(c.myRack);after.set(c.letter,have+1);
  const best=this.wordEngine.best(after),before=this.wordEngine.best(c.myRack)?.score??0,gain=(best?.score??0)-before;
  const tiles=[...c.myRack.values()].reduce((s,n)=>s+n,0),vowels=[...c.myRack].reduce((s,[l,n])=>s+('AEIOU'.includes(l)?n:0),0);
  let cap=c.myBalance*(c.remainingTiles<=5?1:c.remainingTiles<=15?.65:.38);
  if(best&&best.word.length>=6&&gain>0)cap=Math.max(cap,Math.min(c.myBalance,best.score));
  const five=this.variant==='credit-five'||this.variant==='quality-plus-credit'||this.variant==='letter-price-plus-credit';
  if(five&&best&&best.word.length===5&&best.score>=18&&gain>0){cap=Math.max(cap,Math.min(c.myBalance,best.score));bid=Math.max(bid,Math.min(cap,gain*1.92+5));}
  if((this.variant==='quality-all-racks'||this.variant==='quality-plus-credit')&&tiles>=5&&c.remainingTiles>=10&&have===0&&face>=3&&vowels>0){
   if(c.letter!=='Q'||(c.myRack.get('U')??0)>0||gain>0){let prior=3*face+8;if('JZ'.includes(c.letter)&&gain<=0)prior*=.8;bid=Math.max(bid,Math.min(cap,prior));}
  }
  if(this.variant==='letter-price'||this.variant==='letter-price-plus-credit'){
   const observed=c.observedPrices??[];
   if(observed.length>this.priceCount&&this.previous){const pf=LETTER_VALUE[this.previous],bucket=pf>=8?8:pf>=3?3:pf;const history=this.prices.get(bucket)??[];history.push(observed.at(-1)!);this.prices.set(bucket,history);}
   this.priceCount=observed.length;this.previous=c.letter;
   const bucket=face>=8?8:face>=3?3:face,history=this.prices.get(bucket)??[],sorted=[...history].sort((a,b)=>a-b),all=[...observed.slice(-20)].sort((a,b)=>a-b),global=all.length?all[Math.floor(all.length/2)]:12,weight=history.length/(history.length+3),local=sorted.length?sorted[Math.floor(sorted.length/2)]:global,prior=global*(1+.1*(face-1)),quote=weight*local+(1-weight)*prior+1;
   const balanced='AEIOU'.includes(c.letter)?vowels/Math.max(1,tiles)<.6:vowels>0;
   if(have<=1&&balanced&&(c.letter!=='Q'||(c.myRack.get('U')??0)>0||gain>0)){const affordable=c.myBalance/Math.max(2,c.remainingTiles/6*1.2),capacity=Math.max(affordable,3*face+4);bid=Math.max(bid,Math.min(cap,quote,capacity));}
  }
  if(c.remainingTiles===1&&gain<=0)return 0;
  return Math.max(0,Math.floor(Math.min(c.myBalance,bid)));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const worker=Number(arg('--worker','0')),count=Number(arg('--count','500')),freshSeed=Number(arg('--seed','111000001'));
const selectedVariants=arg('--variants','');
const seatFor=(n:number)=>args.includes('--balanced-seats')?Math.floor(n/2)%6:n%6;
const own=selectedVariants?variants.filter(v=>selectedVariants.split(',').includes(v)):variants.filter((_,i)=>i%2===worker),results:unknown[]=[];
const baseline:MatchResult[]=[],latencies:number[]=[];
for(let n=0;n<count;n++)baseline.push(playMatch(currentOptions,freshSeed+n,seatFor(n),n%2,'independent',latencies));
const paired=(rows:MatchResult[],key:'place'|'score'|'last'|'first')=>{const d=rows.map((r,i)=>Number(r[key])-Number(baseline[i][key])),m=d.reduce((s,x)=>s+x,0)/d.length,se=Math.sqrt(d.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,d.length-1)/d.length);return{mean:m,ci95:[m-1.96*se,m+1.96*se]};};

for(const variant of own){const rows:MatchResult[]=[];for(let n=0;n<count;n++)rows.push(playMatch(currentOptions,freshSeed+n,seatFor(n),n%2,'independent',latencies,new BidExperiment(variant)));const result={variant,summary:stats(rows),paired:{place:paired(rows,'place'),score:paired(rows,'score'),last:paired(rows,'last'),first:paired(rows,'first')},matches:rows};results.push(result);fs.writeFileSync(output,JSON.stringify({worker,current:selected,baseline:stats(baseline),baselineMatches:baseline,physicalGames:count*(1+results.length),results},null,2)+'\n');console.log(JSON.stringify({variant,summary:result.summary,paired:result.paired}));}

}
