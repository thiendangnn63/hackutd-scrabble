import { readdirSync, readFileSync } from 'node:fs';
import { MatchRecorder, type LiveMatchRecord } from '../src/telemetry.js';
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? '.research/live-results.json';
const recorder = new MatchRecorder(output);
for (const file of readdirSync('.research').filter(name => /^live-\d+\.json$/.test(name))) {
  const data: { matches: LiveMatchRecord[] } = JSON.parse(readFileSync(`.research/${file}`, 'utf8'));
  for (const match of data.matches) recorder.record(match);
}
console.log(JSON.stringify(recorder.summary(), null, 2));
