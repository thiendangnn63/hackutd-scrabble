/** Bid-for-bid parity: immutable explicit closed auction records vs frozen inferred-history oracle. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {WordEngine} from '../src/engine.js';
import {Strategy,type StrategyContext,type StrategyOptions} from '../src/strategy.js';
import {playMatch,stats,type Policy,type MatchResult} from './mass-local.js';
import {BidExperiment} from './structural-bid-local.js';
const args=process.argv.slice(2),arg=(n:string,d:string)=>args.find(a=>a.startsWith(`${n}=`))?.slice(n.length+1)??d;
const count=Number(arg('--games','500')),offset=Number(arg('--offset','0')),output=arg('--output','.research/letter-price-integration-parity.json');
const old=JSON.parse(fs.readFileSync('.research/letter-price-confirmed.json','utf8')).current;
const options:StrategyOptions={mode:'market-convert',...old.options,letterPrices:false};
const engine=new WordEngine(fs.readFileSync('data/wordlist.txt','utf8').split(/\r?\n/));
let bidChecks=0,wordChecks=0,historyChecks=0;const rows:MatchResult[]=[],started=performance.now();
class Parity implements Policy{
 readonly production=new Strategy(engine,{...options,letterPrices:true});
 readonly reference=new BidExperiment('letter-price',options,engine);
 chooseWord(c:StrategyContext){const p=this.production.chooseWord(c),r=this.reference.chooseWord(c);assert.equal(p,r,'holding changed');wordChecks++;return p;}
 decideBid(c:StrategyContext&{letter:string}){
  const history=c.recentAuctionPrices??[];
  assert.ok(history.every(h=>Number.isFinite(h.paid)&&h.paid>0&&h.letter.length===1));
  assert.equal(new Set(history.map(h=>String(h.auctionId))).size,history.length,'duplicate simulated closed auction IDs');historyChecks++;
  const before=JSON.stringify(history,(_,v)=>typeof v==='bigint'?String(v):v);
  const p=this.production.decideBid(c),r=this.reference.decideBid(c);
  assert.ok(Number.isSafeInteger(p)&&p>=0&&p<=c.myBalance,'invalid funding');
  if(c.remainingTiles===0)assert.equal(p,0);
  assert.equal(p,r,`bid mismatch letter=${c.letter} remaining=${c.remainingTiles} cash=${c.myBalance} history=${history.length}`);
  assert.equal(JSON.stringify(history,(_,v)=>typeof v==='bigint'?String(v):v),before,'public history mutated');bidChecks++;return p;
 }
}
for(let n=0;n<count;n++){
 const i=offset+n,seat=Math.floor(i/2)%6,scenario=i%2;
 rows.push(playMatch({...options,letterPrices:true},181000001+i,seat,scenario,'independent',[],new Parity()));
 if((n+1)%100===0)console.log(`parity ${n+1}/${count}, bids=${bidChecks}, words=${wordChecks}`);
}
const result={complete:true,games:count,seedRange:[181000001+offset,181000000+offset+count],initialConfig:old,method:'500+ full games; explicit public closed-auction history generated after award only; all six seats in each of two strong active scenarios; production bids and holding asserted against frozen pre-integration oracle on every action. Same actions imply identical outcomes.',bidChecks,wordChecks,historyChecks,elapsedMs:performance.now()-started,summary:stats(rows),matches:rows};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,matches:undefined}));
