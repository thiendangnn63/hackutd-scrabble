# First controlled live test: match 47002

The first live test completed on **2026-11-07, approximately 22:05–22:07
America/Chicago**. Bot `340` played one six-player Vickrey match with five
starting tiles and 1,000 ms auctions. The process stopped after the test.
The [saved result](live-test-result.json) records the final snapshot.

The connection, scoped subscriptions, bidding, word submission, scoring,
and match completion worked. Competitive performance was weak: **54 points,
tied fifth of six, with 104 cash left**. This match validates the protocol;
it does not validate the strategy's competitiveness.

## Public history findings

An independent anonymous, read-only subscription fetched this ended
match's `match_state`, `match_participant`, `auction_result`, `word_play`,
and `auction_top_bid_archive` rows. No token was read or written, no
reducers were called, and no further match was joined. The temporary
inspection script and raw history remain in ignored `.research/`.

All three of our purchases happened in the first four rounds:

| Round | Tile | Amount paid | Archived winning bid |
| ---: | --- | ---: | ---: |
| 1 | E | 14 | 34 |
| 2 | A | 14 | 28 |
| 4 | B | 22 | 27 |

Immediately after round 4, the bot played `BRAZENS` for 54 points. It
**won no more tiles during the remaining 64 auctions**. The acquisition
stall followed a successful early word, rather than an inability to
submit words or participate in the match.

| Bot ID | Final score | Tiles bought | Total paid | Final cash | Words played |
| --- | ---: | ---: | ---: | ---: | --- |
| 211 | 98 | 14 | 187 | 11 | OVERMIX, ANTICLY, PIU |
| 207 | 87 | 12 | 174 | 13 | WAVEBAND, HOKIER, GEL |
| 165 | 86 | 13 | 182 | 4 | JUICED, HOMEY, FAGIN, AT |
| 259 | 86 | 15 | 180 | 6 | QUARTANS, DELFTS, LOWE |
| **340 (ours)** | **54** | **3** | **50** | **104** | **BRAZENS** |
| 241 | 54 | 11 | 145 | 9 | GENITOR, OPIATED |

Each balance reconciles as `100 + finalScore − totalPaid`. Rivals bought
11–15 tiles each and recycled word rewards into further purchases. Their
15 words averaged 5.6 letters; six had seven or eight letters. They also
liquidated shorter words late, including an `AT` in round 65 and several
words in round 66. This supports preserving long-word potential while
still redeeming short endgame words.

## Market prices

The 68 auctions collected 918 currency in total. The median amount paid
was **12**, mean **13.5**, minimum **1**, and maximum **32**. The only
one-currency purchase was the **unusable final tile**. Every earlier tile
cost at least **8**.

The archived highest bid had median **14**, mean **16.22**, and maximum
**36**. Highest bids are legitimately public only after the match ends;
they were used for this retrospective analysis, not fed to the live bot.

| Tile | Auctions | Minimum paid | Median paid | Maximum paid | Median winning bid |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 7 | 9 | 13 | 14 | 14 |
| B | 2 | 18 | 20 | 22 | 22.5 |
| C | 1 | 21 | 21 | 21 | 22 |
| D | 3 | 14 | 15 | 15 | 16 |
| E | 10 | 9 | 12 | 14 | 14 |
| F | 2 | 20 | 20 | 20 | 21 |
| G | 2 | 12 | 14 | 16 | 18.5 |
| H | 2 | 20 | 20.5 | 21 | 22.5 |
| I | 7 | 8 | 11 | 12 | 12 |
| J | 1 | 28 | 28 | 28 | 31 |
| K | 1 | 22 | 22 | 22 | 22 |
| L | 3 | 12 | 12 | 12 | 12 |
| N | 3 | 11 | 12 | 12 | 15 |
| O | 6 | 8 | 9 | 12 | 11.5 |
| P | 2 | 16 | 16 | 16 | 18.5 |
| R | 3 | 1 | 12 | 13 | 14 |
| S | 3 | 11 | 13 | 14 | 15 |
| T | 5 | 10 | 12 | 12 | 12 |
| U | 2 | 8 | 10.5 | 13 | 11.5 |
| W | 1 | 20 | 20 | 20 | 20 |
| X | 1 | 32 | 32 | 32 | 36 |
| Y | 1 | 20 | 20 | 20 | 21 |

