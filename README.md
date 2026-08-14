# ratduck-search-mcp

[![CI](https://github.com/dixonSolutions/ratduck-search-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dixonSolutions/ratduck-search-mcp/actions/workflows/ci.yml)
[![install](https://img.shields.io/badge/install-github%20pages-b8541c.svg)](https://dixonsolutions.github.io/ratduck-search-mcp/)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that gives an agent the open web: it searches
DuckDuckGo by scraping the no-JavaScript front end, scrapes any URL you point it at, and filters
and re-ranks results so the agent gets the *top* handful instead of a wall of links.

No API keys. No headless browser. No search-provider bill. Not on the npm registry either — it
installs straight from [its GitHub Pages site](https://dixonsolutions.github.io/ratduck-search-mcp/).

## Tools

| Tool | What it does |
| --- | --- |
| `ddg_search` | Search DuckDuckGo. Returns title, URL, domain and snippet per result. Supports `site:` restriction, region, safe search, time range, domain exclusion and paging. |
| `ddg_top_results` | Search, filter, then re-rank by keyword coverage, host authority and engine position, and return the best few. Optionally scrapes each winner's page in the same call. |
| `scrape_url` | Fetch any http(s) URL as markdown, plain text, raw HTML, a link list, or page metadata. Supports CSS selectors and boilerplate stripping. |
| `filter_results` | Narrow and re-rank results you already have — by domain, terms, regex, snippet length, per-domain cap — without spending another request on DuckDuckGo. |

Full parameter reference: [docs/tools.md](docs/tools.md).

## Install

One-liner — checks your Node version, downloads the tarball, installs it globally, and prints the
client config to paste:

```bash
curl -fsSL https://dixonsolutions.github.io/ratduck-search-mcp/install.sh | bash
```

Or do it by hand:

```bash
curl -fsSLO https://dixonsolutions.github.io/ratduck-search-mcp/ratduck-search-mcp-latest.tgz && npm install -g ./ratduck-search-mcp-latest.tgz
```

Download first, install second — npm 12 refuses to fetch tarball URLs unless you pass
`--allow-remote=all`, and a local file works on every npm version. Every released version is at a
stable URL; [versions.json](https://dixonsolutions.github.io/ratduck-search-mcp/versions.json)
lists them.

## Wire it into a client

**Claude Code**

```bash
claude mcp add ratduck -- ratduck-search-mcp
```

**Claude Desktop / any client using `mcpServers` JSON**

```json
{
  "mcpServers": {
    "ratduck": {
      "command": "ratduck-search-mcp"
    }
  }
}
```

More clients and troubleshooting: [docs/install.md](docs/install.md).

## Example

```
> ask the agent: "find the three best current pages on Rust async runtimes, and read the top one"
```

The agent calls `ddg_top_results` with `count: 3`, `fetchContent: true`, and gets back ranked
results plus the page text — one round trip.

Programmatic use works too, since the package exports its internals (install the tarball as a
project dependency the same way, `npm install ./ratduck-search-mcp-latest.tgz`):

```ts
import { search } from "ratduck-search-mcp/ddg";
import { topResults } from "ratduck-search-mcp/filter";
import { scrapeUrl } from "ratduck-search-mcp/scrape";

const response = await search({ query: "rust async runtime", maxResults: 25 });
const best = topResults(response.results, response.effectiveQuery, 3, { excludeHomepages: true });
const page = await scrapeUrl({ url: best[0].url, format: "markdown", maxChars: 4000 });
```

## Configuration

All optional, all environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATDUCK_TIMEOUT_MS` | `15000` | Per-request timeout. |
| `RATDUCK_MAX_BYTES` | `4000000` | Maximum response body size. |
| `RATDUCK_USER_AGENT` | rotating | Pin a single User-Agent instead of rotating. |
| `RATDUCK_ALLOW_PRIVATE` | unset | Set to `1` to allow scraping loopback/private addresses. Off by default. |

## Safety notes

- **Private-network guard.** `scrape_url` resolves the target host and refuses loopback, RFC1918,
  link-local (including `169.254.169.254`) and CGNAT addresses, so a URL that arrives from a web
  page cannot turn the server into an internal-network probe. Override with `RATDUCK_ALLOW_PRIVATE=1`
  only when you mean it.
- **Everything returned is untrusted.** Search snippets and scraped pages are attacker-controllable
  text. The server declares this in its MCP instructions, but the client is what ultimately has to
  treat tool output as data rather than instructions.
- **Rate limits.** DuckDuckGo challenges bursty traffic. The server detects the challenge page,
  falls back from `html.duckduckgo.com` to `lite.duckduckgo.com`, spaces out paged requests, and
  reports what happened in the result's `notices` instead of failing silently.
- **Be a good citizen.** This scrapes a free service. Keep `maxResults` sane and don't hammer it.

## Development

```bash
npm install
npm test          # unit tests, no network
npm run typecheck
npm run build
npm run test:live # hits DuckDuckGo for real
```

Architecture and contribution notes: [docs/architecture.md](docs/architecture.md),
[docs/contributing.md](docs/contributing.md).

## Releasing

Every push to `main` rebuilds the tarball and redeploys the
[Pages site](https://dixonsolutions.github.io/ratduck-search-mcp/), so the `-latest.tgz` URL always
matches `main`. Bumping `version` in `package.json` additionally tags the commit and cuts a GitHub
Release with the tarball attached — Releases are the permanent home of each version, Pages is the
install surface in front of them. See [docs/release.md](docs/release.md).

## License

MIT — see [LICENSE](LICENSE).
