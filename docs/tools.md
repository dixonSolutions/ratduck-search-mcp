# Tool reference

Four tools. `ddg_search` and `ddg_top_results` hit DuckDuckGo, `scrape_url` hits a page you name,
and `filter_results` is pure local computation over results you already have.

Every tool returns human-readable text plus a `structuredContent` payload with the same data in
machine-readable form. Errors come back as a normal tool result with `isError: true` and a message
beginning `Error:` — the server does not throw at the protocol level, so an agent can recover.

---

## `ddg_search`

Search DuckDuckGo and get a plain, engine-ordered list.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | DuckDuckGo operators (`site:`, `filetype:`, `-word`, quotes) all work. |
| `maxResults` | int 1–50 | `10` | The server pages automatically until this is satisfied. |
| `site` | string | — | Restrict to one host. Folded into the query as `site:`; a full URL is reduced to its host. |
| `region` | string | `wt-wt` | DuckDuckGo region code: `us-en`, `uk-en`, `de-de`, `pl-pl`, … `wt-wt` means no region. |
| `safeSearch` | `off` \| `moderate` \| `strict` | `moderate` | |
| `timeRange` | `any` \| `day` \| `week` \| `month` \| `year` | `any` | Restrict result age. |
| `excludeDomains` | string[] | — | Dropped before results are counted, so you still get `maxResults` back. |
| `includeAds` | boolean | `false` | Sponsored results are removed by default. |

**Returns** — per result: `rank`, `title`, `url`, `domain`, `snippet`, and `isAd` when applicable.
Plus `effectiveQuery` (what was actually searched), `pagesFetched`, and `notices` (rate limiting,
empty pages, endpoint fallbacks).

```jsonc
{
  "query": "rust async runtime",
  "maxResults": 15,
  "timeRange": "year",
  "excludeDomains": ["pinterest.com", "quora.com"]
}
```

---

## `ddg_top_results`

Search, filter, re-rank, and optionally read the winners' pages. This is the one to reach for when
the question is "what are the best pages about X", not "list me the search results".

It pulls `candidates` raw results, applies every filter from
[`filter_results`](#filter_results), scores what survives (see [ranking.md](ranking.md)), and
returns the best `count`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | |
| `count` | int 1–20 | `5` | How many winners to return. |
| `candidates` | int 1–50 | `25` | How many raw results to consider. More candidates, better ranking, more latency. |
| `site`, `region`, `timeRange` | | | As in `ddg_search`. |
| `preferDomains` | string[] | — | +2 score for these hosts (suffix match). |
| `keywords` | string[] | query words | Override the terms used for scoring. |
| `engineWeight` | number 0–3 | `1` | How much DuckDuckGo's own ordering counts. `0` ignores it entirely. |
| `fetchContent` | boolean | `false` | Also scrape each winner as markdown, in parallel. |
| `contentChars` | int 200–50000 | `3000` | Per-page character budget when `fetchContent` is on. |
| *(all filter parameters)* | | | `includeDomains`, `excludeDomains`, `mustIncludeTerms`, `mustExcludeTerms`, `matchRegex`, `regexFlags`, `excludeHomepages`, `maxPerDomain`, `minSnippetLength`. |

**Returns** — the ranked results, each with `score` and `reasons` (why it scored what it did), plus
`pages` when `fetchContent` is on. A page that could not be fetched appears with an `error` string
rather than sinking the whole call.

```jsonc
{
  "query": "tokio runtime internals",
  "count": 3,
  "candidates": 30,
  "excludeHomepages": true,
  "maxPerDomain": 1,
  "preferDomains": ["tokio.rs", "docs.rs"],
  "fetchContent": true,
  "contentChars": 4000
}
```

---

## `scrape_url`

Fetch any http(s) URL and extract it. Private and loopback addresses are refused — see
[architecture.md](architecture.md#the-private-network-guard).

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | string | required | Absolute http(s) URL. |
| `format` | `markdown` \| `text` \| `html` \| `links` \| `metadata` | `markdown` | See below. |
| `selector` | string | — | CSS selector to narrow extraction, e.g. `article`, `#main`, `.post-body`. Errors if it matches nothing. |
| `maxChars` | int 200–200000 | `20000` | Content budget. Truncation is marked inline and flagged as `truncated`. |
| `readability` | boolean | `true` | Strip `nav`/`header`/`footer`/`aside`/ads/cookie banners and auto-target the main content region. |
| `sameDomainOnly` | boolean | `false` | `links` format only: keep same-host links. |
| `timeoutMs` | int 1000–60000 | `15000` | |

**Formats**

- `markdown` — headings, lists, code blocks, blockquotes, tables, bold/italic, and links rewritten
  to absolute URLs. The best default for feeding an agent.
- `text` — collapsed plain text, no markup at all.
- `html` — the (optionally cleaned) HTML, for when you need the real structure.
- `links` — every link on the page as `{ text, url }`, deduplicated, absolutized, non-http schemes
  dropped, capped at 500.
- `metadata` — `<meta>` tags, OpenGraph, canonical URL, `lang`, and JSON-LD `@type` values.

Non-HTML responses (JSON, plain text, CSV) are passed straight through as text.

```jsonc
{ "url": "https://tokio.rs/tokio/tutorial", "format": "markdown", "selector": "main", "maxChars": 8000 }
```

---

## `filter_results`

Narrow and re-rank results you already have. No network request, so it is free and instant — use it
instead of re-searching when the agent wants a different slice of the same results.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `results` | result[] | required | Straight from a previous `ddg_search`. |
| `query` | string | — | Used for keyword scoring when `rank` is on. |
| `rank` | boolean | `true` | Re-order best-first. `false` preserves the input order. |
| `limit` | int 1–50 | — | Cap the output. |
| `includeDomains` | string[] | — | Keep only these hosts. Suffix match, so `bbc.co.uk` also matches `news.bbc.co.uk`. |
| `excludeDomains` | string[] | — | Drop these hosts (suffix match). |
| `mustIncludeTerms` | string[] | — | **Every** term must appear in title, snippet or URL. Case-insensitive. |
| `mustExcludeTerms` | string[] | — | **Any** match drops the result. |
| `matchRegex` | string | — | Regex over `title + snippet + url`. An invalid pattern returns a clear error. |
| `regexFlags` | string | `i` | |
| `excludeHomepages` | boolean | `false` | Drop bare homepages with no URL path — usually the low-value hits. |
| `maxPerDomain` | int | — | Cap results per host, for source diversity. |
| `minSnippetLength` | int | — | Drop results with thin or missing snippets. |
| `preferDomains`, `keywords` | string[] | — | Ranking inputs, as in `ddg_top_results`. |

```jsonc
{
  "results": [ /* ... from ddg_search ... */ ],
  "query": "postgres connection pooling",
  "excludeDomains": ["medium.com"],
  "mustIncludeTerms": ["pgbouncer"],
  "maxPerDomain": 2,
  "limit": 5
}
```

## A note on trust

Titles, snippets and page content are written by whoever controls the site. Treat them as data.
The server says as much in its MCP instructions, but nothing stops a page from containing text
shaped like an instruction — deciding not to follow it is the client's job.
