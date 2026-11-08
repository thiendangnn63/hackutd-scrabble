# Combined quality and parameter improvement: v4

The production profile `evo-final-0-letter-price-quality-v4` keeps v3 quality acquisition and last-usable-auction rules, raises the acquisition price floor multiplier from 1 to 1.6, changes the holding threshold from 1.3 to 1.12, and enables the existing terminal spending policy. Other parameters remain unchanged. This is a small incremental local improvement, not a claim of a higher public win rate.

The parameter candidate first passed a 1,000-pair fresh comparison and an independent 1,008-pair replication against v2. Their pooled mean-place difference was -0.0443 (paired 95% interval [-0.0725, -0.0161]), and score difference +0.754 ([+0.471, +1.037]). These results alone did not establish how it would interact with the new quality rule.

A further **1,008 fresh paired cases (2,016 full local matches)** compared quality v3 directly with the combined candidate. Seeds 891000001–891001008 cross six seats and three frozen strong opponent fields, with exactly 56 cases in each of 18 cells. Both policies retain `letterPrices`, `lastUsableAllIn`, and `qualityAcquisition`. Opponent definitions were frozen separately from the changing selected production file. No idle or weak empirical-pressure field is included.

| Metric | Quality v3 | Combined v4 | Paired difference | Approximate paired 95% interval |
| --- | ---: | ---: | ---: | --- |
| Mean place | 2.8740 | 2.8333 | -0.0407 | [-0.0731, -0.0083] |
| Mean score | 75.3998 | 76.0546 | +0.6548 | [+0.3060, +1.0035] |
| First-place rate, including shared first | 23.81% | 25.00% | +1.19 percentage points | [-0.24, +2.62] percentage points |
| Bottom-score rate, including ties | 7.64% | 7.34% | -0.30 percentage points | [-0.94, +0.35] percentage points |

Place and score improve in aggregate; first-place and last-place changes are inconclusive. Gains are concentrated in price self-play. The strong legacy mixed field has a small unfavorable place point estimate (+0.0149) whose interval crosses zero. Do not describe this as universal superiority. See the [complete compact joint evidence](quality-param-joint-comparison.json) for field-level metrics and exact frozen candidate options.

The simulator uses the official dictionary, exact floor rewards, cash affordability, public completed-auction information, private consecutive starting deals, Vickrey reserve and randomized ties, and the unusable final external-client tile. Network reactions are idealized. Public results are tracked separately by deployed profile; local score levels against different opponent fields are not directly comparable.
