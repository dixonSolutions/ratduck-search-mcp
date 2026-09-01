# Tool reference

Eight tools. `ddg_search`, `ddg_top_results` and `ddg_images` hit DuckDuckGo; `scrape_url`,
`page_images`, `grep_links` and `view_image` hit a URL you name; and `filter_results` is pure local
computation over results you already have.

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
| `format` | `markdown` \| `text` \| `html` \| `links` \| `images` \| `assets` \| `metadata` | `markdown` | See below. |
| `selector` | string | — | CSS selector to narrow extraction, e.g. `article`, `#main`, `.post-body`. Errors if it matches nothing. |
| `maxChars` | int 200–200000 | `20000` | Content budget. Truncation is marked inline and flagged as `truncated`. |
| `readability` | boolean | `true` | Strip `nav`/`header`/`footer`/`aside`/ads/cookie banners and auto-target the main content region. |
| `sameDomainOnly` | boolean | `false` | `links` / `assets` / `images` formats: keep same-host URLs only. |
| `includeAssets` | boolean | `false` | `links` format: also list the resources the page loads, not just anchors. |
| `timeoutMs` | int 1000–60000 | `15000` | |

**Formats**

- `markdown` — headings, lists, code blocks, blockquotes, tables, bold/italic, and links rewritten
  to absolute URLs. The best default for feeding an agent.
- `text` — collapsed plain text, no markup at all.
- `html` — the (optionally cleaned) HTML, for when you need the real structure.
- `links` — the page's anchors as `{ text, url, kind, origin, internal, ext }`, deduplicated,
  absolutized, non-http schemes dropped, capped at 500. Set `includeAssets` to fold in the
  resources the page loads too.
- `assets` — only the resources the page loads: images, scripts, stylesheets, media, fonts,
  iframes, feeds. Same shape as `links`.
- `images` — the images the page shows, with alt text, declared size and where each was found.
- `metadata` — `<meta>` tags, OpenGraph, canonical URL, `lang`, and JSON-LD `@type` values.

For anything beyond a plain list, reach for `grep_links` and `page_images` below — same extraction,
with filters.

Non-HTML responses (JSON, plain text, CSV) are passed straight through as text.

```jsonc
{ "url": "https://tokio.rs/tokio/tutorial", "format": "markdown", "selector": "main", "maxChars": 8000 }
```


---

## `ddg_images`

Search DuckDuckGo Images. Returns the direct image URL, a DuckDuckGo-hosted thumbnail, the page the
image sits on, and the real pixel dimensions.

