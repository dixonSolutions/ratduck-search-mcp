# Changelog

Notable changes per release. Releases are cut automatically from `main`; see
[docs/release.md](docs/release.md).

## Unreleased

- `ddg_images` — DuckDuckGo image search, with size, colour, type, layout, licence, recency, region
  and site filters. Goes through the `vqd` + `i.js` JSON endpoint, since image search has no
  no-JavaScript HTML front end.
- `view_image` — fetch an image and return the picture itself as MCP image content, so a
  vision-capable client can look at it. Pixel dimensions are read from the file header (PNG, JPEG,
  GIF, WebP, BMP, SVG) with no image library; non-image responses are refused.
- `page_images` — list every image a page shows: `img` (including `data-src` lazy-loading and
  `srcset` candidates), `picture` sources, video posters, OpenGraph and Twitter card images, link
  icons, and CSS `url(...)` backgrounds — with alt text, declared size and origin.
- `grep_links` — harvest every URL a page references, links and loaded assets alike, then grep them
  by regex or substring, kind, file extension, internal/external scope or host.
- `scrape_url` gains the `images` and `assets` formats, an `includeAssets` option for the `links`
  format, and richer link rows (`kind`, `origin`, `internal`, `ext`).
- The private-network guard, timeouts and size caps apply to image fetches too.
- Library exports for `ratduck-search-mcp/images` and `/links`.

## 0.1.0

Initial release. Distributed from GitHub Pages rather than the npm registry — see
[docs/release.md](docs/release.md).

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
