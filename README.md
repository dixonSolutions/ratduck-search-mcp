# ratduck-search-mcp

[![CI](https://github.com/dixonSolutions/ratduck-search-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dixonSolutions/ratduck-search-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ratduck-search-mcp.svg)](https://www.npmjs.com/package/ratduck-search-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that gives an agent the open web: it searches
DuckDuckGo by scraping the no-JavaScript front end, scrapes any URL you point it at, and filters
and re-ranks results so the agent gets the *top* handful instead of a wall of links.

No API keys. No headless browser. No search-provider bill.

## Tools

| Tool | What it does |
| --- | --- |
| `ddg_search` | Search DuckDuckGo. Returns title, URL, domain and snippet per result. Supports `site:` restriction, region, safe search, time range, domain exclusion and paging. |
| `ddg_top_results` | Search, filter, then re-rank by keyword coverage, host authority and engine position, and return the best few. Optionally scrapes each winner's page in the same call. |
| `scrape_url` | Fetch any http(s) URL as markdown, plain text, raw HTML, a link list, or page metadata. Supports CSS selectors and boilerplate stripping. |
| `filter_results` | Narrow and re-rank results you already have — by domain, terms, regex, snippet length, per-domain cap — without spending another request on DuckDuckGo. |

Full parameter reference: [docs/tools.md](docs/tools.md).

## Install

One-liner (installs globally via npm, then prints the client config to paste):

```bash
curl -fsSL https://raw.githubusercontent.com/dixonSolutions/ratduck-search-mcp/main/scripts/install.sh | bash
```

Or the plain npm route:

```bash
npm install -g ratduck-search-mcp
```

Or skip installing entirely and let your MCP client run it via `npx -y ratduck-search-mcp`.

## Wire it into a client

**Claude Code**

```bash
claude mcp add ratduck -- npx -y ratduck-search-mcp
```

**Claude Desktop / any client using `mcpServers` JSON**

```json
{
  "mcpServers": {
    "ratduck": {
      "command": "npx",
      "args": ["-y", "ratduck-search-mcp"]
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

Programmatic use works too, since the package exports its internals:

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

Merging to `main` runs CI. If `package.json`'s `version` differs from what is on npm, the release
workflow publishes the package with provenance, tags the commit `v<version>` and opens a GitHub
Release. Nothing else needs doing — see [docs/release.md](docs/release.md).

## License

MIT — see [LICENSE](LICENSE).
