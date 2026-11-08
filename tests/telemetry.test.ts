import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MatchRecorder, type LiveMatchRecord } from '../src/telemetry.js';
import { renderLiveMarkdown } from '../scripts/live-report.js';

function fixture(changes: Partial<LiveMatchRecord> = {}): LiveMatchRecord {
  return { matchId: '1', botId: '340', policy: 'adaptive', format: 'Vickrey',
    endedAt: '2026-11-08T04:00:00.000Z', score: 40, place: 1, tableSize: 3, firstPlaceTies: 1,
    finalCash: 10, tilesWon: 12, totalPaid: 130, words: ['CATS'], opponentScores: [30, 20], errors: 0, ...changes };
}
function temporary(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'scrabble-telemetry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('missing result files report empty totals without creating files', t => {
  const file = join(temporary(t), 'missing.json');
  const summary = new MatchRecorder(file).summary();
  assert.equal(summary.games, 0); assert.equal(summary.winRate, 0);
  assert.equal(summary.meanPlace, 0); assert.deepEqual(summary.groups, []);
  assert.equal(existsSync(file), false);
});

test('outright wins, shared first places, and losses follow exact competition place rules', t => {
  const recorder = new MatchRecorder(join(temporary(t), 'results.json'));
  recorder.record(fixture());
  recorder.record(fixture({ matchId: '2', score: 30, place: 1, firstPlaceTies: 2, opponentScores: [30, 20],
    finalCash: 20, tilesWon: 10, totalPaid: 110, errors: 1 }));
  recorder.record(fixture({ matchId: '3', score: 20, place: 2, firstPlaceTies: 1, opponentScores: [30, 20],
    finalCash: 30, tilesWon: 8, totalPaid: 90, errors: 2 }));
  const result = recorder.summary();
  assert.equal(result.games, 3); assert.equal(result.outrightWins, 1);
  assert.equal(result.sharedFirsts, 1); assert.equal(result.losses, 1);
  assert.equal(result.winRate, 2 / 3); assert.equal(result.meanPlace, 4 / 3);
  assert.equal(result.meanScore, 30); assert.equal(result.meanCash, 20);
  assert.equal(result.meanTilesWon, 10); assert.equal(result.meanPaid, 110);
  assert.equal(result.meanWords, 1); assert.equal(result.errors, 3);
});

test('grouping separates both policy and auction format', t => {
  const recorder = new MatchRecorder(join(temporary(t), 'results.json'));
  recorder.record(fixture());
  recorder.record(fixture({ matchId: '2', format: 'FirstPrice' }));
  recorder.record(fixture({ matchId: '3', policy: 'market-v2' }));
  assert.deepEqual(recorder.summary().groups.map(group => [group.policy, group.format, group.games]), [
    ['adaptive', 'FirstPrice', 1], ['adaptive', 'Vickrey', 1], ['market-v2', 'Vickrey', 1],
  ]);
});

test('recording deduplicates bot/match across restarts while retaining distinct bots', t => {
  const file = join(temporary(t), 'results.json');
  const original = new MatchRecorder(file);
  original.record(fixture());
  const before = readFileSync(file, 'utf8');
  const restarted = new MatchRecorder(file);
  restarted.record(fixture({ policy: 'different-label' }));
  assert.equal(readFileSync(file, 'utf8'), before);
  restarted.record(fixture({ botId: '341' }));
  assert.equal(restarted.summary().games, 2);
  // An older instance reloads before writing, preserving the newer saved row.
  original.record(fixture({ matchId: '2' }));
  assert.equal(new MatchRecorder(file).summary().games, 3);
});

test('atomic saves use a versioned file and leave no temporary files', t => {
  const directory = temporary(t);
  const file = join(directory, 'nested', 'results.json');
  const recorder = new MatchRecorder(file);
  recorder.record(fixture());
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(parsed.schemaVersion, 1); assert.equal(parsed.matches.length, 1);
  assert.deepEqual(readdirSync(join(directory, 'nested')), ['results.json']);
});

