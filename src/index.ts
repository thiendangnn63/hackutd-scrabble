import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DbConnection, tables, type SubscriptionHandle } from './module_bindings/index.js';
import { WordEngine, type Rack } from './engine.js';
import { Strategy, type StrategyMode } from './strategy.js';
import { ActionLoop, type MatchView } from './actions.js';
import { MatchRecorder } from './telemetry.js';

const name = process.env.BOT_NAME ?? 'hackutd';
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('BOT_NAME must be 1–64 letters, digits, underscores or hyphens.');
const tokenPath = resolve(`.token-${name}`);
const token = process.env.BOT_TOKEN?.trim() || (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '');
if (!token) throw new Error('Set BOT_TOKEN in .env (see .env.example), or use a previously saved .token-BOT_NAME.');
const tournamentText = process.env.TOURNAMENT_ID;
if (tournamentText && !/^\d+$/.test(tournamentText)) throw new Error('TOURNAMENT_ID must be a nonnegative integer.');
const tournamentId = tournamentText ? BigInt(tournamentText) : undefined;
const tournamentOnly = process.env.TOURNAMENT_ONLY === '1';
const runOnce = process.argv.includes('--once');
const matchLimitText = process.argv.find(arg => arg.startsWith('--matches='))?.slice(10);
if (matchLimitText && (!/^\d+$/.test(matchLimitText) || Number(matchLimitText) < 1 || !Number.isSafeInteger(Number(matchLimitText)))) throw new Error('--matches must be a positive safe integer.');
const matchLimit = runOnce ? 1 : matchLimitText ? Number(matchLimitText) : Infinity;
const log = (message: string) => console.log(`[${new Date().toISOString()}] [${name}] ${message}`);
const dictionary = readFileSync(fileURLToPath(new URL('../data/wordlist.txt', import.meta.url)), 'utf8').split(/\r?\n/).filter(Boolean);
const started = performance.now();
const engine = new WordEngine(dictionary);
const modes: StrategyMode[] = ['starter', 'greedy', 'hoard', 'adaptive', 'aggressive', 'patient', 'market', 'market-focused', 'market-all', 'market-budget', 'market-pressure', 'market-margin', 'market-quality'];
const mode = process.env.STRATEGY_MODE;
if (mode && !modes.includes(mode as StrategyMode)) throw new Error(`Unknown STRATEGY_MODE: ${mode}`);
const strategy = new Strategy(engine, mode ? { mode: mode as StrategyMode } : {});
log(`indexed ${dictionary.length} official dictionary words in ${Math.round(performance.now() - started)}ms`);
log(`strategy ${strategy.mode}`);
const recorder = new MatchRecorder(process.env.RESULTS_FILE ?? resolve('.research/live-results.json'));
let finished = 0;

let conn: DbConnection;
let myBotId: bigint | undefined;
let controls: SubscriptionHandle | undefined;
let controlsReady = false;
let connected = false;
let stopped = false;
let queued = false;
let joining = false;
let nextJoinAt = 0;
const scopes = new Map<bigint, { handle: SubscriptionHandle; ready: boolean }>();
const completed = new Set<bigint>();
const errorsByMatch = new Map<bigint, number>();
const loop = new ActionLoop(strategy, {
  submitWord: async (matchId, word) => {
    try { await conn.reducers.submitWord({ matchId, word }); schedule(); }
    catch (error) { errorsByMatch.set(matchId, (errorsByMatch.get(matchId) ?? 0) + 1); throw error; }
  },
  submitBid: async (auctionId, amount) => {
    const matchId = conn.db.auction.id.find(auctionId)?.matchId;
    try { await conn.reducers.submitBid({ auctionId, amount: BigInt(amount) }); }
    catch (error) { if (matchId !== undefined) errorsByMatch.set(matchId, (errorsByMatch.get(matchId) ?? 0) + 1); throw error; }
  },
}, log);

function schedule(): void {
  if (queued || stopped) return;
  queued = true;
  setImmediate(() => {
    queued = false;
    if (!connected || !controlsReady || !controls?.isActive() || stopped) return;
    try { refresh(); } catch (error) { log(`refresh error: ${String(error)}`); }
  });
}

function stop(code = 0): void {
  stopped = true; connected = false;
  clearInterval(timer);
  conn?.disconnect();
  process.exitCode = code;
}

function subscriptionError(what: string): void {
  log(`${what} subscription failed; check the server schema and token.`);
  stop(1);
}

function inActiveTournament(): boolean {
  if (myBotId === undefined) return false;
  return [...conn.db.tournamentEntry.iter()].some(entry => {
    if (entry.botId !== myBotId || entry.eliminated) return false;
    const status = conn.db.tournament.id.find(entry.tournamentId)?.status.tag;
    return status === 'Swiss' || status === 'Bracket' || status === 'Final';
  });
}

