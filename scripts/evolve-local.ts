/** Independent nice-10 evolution islands; experiment-only, no network/production writes. */
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {playMatch,stats,type MatchResult} from './mass-local.js';
import type {StrategyOptions} from '../src/strategy.js';
const args=process.argv.slice(2),arg=(n:string,d:string)=>args.find(a=>a.startsWith(`${n}=`))?.slice(n.length+1)??d;
const island=Number(arg('--island','0')),output=arg('--output',`.research/evolution-island-${island}.json`),stopAt=Date.parse(arg('--stop-at','2026-11-08T04:42:00Z'));
const start=performance.now(),cpu=process.cpuUsage();let generation=0,seed=Number(arg('--seed-base','8042001'))+island*100000;
const validationSeed=Number(arg('--validation-seed-base','15000001'));
const initialPath=arg('--initial-config','');
const initial=initialPath?JSON.parse(fs.readFileSync(initialPath,'utf8')):null;
let actualFullMatches=0;
let state=(17479+island*1177)>>>0;const rand=()=>{state=Math.imul(state,1664525)+1013904223>>>0;return state/4294967296;};
const choose=<T>(a:T[])=>a[Math.floor(rand()*a.length)];
const base:StrategyOptions={floorMultiplier:1,acquisitionReserve:1,bidScale:1.6,holdGain:1.5,terminalSpend:false,...(initial?.options??{}),mode:'market-convert'};
const genes={floorMultiplier:[.6,.8,1,1.1,1.2,1.35,1.6,2],acquisitionReserve:[.5,.65,.8,1,1.2,1.5,2,3],bidScale:[.6,.9,1.2,1.6,2,2.5,3.2],holdGain:[1,1.12,1.3,1.5,1.8,2.2,3]};
type Gene=keyof typeof genes;
const key=(o:StrategyOptions)=>JSON.stringify(o);
function mutate(o:StrategyOptions){const next={...o};const keys=Object.keys(genes)as Gene[];for(let n=0;n<1+Math.floor(rand()*2);n++){const g=choose(keys);next[g]=choose(genes[g]);}if(rand()<.1)next.terminalSpend=!next.terminalSpend;return next;}
const baselineCache=new Map<string,MatchResult[]>();
function run(options:StrategyOptions,count:number,offset:number){const rows:MatchResult[]=[],times:number[]=[];for(let n=0;n<count;n++){if(Date.now()>stopAt)break;rows.push(playMatch(options,offset+n,n%6,n%3,'independent',times));actualFullMatches++;}return rows;}
function evaluate(options:StrategyOptions,count:number,offset:number){const bk=`${count}:${offset}`;let baseline=baselineCache.get(bk);if(!baseline){baseline=run(base,count,offset);baselineCache.set(bk,baseline);}const rows=key(options)===key(base)?baseline:run(options,count,offset);const strong=rows.filter(r=>r.scenario!=='empirical-price-pressure'),bs=baseline.filter(r=>r.scenario!=='empirical-price-pressure');const diff=(k:'place'|'score')=>{const ds=strong.map((r,i)=>r[k]-(bs[i]?.[k]??r[k])),n=ds.length,m=n?ds.reduce((s,x)=>s+x,0)/n:0,se=n>1?Math.sqrt(ds.reduce((s,x)=>s+(x-m)**2,0)/(n-1)/n):0;return{mean:m,ci95:[m-1.96*se,m+1.96*se]};};return{options,games:rows.length,summary:stats(rows),competitive:stats(strong),baselineCompetitive:stats(bs),pairedToCurrent:{place:diff('place'),score:diff('score')},byScenario:Object.fromEntries(['convert-selfplay','strong-mixed','empirical-price-pressure'].map(s=>[s,stats(rows.filter(r=>r.scenario===s))]))};}

type Eval=ReturnType<typeof evaluate>;
const compare=(a:Eval,b:Eval)=>a.competitive.meanPlace-b.competitive.meanPlace||b.competitive.meanScore-a.competitive.meanScore;
const profiles=JSON.parse(fs.readFileSync('.research/bot-profiles.json','utf8')) as Array<{policy:string;options?:StrategyOptions}>;
let population:StrategyOptions[]=[base,{...base,acquisitionReserve:.65},{...base,floorMultiplier:1.2},...profiles.slice(20+island*3,23+island*3).map(p=>({...base,...p.options,mode:'market-convert' as const}))];
while(population.length<20)population.push(mutate(choose(population)));
let elites:Eval[]=[],validations:Eval[]=[],trace:unknown[]=[];const evaluated=new Set<string>();
function save(){const used=process.cpuUsage(cpu);fs.writeFileSync(output,JSON.stringify({schemaVersion:2,island,generation,actualFullMatches,initialConfig:initial,trainingSeedBase:seed,validationSeedBase:validationSeed,stopAt:new Date(stopAt).toISOString(),elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,fitness:'Mean finishing place ONLY against convert-selfplay and strong-mixed, score tie-break. Empirical active-pressure field is too weak and excluded from fitness.',screenBags:36,holdoutBags:120,elites,validations,trace},null,2)+'\n');}
while(Date.now()<stopAt){
 const results:Eval[]=[];
 for(const o of population){if(Date.now()>stopAt)break;results.push(evaluate(o,36,seed+generation*2000));}
 const complete=results.filter(r=>r.games===36).sort(compare);if(!complete.length)break;
 elites=complete.slice(0,4);generation++;
 for(const elite of elites.slice(0,2)){if(Date.now()>stopAt)break;const k=key(elite.options);if(evaluated.has(k))continue;const validation=evaluate(elite.options,120,validationSeed+island*100000+generation*1000);if(validation.games===120){validations.push(validation);evaluated.add(k);}}
 validations.sort(compare);validations=validations.slice(0,20);trace.push({generation,screened:complete.length,best:elites[0],bestValidated:validations[0]});save();console.log(JSON.stringify({island,generation,screened:complete.length,bestScreen:elites[0].competitive,bestValidated:validations[0]?.competitive,options:validations[0]?.options}));
 population=elites.map(e=>e.options);while(population.length<20){const o=mutate(choose(elites).options);if(!population.some(p=>key(p)===key(o)))population.push(o);}
 if(process.memoryUsage().rss>768*1048576)break;
}
save();console.log(`island${island} stopped cleanly`);
