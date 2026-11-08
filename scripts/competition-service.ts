/** macOS per-user competition runner: no credentials are embedded in the plist. */
import { mkdirSync, writeFileSync } from 'node:fs';
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
  const policy = process.argv[3];
  if (!policy || !/^[a-z-]+$/.test(policy)) throw new Error('Usage: competition-service start <selected-policy>');
  mkdirSync(directory, { recursive: true });
  const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const env = { BOT_NAME: 'bigdawg', STRATEGY_MODE: policy, STRATEGY_OPTIONS: '{}', POLICY_LABEL: policy, TOURNAMENT_ID: '2', TOURNAMENT_ONLY: '1', EXIT_AFTER_TOURNAMENT: '1', RESULTS_FILE: resolve('.research/live-340.json') };
  const args = ['/usr/bin/caffeinate', '-i', process.execPath, '--env-file-if-exists=.env', resolve('dist/bot.mjs')];
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>WorkingDirectory</key><string>${xml(resolve('.'))}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(resolve(directory, 'competition.log'))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(directory, 'competition.log'))}</string>
</dict></plist>`, { mode: 0o600 });
  // Reloading this one named user job is reversible and leaves unrelated jobs alone.
  spawnSync('launchctl', ['bootout', target], { encoding: 'utf8' });
  const result = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid!()}`, plist], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  console.log(`Competition runner started: ${policy}; tournament 2 only; automatic crash restart; idle sleep inhibited while it runs.`);
} else throw new Error('Action must be start, stop or status.');
