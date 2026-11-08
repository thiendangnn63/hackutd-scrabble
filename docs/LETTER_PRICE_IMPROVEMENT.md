# Letter-price improvement: fresh local confirmation

A frozen letter-price bidder improved finishing place against the current `evo-final-0` policy in **1,000 fresh paired local bag cases**, requiring **2,000 full simulated matches**. This is local evidence; no public match win rate was measured for the candidate in this confirmation round.

| Metric | Current evo-final-0 | Letter-price candidate | Paired difference | Approximate paired 95% interval |
| --- | ---: | ---: | ---: | --- |
| Mean finishing place | 2.672 | 2.379 | -0.293 | [-0.369, -0.217] |
| Mean word score | 76.612 | 79.233 | +2.621 | [+1.720, +3.522] |
| First-place rate, including shared first | 31.4% | 36.8% | +5.4 percentage points | [+2.7, +8.1] percentage points |
| Last-score-place rate, including bottom ties | 8.7% | 4.8% | -3.9 percentage points | [-5.4, -2.4] percentage points |

Lower finishing place is better. The mean-place difference of −0.293 has a 95% interval entirely below zero, from −0.369 to −0.217. Improvement also appears separately in both modeled opponent scenarios; this was not driven by idle opponents.

## What changed

The candidate uses completed public auction records to distinguish prices for different letters rather than treating the market as a single undifferentiated price. Production integration supplies explicit auction ID, letter, and amount-paid records from the public subscription. It does not infer missing history from skipped, truncated, or repeated strategy calls.

The existing cash limits, integer bid constraints, auction clock guard, and final-tile restrictions remain in place. Letter prices are enabled through a dedicated `letterPrices` option; the other selected parameters remain the `evo-final-0` values. No model or network request is needed inside the bidding decision.

## Confirmation design

Six structural candidates were screened on an earlier set of 500 bags. The letter-price candidate was frozen before this separate confirmation on seeds 141000001–141001000. Each baseline/candidate pair used the same bag, seat, and opponent scenario. The two 500-case blocks are recorded in [the confirmation JSON](letter-price-confirmed.json).

Every table had five active opponents. Half the cases used convert self-play rivals and half used strong mixed rivals. Idle and empirical-pressure fields were excluded. Seat assignment `floor(n/2) % 6` crossed all six seats with both scenarios, addressing the earlier scenario/seat-parity confound.

| Opponent scenario | Cases per policy | Current mean place | Candidate mean place | Place difference | Approximate paired 95% interval |
| --- | ---: | ---: | ---: | ---: | --- |
| convert-selfplay | 500 | 2.922 | 2.542 | -0.380 | [-0.490, -0.270] |
| strong-mixed | 500 | 2.422 | 2.216 | -0.206 | [-0.311, -0.101] |

## Integration gate

The integrated bidder passed 500 additional full local parity games using explicit public auction history, with zero mismatches across 34,000 bid comparisons and 35,775 word comparisons. See [the integration parity evidence](letter-price-integration-parity.json). The integrated source also passed TypeScript checking, the production bundle build, and 64 local unit tests. The selected configuration is `evo-final-0-letter-price-v1`, retaining the prior parameters and adding `letterPrices: true`. The previous configuration is preserved in [the policy backup](policies/evo-final-0.json).

## Limits

These are modeled local matches, with idealized client timing and a fixed opponent population. They do not establish performance against the live tournament field. Confidence intervals use a normal approximation to paired differences. The confirmation set is now archived evidence and must not be reused as a fresh gate for later tuning. Tournament registration and live queues are outside this local validation workflow.
