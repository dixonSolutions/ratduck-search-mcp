# Troubleshooting

## "DuckDuckGo returned a rate-limit / anomaly page"

DuckDuckGo served its bot challenge instead of results. The server already retried against the
lite front end and still got challenged.

What helps, in order:

1. **Wait.** The block is per-IP and usually clears in a few minutes.
2. **Ask for fewer results.** `maxResults: 10` is one page; `maxResults: 40` is three, and each
   page is another request against a rate limit you are already close to.
3. **Space out calls.** Several searches in quick succession is exactly the pattern that trips it.
4. **Pin a User-Agent** with `RATDUCK_USER_AGENT` if rotation seems to correlate with challenges on
   your network.

Datacentre IPs (CI runners, cloud VMs, some VPNs) get challenged far more aggressively than
residential ones. This is why live tests are not in CI.

## `Could not obtain a DuckDuckGo image-search token (vqd)`

`ddg_images` needs a token that only the search page hands out, so it makes two requests: one for
the token, one for the results. This error means the first one came back without a token — almost
always rate limiting, occasionally a markup change on DuckDuckGo's side.

Wait several seconds and retry. If it persists while `ddg_search` still works, the token pattern
has probably moved; `extractVqd` in `src/images.ts` is the one function to fix, and it has
unit tests covering the shapes the token has taken so far.

Image search is more rate-limit-prone than web search because it has no `lite` front end to fall
back to. Keep `maxResults` modest — each engine page is about 100 hits, so 20 results is a single
request.

## An image comes back as an error, or looks broken

`view_image` refuses a response that is neither labelled `image/*` nor recognisable from its file
header, which is usually one of:

- **Hotlink protection.** The host serves an HTML "no hotlinking" page to requests without a
  referer. Pass `referer` with the page the image was found on (`sourceUrl` from `ddg_images`).
- **A login or consent wall.** Nothing to do about it; try another result.
- **`Response is N bytes, over the limit`.** `view_image` caps at 3MB by default because the bytes
  are base64-encoded into the conversation. Raise `maxBytes`, or use the `thumbnailUrl` from
  `ddg_images` instead.

`width` and `height` come back null for formats whose headers are not parsed (AVIF, HEIC, some
progressive variants). The image itself is still returned.

## `grep_links` or `page_images` finds nothing

Both read the HTML the server sends. A page that renders its content with JavaScript has almost
nothing in that HTML — there is no headless browser here. Check with
`scrape_url` at `format: "html"`; if the markup is an empty shell, no amount of filtering will
help.

Otherwise it is usually a filter that is stricter than intended:

- `minWidth` / `minHeight` only drop images whose markup *declares* a smaller size — but plenty of
  pages declare nothing, and those are kept. If you got too much back, that is why.
- `scope: "internal"` compares hosts exactly, so images on a CDN subdomain count as external.
- `extensions` matches the URL path only. An image CDN serving `/photo?id=1` has no extension;
  filter by `kinds: ["image"]` instead.

## Empty results with no notice

If `results` is empty and `notices` is empty too, DuckDuckGo returned a page that parsed cleanly
and genuinely contained nothing — usually an over-constrained query. Check `effectiveQuery` in the
response: a `site:` restriction plus a narrow `timeRange` will do this quickly.

If `effectiveQuery` looks reasonable and the same query returns results in a browser, the markup
has probably changed. See [contributing.md](contributing.md#when-duckduckgo-changes-its-markup).

## `Refusing to fetch private address` / `private host`

Working as intended: the URL resolves to loopback, RFC1918, link-local or CGNAT space. See
[architecture.md](architecture.md#the-private-network-guard).

For local development against your own server, start the MCP server with `RATDUCK_ALLOW_PRIVATE=1`.
Do not set it when the agent can be steered by web content — that is the situation the guard exists
for.

## `Selector "..." matched nothing`

The CSS selector found no elements. Common causes:

- The content is rendered by JavaScript. This server does not run JS; there is no DOM to select
  from. Look for an API endpoint the page calls, or scrape without a selector and let readability
  find the content.
- `readability: true` (the default) already removed the element — it strips `nav`, `header`,
  `footer`, `aside` and ad/cookie classes *before* selecting. Pass `readability: false` if you are
  deliberately targeting one of those.
- The selector is right but the page varies. Drop the selector; the main-content heuristic handles
  most articles.

## Content is truncated

`truncated: true` and a `[truncated at N characters]` marker mean you hit `maxChars` (default
20000). Raise it, or narrow the extraction with a `selector` so the budget is spent on the part you
care about.

## Timeouts

`Request to ... timed out` after the default 15s. Raise `timeoutMs` on the call, or
`RATDUCK_TIMEOUT_MS` globally. Slow sites, large pages and Tor-adjacent hosts are the usual
suspects. The fetcher already retries twice on 429/5xx with backoff.

## Markdown output looks wrong

The converter handles headings, paragraphs, lists, code blocks, blockquotes, tables and inline
emphasis. Deeply nested or `div`-soup layouts degrade to flat paragraphs. Options: `format: "text"`
if structure does not matter, or `format: "html"` with a `selector` if it matters a lot.

## `EALLOWREMOTE` when installing

npm 12 and newer refuse to install from a tarball URL unless you opt in. Either download first —

```bash
curl -fsSLO https://dixonsolutions.github.io/ratduck-search-mcp/ratduck-search-mcp-latest.tgz
npm install -g ./ratduck-search-mcp-latest.tgz
```

— or pass `--allow-remote=all`. The install script already does the download-first version, so this
only bites people installing by hand.

## `ratduck-search-mcp: command not found` after installing

The npm global bin directory is not on your PATH. Find it with `npm prefix -g` and add
`<that>/bin` to your PATH, or use the absolute path in your MCP client config. GUI applications in
particular often do not see the PATH your shell exports.

## The server does not appear in my client

- Check it runs: `ratduck-search-mcp --version`.
- Check the client's config path and JSON syntax — a trailing comma silently disables the whole
  file in most clients.
- Restart the client. Most read MCP config only at startup.
- Use an absolute path in the client config if the client cannot resolve the command name.
- Claude Code: `claude mcp list` shows what is registered.

## It starts and immediately "hangs"

That is correct. An MCP stdio server waits on stdin for a client. It prints one line to stderr and
then goes quiet. Ctrl-C to exit.

## Node version errors

Node 20+ is required. `node -v` to check. The package ships plain ESM; if your client runs it under
an older Node, the syntax errors will be about `??=` or top-level `await` in a dependency.
