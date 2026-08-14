# Changelog

Notable changes per release. Releases are cut automatically from `main`; see
[docs/release.md](docs/release.md).

## 0.1.0

Initial release.

- `ddg_search` — DuckDuckGo search with site restriction, region, safe search, time range, domain
  exclusion, ad filtering and automatic paging.
- `ddg_top_results` — search + filter + re-rank, with optional page-content fetching in the same
  call.
- `scrape_url` — markdown / text / html / links / metadata extraction from any http(s) URL, with
  CSS selectors and boilerplate stripping.
- `filter_results` — offline filtering and re-ranking of results you already have.
- Automatic fallback from `html.duckduckgo.com` to `lite.duckduckgo.com` when rate-limited, with
  the reason reported in `notices`.
- Private-network guard on all scrape targets.
- Library exports for `ddg`, `scrape` and `filter` alongside the MCP server.
