# Strategy and experiments

Current production profile: **`evo-final-0-letter-price-quality-v4`**, with explicit public letter-price history, Vickrey quality acquisition, and a last-usable-auction cash rule. See [quality confirmation and parity](QUALITY_ACQUISITION_IMPROVEMENT.md) and [the v4 joint-parameter confirmation](JOINT_PARAMETER_IMPROVEMENT.md). See [letter-price confirmation](LETTER_PRICE_IMPROVEMENT.md), [terminal-v2 evidence](TERMINAL_V2.md), and [the public match audit](PUBLIC_47739_AUDIT.md). Earlier benchmark sections below describe historical candidates.

The current production policy is `evo-final-0-letter-price-quality-v4`: indexed word valuation, cash-aware acquisition, explicit public per-letter price history, and a last-usable-auction cash rule. Promotions use fresh paired local validation and public match observation. Earlier sections below retain historical experiments and do not establish live superiority.

## Live validation and the Vickrey bootstrap fix

The first public match exposed a failure that the original opponent models missed: after cashing a long word, the tiny remaining rack had no near-completions, so the old Vickrey bidder stopped acquiring letters despite substantial cash. The acquisition floor had only been enabled in first-price auctions. `market-all` enables the existing affordable public-price floor in Vickrey too.

| Public match | Policy | Score | Finishing place | Auctions won | Paid | Final cash |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 47002 | Original market | 54 | Tied 5/6 | 3/68 | 50 | 104 |
| 47068 | Market-all | 53 | Tied 5/6 | 10/68 | 132 | 21 |

Sources: [original live result](live-test-result.json), [market-all live result](live-test-market-all.json). These two different matches show that acquisition restarted, but neither establishes winning performance. The second game also highlights the value of letter quality: ENTERAL earns only 21 despite reaching seven letters. More public matches, with explicit wins/losses and scores, are required before promoting another policy.

Vickrey paid prices are runner-up bids, not winning thresholds. After a match, the archived winning-bid history can provide a historical prior; it is not available as the current sealed-bid threshold. The `market-margin` challenger uses 1.2× the recent median paid price plus one, under the same affordability cap. The frozen `market-all` baseline uses median plus one.

Before public-only steering, a second offline revision tested stronger rivals and true all-format self-play. V2 tuning seeds were 402001–402060; the fresh holdout was 680001–680060. Each reported row has 60 games per policy and format.

| V2 Vickrey holdout rivals | Original market place | Market-all place | Market-margin place | Market-all score |
| --- | ---: | ---: | ---: | ---: |
| Mixed | 1.67 | 1.28 | 1.22 | 183.72 |
| Five market-all policies | 4.22 | 3.83 | 3.67 | 66.22 |
| Five higher-budget policies | 3.32 | 2.67 | 3.02 | 74.40 |
| Five pressure policies | 2.42 | 2.40 | 2.37 | 75.62 |
| Strong mixed/value policies | 3.47 | 2.78 | 2.67 | 69.23 |
| Fixed-18 | 1.03 | 1.05 | 1.05 | 100.20 |
| Independent value bidders | 2.20 | 1.60 | 1.57 | 74.48 |

Across these equally weighted V2 scenarios, original market versus market-all changes Vickrey mean place from 2.62 to 2.23, mean final cash from 70.77 to 20.35, and tiles acquired from 12.88 to 17.01. Market-margin's mean place is 2.22, essentially tied with market-all; the simpler market-all had slightly better tuning results and remains the baseline. First-price behavior remains the original floor policy apart from skipping a penultimate tile with no immediate playable gain. Raw V2 reports are `benchmark-v2-*-tuning.json` and `benchmark-v2-*-holdout.json`.

A probability-aware two-letter lookahead candidate was rejected after much worse results against strong rivals (often fifth/sixth), rather than promoted for sophistication. V3 floor/reserve/terminal-spend experiments finished before public-only steering, have no fresh holdout or public validation, and do not change production defaults. No additional offline parameter experiments are running.

The remaining sections preserve the initial offline comparison and its limitations.

## Decisions

- The server's exact ENABLE dictionary is bundled locally. Kaggle or a larger generic corpus would introduce words the server rejects, and no model inference is needed to price a letter.
- A sorted-letter trie collapses equivalent anagrams. Top-only searches find the highest-paying playable word and best one-letter completion without a dictionary scan. Cached and uncached performance are measured separately; see [PERFORMANCE.md](PERFORMANCE.md).
- A bid values the improvement in playable payout and discounted one-letter completion potential, plus vowel balance, minus duplicate penalties. Rare expensive deadwood gets a low bid unless it helps a word. Cash commitments are capped, and the cap loosens near the end. The final auction letter gets a zero bid because a real client cannot redeem it.
- Vickrey starts from the reservation estimate; first-price shades it by 0.7. The current `market-all` policy then raises a useful balanced letter to the recent median paid price plus one in either format, subject to cash per expected remaining acquisition. This responds to expensive tables without spending past confirmed cash. Price history is public and must be filtered to the current match.
- Redeem seven-letter and longer words immediately. Six-letter words usually sell unless a material one-letter improvement is available; smaller words can wait for multiplier gains. Low cash triggers earlier redemption. Near the finish, bounded disjoint-word partition search extracts the best legal sequence found, with an explicit exact/inexact status. For auctions shorter than 250ms, terminal redemption uses the fast best-word fallback.
- Opponent scores are available in the context but currently do not change bids. We do not infer exact hidden starting racks or exact remaining letter composition. Missing-letter rarity is not separately probability-weighted; this remains an unvalidated improvement idea.

## Initial offline selection procedure (historical)

