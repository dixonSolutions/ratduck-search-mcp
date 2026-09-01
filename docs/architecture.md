# Architecture

```
src/
  index.ts    CLI entrypoint: --help/--version, stdio transport, signal handling
  server.ts   builds the McpServer and its instructions
  tools.ts    the eight MCP tool definitions (zod schemas, rendering, error handling)
  ddg.ts      DuckDuckGo web search: URL building, paging, HTML parsing for both front ends
  images.ts   DuckDuckGo image search (vqd + i.js), and fetching an image for a client to view
  links.ts    harvesting a page's links and assets, classifying them, grepping them — pure
  scrape.ts   arbitrary-URL fetch and extraction (markdown/text/html/links/assets/images/metadata)
  filter.ts   filtering, scoring, ranking — pure functions, no I/O
  http.ts     fetch wrapper: timeouts, retries, size caps, the private-network guard
  types.ts    shared shapes
```

The layering is deliberate: `filter.ts` and `links.ts` are pure, `ddg.ts`, `images.ts` and
`scrape.ts` do I/O only through `http.ts`, and `tools.ts` is the only file that knows about MCP.
That is what makes the package usable as a plain library (`ratduck-search-mcp/ddg`, `/images`,
`/links`, `/scrape`, `/filter`) as well as a server.

## Searching DuckDuckGo

There is no official DuckDuckGo search API. The Instant Answer API returns definitions, not web
results. So the server scrapes the front end that exists precisely for clients without JavaScript:

1. `GET https://html.duckduckgo.com/html/?q=…&kl=…&kp=…&df=…`
2. Parse `div.result` blocks with cheerio: `a.result__a` for the title and link,
   `.result__snippet` for the description, `.result--ad` / `.badge--ad` for sponsored results.
3. Unwrap the redirect links. Organic results arrive as `//duckduckgo.com/l/?uddg=<encoded>`;
   sponsored ones as `//duckduckgo.com/y.js?…&u3=<encoded>`. Both are decoded to the real target.
4. For more results, submit the engine's own "next page" form: collect its hidden inputs
   (`s`, `dc`, `nextParams`, `v`, `o`, `api`) and POST them back. Reusing the engine's form rather
   than guessing the offset is what makes paging survive DuckDuckGo's parameter changes.
5. Deduplicate by URL, drop excluded domains and ads, stop at `maxResults`.

### The lite fallback

