# Release pipeline

This package is **not published to the npm registry**. It is distributed as a tarball from GitHub
Pages, built and deployed by GitHub Actions on every push to `main`. There are no registry
credentials anywhere in the pipeline — the only secret involved is the `GITHUB_TOKEN` that Actions
provides automatically.

## The two surfaces

- **GitHub Releases** are the permanent, immutable record. Each version gets a `v<version>` tag and
  a release with its `.tgz` attached. Nothing ever rewrites them.
- **GitHub Pages** is the install surface: https://dixonsolutions.github.io/ratduck-search-mcp/.
  It is rebuilt from scratch on every deploy, so every past tarball is pulled back down from the
  Releases before deploying. A Pages deployment replaces the site rather than adding to it, which
  is exactly why the Releases have to be the source of truth.

The site contains:

| Path | Contents |
| --- | --- |
| `index.html` | Landing page with install instructions and a version table. |
| `install.sh` | A copy of `scripts/install.sh`, so the curl one-liner is self-hosted. |
| `ratduck-search-mcp-latest.tgz` | The current version, always matching `main`. |
| `ratduck-search-mcp-<version>.tgz` | Every released version at a stable URL. |
| `versions.json` | The same list, machine-readable. |

## How a push to main is handled

`.github/workflows/release.yml`:

1. Read `version` from `package.json` and check whether `v<version>` already has a GitHub Release.
2. `npm ci`, typecheck, test.
3. `npm pack` — which runs `prepack`, so the tarball is built from a clean `dist/`.
4. **If the version is new**: tag the commit, push the tag, and create a GitHub Release with the
   tarball attached.
5. Run `scripts/build-site.mjs`, which assembles `site/`: the fresh tarball, a `-latest.tgz` copy,
   every previously released tarball recovered via `gh release download`, `versions.json`,
   `index.html` and `install.sh`.
6. Deploy `site/` to Pages.

Existing versions are never re-released; a push that does not change the version just redeploys the
site, which keeps `-latest.tgz` in step with `main`.

## Cutting a release

```bash
npm version patch   # or minor / major
git push origin main
```

`npm version` also creates a tag locally. The workflow creates its own annotated tag, so either
delete the local one or push with `git push origin main` only — do not push local tags, or step 4
will fail on a tag that already exists.

If you prefer, edit `version` in `package.json` by hand, commit and push.

## One-time setup

Already done for this repository, listed here for forks:

1. **Enable Pages with Actions as the source.** *Settings → Pages → Build and deployment → Source:
   GitHub Actions*. Or: `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`.
2. Nothing else. The workflow already requests `contents: write` (tags and releases), `pages: write`
   and `id-token: write` (Pages deployment).

Forks also need `BASE_URL` in `scripts/install.sh` and the URLs in the docs pointed at their own
Pages host; `scripts/build-site.mjs` derives its URLs from `GITHUB_REPOSITORY` automatically.

## Why not npm?

A deliberate choice for this project: no registry account, no token to rotate, no name squatting,
and the artifact lives next to its source. The cost is that consumers cannot `npm install
ratduck-search-mcp` by name, do not get semver range resolution, and get no `npm outdated` signal.
For a self-contained MCP server that people install once and point a client at, that trade is fine.

One sharp edge worth knowing: **npm 12 blocks installs from tarball URLs by default**
(`EALLOWREMOTE`). The install script therefore downloads the tarball first and installs from the
local file, which works on every npm version. See [install.md](install.md#option-2--by-hand).

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
`npm pack --dry-run` to confirm the tarball is sane.

Live network tests (`npm run test:live`) are deliberately **not** in CI — they hit DuckDuckGo for
real and would be flaky and impolite. Run them locally when you touch the parsers.
