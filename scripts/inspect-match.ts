/** Read-only authenticated match snapshot. Does not expose the token or private rack. */
import { writeFileSync } from 'node:fs';
import { DbConnection, tables } from '../src/module_bindings/index.js';
const matchArg = process.argv.find(a => a.startsWith('--match='))?.slice(8);
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
if (matchArg && !/^\d+$/.test(matchArg)) throw new Error('--match must be an integer');
if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required (.env).');
let connection: DbConnection;
const timer = setTimeout(() => fail('Match inspection timed out'), 20000);
function fail(message: string): void { clearTimeout(timer); console.error(message); connection?.disconnect(); process.exitCode = 1; }
connection = DbConnection.builder().withUri(process.env.STDB_HOST ?? 'https://maincloud.spacetimedb.com')
  .withDatabaseName(process.env.STDB_DB ?? 'scrabblebot').withToken(process.env.BOT_TOKEN)
  .onConnect((conn, identity) => {
    conn.subscriptionBuilder().onError(() => fail('Credential subscription failed')).onApplied(() => {
      const botId = conn.db.botCredential.identity.find(identity)?.botId;
      if (botId === undefined) { fail('No bot credential'); return; }
      conn.subscriptionBuilder().onError(() => fail('Match subscription failed')).onApplied(() => {
        const match = [...conn.db.matchState.iter()].sort((a, b) => a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch ? -1 : 1)
          .find(m => !matchArg || m.id === BigInt(matchArg));
        if (!match) { fail('No matching match'); return; }
        conn.subscriptionBuilder().onError(() => fail('History subscription failed')).onApplied(() => {
          const participants = [...conn.db.matchParticipant.iter()].filter(p => p.matchId === match.id)
            .sort((a, b) => a.score > b.score ? -1 : a.score < b.score ? 1 : 0);
          const me = participants.find(p => p.botId === botId)!;
          const auctions = [...conn.db.auctionResult.iter()];
          const wins = auctions.filter(a => a.winnerBotId === botId);
          const words = [...conn.db.wordPlay.iter()].filter(w => w.botId === botId)
            .sort((a, b) => a.playedAt.microsSinceUnixEpoch < b.playedAt.microsSinceUnixEpoch ? -1 : 1);
          const result = {
            checkedAt: new Date().toISOString(), botId: String(botId), matchId: String(match.id), status: match.status.tag,
            auctionType: match.auctionType.tag, startingRackSize: match.startingRackSize, auctionDurationMs: Number(match.auctionDurationMs),
            score: Number(me.score), balance: Number(me.balance), place: 1 + participants.filter(p => p.score > me.score).length,
            participants: participants.map(p => ({ botId: String(p.botId), score: Number(p.score), balance: Number(p.balance) })),
            auctionsCompleted: auctions.length, auctionsWon: wins.length, totalPaid: wins.reduce((n, w) => n + Number(w.paid), 0),
            words: words.map(w => ({ word: w.word, reward: Number(w.totalReward) })),
          };
          if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
          console.log(JSON.stringify(result, null, 2)); clearTimeout(timer); conn.disconnect();
        }).subscribe([
          tables.matchParticipant.where(p => p.matchId.eq(match.id)),
          tables.auctionResult.where(a => a.matchId.eq(match.id)),
          tables.wordPlay.where(w => w.matchId.eq(match.id)),
        ]);
      }).subscribe(tables.matchParticipant.where(p => p.botId.eq(botId)).rightSemijoin(tables.matchState, (p, m) => p.matchId.eq(m.id)));
    }).subscribe(tables.botCredential.where(c => c.identity.eq(identity)));
  }).onConnectError((_ctx, error) => fail(error.message)).build();
