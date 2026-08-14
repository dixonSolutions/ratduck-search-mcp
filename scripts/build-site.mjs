#!/usr/bin/env node
/**
 * Assemble the GitHub Pages site that serves this package.
 *
 * The site is the install surface: a landing page, the tarball for every
 * version ever released, a `-latest.tgz` pointer, a versions.json manifest and
 * a copy of the install script. GitHub Releases remain the source of truth —
 * past tarballs are pulled back from them on every deploy, because a Pages
 * deployment replaces the whole site rather than adding to it.
 *
 * Expects NAME, VERSION and TARBALL in the environment, plus a working `gh`.
 * Run from the repository root.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = process.env.NAME ?? "ratduck-search-mcp";
const VERSION = process.env.VERSION ?? "0.0.0";
const TARBALL = process.env.TARBALL ?? `${NAME}-${VERSION}.tgz`;
const REPO = process.env.GITHUB_REPOSITORY ?? "dixonSolutions/ratduck-search-mcp";
const SITE = "site";

const gh = (args, options = {}) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });

rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });

if (!existsSync(TARBALL)) {
  console.error(`Expected ${TARBALL} in the working directory — did npm pack run?`);
  process.exit(1);
}
copyFileSync(TARBALL, join(SITE, TARBALL));
copyFileSync(TARBALL, join(SITE, `${NAME}-latest.tgz`));
copyFileSync("scripts/install.sh", join(SITE, "install.sh"));

// Pull every previously released tarball back down so old install URLs keep working.
let tags = [];
try {
  tags = JSON.parse(gh(["release", "list", "--limit", "100", "--json", "tagName"]))
    .map((release) => release.tagName)
    .filter((tag) => tag !== `v${VERSION}`);
} catch (error) {
  console.warn(`Could not list releases (${error.message.trim()}); shipping the current version only.`);
}

for (const tag of tags) {
  try {
    gh(["release", "download", tag, "--pattern", "*.tgz", "--dir", SITE, "--clobber"]);
    console.log(`recovered tarball for ${tag}`);
  } catch {
    console.warn(`no tarball asset on ${tag}; skipping`);
  }
}

const versions = readdirSync(SITE)
  .filter((file) => file.endsWith(".tgz") && !file.endsWith("-latest.tgz"))
  .map((file) => file.slice(NAME.length + 1, -".tgz".length))
  .sort(compareVersions)
  .reverse();

const base = `https://${REPO.split("/")[0].toLowerCase()}.github.io/${REPO.split("/")[1]}/`;

writeFileSync(
  join(SITE, "versions.json"),
  `${JSON.stringify(
    {
      name: NAME,
      latest: VERSION,
      base,
      latestTarball: `${base}${NAME}-latest.tgz`,
      versions: versions.map((version) => ({
        version,
        tarball: `${base}${NAME}-${version}.tgz`,
        release: `https://github.com/${REPO}/releases/tag/v${version}`,
      })),
    },
    null,
    2,
  )}\n`,
);

writeFileSync(join(SITE, "index.html"), renderIndex({ base, versions }));
writeFileSync(join(SITE, ".nojekyll"), "");

console.log(`site/ assembled: ${versions.length} version(s), latest ${VERSION}`);

function compareVersions(a, b) {
  const parse = (value) => value.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l === r) continue;
    if (typeof l === "number" && typeof r === "number") return l - r;
    return String(l) < String(r) ? -1 : 1;
  }
  return 0;
}

function renderIndex({ base, versions }) {
  const rows = versions
    .map(
      (version) =>
        `<tr><td><code>${version}</code>${version === VERSION ? ' <span class="tag">latest</span>' : ""}</td>` +
        `<td><a href="${NAME}-${version}.tgz">${NAME}-${version}.tgz</a></td>` +
        `<td><a href="https://github.com/${REPO}/releases/tag/v${version}">release notes</a></td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NAME} — install</title>
<meta name="description" content="MCP server for DuckDuckGo search, URL scraping and result filtering. Installed straight from GitHub Pages, no npm registry.">
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #1a1a1a; --muted: #5a5a5a; --line: #e3e3e3;
    --code-bg: #f6f6f4; --accent: #b8541c;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16161a; --fg: #e8e6e3; --muted: #9b9894; --line: #2c2c32;
            --code-bg: #202027; --accent: #e08b52; }
  }
  * { box-sizing: border-box; }
  body { margin: 0 auto; padding: 3rem 1.25rem 5rem; max-width: 46rem; background: var(--bg); color: var(--fg);
         font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 1.9rem; margin: 0 0 .3rem; letter-spacing: -.02em; }
  h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; letter-spacing: -.01em; }
  p.lede { color: var(--muted); margin: 0 0 2rem; font-size: 1.05rem; }
  pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
        padding: .85rem 1rem; overflow-x: auto; font-size: .875rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  p code, li code, td code { background: var(--code-bg); padding: .1rem .35rem; border-radius: 4px; font-size: .875em; }
  a { color: var(--accent); }
  table { border-collapse: collapse; width: 100%; font-size: .925rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  .tag { background: var(--accent); color: var(--bg); border-radius: 4px; padding: .05rem .35rem;
         font-size: .7rem; vertical-align: middle; }
  footer { margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
           color: var(--muted); font-size: .875rem; }
  ul { padding-left: 1.2rem; }
</style>
</head>
<body>
<h1>${NAME}</h1>
<p class="lede">An MCP server that gives an agent the open web: DuckDuckGo search, URL scraping, and
result filtering and ranking. No API key, no headless browser, and no npm registry — it installs
straight from this page.</p>

<h2>Install</h2>
<pre><code>curl -fsSL ${base}install.sh | bash</code></pre>
<p>Or point npm at the tarball yourself:</p>
<pre><code>npm install -g ${base}${NAME}-latest.tgz</code></pre>

<h2>Use it</h2>
<p>Claude Code:</p>
<pre><code>claude mcp add ratduck -- ratduck-search-mcp</code></pre>
<p>Any client that takes <code>mcpServers</code> JSON:</p>
<pre><code>{
  "mcpServers": {
    "ratduck": {
      "command": "ratduck-search-mcp"
    }
  }
}</code></pre>

<h2>Tools</h2>
<ul>
  <li><code>ddg_search</code> — search DuckDuckGo, with site, region, safe-search and time-range options</li>
  <li><code>ddg_top_results</code> — search, filter and re-rank to the best few, optionally fetching each page</li>
  <li><code>scrape_url</code> — any URL as markdown, text, HTML, links or metadata</li>
  <li><code>filter_results</code> — narrow and re-rank results you already have, offline</li>
</ul>

<h2>Versions</h2>
<table>
<thead><tr><th>Version</th><th>Tarball</th><th>Notes</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p><a href="versions.json">versions.json</a> has the same list, machine-readable.</p>

<footer>
<a href="https://github.com/${REPO}">Source</a> ·
<a href="https://github.com/${REPO}/tree/main/docs">Documentation</a> ·
<a href="https://github.com/${REPO}/blob/main/LICENSE">MIT</a>
</footer>
</body>
</html>
`;
}