test('records and returned summaries cannot be mutated to corrupt saved or future results', t => {
  const recorder = new MatchRecorder(join(temporary(t), 'results.json'));
  const record = fixture(); recorder.record(record);
  record.words.push('DOG'); record.opponentScores[0] = 100;
  const result = recorder.summary();
  result.lastMatches[0].words.push('AA'); result.lastMatches[0].opponentScores[0] = 100;
  result.groups[0].games = 999;
  assert.deepEqual(recorder.summary().lastMatches[0].words, ['CATS']);
  assert.deepEqual(recorder.summary().lastMatches[0].opponentScores, [30, 20]);
  assert.equal(recorder.summary().groups[0].games, 1);
});

test('malformed JSON and invalid schema fail clearly and preserve existing files', t => {
  const file = join(temporary(t), 'results.json');
  for (const contents of ['{broken', '{}', '{"schemaVersion":2,"matches":[]}',
    JSON.stringify({ schemaVersion: 1, matches: [fixture({ place: 2 })] })]) {
    writeFileSync(file, contents);
    assert.throws(() => new MatchRecorder(file), /Cannot load live results.*Existing file was left unchanged/);
    assert.equal(readFileSync(file, 'utf8'), contents);
  }
  const recorderFile = join(temporary(t), 'other.json');
  const recorder = new MatchRecorder(recorderFile);
  recorder.record(fixture());
  writeFileSync(recorderFile, 'external corruption');
  assert.throws(() => recorder.record(fixture({ matchId: '2' })), /Cannot load live results/);
  assert.equal(readFileSync(recorderFile, 'utf8'), 'external corruption');
});

test('invalid incoming records reject inconsistencies, nonfinite data, and unexpected secret fields', t => {
  const file = join(temporary(t), 'results.json');
  const recorder = new MatchRecorder(file);
  for (const record of [fixture({ score: NaN }), fixture({ finalCash: -1 }), fixture({ place: 2 }),
    fixture({ firstPlaceTies: 2 }), fixture({ tableSize: 4 }), fixture({ endedAt: 'not a date' }),
    fixture({ words: ['not valid'] }), fixture({ matchId: '01' }),
    { ...fixture(), token: 'SHOULD_NEVER_BE_SAVED' }]) {
    assert.throws(() => recorder.record(record), /Invalid live match record/);
  }
  assert.equal(existsSync(file), false);
});

test('last matches are the ten most recent completion times even when recorded out of order', t => {
  const recorder = new MatchRecorder(join(temporary(t), 'results.json'));
  for (let n = 12; n >= 1; n--) recorder.record(fixture({ matchId: String(n), endedAt: `2026-11-08T04:${String(n).padStart(2, '0')}:00.000Z` }));
  assert.deepEqual(recorder.summary().lastMatches.map(match => match.matchId), ['12','11','10','9','8','7','6','5','4','3']);
});

test('report prints exact tie-aware totals and exports a sample-limited Markdown artifact', t => {
  const directory = temporary(t);
  const file = join(directory, 'results.json');
  const markdown = join(directory, 'report.md');
  const recorder = new MatchRecorder(file);
  recorder.record(fixture({ firstPlaceTies: 2, opponentScores: [40, 20] }));
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/live-report.ts', file, `--markdown=${markdown}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 games \| 0 outright wins \| 1 shared firsts \| 0 losses \| win rate 100\.0%/);
  const text = readFileSync(markdown, 'utf8');
  assert.match(text, /observational, unpaired public matches/);
  assert.match(text, /Small samples do not establish/);
  assert.match(text, /adaptive \| Vickrey/);
  assert.match(renderLiveMarkdown(recorder.summary(), 'FIXED-TIME'), /Generated FIXED-TIME/);
});

test('report refuses to overwrite its input result log with Markdown', t => {
  const file = join(temporary(t), 'results.json');
  new MatchRecorder(file).record(fixture());
  const before = readFileSync(file, 'utf8');
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/live-report.ts', file, `--markdown=${file}`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Markdown output must differ/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