DuckDuckGo challenges bursty traffic with an anomaly page ("Unfortunately, bots use DuckDuckGo
too") served with HTTP 202 — not an error status, so a naive client sees "success" and zero
results. The server detects it (`anomaly-modal`, `anomaly.js`, `challenge-form`, "unusual traffic")
and, when the caller has not pinned an endpoint, retries the same page against
`lite.duckduckgo.com/lite/`, a much smaller table-based front end that is challenged less often.

Whatever happens is reported in `notices` — an empty result set always comes with a reason.

Requests are spaced 500ms apart when paging, and User-Agents rotate through four desktop browser
strings unless `RATDUCK_USER_AGENT` pins one.

### Fragility, honestly

This is scraping. If DuckDuckGo changes its markup, parsing breaks. The mitigations are: two
independent front ends, parsers isolated in `parseResultsPage` / `parseLitePage` with fixture-based
tests, and explicit `notices` rather than silent empty results. `npm run test:live` exercises the
real endpoints when you want to know whether the markup still matches.

## Searching for images

Image search has no no-JavaScript front end to scrape: `duckduckgo.com/?q=…&ia=images` is a
JavaScript shell that calls `i.js`, and `i.js` refuses to answer without a `vqd` token minted by
that shell. So `images.ts` does it in two steps — fetch the shell and regex the token out of it,
then spend the token on the JSON endpoint with `x-requested-with: XMLHttpRequest` and a
`duckduckgo.com` referer, the way the page's own script does.

Filters go in a single `f` parameter with six comma-separated slots — time, size, colour, type,
layout, licence — and empty slots stay empty (`,,,,,` means no filters at all). Paging follows the
`s=` offset out of the response's own `next` field rather than guessing.

The token is the fragile part: no token means no search, and that surfaces as a clear `blocked`
error rather than an empty list. A payload that comes back as HTML instead of JSON is a challenge
page, and is reported in `notices` like every other rate limit.

## Looking at an image

`view_image` is the only path in the server that returns bytes rather than text. It fetches through
`fetchBinary` — same private-network guard, timeout and size cap as everything else, but with a
tighter default budget (3MB), because the bytes are base64-encoded into the conversation and cost
tokens.

Pixel dimensions are read out of the file header rather than by decoding the image: PNG IHDR, GIF
logical screen descriptor, the JPEG segment chain walked to its first start-of-frame marker, the
three WebP chunk layouts, BMP, and the `width`/`height`/`viewBox` of an SVG. No image library, no
native dependency. An unrecognised format is still returned, with null dimensions.

A response that is neither labelled `image/*` nor recognisable from its header is refused, so a
"403, please log in" HTML page does not arrive as a broken picture.

## Harvesting links and assets

`links.ts` walks a parsed document once and collects every attribute that can carry a URL — `href`,
`src`, `srcset`, `poster`, `data`, `action`, lazy-loading `data-*` variants, OpenGraph URLs, and
`url(...)` inside both `style` attributes and `<style>` blocks.

Each URL is bucketed into a `kind`. The element decides where it is unambiguous — an `<img>` is an
image whether or not its URL ends in `.png`, which matters on image CDNs that serve extensionless
URLs — and the file extension decides the rest. `origin` records which element it came from, which
is what lets a caller tell a content image from a favicon, or a first-party script from a CDN one.

`grepLinks` then filters that list: regex or substring over URL and/or text, `invert` for grep -v,
plus kind, extension, internal/external scope and host filters. It is all pure, so `format: links`,
`format: assets`, `grep_links` and `page_images` are one extraction path with different filters
rather than four parsers.

## Scraping a URL

`scrapeUrl` fetches, then branches on `format`. For text-ish formats it removes boilerplate
(`nav`, `header`, `footer`, `aside`, ARIA landmarks, ad and cookie-banner classes), then picks the
main content region by trying `main`, `article`, `[role=main]`, `#content`, `.content`, `#main` and
taking the first one with more than 200 characters of text. An explicit `selector` skips that
heuristic entirely.

The markdown converter is intentionally small — headings, paragraphs, lists, `pre`, blockquotes,
tables, inline bold/italic/code, and links absolutized against the final URL. It is not a general
HTML-to-markdown engine; it is a "make this readable to a language model" converter.

## Ranking

See [ranking.md](ranking.md) for the scoring formula and how to tune it.

## The private-network guard

`http.ts` resolves every scrape target before fetching it and refuses:

- `localhost`, `*.localhost`, `*.internal`
- loopback (`127.0.0.0/8`, `::1`), `0.0.0.0`
- RFC1918 (`10/8`, `172.16/12`, `192.168/16`), CGNAT (`100.64/10`)
- link-local (`169.254/16` — this is the cloud metadata endpoint), IPv6 unique-local and
  link-local, IPv4-mapped IPv6 forms of all of the above
- multicast and reserved space
- any scheme that is not http/https

Both literal IPs and hostnames that *resolve* to those ranges are blocked, since `evil.example`
can trivially point at `169.254.169.254`. This matters because scrape targets often come from
search results or page content, which is to say from strangers.

`RATDUCK_ALLOW_PRIVATE=1` disables the guard for local development — the test suite uses it to
scrape a `127.0.0.1` fixture server.

## HTTP behaviour

- Timeout per request via `AbortController` (default 15s, `RATDUCK_TIMEOUT_MS`).
- Retries on 429 and 5xx with exponential backoff (400ms, 800ms), two retries by default.
- Response size capped before decoding (default 4MB, `RATDUCK_MAX_BYTES`), checked against both
  `content-length` and the actual body.
- Charset honoured from `content-type`, falling back to UTF-8.
- Errors are `FetchError` with a `code` (`blocked`, `timeout`, `status`, `too_large`, `network`,
  `unsupported`) so callers can branch without string matching.

## Error handling at the MCP boundary

Tool handlers never throw. Anything that goes wrong becomes a result with `isError: true` and a
readable message. An agent that asks for a page behind a paywall gets told so and can move on,
rather than seeing a protocol-level failure.
