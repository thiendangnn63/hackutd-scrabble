import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Public completed-match results only. Never pass credentials or private racks. */
export interface LiveMatchRecord {
  matchId: string;
  botId: string;
  policy: string;
  format: 'Vickrey' | 'FirstPrice';
  endedAt: string;
  score: number;
  place: number;
  tableSize: number;
  /** Number of table players sharing its highest score, including opponents. */
  firstPlaceTies: number;
  finalCash: number;
  tilesWon: number;
  totalPaid: number;
  words: string[];
  opponentScores: number[];
  errors: number;
}

export interface MatchSummary {
  games: number;
  outrightWins: number;
  sharedFirsts: number;
  losses: number;
  /** Fraction of games finishing first, including every shared first place. */
  winRate: number;
  meanPlace: number;
  meanScore: number;
  meanCash: number;
  meanTilesWon: number;
  meanPaid: number;
  meanWords: number;
  errors: number;
}
export interface PolicyMatchSummary extends MatchSummary { policy: string; format: LiveMatchRecord['format'] }
export interface LiveSummary extends MatchSummary { totals: MatchSummary; groups: PolicyMatchSummary[]; lastMatches: LiveMatchRecord[] }

interface MatchFile { schemaVersion: 1; matches: LiveMatchRecord[] }
const fields = new Set(['matchId', 'botId', 'policy', 'format', 'endedAt', 'score', 'place', 'tableSize',
  'firstPlaceTies', 'finalCash', 'tilesWon', 'totalPaid', 'words', 'opponentScores', 'errors']);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(detail: string): never { throw new Error(`Invalid live match record: ${detail}`); }
function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid(`${field} must be a safe integer >= ${minimum}`);
  return value;
}
function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) {
    invalid(`${field} must be a canonical unsigned 64-bit integer string`);
  }
  return value;
}

function validateRecord(value: unknown): LiveMatchRecord {
  if (!object(value)) invalid('expected an object');
  if (Object.keys(value).some(field => !fields.has(field))) invalid('unexpected field; only public result fields are allowed');
  const matchId = identifier(value.matchId, 'matchId');
  const botId = identifier(value.botId, 'botId');
  if (typeof value.policy !== 'string' || !value.policy.trim() || value.policy.length > 128 || /[\x00-\x1f\x7f]/.test(value.policy)) {
    invalid('policy must be a nonempty label of at most 128 characters without control characters');
  }
  const policy = value.policy;
  if (value.format !== 'Vickrey' && value.format !== 'FirstPrice') invalid('format must be Vickrey or FirstPrice');
  const format = value.format;
  if (typeof value.endedAt !== 'string' || !value.endedAt.includes('T') || !Number.isFinite(Date.parse(value.endedAt))) {
    invalid('endedAt must be an ISO date-time');
  }
  const endedAt = new Date(value.endedAt).toISOString();
  const score = integer(value.score, 'score');
  const place = integer(value.place, 'place', 1);
  const tableSize = integer(value.tableSize, 'tableSize', 2);
  const firstPlaceTies = integer(value.firstPlaceTies, 'firstPlaceTies', 1);
  const finalCash = integer(value.finalCash, 'finalCash');
  const tilesWon = integer(value.tilesWon, 'tilesWon');
  const totalPaid = integer(value.totalPaid, 'totalPaid');
  const errors = integer(value.errors, 'errors');
  if (!Array.isArray(value.words) || value.words.some(word => typeof word !== 'string' || !/^[A-Z]{2,98}$/.test(word))) {
    invalid('words must be an array of uppercase A-Z words of length 2–98');
  }
  const words = value.words as string[];
  if (!Array.isArray(value.opponentScores)) invalid('opponentScores must be an array');
  const opponentScores = value.opponentScores.map((opponentScore, i) => integer(opponentScore, `opponentScores[${i}]`));
  if (opponentScores.length + 1 !== tableSize) invalid('tableSize must equal opponentScores.length + 1');
  if (place !== 1 + opponentScores.filter(other => other > score).length) invalid('place disagrees with the recorded scores');
  const allScores = [score, ...opponentScores];
  const top = Math.max(...allScores);
  if (firstPlaceTies !== allScores.filter(other => other === top).length) invalid('firstPlaceTies disagrees with the recorded highest score');
  return { matchId, botId, policy, format, endedAt, score, place, tableSize, firstPlaceTies, finalCash,
    tilesWon, totalPaid, words: [...words], opponentScores, errors };
}