function refresh(): void {
  if (myBotId === undefined) return;
  const matches: MatchView[] = [];
  let running = false;
  for (const mine of conn.db.matchParticipant.iter()) {
    if (mine.botId !== myBotId) continue;
    const match = conn.db.matchState.id.find(mine.matchId);
    if (!match) continue;
    if (match.status.tag === 'Ended') {
      if (scopes.has(match.id)) {
        if (!scopes.get(match.id)?.ready) continue;
        if (!completed.has(match.id)) {
          const participants = [...conn.db.matchParticipant.iter()].filter(p => p.matchId === match.id);
          const opponents = participants.filter(p => p.botId !== myBotId).map(p => Number(p.score));
          const top = Math.max(Number(mine.score), ...opponents);
          const auctions = [...conn.db.auctionResult.iter()].filter(a => a.matchId === match.id && a.winnerBotId === myBotId);
          const words = [...conn.db.wordPlay.iter()].filter(w => w.matchId === match.id && w.botId === myBotId);
          const place = 1 + opponents.filter(score => score > Number(mine.score)).length;
          recorder.record({
            matchId: String(match.id), botId: String(myBotId), policy: strategy.mode, format: match.auctionType.tag,
            endedAt: match.endedAt ? new Date(Number(match.endedAt.microsSinceUnixEpoch / 1000n)).toISOString() : new Date().toISOString(),
            score: Number(mine.score), place, tableSize: participants.length,
            firstPlaceTies: [Number(mine.score), ...opponents].filter(score => score === top).length,
            finalCash: Number(mine.balance), tilesWon: auctions.length,
            totalPaid: auctions.reduce((sum, a) => sum + Number(a.paid), 0),
            words: words.map(w => w.word), opponentScores: opponents, errors: errorsByMatch.get(match.id) ?? 0,
          });
          finished++;
          log(`match ${match.id} ended: place ${place}/${participants.length}, score ${mine.score}, cash ${mine.balance}, ${auctions.length} purchases`);
          const stats = recorder.summary().totals;
          log(`live record: ${stats.outrightWins} wins, ${stats.sharedFirsts} shared firsts, ${stats.losses} losses over ${stats.games} matches`);
        }
        completed.add(match.id);
        scopes.get(match.id)?.handle.unsubscribe(); scopes.delete(match.id);
        errorsByMatch.delete(match.id);
        if (finished >= matchLimit && !inActiveTournament()) { log(`completed ${finished} test match(es); stopping`); stop(); return; }
      }
      continue;
    }
    if (match.status.tag !== 'Running') continue;
    running = true;
    if (!scopes.has(match.id)) {
      log(`match ${match.id}: ${match.auctionType.tag}, ${match.startingRackSize} starting tiles, ${match.auctionDurationMs}ms auctions`);
      const scope = { handle: undefined as unknown as SubscriptionHandle, ready: false };
      const handle = conn.subscriptionBuilder().onApplied(() => { scope.ready = true; schedule(); })
        .onError(() => subscriptionError(`match ${match.id}`)).subscribe([
          tables.auction.where(a => a.matchId.eq(match.id)),
          tables.matchParticipant.where(p => p.matchId.eq(match.id)),
          tables.auctionResult.where(a => a.matchId.eq(match.id)),
          tables.wordPlay.where(w => w.matchId.eq(match.id)),
        ]);
      scope.handle = handle;
      scopes.set(match.id, scope);
    }
    if (!scopes.get(match.id)?.ready || !scopes.get(match.id)?.handle.isActive()) continue;
    const rack: Rack = new Map();
    for (const row of conn.db.myRack.iter()) if (row.matchId === match.id) rack.set(row.letter, (rack.get(row.letter) ?? 0) + row.count);
    const participants = [...conn.db.matchParticipant.iter()].filter(p => p.matchId === match.id);
    const auction = match.currentAuctionId === undefined ? undefined : conn.db.auction.id.find(match.currentAuctionId);
    const prices = [...conn.db.auctionResult.iter()].filter(r => r.matchId === match.id && r.paid > 0n)
      .sort((a, b) => a.closedAt.microsSinceUnixEpoch < b.closedAt.microsSinceUnixEpoch ? -1 : 1).slice(-24).map(r => Number(r.paid));
    matches.push({
      matchId: match.id, myRack: rack, myBalance: Number(mine.balance), myScore: Number(mine.score),
      remainingTiles: match.bagTotal, auctionType: match.auctionType.tag, auctionDurationMs: Number(match.auctionDurationMs),
      opponentScores: participants.filter(p => p.botId !== myBotId).map(p => Number(p.score)),
      opponentCount: Math.max(0, participants.length - 1), observedPrices: prices,
      auction: auction?.status.tag === 'Open' ? {
        id: auction.id, letter: auction.letter, closesAtMs: Number(auction.closesAt.microsSinceUnixEpoch / 1000n), durationMs: Number(match.auctionDurationMs),
      } : undefined,
    });
  }
  loop.tick(matches);
  if (!running && !joining && Date.now() >= nextJoinAt && !tournamentOnly && !inActiveTournament()) {
    const lobby = [...conn.db.openLobbies.iter()].find(l => l.status.tag === 'Open');
    const alreadyJoined = lobby && [...conn.db.openLobbyMembers.iter()].some(m => m.lobbyId === lobby.id && m.botId === myBotId);
    if (lobby && !alreadyJoined) {
      joining = true; nextJoinAt = Date.now() + 5000;
      void conn.reducers.joinLobby({}).then(() => log('joined lobby'), error => log(`lobby: ${String(error)}`))
        .finally(() => { joining = false; schedule(); });
    }
  }
}

