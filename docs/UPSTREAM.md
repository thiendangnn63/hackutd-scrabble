# Upstream provenance and live verification

## Pinned source

- Upstream repository: [clockworklabs/scrabblebot](https://github.com/clockworklabs/scrabblebot).
- Audited full commit: [`b5ccb36aa238ad16692f8d6af54da15ef9f11324`](https://github.com/clockworklabs/scrabblebot/commit/b5ccb36aa238ad16692f8d6af54da15ef9f11324).
- Commit date: 2026-10-25; title: `Team invite codes (#24)`.
- Audit date: 2026-11-07, America/Chicago.
- License: [MIT](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/LICENSE).

Generated client bindings and the server's ENABLE dictionary originate
from this upstream snapshot. Keep the applicable upstream license notice.
Do not manually edit generated bindings or replace the dictionary with a
different spelling corpus. Kaggle is unnecessary: the exact accepted
wordlist is already available from the server's own repository.

The complete source archive used during development stays under ignored
`.research/`, not in the submitted bot. Audited files are `game.ts`,
`index.ts`, `letters.ts`, `dictionary.ts`, `schema.ts`, and `tournament.ts`
under `spacetimedb/src/`. [RULES.md](RULES.md) records their behavioral
contract and discrepancies with the website documentation.

## Read-only deployed-schema check

On 2026-11-07, an unauthenticated GET to
[`https://maincloud.spacetimedb.com/v1/database/scrabblebot/schema?version=9`](https://maincloud.spacetimedb.com/v1/database/scrabblebot/schema?version=9)
returned HTTP 200 and 55,754 bytes of schema JSON. No credentials were
claimed, reducers invoked, or account settings changed for this check.

The raw response's SHA-256 was:

```text
69b8fe84849ccea9b592fb8a9e267a8cdcde1900cc51153905856a3d34968a50
```

The response described 32 tables and 34 reducers. These relevant protocol
details agree with the pinned upstream source and generated bindings:

| Surface | Verified shape |
| --- | --- |
| `auction_result` | `auction_id`, `match_id`, `letter`, `winner_bot_id`, `paid`, `closed_at`; no `top_bid`. |
| `match_state` | Includes `bag_total`, `auction_type`, `auction_duration_ms`, and `starting_rack_size`. |
| `match_participant` | `id`, `match_id`, `bot_id`, `balance`, `score`. |
| `holding` | Private access; includes match ID, bot ID, letter, and count. |
| `bag_letter` | Private access. |
| `matchmaker_config` | `id`, `starting_rack_size`, `lobby_max_size`, `auction_duration_ms`. |
| `submit_bid` | `auctionId: u64`, `amount: i64`. |
| `submit_word` | `matchId: u64`, `word: string`. |
| `join_lobby` | No parameters. |
| `register_for_tournament` | `tournamentId: u64`. |

This is a protocol compatibility check, not proof of identical deployed
logic. Schema inspection cannot verify live default settings, no-bid
behavior, auction-close ordering, or scoring implementation. Those rules
are audited from the pinned source; a future live change requires a new
audit. Strategy and runtime use public per-match configuration where
available rather than relying on defaults.

To repeat the read-only check:

```sh
curl -fsSL 'https://maincloud.spacetimedb.com/v1/database/scrabblebot/schema?version=9' \
  -o /tmp/scrabblebot-schema.json
shasum -a 256 /tmp/scrabblebot-schema.json
```

A changed hash is a reason to inspect the schema difference; serialization
or unrelated schema changes can alter the hash without breaking this bot.
