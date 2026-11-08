# Quality acquisition: v3 local confirmation

The `quality-3-3` bidder improved mean finishing place and reduced bottom-score finishes against the selected v2 baseline in **1,008 fresh paired local cases**: **2,016 full matches**. The production candidate is `evo-final-0-letter-price-quality-v3`, enabled by `qualityAcquisition: true` in Vickrey matches. This is local confirmation, not a measured public win-rate improvement or a promise of 150 points.

| Metric | Current v2 | Quality candidate | Paired difference | Approximate paired 95% interval |
| --- | ---: | ---: | ---: | --- |
| Mean place | 3.120 | 2.963 | -0.157 | [-0.247, -0.066] |
| Mean score | 74.372 | 75.850 | +1.478 | [+0.523, +2.433] |
| Purchased face value | 23.548 | 24.620 | +1.072 | [+0.685, +1.460] |
| First-place rate, including shared first | 21.83% | 23.02% | +1.19 percentage points | [-1.37, +3.76] percentage points |
| Bottom-score rate, including ties | 12.80% | 9.42% | -3.37 percentage points | [-5.31, -1.44] percentage points |

The mean-place interval is entirely below zero, and the purchased-face interval entirely above zero. The first-place-rate interval crosses zero, so these results do not establish a win-rate improvement. Mean tiles won decreased slightly, from 11.317 to 11.118, while purchased face value increased: the change improved acquisition quality rather than simply buying more tiles.

## What changed

The quality floor applies to a previously absent letter worth at least three face points when the rack contains 5–12 tiles, includes a vowel, and at least eight undrawn tiles remain. It raises the candidate reservation toward `3 × face + 8`, subject to confirmed cash and the existing liquidity cap. A concrete positive six-letter-or-longer completion can support a larger cap bounded by its payout. Unsupported Q remains gated; unsupported J and Z receive discounts.

The feature is Vickrey-only. Existing explicit public letter-price history, integer/cash checks, auction clock guard, word selection, last-usable-auction rule, and zero bid on the final unusable tile remain in place. It responds to [the 47739 audit](PUBLIC_47739_AUDIT.md): a rack can contain enough tiles yet lack enough face value to support a high score.

## Confirmation design and field differences

The candidate was selected from an earlier search, then frozen before seeds 261000001–261001008. The final set crosses six seats with three active opponent fields: 18 cells, each repeated 56 times. Baseline and candidate share each bag, seat, and field. No idle or weak empirical-price-pressure field is included. Holding decisions are frozen; only bids change.

| Opponent field | Cases per policy | Baseline mean place | Candidate mean place | Paired place difference | Approximate paired 95% interval |
| --- | ---: | ---: | ---: | ---: | --- |
| current-price-selfplay | 336 | 3.342 | 3.003 | -0.339 | [-0.500, -0.179] |
| current-price-strong-mixed | 336 | 3.488 | 3.265 | -0.223 | [-0.387, -0.059] |
| legacy-strong | 336 | 2.530 | 2.622 | +0.092 | [-0.050, +0.234] |

The two current-price fields improved. The legacy-strong field regressed in its point estimates; the aggregate result should not be described as improvement in every field. See [the compact confirmation evidence](quality-face-confirmation.json) for all metrics and scenario intervals.

## Reproduce the frozen research comparison

The credential-free [validation script](../scripts/quality-acquisition-validation.ts) preserves the research bidder and exact baseline input. Run from the project root; this performs local matches only and does not connect to the game server.

```sh
mkdir -p .research
node --import tsx scripts/quality-acquisition-validation.ts --baseline=docs/quality-acquisition-baseline.json --phase=confirmation --games=1008 --seed=261000001 --variants=quality-3-3 --output=.research/reproduced-quality-confirmation.json
```

This command replays archived evidence. Use a new held-out seed region for a later promotion decision. CPU timings and bounded-search timing can differ by machine. The integrated qualityAcquisition Strategy passed direct rule tests and 504 additional fresh full-game parity checks against the frozen research formula: zero differences across 34,272 bid calls and 35,879 word calls, balanced over all 18 seat/field cells. See [the compact integration parity evidence](quality-acquisition-parity-results.json). Project unit tests, TypeScript checking, and the production bundle build passed before publication.

## Limits

The simulator idealizes client timing and uses fixed modeled opponents. The production integration was checked against the research formula before publication; public performance requires separate observation. Confidence intervals use normal paired approximations. The table-wide 187-face economy and 3× ceiling still apply; quality capture improves access to score but cannot make a universal six-player average of 150 feasible.
