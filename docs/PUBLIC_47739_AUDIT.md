# Public match 47739: why 65 points

Bot 340 finished fifth of six with **65 points**, 23 cash, 12 auction wins, and no reported reducer errors. It played `JOSTLED` (45), `AGNATE` (17), and `OIL` (3). An anonymous read-only inspection recovered all 68 auction results, 15 word plays, and 68 archived winning bids after the match ended. No token, reducer, queue entry, or production process was used for this audit.

## Resource ceiling and conversion

The complete public chronology proves our initial hand was **EJSTG**, worth 13 face points. Our 12 purchases, `EDAOLNIOTALE`, also contained only 13 face points. We therefore acquired 17 tiles worth **26 face points** in total. Sixteen tiles worth 25 face points were played; one E remained.

The absolute 3× score ceiling for that inventory was **78**, even with perfect word availability and timing. Our played letters had a 75-point 3× ceiling: `AGNATE` lost 4 points relative to 3× and `OIL` lost 6. The unused E accounts for the remaining 3-point gap. Better word conversion alone could not produce 150 from these tiles.

A retrospective legal partition of the same acquired inventory scores 74: `ADJOINTS` (48), `LEGATEE` (24), and `LO` (2). These letters were available by rounds 31 and 65, respectively, and the published purchase costs fit the intervening cash balances. This is a feasible hindsight plan, not an exact optimum or a claim that an online policy would choose it. The bounded search marked its result non-exact; the proven inventory upper bound remains 78.

| Bot | Score | Starting face | Bought face | Total face | Absolute 3× ceiling | Final cash |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 194 | 105 | 22 | 13 | 35 | 105 | 70 |
| 190 | 96 | 5 | 34 | 39 | 117 | 31 |
| 326 | 90 | 14 | 20 | 34 | 102 | 10 |
| 235 | 86 | 12 | 18 | 30 | 90 | 22 |
| **340** | **65** | **13** | **13** | **26** | **78** | **23** |
| 402 | 48 | 12 | 11 | 23 | 69 | 47 |

All starting hands can be reconstructed retrospectively here. Cumulative word consumption minus earlier purchases supplies each hand's letter minima; aggregate starting letters equal the standard bag minus all revealed auction letters. Those constraints fix our five letters and leave just one globally unallocated O, which belongs to bot 190. This post-match reconstruction does not make private initial hands observable during play.

## How the 105-point winner differed

Bot 194 started with **WKYUX**, worth 22 face points, then bought ten tiles worth 13 face points for 135 currency. It converted all 35 face points at the full 3× multiplier: `WHISKEY` (60) in round 33 and `UNIAXIAL` (45) in round 62. Its 105 exactly reaches its inventory ceiling.

It bought the same face value as our bot. Its nine-point starting-face advantage explains **27** of the 40-point score gap; our 13-point conversion/unused-tile gap explains the rest. It sometimes placed large winning bids—H 45, N 48, I 55, S 53—but paid the competing second bid, not those reservation amounts. This supports valuing concrete completions in Vickrey auctions rather than equating a high bid with that exact expenditure.

## The most actionable missed completion

After round 35, our rack was **AEGINO**, with 57 cash. It remained unchanged for many auctions. At round 44, Z would have completed **AGONIZE**, a legal seven-letter word worth **51**. The archived highest rival bid was 47. A bid of 48 was affordable and would have won against those recorded rival bids, paying 47; redeeming the word immediately would return 51 cash and add 51 score.

Recomputing the frozen v1 policy on the reconstructed closing state yields a bid of **45**, three below the guaranteed winning threshold. The actual published payment was also 45, which is consistent with that quote but does not identify whose losing bid set the price. Public history does not expose our full submitted bid trace.

This was a missed **cash-self-financing completion**: payout minus payment would be +4. It is not a proof of positive incremental economic value, because the six existing letters already had a playable `AGONE` worth 12. The full counterfactual must value those letters, future liquidity, and score placement. Nevertheless, it is concrete evidence that an affordable high-value completion can be missed by the current reservation formula.

| Round | Offered tile | Actual rack | Best word after buying | Payout | Highest rival bid | Bid to guarantee the win | Recomputed v1 quote |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 32 | U | AEGIN | GUINEA | 17 | 15 | 16 | 4 |
| 44 | Z | AEGINO | AGONIZE | 51 | 47 | 48 | 45 |
| 47 | M | AEGINO | ENIGMA | 22 | 18 | 19 | 13 |
| 48 | S | AEGINO | AGONIES | 24 | 35 | 36 | 13 |

The S example is deliberately different: its 24-point payout was below the 35 payment needed to beat the old highest bidder, so simply raising every completion bid would be unsound. Paying the observed **second** price is also not a valid counterfactual: a new winner would pay the old **highest** rival bid.

## Economy and the 150-point target

The checked standard 98-tile distribution totals **187 face points**. Because no word exceeds a 3× multiplier, the entire six-player table has a theoretical score ceiling of **561**, or **93.5 per player on average**, even if every tile converts perfectly. Typical actual totals are lower because of short words and stranded letters.

An individual 150 remains possible, but requires at least **50 face points** at perfect 3× conversion—more than **1.6 times** the equal 31.17-face share. Our actual 26-face inventory needed at least another 24 face points before 150 was even theoretically possible. A universal six-player average of 150 is impossible under this scoring economy.

The next training objective should therefore examine **quality-adjusted face capture and timely cash recycling**, not only dictionary coverage or total tile count. In this match we bought mostly one-point letters; one well-supported Z could have raised the inventory ceiling from 78 to 108. Unsupported rare letters still risk becoming deadwood.

## Calibration and next experiments

- Model the actual field's ability to complete and monetize valuable words. A local proxy that burns rival budgets or strands their high-value starting tiles makes acquisition look easier than this public table.
- Test completion-aware reservation overrides when a concrete payout can replenish the purchase and the bot has sufficient confirmed cash. Preserve budget and clock checks; compare to liquidating the existing rack, not just to doing nothing.
- Track acquired face value, realized score divided by the 3× inventory ceiling, time between word redemptions, and stranded high-value completions alongside score and place.
- The terminal-v2 all-in rule addresses the last usable auction, not this round-44 miss. The last usable offer in this match was E while our remaining rack was E, so it did not create a playable improvement. It does not explain or remedy the central acquisition gap here.

## Counterfactual limits

The per-round quotes are deterministic recomputations from public closing-state racks, balances, and completed-auction history. They are not a captured client bid trace and do not model event arrival times. Changing one purchase changes later racks, cash, word timing, rival outcomes, and auction prices. The missed-Z example proves a one-auction opportunity under the recorded earlier trajectory; it does not prove a final score, rank, or 150-point result for a different full strategy. Raw public rows and the temporary analysis scripts remain under ignored `.research/`.