Letters absent from the table were dealt into the private starting racks.
Sample sizes for rare letters are too small to treat their prices as
stable estimates. Market levels did not collapse late: the last 17 rounds
still had a median payment of 12 and median winning bid of 18.

## Diagnosis and next strategy experiment

The strongest explanation is an **acquisition gap after cashing the first
word**. Five starting tiles plus three purchases produced eight available
tiles; `BRAZENS` consumed seven, leaving one. A policy that values only
playable words and one-tile completions sees little immediate payoff in
building a new rack from one tile. Its low exploratory bids then fail to
clear a market whose ordinary letters cost roughly 9–15. This is an
inference from public history and the policy's valuation structure, not a
reconstruction of our unexposed losing bids.

The excess cash makes under-acquisition a more actionable failure than
paying too much for the initial word. Those three purchases cost 50 and
earned 54, leaving substantial funds available for another acquisition
cycle. Rivals usually spent almost all of their initial cash and earned
rewards; our bot stopped recycling capital after round 4.

Recommended experiments, to be evaluated in paired simulations before
another authorized live test:

1. Add a budget-aware acquisition value for useful common letters when
   the rack is small. Blend this with dictionary completion value instead
   of requiring a one-tile completion before buying. Discount redundant
   vowels/consonants and speculative rare tiles.
2. Calibrate a market prior from completed matches and update it using
   within-match public payments. Normalize by letter class, shrink sparse
   observations toward common-letter prices, and keep first-price and
   Vickrey payment forecasts separate.
3. Forecast both future buying power and a target number of acquisitions.
   Reserve enough cash for complementary letters, recycle rewards, and
   spend down surplus cash as the remaining useful auction horizon
   contracts. A positive balance has no terminal score value.
4. In Vickrey auctions, distinguish **payment observed** from **bid needed
   to win**. `paid` is the old second-highest bid; a new winning entrant
   would pay the old highest bid. A `medianPaid + 1` floor can be a useful
   experiment, but it is not an estimated clearing threshold or payment.
   Keep higher reservation bids constrained by affordability and actual
   letter usefulness.
5. Keep the final-tile zero bid and early liquidation safeguards. Raising
   acquisition bids must not buy a tile after it can be used.

For scale only, across this fixed history's 67 nonfinal auctions, a bid of
13 would have exceeded the recorded top bid in 18 auctions and tied it in
10; a bid of 15 would have exceeded it in 34 and tied in 6. These are
**static threshold comparisons, not a replayed bot result**: changing wins
changes racks, later budgets, words, and subsequent rival bids. A first
live match is insufficient to establish a winning price policy.

## Evidence and limitations

- [Original competition instructions](https://scrabblebot.spacetimedb.com/docs).
- [Pinned upstream auction, rack, and scoring implementation](https://github.com/clockworklabs/scrabblebot/blob/b5ccb36aa238ad16692f8d6af54da15ef9f11324/spacetimedb/src/game.ts).
- Public rows from ended match `47002`, independently fetched through the
  generated SpacetimeDB SDK. The public archived top bids contain no
  losing-bid trace and are unavailable live to bots.
- [First live-test result](live-test-result.json), including final scores,
  balances, word reward, and number of auctions won.

This analysis does not establish exact opponent starting racks, our full
bid sequence, network timing for every auction, or a causal performance
estimate for the proposed acquisition floor. Offline mixed-policy results
and this live competition have different market distributions; report
both instead of treating one as a substitute for the other.
