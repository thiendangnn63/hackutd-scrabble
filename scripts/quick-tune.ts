/** Bounded deterministic screening; public matches decide production promotion. */
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { WordEngine, DEFAULT_BAG, scoreWord, type Rack } from '../src/engine.js';
import { Strategy, type StrategyOptions, type StrategyContext } from '../src/strategy.js';
const start=performance.now(),deadline=start+55000;
const engine=new WordEngine(fs.readFileSync('data/wordlist.txt','utf8').split(/\r?\n/));
const base:StrategyOptions={mode:'market-convert',floorMultiplier:1,acquisitionReserve:.65,bidScale:1.6,holdGain:1.5};
const deltas:Partial<StrategyOptions>[]=[{}, {floorMultiplier:1.1},{floorMultiplier:1.2},{floorMultiplier:1.35},{acquisitionReserve:.5},{acquisitionReserve:.8},{acquisitionReserve:1},{bidScale:1.2},{bidScale:2},{bidScale:2.5},{holdGain:1.12},{holdGain:2},{floorMultiplier:1.1,acquisitionReserve:.8},{floorMultiplier:1.2,acquisitionReserve:.8},{floorMultiplier:1.35,acquisitionReserve:.8},{floorMultiplier:1.2,acquisitionReserve:1},{acquisitionReserve:.8,bidScale:2},{floorMultiplier:1.2,acquisitionReserve:.8,bidScale:2},{floorMultiplier:1.2,acquisitionReserve:.8,holdGain:1.12},{floorMultiplier:1.1,acquisitionReserve:.8,bidScale:2,holdGain:2}];
const configs=deltas.map((delta,n)=>({label:`convert-${String(n).padStart(2,'0')}`,options:{...base,...delta}}));
fs.mkdirSync('.research',{recursive:true});
fs.writeFileSync('.research/quick-configs.json',JSON.stringify(configs,null,2)+'\n');
function rng(seed:number){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
interface P{rack:Rack;cash:number;score:number;bot:Strategy;prices:number[];wins:number;paid:number}
interface Result{score:number;place:number;win:number;cash:number;tiles:number;paid:number}
function match(options:StrategyOptions,seed:number,seat:number,format:'Vickrey'|'FirstPrice',style:number):Result{
 const rand=rng(seed),bag=Object.entries(DEFAULT_BAG).flatMap(([c,n])=>Array<string>(n).fill(c));
 for(let i=bag.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
 const kinds=['market-all','market-margin','market-convert','market-pressure','market-quality'] as const;
 let oi=0;const ps:P[]=Array.from({length:6},(_,i)=>({rack:new Map(),cash:100,score:0,bot:new Strategy(engine,i===seat?options:style===0?'market-convert':kinds[oi++]),prices:[],wins:0,paid:0}));
 for(const p of ps)for(let i=0;i<5;i++){const c=bag.pop()!;p.rack.set(c,(p.rack.get(c)??0)+1);}
 const ctx=(p:P,remainingTiles:number,letter?:string):StrategyContext=>({myRack:p.rack,myBalance:p.cash,myScore:p.score,remainingTiles,auctionType:format,letter,opponentCount:5,observedPrices:p.prices,opponentScores:ps.filter(o=>o!==p).map(o=>o.score)});
 while(bag.length){const letter=bag.pop()!,remaining=bag.length;
  for(const p of ps)for(let j=0;j<30;j++){const word=p.bot.chooseWord(ctx(p,remaining));if(!word)break;const reward=scoreWord(word);p.cash+=reward;p.score+=reward;for(const c of word){const n=p.rack.get(c)!-1;if(n)p.rack.set(c,n);else p.rack.delete(c);}}
  const bids=ps.map(p=>p.bot.decideBid({...ctx(p,remaining),letter}));
  const top=Math.max(...bids);if(top>0){const tied=bids.flatMap((b,i)=>b===top?[i]:[]),winner=tied[Math.floor(rand()*tied.length)],sorted=[...bids].sort((a,b)=>b-a),paid=format==='FirstPrice'?top:Math.max(1,sorted[1]);const p=ps[winner];p.cash-=paid;p.wins++;p.paid+=paid;p.rack.set(letter,(p.rack.get(letter)??0)+1);for(const p of ps)p.prices.push(paid);}
 }
 const p=ps[seat],ahead=ps.filter(o=>o.score>p.score).length,ties=ps.filter(o=>o.score===p.score).length;
 return{score:p.score,place:ahead+1,win:ahead===0?1/ties:0,cash:p.cash,tiles:p.wins,paid:p.paid};
}
function summary(rows:Result[]){const mean=(key:keyof Result)=>rows.reduce((s,r)=>s+r[key],0)/rows.length;return{games:rows.length,meanScore:mean('score'),meanPlace:mean('place'),firstPlaceShare:mean('win'),meanCash:mean('cash'),meanTilesWon:mean('tiles'),meanPaid:mean('paid')};}
function evaluate(config:typeof configs[number],count:number,offset:number){const out:Record<string,ReturnType<typeof summary>>={};for(const format of ['Vickrey','FirstPrice'] as const){const rows:Result[]=[];for(let n=0;n<count;n++){if(performance.now()>deadline)throw new Error('Bounded quick-tune deadline reached');rows.push(match(config.options,offset+n,n%6,format,n%2));}out[format]=summary(rows);}return out;}
const training:Record<string,ReturnType<typeof evaluate>>={},validation:Record<string,ReturnType<typeof evaluate>>={};
let failure:string|undefined;
try{
 for(const c of configs){training[c.label]=evaluate(c,10,850001);console.log(`train ${c.label} Vickrey place=${training[c.label].Vickrey.meanPlace.toFixed(2)} score=${training[c.label].Vickrey.meanScore.toFixed(1)}`);}
 const top=[...configs].sort((a,b)=>training[a.label].Vickrey.meanPlace-training[b.label].Vickrey.meanPlace||training[b.label].Vickrey.meanScore-training[a.label].Vickrey.meanScore).slice(0,3);
 for(const c of top){validation[c.label]=evaluate(c,20,970001);console.log(`validate ${c.label} Vickrey place=${validation[c.label].Vickrey.meanPlace.toFixed(2)} score=${validation[c.label].Vickrey.meanScore.toFixed(1)}`);}
}catch(e){failure=String(e);}
const validated=Object.keys(validation).sort((a,b)=>validation[a].Vickrey.meanPlace-validation[b].Vickrey.meanPlace||validation[b].Vickrey.meanScore-validation[a].Vickrey.meanScore);
const report={createdAt:new Date().toISOString(),elapsedMs:performance.now()-start,configs,training,validation,bestValidated:validated[0]??null,failure,methodology:'20 options over market-convert; ten paired training bags per format, top three selected by Vickrey mean place then score, twenty disjoint validation bags per format; six active clients, alternating five convert rivals and five mixed market-family rivals; no idle bots; default five starting tiles; no final-tile redemption; immediate idealized reactions. Small local screening is not public proof.'};
fs.writeFileSync('.research/quick-tune-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({bestValidated:report.bestValidated,elapsedMs:report.elapsedMs,failure,validation}));
