/** Independent public clients. No rack, balance, or bid data is shared between policies. */
import { readFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const matchesText = process.argv.find(a => a.startsWith('--matches='))?.slice(10) ?? '4';
if (!/^\d+$/.test(matchesText) || Number(matchesText) < 1) throw new Error('--matches must be positive');
if (!process.env.BOT_TOKEN) throw new Error('Run with .env loaded; BOT_TOKEN is required for the main bot.');
interface LabBot { label: string; policy: string; botId: string; tokenPath: string; options?: Record<string, unknown>; policyLabel?: string }
interface RunBot { label: string; policy: string; botId: string; token: string; tournament: string; options?: Record<string, unknown>; policyLabel?: string }
const labs: LabBot[] = JSON.parse(readFileSync('.secrets/lab-bots.json', 'utf8'));
let bots: RunBot[] = [
  { label: 'bigdawg', policy: process.env.MAIN_POLICY ?? 'market-all', botId: '340', token: process.env.BOT_TOKEN, tournament: process.env.TOURNAMENT_ID ?? '2' },
  ...labs.map(bot => ({ ...bot, token: readFileSync(bot.tokenPath, 'utf8').trim(), tournament: '' })),
];
const labelsText = process.argv.find(a => a.startsWith('--labels='))?.slice(9);
if (labelsText) {
  const labels = new Set(labelsText.split(','));
  bots = bots.filter(bot => labels.has(bot.label));
  if (bots.length !== labels.size) throw new Error('One or more requested lab labels do not exist.');
}
const untilArg = process.argv.find(a => a.startsWith('--until='));
mkdirSync('.research', { recursive: true });
const logfile = createWriteStream('.research/public-lab.log', { flags: 'a', mode: 0o600 });
console.log(`Starting ${bots.length} independent public bots for ${matchesText} matches each. Only bigdawg is registered for the tournament.`);
const children: Array<{ child: ChildProcess; bot: typeof bots[number] }> = [];
for (const [index, bot] of bots.entries()) {
  // Stagger entries to mix with existing public opponents instead of filling
  // every newly opened table with copies launched in the same millisecond.
  if (index > 0) await new Promise(resolve => setTimeout(resolve, 900));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', `--matches=${matchesText}`, ...(untilArg ? [untilArg] : [])], {
    env: { ...process.env, BOT_NAME: bot.label, BOT_TOKEN: bot.token, STRATEGY_MODE: bot.policy,
      STRATEGY_OPTIONS: JSON.stringify(bot.options ?? {}), POLICY_LABEL: bot.policyLabel ?? bot.policy,
      TOURNAMENT_ID: bot.tournament, TOURNAMENT_ONLY: '0', RESULTS_FILE: resolve(`.research/live-${bot.botId}.json`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const source of [child.stdout, child.stderr]) source.on('data', data => {
    const line = `[${bot.label}] ${String(data)}`;
    process.stdout.write(line); logfile.write(line);
  });
  children.push({ child, bot });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  for (const { child } of children) child.kill('SIGTERM');
});
const codes = await Promise.all(children.map(({ child, bot }) => new Promise<number>(yes => {
  child.once('error', error => { console.error(`${bot.label} failed: ${error.message}`); yes(1); });
  child.once('exit', code => { console.log(`${bot.label} exited with code ${code ?? 1}`); yes(code ?? 1); });
})));
logfile.end();
process.exitCode = codes.some(code => code !== 0) ? 1 : 0;
