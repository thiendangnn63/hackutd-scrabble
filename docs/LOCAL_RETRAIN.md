# Local retraining: selected policy retained

The local-only retraining round completed **at least 23,394 full matches**: 21,394 search matches and 2,000 final-validation matches. No public games, lobby entries, or tournament-registration changes were part of this round.

**Decision: retain `evo-final-0`.** None of the three frozen challengers demonstrated a reliable improvement in mean finishing place against the currently selected policy. Search winners were not promoted on noisy point estimates.

## Fresh paired final validation

Each policy played 500 fresh bags using the same seed, seat, and opponent scenario for each paired comparison: 250 convert self-play tables and 250 strong mixed tables. Every table had five active opponents. Empirical-pressure and idle opponents were excluded from this final validation. The baseline is the actual selected `evo-final-0` configuration, not stock `market-convert`.

| Policy | Games | Win rate including shared first | Mean place | Mean score | Mean-place difference vs selected | Approximate paired 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| evo-final-0 (retained) | 500 | 31.8% | 2.688 | 76.664 | 0 | baseline |
| retrain3m-pair4 | 500 | 33.0% | 2.624 | 77.436 | -0.064 | [-0.165, +0.037] |
| retrain3m-pair2 | 500 | 32.2% | 2.662 | 77.736 | -0.026 | [-0.079, +0.027] |
| retrain3m-pair0 | 500 | 31.2% | 2.690 | 77.122 | +0.002 | [-0.046, +0.050] |

Lower mean place is better. All three place intervals include zero. The best point estimate, `retrain3m-pair4`, improved place by 0.064 on average, with a 95% interval from −0.165 to +0.037. This does not establish a place improvement. One candidate improved word score while its place interval still crossed zero; word score alone did not satisfy the promotion criterion.

## Selected production configuration

```json
{
  "label": "evo-final-0",
  "options": {
    "floorMultiplier": 1,
    "acquisitionReserve": 1.2,
    "bidScale": 1.6,
    "holdGain": 1.3,
    "terminalSpend": false
  }
}
```

## Search and reproducibility

Six nice-10 local islands explored parameter mutations with independent seed regions, starting from the selected configuration. Search fitness used finishing place against active convert self-play and strong mixed opponents, with word score as a tiebreaker. The weak empirical-price-pressure scenario was excluded from fitness. Three finalists were frozen before the final held-out comparison.

This round used new 51-million training and 71-million search-validation seed regions; final paired evaluation used a separate 91-million region. The exact final baseline, candidate options, metrics, confidence intervals, and conservative match counts are in [the final comparison JSON](retrain3m-final-comparison.json). [Count summary](retrain3m-counts.json) distinguishes physical match runs from the 500 paired bag cases.

The relevant helpers are [evolve-local.ts](../scripts/evolve-local.ts), [final-local-validation.ts](../scripts/final-local-validation.ts), and [compare-retrain-local.ts](../scripts/compare-retrain-local.ts). Evolution accepts `--seed-base`, `--validation-seed-base`, and `--initial-config`; final validation accepts a fresh seed base and the selected configuration. Use a new held-out seed region for another promotion decision.

## Limits and lesson

These are local model results, not live win-rate estimates. Client reactions are idealized, opponents are a fixed modeled population, and normal-approximation paired intervals are not adjusted for testing three finalists. Repeatedly tuning against a final set would turn it into training data; new decisions need fresh validation bags. Some cutoff-boundary search work is excluded conservatively from the reported total.

The search result is useful evidence even though no policy was replaced: preserve the selected bot when an apparent improvement does not survive fresh paired validation. The tournament client and its registration remained untouched during this local-only round.

## Reproduce the frozen comparison

Public profile metadata and frozen finalists are included; restore only the nonsecret profile input, then run the baseline and indices 0–2 with the same seed base:

```sh
mkdir -p .research
cp docs/local-bot-profiles.json .research/bot-profiles.json
nice -n 10 node --import tsx scripts/final-local-validation.ts --index=-1 --games=500 --seed-base=91000001 --initial-config=docs/selected-config.json --config-file=docs/retrain3m-finalists.json --output-prefix=.research/reproduce-retrain
```

Repeat the final command with `--index=0`, `--index=1`, and `--index=2` to replay the three frozen challengers. These seeds reproduce archived evidence; do not reuse them as a fresh promotion gate. Local elapsed time and CPU counters vary by hardware.
