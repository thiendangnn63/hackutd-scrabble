/** macOS per-user competition runner: no credentials are embedded in the plist. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const action = process.argv[2] ?? 'status';
if (process.platform !== 'darwin') throw new Error('This helper uses macOS launchd. Elsewhere run npm run start:prod under your process supervisor.');
const label = 'com.hackutd.scrabble.bigdawg';
const target = `gui/${process.getuid!()}/${label}`;
const directory = resolve('.research');
const plist = resolve(directory, `${label}.plist`);
if (action === 'stop') {
  const result = spawnSync('launchctl', ['bootout', target], { encoding: 'utf8' });
  console.log(result.status === 0 ? 'Competition runner stopped.' : result.stderr.trim());
} else if (action === 'status') {
  const result = spawnSync('launchctl', ['print', target], { encoding: 'utf8' });
  if (result.status !== 0) { console.log('Competition runner is not loaded.'); process.exitCode = 1; }
  else console.log(result.stdout.split('\n').filter(line => /state =|pid =|last exit code =|program =/.test(line)).join('\n'));
} else if (action === 'start') {
  const tournamentId = process.env.TOURNAMENT_ID ?? '2';
  if (!/^\d+$/.test(tournamentId)) throw new Error('TOURNAMENT_ID must be a nonnegative integer.');
  const policy = process.argv[3];
  const modes = ['starter', 'greedy', 'hoard', 'adaptive', 'aggressive', 'patient', 'market', 'market-focused', 'market-all', 'market-budget', 'market-pressure', 'market-margin', 'market-quality', 'market-convert'];
  if (!policy || !modes.includes(policy)) throw new Error('Usage: competition-service start <supported-policy> [--options-file=public-config.json]');
  const optionsPath = process.argv.find(arg => arg.startsWith('--options-file='))?.slice(15);
  let selectedLabel = policy;
  let selectedOptions: Record<string, number | boolean> = {};
  if (optionsPath !== undefined) {
    if (!optionsPath) throw new Error('--options-file requires a path to public configuration JSON.');
    const config: unknown = JSON.parse(readFileSync(resolve(optionsPath), 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Public configuration must be an object.');
    const entry = config as Record<string, unknown>;
    if (Object.keys(entry).some(key => key !== 'label' && key !== 'options')) throw new Error('Public configuration permits only label and options; credentials must remain in .env.');
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 128 || /[\x00-\x1f\x7f]/.test(entry.label)) throw new Error('Public configuration label must be 1–128 characters without control characters.');
    if (!entry.options || typeof entry.options !== 'object' || Array.isArray(entry.options)) throw new Error('Public configuration options must be an object.');
    selectedLabel = entry.label;
    for (const [key, value] of Object.entries(entry.options)) {
      if (key === 'terminalSpend' && typeof value === 'boolean') { selectedOptions[key] = value; continue; }
      if (!['bidScale', 'holdGain', 'floorMultiplier', 'acquisitionReserve'].includes(key) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 5) throw new Error(`Invalid public strategy option ${key}; numeric values must be >0 and <=5.`);
      selectedOptions[key] = value;
    }
  }
  mkdirSync(directory, { recursive: true });
  const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const publicUntil = process.argv.find(arg => arg.startsWith('--public-until='))?.slice(15);
  if (publicUntil && !Number.isFinite(Date.parse(publicUntil))) throw new Error('--public-until must be an ISO timestamp.');
  const env = { BOT_NAME: 'bigdawg', STRATEGY_MODE: policy, STRATEGY_OPTIONS: JSON.stringify(selectedOptions), POLICY_LABEL: selectedLabel, TOURNAMENT_ID: tournamentId, TOURNAMENT_ONLY: publicUntil ? '0' : '1', EXIT_AFTER_TOURNAMENT: '1', RESULTS_FILE: resolve('.research/live-340.json') };
  const args = ['/usr/bin/caffeinate', '-i', process.execPath, '--env-file-if-exists=.env', resolve('dist/bot.mjs')];
  if (publicUntil) args.push(`--until=${publicUntil}`);
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>WorkingDirectory</key><string>${xml(resolve('.'))}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(resolve(directory, 'competition.log'))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(directory, 'competition.log'))}</string>
</dict></plist>`, { mode: 0o600 });
  // Reloading this one named user job is reversible and leaves unrelated jobs alone.
  const deadline = performance.now() + 5000;
  spawnSync('launchctl', ['bootout', target], { encoding: 'utf8', timeout: 1000 });
  let loaded = false;
  let lastError = 'Previous job did not finish unloading.';
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (performance.now() < deadline) {
    const timeout = Math.max(1, Math.min(750, Math.floor(deadline - performance.now())));
    const oldJob = spawnSync('launchctl', ['print', target], { encoding: 'utf8', timeout });
    if (oldJob.status !== 0) {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) break;
      const result = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid!()}`, plist], { encoding: 'utf8', timeout: Math.min(750, remaining) });
      if (result.status === 0) { loaded = true; break; }
      lastError = result.stderr?.trim() || result.error?.message || 'launchctl bootstrap failed.';
    }
    const remaining = deadline - performance.now();
    if (remaining > 0) Atomics.wait(pause, 0, 0, Math.min(100, remaining));
  }
  if (!loaded) throw new Error(`Competition runner reload failed after bounded retries: ${lastError}`);
  console.log(`Competition runner started: ${selectedLabel} (${policy}); ${publicUntil ? `public practice until ${publicUntil}, then tournament ${tournamentId} seating` : `tournament ${tournamentId} only`}; automatic crash restart; idle sleep inhibited while it runs.`);
} else throw new Error('Action must be start, stop or status.');