function aggregate(matches: readonly LiveMatchRecord[]): MatchSummary {
  const games = matches.length;
  const mean = (field: 'place' | 'score' | 'finalCash' | 'tilesWon' | 'totalPaid') =>
    games ? matches.reduce((sum, match) => sum + match[field], 0) / games : 0;
  const outrightWins = matches.filter(match => match.place === 1 && match.firstPlaceTies === 1).length;
  const sharedFirsts = matches.filter(match => match.place === 1 && match.firstPlaceTies > 1).length;
  return {
    games, outrightWins, sharedFirsts, losses: matches.filter(match => match.place > 1).length,
    winRate: games ? (outrightWins + sharedFirsts) / games : 0,
    meanPlace: mean('place'), meanScore: mean('score'), meanCash: mean('finalCash'),
    meanTilesWon: mean('tilesWon'), meanPaid: mean('totalPaid'),
    meanWords: games ? matches.reduce((sum, match) => sum + match.words.length, 0) / games : 0,
    errors: matches.reduce((sum, match) => sum + match.errors, 0),
  };
}

/** Single-writer result log. Missing files are empty; malformed files are never overwritten. */
export class MatchRecorder {
  private readonly path: string;
  private matches: LiveMatchRecord[];

  constructor(path: string) {
    this.path = resolve(path);
    this.matches = this.load();
  }

  private load(): LiveMatchRecord[] {
    if (!existsSync(this.path)) return [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!object(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.matches)
        || Object.keys(parsed).some(field => field !== 'schemaVersion' && field !== 'matches')) {
        throw new Error('expected {schemaVersion: 1, matches: [...]}');
      }
      const matches = parsed.matches.map(validateRecord);
      const keys = new Set<string>();
      for (const match of matches) {
        const key = `${match.botId}:${match.matchId}`;
        if (keys.has(key)) throw new Error(`duplicate botId/matchId ${key}`);
        keys.add(key);
      }
      return matches;
    } catch (error) {
      throw new Error(`Cannot load live results ${this.path}: ${error instanceof Error ? error.message : String(error)}. Existing file was left unchanged.`);
    }
  }

  record(value: LiveMatchRecord): void {
    const record = validateRecord(value);
    // Reload before updating so a restarted recorder sees the latest saved rows.
    const existing = this.load();
    if (existing.some(match => match.botId === record.botId && match.matchId === record.matchId)) {
      this.matches = existing;
      return;
    }
    const matches = [...existing, record];
    const data: MatchFile = { schemaVersion: 1, matches };
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw new Error(`Cannot save live results ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.matches = matches;
  }

  summary(): LiveSummary {
    const byGroup = new Map<string, LiveMatchRecord[]>();
    for (const match of this.matches) {
      const key = JSON.stringify([match.policy, match.format]);
      const group = byGroup.get(key) ?? [];
      group.push(match); byGroup.set(key, group);
    }
    const groups = [...byGroup.values()].map(matches => ({
      policy: matches[0].policy, format: matches[0].format, ...aggregate(matches),
    })).sort((a, b) => a.policy.localeCompare(b.policy) || a.format.localeCompare(b.format));
    const lastMatches = [...this.matches].sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)
      || (BigInt(a.matchId) < BigInt(b.matchId) ? 1 : BigInt(a.matchId) > BigInt(b.matchId) ? -1 : 0))
      .slice(0, 10).map(match => ({ ...match, words: [...match.words], opponentScores: [...match.opponentScores] }));
    const totals = aggregate(this.matches);
    return { ...totals, totals: { ...totals }, groups, lastMatches };
  }
}
