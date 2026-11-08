# HackUTD Scrabble Bot

A deterministic TypeScript bot for the [SpacetimeDB Scrabble auction competition](https://scrabblebot.spacetimedb.com/docs). It bids on letters, builds words from a private rack, and recycles word rewards into future auctions. It needs no LLM, Kaggle account, GPU, or paid API.

## Run

Requires Node.js 22 or later. Generated bindings and the official 172,820-word dictionary are included; the SpacetimeDB CLI is not needed to run the bot.

```sh
git clone https://github.com/thiendangnn63/hackutd-scrabble.git
cd hackutd-scrabble
npm ci
```

Create `.env` from [.env.example](.env.example) and set `BOT_TOKEN` to your team's bot token. `BOT_NAME` selects the local log label and token-cache filename; the team's website controls the actual registered bot name.

```sh
npm start -- --once  # one live match, then stop before rejoining
npm start           # continuous play, automatic lobby rejoin
```

To obtain a token, link your identity on [/account](https://scrabblebot.spacetimedb.com/account), create or join a team, then choose **Generate token** on [/team](https://scrabblebot.spacetimedb.com/team). If necessary, install the [official CLI](https://spacetimedb.com/install), run `spacetime login`, and run the exact `connect_id` command displayed on your Account page. Its browser identity is specific to that browser session.

`.env` and `.token-*` are ignored by Git. The bot persists its credential in a private, mode-600 `.token-<BOT_NAME>` file and supports reconnecting or restarting during an existing match. Do not run two processes for the same bot at once; they would race each other's word submissions.

## Competition behavior

- Uses indexed dictionary search and letter-completion value, cash reserves, rack balance, and observed auction prices.
- Holds short words when the length bonus makes a plausible longer word worthwhile, while redeeming mature words and replenishing low cash.
- Liquidates disjoint words near the end, with bounded search and a fast fallback for short configured auctions.
- Never values the final auction's tile: the audited server awards it and ends the match in the same transaction.
- Handles both Vickrey and first-price formats, private starting racks, repeated letters, and integer payout rounding.

The server source differs from parts of the website prose. Read [the audited rules](docs/RULES.md), [strategy experiments](docs/STRATEGY.md), [independent correctness and latency measurements](docs/PERFORMANCE.md), and [upstream provenance](docs/UPSTREAM.md). Simulated results are comparisons under documented assumptions, not a prediction of leaderboard rank. Live results are recorded separately.

## Verify

```sh
npm test
npm run build
npm run check:server  # read-only live SDK/subscription check
npm run verify:engine
npm run benchmark -- --help
```

`check:server` does not join a lobby or submit any actions. `verify:engine` compares indexed search with a separate full-dictionary oracle and measures cold, warm, uncached, pathological-rack, and simultaneous-match workloads. The seeded benchmark records both finishing place and word score across different opponents and auction formats.

To inspect a live match without acting:

```sh
npx tsx --env-file-if-exists=.env scripts/inspect-match.ts --match=47002
```

## Tournaments

Set `TOURNAMENT_ID` in `.env` to register on connection. Set `TOURNAMENT_ONLY=1` to wait for tournament seating without joining public lobbies, then run `npm start`. Stay connected for the duration. Swiss and elimination stages reward finishing position; finals sum scores across three games. The same bot protocol works in both lobby and tournament matches.

## Production

```sh
npm run build
npm run start:prod
```

The bundled program is `dist/bot.mjs`; keep `data/wordlist.txt` and production dependencies beside the deployment. A multi-stage Dockerfile is included:

```sh
docker build -t hackutd-scrabble .
docker run --rm --env-file .env hackutd-scrabble
```

The GitHub Actions workflow checks Node 22 and 24, tests, and builds. Generated bindings and the dictionary derive from MIT-licensed [clockworklabs/scrabblebot](https://github.com/clockworklabs/scrabblebot); see [LICENSE](LICENSE).

## Live selection and competition runner

The current production policy is `market-convert`, selected after public trials. It extends the acquisition floor with a cap exception for a tile that immediately completes a six-letter or longer word. The earlier cash cap repeatedly prevented profitable word completion in an audited public match. Results, including losses and idle-opponent caveats, are in [LIVE_RESULTS.md](docs/LIVE_RESULTS.md).

`bigdawg` (bot 340) is the single tournament-2 entry. Separate test identities never register for the tournament. The public lab supports distinct policy labels and options, separate result files, staggered entry, match limits, and a wall-clock cutoff; it shares no racks or decisions between clients.

On macOS, after building, the competition helper keeps the bot connected with automatic crash restart and inhibits idle sleep while the process runs. It waits for tournament seating and exits after elimination or tournament completion:

```sh
npm run competition:start -- market-convert
npm run competition:status
npm run competition:stop
```

It reads the token from `.env`; no credential is embedded in its launchd configuration. Keep the laptop powered and connected to the internet.
