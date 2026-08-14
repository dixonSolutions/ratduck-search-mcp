# Ranking: what "top results" means

`ddg_top_results` and `filter_results` (with `rank: true`) score every surviving result and sort
best-first. The scoring lives in `rankResults` in [`src/filter.ts`](../src/filter.ts) and is
deliberately simple and inspectable — every result carries a `reasons` array explaining its score.

## The formula

```
score = engineWeight × 3 / √rank        engine position
      + coverage × 3                    fraction of keywords found anywhere
      + titleCoverage × 2               fraction of keywords found in the title
      + authority                       host reputation, −1.0 … +1.5
      + 2 if the host is in preferDomains
      + 0.5 if the snippet is longer than 120 characters
      − 5 if the result is an advertisement
```

### Engine position

`3 / √rank` — the first result contributes 3.0, the fourth 1.5, the twenty-fifth 0.6. Decaying
rather than linear, because DuckDuckGo's ordering is informative at the top and increasingly noisy
further down. `engineWeight: 0` removes the term completely, which is what you want when you are
deliberately looking for something the engine ranked poorly.

### Keyword coverage

Keywords default to the query's own words, minus stop words (`the`, `a`, `how`, `what`, …) and
anything shorter than three characters, with `site:` operators stripped. A match in the title
counts twice: once for overall coverage and again for title coverage. Pass `keywords` explicitly
when the query text is not what you actually want to match on.

### Authority

| Pattern | Weight |
| --- | --- |
| `.gov`, `.edu`, `.mil` | +1.5 |
| `wikipedia.org` | +1.2 |
| `github.com`, `gitlab.com` | +1.0 |
| Stack Exchange sites | +0.9 |
| Hosts starting `docs.`, `doc.`, `developer.` | +0.9 |
| Pinterest, Quora, `answers.*`, Blogspot | −1.0 |

Crude on purpose. It is a tie-breaker among results the keyword pass already liked, not a
judgement about the web.

## Tuning it

The knobs, roughly in order of usefulness:

- **`preferDomains`** — when you know which sources you trust. `+2` reliably floats them up.
- **`maxPerDomain: 1`** — the highest-value filter for research. Without it, one prolific site can
  take every slot.
- **`excludeHomepages: true`** — removes bare `https://example.com/` hits, which are almost never
  the answer to a specific question.
- **`engineWeight`** — lower it (`0.3`) when you want the ranker's opinion to dominate; raise it
  (`2`) when you mostly trust DuckDuckGo and just want the obvious junk filtered out.
- **`candidates`** — ranking can only reorder what it was given. Raising it from 25 to 40 gives the
  ranker more to work with, at the cost of an extra engine page.

## Worked example

For the query `tokio async runtime`, a result titled "Tokio Tutorial - async runtime" at
`tokio.rs/tokio/tutorial`, sitting at engine rank 2 with a 95-character snippet:

```
engine       1 × 3 / √2      = 2.121
coverage     3/3 keywords ×3 = 3.000
title        3/3 in title ×2 = 2.000
authority    no match        = 0.000
snippet      95 chars        = 0.000
                              -------
                               7.121
```

A Pinterest homepage at rank 1 matching one keyword:

```
engine       1 × 3 / √1      =  3.000
coverage     1/3 keywords ×3 =  1.000
title        0/3 in title ×2 =  0.000
authority    pinterest       = -1.000
                              -------
                                3.000
```

The engine's first result loses to its second. That is the entire point of the tool.

## If you need something better

The ranker is a pure function over `SearchResult[]`. If you want embeddings, recency weighting or a
model-based re-rank, call `search()` from the library and rank the results yourself — nothing in
`ddg.ts` depends on `filter.ts`.
