# Release pipeline

Releases are triggered by commits to `main`. There is no release branch, no changelog file to
maintain by hand, and no manual `npm publish`.

## How it works

`.github/workflows/release.yml` runs on every push to `main`:

1. Read `version` from `package.json` and the current published version from npm.
2. If they match, stop. Ordinary commits to `main` cost one cheap job.
3. If they differ: `npm ci`, typecheck, test, build.
4. `npm publish --provenance --access public`.
5. Tag the commit `v<version>` and push the tag.
6. Create a GitHub Release with auto-generated notes from the commits since the last tag.

Comparing against the registry rather than diffing `package.json` means a failed or half-finished
release is fixed by re-running the workflow, and re-pushing an already-published version is a
no-op instead of an error.

## Cutting a release

```bash
npm version patch   # or minor / major — updates package.json and creates a local commit
git push origin main
```

That's it. Watch the Actions tab.

If you prefer not to use `npm version`, just edit the `version` field, commit and push.

## One-time setup

### `NPM_TOKEN`

Create a **Granular Access Token** on npmjs.com with read+write on `ratduck-search-mcp`, then add
it at *Settings → Secrets and variables → Actions → New repository secret* named `NPM_TOKEN`.

Classic automation tokens also work. Granular tokens expire — put a reminder somewhere.

### Provenance

The workflow publishes with `--provenance`, which attaches a signed attestation linking the
package to the exact commit and workflow run that built it. It needs `id-token: write` (already in
the workflow) and a public repository (this one is).

### `GITHUB_TOKEN`

Provided automatically. The workflow requests `contents: write` so it can push the tag and create
the release.

## First publish

The very first run has nothing to compare against — `npm view` fails, the version is recorded as
`none`, and the publish proceeds. If the name is already taken on npm by someone else, the publish
fails with `E403`; rename the package in `package.json` (and the `bin` entry) and push again.

## Versioning

Semver, judged from the consumer's side:

- **patch** — parser fixes, better boilerplate stripping, dependency bumps
- **minor** — new tools, new parameters, new exports
- **major** — renamed or removed tools, changed defaults that alter results, dropped Node versions

Scraper adjustments that keep the same tool surface are patches, even when the internals change a
lot. What matters is what an agent calling the tools would notice.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`: typecheck, unit tests and
build on Node 20, 22 and 24, a smoke test of the built CLI, `shellcheck` on the install script, and
`npm pack --dry-run` to confirm the published tarball is sane.

Live network tests (`npm run test:live`) are deliberately **not** in CI — they hit DuckDuckGo for
real and would be flaky and impolite. Run them locally when you touch the parsers.