The first comparison tested six policies on paired bags: the upstream longest-word/face-value baseline, immediate highest-score redemption, fixed seven-letter hoarding, and three completion-aware bid/holding settings. Each candidate played 60 seeds in each auction type, in both a tuning and a separate heldout phase, with rotating seats and two heterogeneous opponent lineups. The `aggressive` setting (marginal value scale 1.6, six-letter hold threshold 1.5) had the best tuning finishing place in both formats.

Independent stress tests then exposed unspent cash against expensive first-price rivals. A second tuning experiment compared that frozen policy with `market` and `market-focused` (the same floor gated on an immediate improvement). Selection used equally weighted mean finishing place over six opponent scenarios, matching the competition's Swiss/place objective. `market` improved the first-price average from 3.05 to 1.85; `market-focused` was similar (1.83) and was rejected because its extra gate offered little reliable improvement. Vickrey decisions are identical in all three policies. This selection was frozen before the final fresh holdout.

## Initial heldout results (historical)

Final seeds are 290001–290060 (CLI seed 190001 plus holdout offset 100000), 60 games per candidate, format, and scenario, rotating all six seats. All rows below are simulated six-player matches. Lower mean place is better. First-place share divides a tied lead equally; JSON also reports the rate of finishing tied for first.

| Mixed opponents | Vickrey mean score | Vickrey mean place | First-price mean score | First-price mean place |
| --- | ---: | ---: | ---: | ---: |
| Starter longest/face bid | 14.93 | 4.80 | 20.87 | 4.95 |
| Immediate highest score | 15.88 | 4.72 | 21.72 | 4.83 |
| Fixed hoard | 24.15 | 3.92 | 38.42 | 3.68 |
| Adaptive completion value | 130.32 | 2.07 | 106.23 | 1.98 |
| Aggressive completion value | 147.25 | 1.67 | 113.98 | 1.78 |
| Patient completion value | 109.73 | 2.47 | 84.53 | 2.50 |
| **Selected market policy** | **147.25** | **1.67** | **98.18** | **1.87** |

| Five-rival scenario | Vickrey selected mean place | First-price aggressive mean place | First-price selected mean place | First-price selected mean score |
| --- | ---: | ---: | ---: | ---: |
| Mixed policies | 1.67 | 1.78 | 1.87 | 98.18 |
| Five aggressive completion bidders | 3.37 | 3.45 | 2.40 | 87.22 |
| High-face bidders (2× face + 4) | 1.05 | 3.07 | 1.38 | 79.43 |
| Fixed-12 bidders | 1.85 | 3.67 | 1.65 | 74.78 |
| Vowel-focused bidders | 1.25 | 4.05 | 1.65 | 77.03 |
| Idle opponents | 1.00 | 1.00 | 1.00 | 196.48 |

The first-price mean place across these scenarios improves from **2.84 to 1.66**. The deliberate tradeoff is weaker first-price score against cheaper mixed and idle lineups: aggressive scores 113.98 and 222.00 there, versus selected 98.18 and 196.48. `STRATEGY_MODE=aggressive` can select that measured alternative when appropriate. Vickrey has no such tradeoff: selected is identical to aggressive. This supports a robust default, not universal superiority.

Final decision latency and an additional 192 uncached decisions appear in each JSON report. The uncached test uses fresh random 5–16-tile racks, includes bidding and word choice, and disables query caches. Full engine stress includes larger pathological racks. Hardware/JIT/GC affect timings; network and reducer latency are not included.

## Historical offline reproduction commands

```sh
npm run check
npm test

# Original six-policy paired comparison, tuning and separate holdout:
npm run benchmark -- --games 60 --seed 28001 --candidates starter,greedy,hoard,adaptive,aggressive,patient --output docs/benchmark-results.json

# Second-stage tuning: repeat for mixed/selfplay/face/fixed/vowel/idle:
npm run benchmark -- --games 60 --seed 72001 --scenario fixed --candidates aggressive,market,market-focused --phases tuning --output docs/benchmark-market-fixed-tuning.json

# Frozen final primary comparison:
npm run benchmark -- --games 60 --seed 190001 --scenario mixed --candidates starter,greedy,hoard,adaptive,aggressive,patient,market --phases holdout --output docs/benchmark-final-mixed.json

# Frozen final independent stress: repeat for selfplay/face/fixed/vowel/idle:
npm run benchmark -- --games 60 --seed 190001 --scenario fixed --candidates aggressive,market --phases holdout --output docs/benchmark-final-fixed.json
```

The initial archived JSON reports retain 5,640 simulated matches: 1,440 initial comparisons, 2,160 second-stage tuning matches, and 2,040 final holdout matches. Repeated development runs and abandoned smoke/intermediate stress reports are excluded. Reusing a seed between candidates creates paired comparisons, not additional independent bags.

## Simulator boundaries

The simulator uses the pinned source's 98-tile bag, five private starting tiles dealt consecutively per player, 100 initial cash, integer-floor rewards, random tied bids, Vickrey reserve one, discarded no-bid draws, and the unusable final real-client tile. It draws the next tile before client reactions, so public bagTotal is current. Policies receive their own rack, public scores/prices, remaining count and format, never rival racks or future draws.

All non-idle rivals are modeled as real clients. Internal server-controlled bots have different timing and can use the final tile; they are not represented by these real-client scenarios. Independent face/fixed/vowel rivals hold words to five letters, sell earlier when low on cash or near the end, and liquidate at the finish. Idle means zero actions, rather than a claim that every server filler behaves that way.

Client reactions and multiple word submissions are idealized as immediate. SDK ordering, disconnects, packet delay, tournament scheduling and hostile live opponents need separate integration tests. These simulations do not establish a live leaderboard rating. Actual MatchState supplies configurable rack size and auction duration to the runtime; strategy experiments use the default five-tile, one-second configuration.
