# Contributing

Contributions are welcome. The full guide lives in [docs/contributing.md](docs/contributing.md).

The short version:

```bash
npm install
npm test          # must pass, no network needed
npm run typecheck
npm run build
```

- Parser changes need a fixture in `test/fixtures/`.
- Don't bump the version in a PR — releases are cut from `main` (see [docs/release.md](docs/release.md)).
- Be honest in the PR description about what you tested, especially for scraping changes.