const timer = setInterval(schedule, 100);
conn = DbConnection.builder()
  .withUri(process.env.STDB_HOST ?? 'https://maincloud.spacetimedb.com')
  .withDatabaseName(process.env.STDB_DB ?? 'scrabblebot')
  .withToken(token)
  .withAutomaticReconnect({ minDelayMs: 1000, maxDelayMs: 15000 })
  .onConnect((connection, identity, issuedToken) => {
    connected = true;
    // Persist credentials privately; never include them in logs or source.
    writeFileSync(`${tokenPath}.tmp`, issuedToken, { mode: 0o600 });
    renameSync(`${tokenPath}.tmp`, tokenPath);
    log('connected; resolving bot credential');
    connection.subscriptionBuilder().onError(() => subscriptionError('identity')).onApplied(() => {
      const credential = connection.db.botCredential.identity.find(identity);
      if (!credential) { log('No bot credential belongs to this token. Generate a bot token on /team.'); stop(1); return; }
      if (controls) { schedule(); return; }
      myBotId = credential.botId;
      log(`acting as bot ${myBotId}`);
      controls = connection.subscriptionBuilder().onError(() => subscriptionError('control')).onApplied(() => {
        controlsReady = true;
        if (tournamentId !== undefined) {
          void connection.reducers.registerForTournament({ tournamentId }).then(
            () => log(`registered for tournament ${tournamentId}`), error => log(`tournament registration: ${String(error)}`));
        }
        schedule();
      }).subscribe([
        tables.matchParticipant.where(p => p.botId.eq(credential.botId)),
        tables.matchParticipant.where(p => p.botId.eq(credential.botId))
          .rightSemijoin(tables.matchState, (p, m) => p.matchId.eq(m.id)),
        tables.myRack, tables.openLobbies, tables.openLobbyMembers, tables.tournament,
        tables.tournamentEntry.where(e => e.botId.eq(credential.botId)),
      ]);
    }).subscribe(tables.botCredential.where(c => c.identity.eq(identity)));
    connection.db.auction.onInsert(schedule); connection.db.auction.onUpdate(schedule);
    connection.db.myRack.onInsert(schedule); connection.db.myRack.onUpdate(schedule); connection.db.myRack.onDelete(schedule);
    connection.db.matchState.onInsert(schedule); connection.db.matchState.onUpdate(schedule);
    connection.db.matchParticipant.onInsert(schedule); connection.db.matchParticipant.onUpdate(schedule);
    connection.db.openLobbies.onInsert(schedule); connection.db.tournament.onUpdate(schedule);
    connection.db.auctionResult.onInsert(schedule);
  })
  .onAutomaticReconnect(() => { connected = true; controlsReady = false; loop.reset(); log('reconnected; replaying subscriptions'); })
  .onConnectError((_ctx, error, nextAttempt, nextDelay) => {
    log(`connection failed: ${error.message}${nextAttempt ? `; retry ${nextAttempt} in ${nextDelay}ms` : ''}`);
    if (nextAttempt === undefined) stop(1);
  })
  .onDisconnect((_ctx, error, nextAttempt, nextDelay) => {
    connected = false; controlsReady = false; loop.reset();
    for (const scope of scopes.values()) scope.ready = false;
    if (!stopped) {
      log(`disconnected${error ? `: ${error.message}` : ''}${nextAttempt ? `; retry ${nextAttempt} in ${nextDelay}ms` : '; no retry scheduled'}`);
      if (nextAttempt === undefined) stop(1);
    }
  }).build();

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
