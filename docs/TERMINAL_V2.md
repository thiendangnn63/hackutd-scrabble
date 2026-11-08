# Terminal-v2: last usable auction reservation

The selected v2 policy keeps letter-price bidding and adds `lastUsableAllIn: true`. When exactly one usable purchase remains (`remainingTiles === 1`) and buying the offered tile immediately improves a playable word, it can bid all confirmed remaining cash. Cash has no terminal score value. The final auction (`remainingTiles === 0`) remains unusable and receives no bid.

On 1,008 fresh paired strong-field bag cases (2,016 full local matches), mean place improved from 3.420635 to 3.410714; the paired difference was −0.009921, with approximate 95% interval [−0.016042, −0.003799]. Mean word score rose by 0.150794, with interval [+0.107420, +0.194167]. There were zero score regressions, zero place regressions, and zero pre-terminal bid/word trace differences in that sample. The win-rate interval still crossed zero; this is a narrow edge improvement, not evidence of a large win-rate gain.

The experiment used 84 full cycles across all six seats and two active current-letter-price fields, excluding idle and weak empirical opponents. See [the complete terminal evidence](terminal-round3-summary.json). Cash limits, integer checks, clock guards, and word legality remain enforced. This is local evidence and idealizes immediate client reactions.

The lesson is to distinguish the last **usable** auction from the final atomic award that ends the match. Terminal cash can be spent for confirmed immediate score, while the final tile cannot be redeemed by a real client. Earlier opportunities still need normal liquidity and opportunity-cost evaluation; this rule does not justify all-in bids throughout a match.
