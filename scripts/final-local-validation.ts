/** Frozen candidates, fresh common bags, no empirical/idle field; no production writes. */
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {playMatch,stats,type MatchResult} from './mass-local.js';
import type {StrategyOptions} from '../src/strategy.js';
const index=Number(process.argv.find(a=>a.startsWith('--index='))?.slice(8)??'-1');
const finalists=JSON.parse(fs.readFileSync('.research/evolution-top4.json','utf8')) as Array<{label:string;options:StrategyOptions}>;
const candidate=index<0?{label:'frozen-public-baseline',options:{mode:'market-convert' as const,floorMultiplier:1,acquisitionReserve:.65,bidScale:1.6,holdGain:1.5,terminalSpend:false}}:{...finalists[index],options:{...finalists[index].options,mode:'market-convert' as const}};
const output=`.research/final-validation-${index<0?'baseline':index}.json`,rows:MatchResult[]=[],latencies:number[]=[],started=performance.now(),cpuStart=process.cpuUsage();
function save(){const cpu=process.cpuUsage(cpuStart);fs.writeFileSync(output,JSON.stringify({schemaVersion:1,label:candidate.label,options:candidate.options,complete:rows.length===250,gamesTarget:250,seedBase:28600001,seedMethod:'All five frozen policies use identical 250 NEVER-BEFORE-USED bags/seats/scenarios; half five convert rivals, half strong-mixed active rivals. No empirical/idle cases. Paired differences require baseline from this same final run.',summary:stats(rows),byScenario:Object.fromEntries(['convert-selfplay','strong-mixed'].map(s=>[s,stats(rows.filter(r=>r.scenario===s))])),elapsedMs:performance.now()-started,cpuMs:(cpu.user+cpu.system)/1000,matches:rows},null,2)+'\n');}
for(let n=0;n<250;n++){rows.push(playMatch(candidate.options,28600001+n,n%6,n%2,'independent',latencies));if((n+1)%50===0)save();}
save();console.log(JSON.stringify({label:candidate.label,...stats(rows)}));
