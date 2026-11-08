/** Report saved public match results. Importing this module performs no I/O. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatchRecorder, type LiveSummary } from '../src/telemetry.js';

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const number = (value: number) => value.toFixed(2);
const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function renderLiveMarkdown(summary: LiveSummary, generatedAt = new Date().toISOString()): string {
  const lines = [
    '# Live match results', '', `Generated ${generatedAt}.`, '',
    `${summary.games} games; ${summary.outrightWins} outright wins, ${summary.sharedFirsts} shared first places, `
      + `${summary.losses} losses. Win rate including shared first places: **${percent(summary.winRate)}**.`, '',
    'A win means finishing first, including a tie for first. A loss means finishing below first. '
      + 'Shared first places are counted separately and are not fractional wins.', '',
    'These are observational, unpaired public matches. Opponents, seats, racks, bag draws, and auction formats '
      + 'can differ between policies. Small samples do not establish a reliable win rate or prove that a tuning '
      + 'change caused an improvement. Offline paired benchmarks provide complementary evidence.', '',
    '| Policy | Format | Games | Outright wins | Shared firsts | Losses | Win rate | Mean place | Mean score | Mean cash | Mean tiles won | Mean paid | Errors |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.groups.map(group => `| ${cell(group.policy)} | ${group.format} | ${group.games} | ${group.outrightWins} | ${group.sharedFirsts} | ${group.losses} | ${percent(group.winRate)} | ${number(group.meanPlace)} | ${number(group.meanScore)} | ${number(group.meanCash)} | ${number(group.meanTilesWon)} | ${number(group.meanPaid)} | ${group.errors} |`),
    '', '## Most recent matches', '',
    '| Match | Bot | Ended at (UTC) | Policy | Format | Place / players | Score | Final cash | Tiles won | Paid | Errors | Words |',
    '| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...summary.lastMatches.map(match => `| ${match.matchId} | ${match.botId} | ${match.endedAt} | ${cell(match.policy)} | ${match.format} | ${match.place} / ${match.tableSize} | ${match.score} | ${match.finalCash} | ${match.tilesWon} | ${match.totalPaid} | ${match.errors} | ${match.words.join(', ')} |`),
    '',
  ];
  if (summary.games === 0) lines.splice(4, 0, 'No completed matches have been recorded.', '');
  return lines.join('\n');
}

export function liveReportMain(args = process.argv.slice(2)): void {
  if (args.includes('--help')) {
    console.log('Usage: tsx scripts/live-report.ts [results.json] [--markdown=docs/LIVE_RESULTS.md]');
    return;
  }
  const paths = args.filter(arg => !arg.startsWith('--'));
  const unknown = args.filter(arg => arg.startsWith('--') && !arg.startsWith('--markdown='));
  const outputs = args.filter(arg => arg.startsWith('--markdown='));
  if (paths.length > 1 || unknown.length > 0 || outputs.length > 1 || outputs.some(arg => !arg.slice('--markdown='.length))) {
    throw new Error('Expected one optional results file and one optional --markdown=path. Use --help.');
  }
  const input = paths[0] ?? '.research/live-results.json';
  const markdownPath = outputs[0] ? resolve(outputs[0].slice('--markdown='.length)) : undefined;
  if (markdownPath === resolve(input)) throw new Error('Markdown output must differ from the results JSON file.');
  const summary = new MatchRecorder(input).summary();
  console.log(`${summary.games} games | ${summary.outrightWins} outright wins | ${summary.sharedFirsts} shared firsts | ${summary.losses} losses | win rate ${percent(summary.winRate)}`);
  for (const group of summary.groups) console.log(`${group.policy} / ${group.format}: ${group.games} games, win ${percent(group.winRate)}, mean place ${number(group.meanPlace)}, score ${number(group.meanScore)}, cash ${number(group.meanCash)}, tiles ${number(group.meanTilesWon)}`);
  console.log('Most recent matches:');
  for (const match of summary.lastMatches) console.log(`${match.matchId} ${match.policy}/${match.format}: place ${match.place}/${match.tableSize}, score ${match.score}, cash ${match.finalCash}, won ${match.tilesWon}, paid ${match.totalPaid}`);
  console.log('Live comparisons are unpaired and sample-limited; do not treat differences as causal.');
  if (markdownPath) {
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, renderLiveMarkdown(summary));
    console.log(`Saved ${markdownPath}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { liveReportMain(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
