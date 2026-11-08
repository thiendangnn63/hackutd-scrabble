# Audited competition rules

Audited on 2026-11-07 against Clockwork Labs commit
[`b5ccb36aa238ad16692f8d6af54da15ef9f11324`](https://github.com/clockworklabs/scrabblebot/tree/b5ccb36aa238ad16692f8d6af54da15ef9f11324).
The [website instructions](https://scrabblebot.spacetimedb.com/docs) describe
the competition, but several details differ from this source. The bot uses
the source contract below. See [UPSTREAM.md](UPSTREAM.md) for provenance and
the limits of live verification.

## Match and scoring

- The standard Scrabble distribution contains 98 tiles, with no blanks.
- Every player starts with balance 100 and score 0. Defaults deal five
  private tiles per player. The admin can configure the starting rack,
  table size, and auction duration; read each match's `startingRackSize`
  and `auctionDurationMs` rather than assuming the defaults.
- Each auction sells one tile. There is no board, positional scoring,
  rack-size cap, or seven-tile bingo bonus.
- At any time while the match is `Running`, a player can submit any
  dictionary word of at least two ASCII letters. Lowercase is converted
  to uppercase; whitespace and punctuation are rejected. The word consumes
  exact tile multiplicities from that player's rack in that match.
- Several words may be played in succession. A spelling can be reused if
  the player obtains the necessary tiles again.
- A word's base value is its standard Scrabble letter-value sum. The
  reward is `floor(base × multiplier)`, using the table below. The same
  reward increases both balance and score.
- Winning auction payments reduce balance only. Unspent balance and
  unplayed tiles have no final score value. Buying letters never directly
  earns score.

| Word length | Multiplier |
| --- | ---: |
| 2–3 | 1 |
| 4 | 1.5 |
| 5 | 2 |
| 6 | 2.5 |
| 7+ | 3 |

Sources: [match creation and word payment](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/game.ts),
[values and distribution](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/letters.ts),
[word validation](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/index.ts).

## Auctions and the deadline

- Default duration is 1,000 ms. A bid must arrive strictly before
  `closesAt`. It must be a nonnegative signed 64-bit integer, no greater
  than current balance, submitted by a participant's credential.
- Only one current bid per bot is retained. Submitting another replaces
  the previous bid. Zero is equivalent to withdrawal.
- Positive highest bids win. Equal positive bids are shuffled before a
  stable descending sort, so ties are random, not first-arrival wins.
- In `Vickrey`, the winner pays the second-highest positive bid. A sole
  bidder pays reserve 1. In `FirstPrice`, the winner pays its own bid.
- The source consumes the tile even when nobody bids. It does **not** put
  no-bid tiles back into the bag, contrary to the website's prose.
- Public `bagTotal` counts undrawn tiles; the tile in the current auction
  has already been removed. Thus `bagTotal === 0` means the current auction
  is the final one.
- At final close, the server awards the tile, optionally lets a simulated
  winner play, and immediately sets the match to `Ended`, all in one
  transaction. An external bot cannot submit a word using that last tile:
  `submitWord` rejects ended matches. Flush existing rack words before
  final close, and bid zero on that final tile. An offline benchmark must
  preserve the simulated-bot advantage on this final transaction.
- A letter won on the penultimate auction can still be played during the
  final auction. No post-match liquidation phase exists.

Source: [`closeAuction`, `playWord`, and `drawLetter`](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/game.ts),
[`submitBid` and `submitWord`](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/index.ts).

## Available information

The bot sees its own rack through `my_rack`, public match participants'
balances and scores, auctions, completed auction results, and public word
plays. Filter every rack and event by match ID.

`auction_result` contains the winner and amount **paid**, not the winning
bid. Bots do not receive the spectator-only live winning-bid view. Archived
winning bids become public after a match ends.

Both `holding` and `bag_letter` are private. Public purchases and word
plays reveal part of an opponent's rack, but their private starting deal
prevents exact reconstruction. Likewise, the remaining bag's tile count is
public while its composition is uncertain. Model that uncertainty instead
of presenting inferred counts as exact.

Sources: [schema](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/schema.ts),
[rack and spectator views](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/index.ts).

## Dictionary and strategy objective

The server embeds its own ENABLE wordlist. Use the vendored matching list,
including short words and obscure spellings; a general vocabulary corpus
or Kaggle replacement can produce rejected moves. Prefer exact scoring
and efficient word search over language-model calls in the auction loop.

Rating uses OpenSkill finishing places. Score ties share their place; the
absolute score margin does not enter the OpenSkill result. A separate Elo
statistic is also updated. For casual play, compare finishing place and
win rate alongside raw word score. The displayed rating starts at 1500
and remains provisional until uncertainty is within 175, according to the
[leaderboard instructions](https://scrabblebot.spacetimedb.com/docs).

Sources: [dictionary lookup](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/dictionary.ts),
[`updateEloAtMatchEnd`](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/game.ts).

## Tournament scoring and lifecycle

- Registration must be submitted from a bot credential, not the human's
  website identity. An offline registered bot is still seated and loses
  auctions it misses.
- Swiss tables have approximately the configured match size; leftovers
  are distributed across tables. A bot's Swiss points for a match are
  `max(configuredMatchSize − count(strictly higher scores), 0)`.
  Tied bots share the higher place.
- Swiss standings sort by Swiss points, then total tournament word score,
  then lower bot ID. These tiebreakers determine the cut.
- Each elimination match knocks out its last-place player. A tie for last
  is broken by lower total tournament word score, then higher bot ID.
- The two finalists play three games. The champion has the greater sum
  of scores across those games; individual game wins do not determine
  the result. Ties use total tournament word score, then lower bot ID.
- The admin starts each elimination and final game. A registered bot must
  stay connected while waiting. Once the tournament is underway, entrants
  still in contention are barred from casual lobbies; the bot must keep
  servicing its subscriptions through the waiting periods.

Source: [tournament implementation](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/tournament.ts).

## Differences from the website to preserve in tests

| Website statement or omission | Pinned source contract |
| --- | --- |
| A 60-second lobby | Default lobby duration is 90 seconds. |
| No starting deal described | Default five-tile private starting rack; configurable. |
| No-bid letters return to the bag | No-bid letters are consumed. |
| Auction results expose `top_bid` | Results expose `paid`; live winning bids are hidden from bots. |
| Opponent racks and bag are derivable | Private initial deals make full reconstruction uncertain. |
| Match ends when the bag empties | Final award and end share one transaction; real bots cannot use the final tile. |

These are pinned-source findings. The live schema confirms the protocol
shape, but it does not prove that the live reducer implementation is
byte-for-byte identical; see [UPSTREAM.md](UPSTREAM.md).
