/** Creates independent, clearly labelled PUBLIC TEST bots; never registers them in a tournament.
 * The supported API creates one bot per team. Every test team has its own
 * locally generated SpacetimeDB identity and privately retained owner token.
 * Usage: npm run provision:lab -- margin market-margin */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DbConnection, tables } from '../src/module_bindings/index.js';
import { toSql, type Identity } from 'spacetimedb';

const [label, policy] = process.argv.slice(2);
if (!label || !/^[a-z][a-z0-9-]{0,15}$/.test(label) || !policy || !/^[a-z-]+$/.test(policy)) {
  throw new Error('Usage: provision-lab <short-label> <policy>');
}
const secretDir = resolve('.secrets');
mkdirSync(secretDir, { recursive: true, mode: 0o700 });
const manifestPath = resolve(secretDir, 'lab-bots.json');
interface LabBot { label: string; policy: string; botId: string; botName: string; teamName: string; tokenPath: string; ownerTokenPath: string }
const bots: LabBot[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
if (bots.some(bot => bot.label === label)) {
  console.log(`Lab ${label} already exists; credentials preserved.`); process.exit(0);
}
const botName = `bigdawg-test-${label}-340`;
const teamName = `bigdawg public test ${label} 340`;
const ownerTokenPath = resolve(secretDir, `${label}.owner-token`);
const tokenPath = resolve(secretDir, `${label}.bot-token`);
const host = process.env.STDB_HOST ?? 'https://maincloud.spacetimedb.com';
const database = process.env.STDB_DB ?? 'scrabblebot';
const waitFor = async <T>(read: () => T | undefined): Promise<T> => {
  const until = Date.now() + 10000;
  while (Date.now() < until) { const value = read(); if (value !== undefined) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Timed out waiting for the authorized team/credential update.');
};
function connect(token?: string): Promise<{ conn: DbConnection; identity: Identity; token: string }> {
  return new Promise((yes, no) => {
    const conn = DbConnection.builder().withUri(host).withDatabaseName(database).withToken(token)
      .onConnect((conn, identity, issuedToken) => yes({ conn, identity, token: issuedToken }))
      .onConnectError((_ctx, error) => { conn.disconnect(); no(error); }).build();
  });
}
async function subscribe(conn: DbConnection, queries: Parameters<typeof toSql>[0][]): Promise<void> {
  await new Promise<void>((yes, no) => conn.subscriptionBuilder().onApplied(() => yes()).onError(() => no(new Error('Lab subscription failed'))).subscribe(queries.map(q => toSql(q))));
}

const owner = await connect(existsSync(ownerTokenPath) ? readFileSync(ownerTokenPath, 'utf8').trim() : undefined);
writeFileSync(ownerTokenPath, owner.token, { mode: 0o600 });
let bot: Awaited<ReturnType<typeof connect>> | undefined;
try {
  await subscribe(owner.conn, [tables.myTeam, tables.myNonces]);
  let team = [...owner.conn.db.myTeam.iter()][0];
  if (!team) {
    await owner.conn.reducers.createTeam({ teamName, botName });
    team = await waitFor(() => [...owner.conn.db.myTeam.iter()][0]);
  }
  if (team.botName !== botName) throw new Error('Owner identity already belongs to a different team; no changes made to it.');
  const before = new Set([...owner.conn.db.myNonces.iter()].map(n => n.code));
  await owner.conn.reducers.mintCredentialNonce({});
  const nonce = await waitFor(() => [...owner.conn.db.myNonces.iter()].find(n => n.botId === team.botId && !before.has(n.code)));
  bot = await connect(existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : undefined);
  const credentialIdentity = bot.identity;
  writeFileSync(tokenPath, bot.token, { mode: 0o600 });
  await subscribe(bot.conn, [tables.botCredential.where(c => c.identity.eq(credentialIdentity))]);
  const existing = bot.conn.db.botCredential.identity.find(credentialIdentity);
  if (!existing) await bot.conn.reducers.claimCredential({ code: nonce.code });
  const credential = await waitFor(() => bot!.conn.db.botCredential.identity.find(credentialIdentity) ?? undefined);
  if (credential.botId !== team.botId) throw new Error('Unexpected bot identity; stopping.');
  writeFileSync(tokenPath, bot.token, { mode: 0o600 });
  bots.push({ label, policy, botId: String(team.botId), botName, teamName, tokenPath, ownerTokenPath });
  writeFileSync(manifestPath, JSON.stringify(bots, null, 2) + '\n', { mode: 0o600 });
  console.log(`Created public test bot ${botName} (id ${team.botId}), policy ${policy}. Private credentials retained in .secrets; no tournament registration.`);
} finally { bot?.conn.disconnect(); owner.conn.disconnect(); }
