# Contributing

## Setup

```bash
git clone https://github.com/dixonSolutions/ratduck-search-mcp.git
cd ratduck-search-mcp
npm install
```

npm 12 blocks dependency install scripts by default; `esbuild` (needed by `tsx` to run TypeScript
tests) is pre-approved in the `allowScripts` field of `package.json`. On older npm versions this
field is simply ignored.

## Commands

```bash
npm test          # unit tests, no network — the ones that must always pass
npm run typecheck # tsc --noEmit
npm run build     # emit dist/
npm run dev       # run the server from source over stdio
npm run test:live # hits DuckDuckGo for real; not run in CI
```

## Testing approach

- **Parsers** are tested against saved fixtures in `test/fixtures/`. Adding a case means adding
  markup, not mocking a network layer.
- **Scraping** is tested against a real `node:http` server on `127.0.0.1`, with
  `RATDUCK_ALLOW_PRIVATE=1`. That exercises the actual fetch path, redirects and charset handling.
- **Filtering and ranking** are pure functions, tested directly.
- **The MCP surface** is tested through a real client over `InMemoryTransport`, so tool schemas and
  error handling are checked the way a client would see them.
- **Live tests** are skipped unless `RATDUCK_LIVE=1`.

Anything touching `ddg.ts`'s parsing should come with a fixture. Anything touching ranking should
come with an assertion about ordering, not just about scores.

## When DuckDuckGo changes its markup

That is the expected failure mode of this project. The fix:

1. `npm run test:live` to confirm the breakage is real.
2. Save the current live HTML, diff it against the fixture in `test/fixtures/`.
3. Update the fixture and the selectors in `parseResultsPage` or `parseLitePage`.
4. Keep the old selector alongside the new one where it is cheap to do so — DuckDuckGo has been
   known to serve both.

## Conventions

- TypeScript, strict, ESM, `.js` extensions on relative imports (NodeNext resolution).
- No new runtime dependencies without a good reason. The current three are `@modelcontextprotocol/sdk`,
  `cheerio` and `zod`.
- Comments explain *why*, not *what*. The code says what.
- Tool handlers return errors as results, never throw.
- Any new user-controlled URL path goes through `assertPublicUrl`.

## Pull requests

CI must be green: typecheck, unit tests and build on Node 20/22/24, shellcheck, pack dry-run.
Do not bump the version in a PR — releases happen from `main` (see [release.md](release.md)).

## Reporting bugs

Include the query or URL, what you got, what you expected, and the `notices` field if it was a
search. For parser breakage, attaching the raw HTML is the single most useful thing you can do.
