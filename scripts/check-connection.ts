/** Read-only protocol check. Never joins lobbies, registers or calls reducers. */
import { DbConnection, tables } from '../src/module_bindings/index.js';

let connection: DbConnection | undefined;
const timer = setTimeout(() => {
  console.error('Connection/subscription check timed out.');
  connection?.disconnect(); process.exitCode = 1;
}, 20000);

function fail(message: string): void {
  clearTimeout(timer); console.error(message); connection?.disconnect(); process.exitCode = 1;
}

connection = DbConnection.builder()
  .withUri(process.env.STDB_HOST ?? 'https://maincloud.spacetimedb.com')
  .withDatabaseName(process.env.STDB_DB ?? 'scrabblebot')
  .withToken(process.env.BOT_TOKEN || undefined)
  .onConnect((conn, identity) => {
    conn.subscriptionBuilder().onError(() => fail('Identity subscription failed.')).onApplied(() => {
      const botId = conn.db.botCredential.identity.find(identity)?.botId ?? 0n;
      conn.subscriptionBuilder().onError(() => fail('Control subscription failed.')).onApplied(() => {
        console.log(`Live SDK and control subscriptions verified (${botId ? 'bot credential found' : 'anonymous; no bot credential'}). No reducers called.`);
        clearTimeout(timer); conn.disconnect();
      }).subscribe([
        tables.matchParticipant.where(p => p.botId.eq(botId)),
        tables.matchParticipant.where(p => p.botId.eq(botId)).rightSemijoin(tables.matchState, (p, m) => p.matchId.eq(m.id)),
        tables.myRack, tables.openLobbies, tables.openLobbyMembers, tables.tournament,
        tables.tournamentEntry.where(e => e.botId.eq(botId)),
      ]);
    }).subscribe(tables.botCredential.where(c => c.identity.eq(identity)));
  }).onConnectError((_ctx, error) => fail(`Connection failed: ${error.message}`)).build();