Image search has no no-JavaScript HTML front end, so this goes through DuckDuckGo's own JSON
endpoint: one request mints a `vqd` token from the search page, the second spends it on `i.js`. It
is a bit more rate-limit-prone than web search as a result — failures come back in `notices`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | |
| `maxResults` | int 1–100 | `20` | Paged automatically; each engine page is about 100 hits. |
| `site` | string | — | Restrict to one host, folded in as `site:`. |
| `region` | string | `wt-wt` | As in `ddg_search`. |
| `safeSearch` | `off` \| `moderate` \| `strict` | `moderate` | The image endpoint only distinguishes on from off; `moderate` and `strict` both mean on. |
| `size` | `any` \| `small` \| `medium` \| `large` \| `wallpaper` | `any` | |
| `type` | `any` \| `photo` \| `clipart` \| `gif` \| `transparent` \| `line` | `any` | |
| `layout` | `any` \| `square` \| `tall` \| `wide` | `any` | |
| `color` | `any` \| `color` \| `monochrome` \| a named colour | `any` | `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `brown`, `black`, `gray`, `teal`, `white`. |
| `license` | `any` \| `public` \| `share` \| `shareCommercially` \| `modify` \| `modifyCommercially` | `any` | Usage rights. |
| `timeRange` | `any` \| `day` \| `week` \| `month` \| `year` | `any` | |
| `excludeDomains` | string[] | — | Matched against the source page's host. |

**Returns** — per image: `rank`, `title`, `imageUrl`, `thumbnailUrl`, `sourceUrl`, `domain`,
`width`, `height`, `ext`, `provider`. Plus `effectiveQuery`, `pagesFetched` and `notices`.

```jsonc
{
  "query": "aurora borealis",
  "maxResults": 12,
  "size": "wallpaper",
  "layout": "wide",
  "license": "shareCommercially"
}
```

---

## `view_image`

Fetch an image and return the picture itself, so a vision-capable client can actually look at it
rather than just receive a link. The result carries an `image` content block alongside a one-line
text summary.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | string | required | Absolute http(s) URL of the image. |
| `maxBytes` | int 1000–8000000 | `3000000` | Refused before decoding. Keep it low: the bytes are base64-encoded into the conversation. |
| `referer` | string | — | Some hosts refuse hotlinked images without one. Pass the page the image was found on. |
| `timeoutMs` | int 1000–60000 | `15000` | |

Pixel dimensions are read straight out of the file header (PNG, JPEG, GIF, WebP, BMP, SVG); an
unrecognised format still returns the image, with `width` and `height` null. A response that is
neither labelled `image/*` nor recognisable as one is refused, so a redirect to an HTML error page
does not arrive as a broken picture.

```jsonc
{ "url": "https://upload.wikimedia.org/…/panda.jpg", "referer": "https://en.wikipedia.org/wiki/Red_panda" }
```

---

## `page_images`

List the images a page shows, without downloading any of them. Pair it with `view_image` to look at
the one you want.

It finds `<img>` (including `data-src` lazy-loading and every `srcset` candidate), `<picture>`
sources, video posters, OpenGraph and Twitter card images, link icons, and CSS `url(...)`
backgrounds.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | string | required | Page to inspect. |
| `selector` | string | — | Limit the search to part of the page. |
| `sameDomainOnly` | boolean | `false` | Drop images served from other hosts (CDNs included). |
| `excludeIcons` | boolean | `false` | Drop favicons and apple-touch icons. |
| `excludeBackgrounds` | boolean | `false` | Drop CSS `url(...)` backgrounds. |
| `minWidth` / `minHeight` | int | — | Drop images *declaring* a smaller size. Images with no declared size are kept, since the markup often omits it. |
| `pattern` / `patternFlags` | string | — | Regex over URL, alt and title. |
| `limit` | int 1–1000 | `100` | |
| `timeoutMs` | int 1000–60000 | `15000` | |

**Returns** — per image: `url`, `alt`, `title`, `width`, `height`, `origin`, `domain`, `internal`,
`ext`. `origin` says where it came from (`img[src]`, `img[srcset]`, `meta[og:image]`,
`css background`, …), which is usually how you tell a real content image from chrome.

```jsonc
{ "url": "https://example.com/gallery", "excludeIcons": true, "minWidth": 300, "limit": 40 }
```

---

## `grep_links`

Harvest every URL a page references — the links it points at *and* the assets it loads — then grep
them. This is the tool for "find every PDF on this page", "what does this site pull from a CDN",
"list the outbound links".

Sources covered: `a`/`area`, `link` (stylesheets, icons, feeds, preloads), `script`, `img`
(including `srcset` and lazy attributes), `source`, `video`/`audio` (including posters), `track`,
`iframe`, `embed`, `object`, `form` actions, OpenGraph URLs, and CSS `url(...)`.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | string | required | Page to harvest. |
| `selector` | string | — | Limit the harvest to part of the page. |
| `include` | `all` \| `links` \| `assets` | `all` | `links` is anchors only; `assets` is only what the page loads. |
| `pattern` | string | — | Regex the link must match. |
| `patternFlags` | string | `i` | |
| `contains` | string | — | Case-insensitive substring. Combines with `pattern` (both must hit). |
| `matchOn` | `url` \| `text` \| `both` | `both` | What `pattern` and `contains` test against. |
| `invert` | boolean | `false` | Keep only what does *not* match, like `grep -v`. Needs a `pattern` or `contains`. |
| `kinds` | kind[] | — | `page`, `image`, `script`, `stylesheet`, `media`, `document`, `archive`, `font`, `feed`, `data`, `other`. |
| `extensions` | string[] | — | With or without the dot: `["pdf", ".csv"]`. |
| `scope` | `all` \| `internal` \| `external` | `all` | `internal` means the page's own host. |
| `includeDomains` / `excludeDomains` | string[] | — | Suffix match, so `example.com` matches `cdn.example.com`. |
| `unique` | boolean | `true` | Collapse a URL found through several elements into one row. |
| `limit` | int 1–2000 | `200` | |
| `timeoutMs` | int 1000–60000 | `15000` | |

**Returns** — per link: `url`, `text`, `kind`, `origin`, `domain`, `internal`, `ext`, and `rel`
where the element had one. The text summary leads with a per-kind count.

Kind is decided by the element first and the extension second: an `<img>` is an `image` whether or
not its URL ends in `.png`, which matters on the image CDNs that serve extensionless URLs.

```jsonc
{ "url": "https://example.com/docs", "kinds": ["document"], "extensions": ["pdf"], "scope": "internal" }
```

```jsonc
{ "url": "https://example.com", "include": "assets", "scope": "external", "kinds": ["script"] }
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

Images are no different. An image fetched by `view_image` is untrusted content from a stranger's
server, and text rendered *inside* a picture reaches a vision model just as readable as text in a
snippet. Alt text and file names are attacker-controlled too.
