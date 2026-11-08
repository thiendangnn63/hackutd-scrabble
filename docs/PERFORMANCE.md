# Word engine validation and latency

Measured on 2026-11-07 using Node v25.8.1 on macOS arm64 / Apple M4 Pro.
The default `market` strategy uses the official 172,820-word dictionary,
compressed into 156,473 distinct letter inventories. Dictionary indexing
cost about 320 ms once, before connecting to the game.

Reproduce the independent verification and latency run:

```sh
npm ci
npx tsx scripts/verify-engine.ts --output=docs/performance-results.json
```

The generator uses xorshift seed `0x6e7a10`, standard 98-tile bag shuffles,
and no external models or services. Exact samples, scores, and timings are
in [performance-results.json](performance-results.json). This measures CPU
work; network round trips, reducer processing, and scheduling jitter are
outside the benchmark.

## Independent correctness verification

The verifier compares the indexed engine against a separate naive
26-letter count-array scan of the complete official dictionary. Across 100
random legal racks of 2–30 tiles, all **1,446,320 playable or one-tile-away
results matched**, including exact missing letters. Anagrams are compared
by their canonical representative because their tile consumption and score
are identical. The top playable and completion results also agree on
score, length, and lexical tiebreaks for every sampled rack.

The normal test suite separately checks scoring floors, repeated letters,
two-letter words, words beyond seven letters, exact disjoint-word packing,
valid bounded-search fallback, cache mutation isolation, and subtree-bound
ranking. Small-rack queries and partitions are checked against independent
oracles, including two missing letters.

Malformed dictionary entries are rejected: punctuation, embedded NULs,
non-ASCII spellings, one-letter entries, and words longer than the entire
98-tile bag. ASCII case and surrounding whitespace are normalized, and
duplicates are removed. Every endgame stress move was checked against the
remaining rack; each consumed at least two tiles, so liquidation always
made progress and terminated.

## Normal auction decisions

A tick below calls both `chooseWord` and `decideBid`, rather than timing
only a cache lookup. Cold means a previously unseen rack; uncached uses a
separate `WordEngine(words, 0)`. Warm p95 uses 25 repeated ticks; uncached
p95 uses 10. Timings are milliseconds and depend on machine load.

| Rack tiles | Cold tick | Warm p95 | Cache-disabled p95 |
| --- | ---: | ---: | ---: |
| 5 | 0.82 | 0.032 | 0.63 |
| 10 | 2.34 | 0.019 | 1.31 |
| 20 | 3.62 | 0.013 | 4.10 |
| 30 | 0.73 | 0.034 | 0.86 |
| 50 | 0.31 | 0.014 | 0.35 |
| 98 | 0.17 | 0.033 | 0.20 |

Large racks can be faster because a high-scoring word quickly establishes
a strong search bound. Each trie node stores its best possible descendant;
branches whose descendants cannot beat the current result are skipped.
This retains exact results while avoiding a dictionary-wide scan or
sorting/materializing thousands of unneeded candidates on each bid.

On the 100 random racks, a cold pair of top-result queries had median
0.81 ms, p95 2.22 ms, and maximum 4.03 ms. The equivalent naive full scan
had median 5.35 ms and p95 8.20 ms. Enumerating **all** matches is slower on
large racks: indexed full enumeration had p95 51.45 ms versus 10.42 ms for
the naive count scan. Production bidding requests only the top result;
full enumeration is reserved for partitioning and validation.

Four simultaneous matches with 7/10/13/16-tile racks took at most 4.55 ms
per combined tick and p95 0.053 ms over 100 ticks. Four separate
20/30/50/98-tile matches took at most 3.03 ms per combined tick
and p95 2.37 ms over 25 ticks. Each group used a fresh engine
cache; later ticks reused its results.

The initial implementation materialized completion lists and could spend
300–557 ms on a 50–98-tile tick. Top-only queries, bounded caches, and
subtree pruning removed that bottleneck without changing strategy choices.

## Endgame partitioning and limits

Partitioning is a different operation from ordinary bidding. It searches
for disjoint words with the greatest total payout. The search is exact
until 4,000 memo states or 250,000 candidate checks; on exhaustion it returns
a valid best-known plan with `exact: false`. Only completed exact plans
are cached. Query caches are limited to 2,048 keys and 200,000 result rows;
top-result and partition caches also have finite key limits.

| Starting tiles | Words redeemed | Longest single decision | Total decision CPU |
| --- | ---: | ---: | ---: |
| 20 | 2 | 11.22 ms | 13.02 ms |
| 30 | 3 | 17.14 ms | 27.47 ms |
| 50 | 5 | 38.38 ms | 47.46 ms |
| 98 | 8 | 163.97 ms | 279.67 ms |

The standard one-second auction leaves considerable CPU margin in these
samples. The pathological 98-tile partition decision can exceed a 100 ms
auction. Production therefore switches to the exact top legal word instead
of partition search when `auctionDurationMs < 250`. A separate **cache-disabled**
100 ms endgame test confirms that fallback remains fast and consumes valid
tiles:

| Starting tiles | Words redeemed | Longest single decision | Total decision CPU |
| --- | ---: | ---: | ---: |
| 20 | 2 | 0.508 ms | 0.518 ms |
| 30 | 3 | 0.153 ms | 0.316 ms |
| 50 | 4 | 0.834 ms | 1.201 ms |
| 98 | 9 | 0.436 ms | 1.546 ms |

Start liquidation before the final auction, use the runtime's deadline
checks, and allow network margin. These local measurements do not guarantee
arrival before a server deadline or completion of all sequential reducer
round trips within one auction. The real-client final-tile restriction
still applies regardless of how quickly the engine runs.
