# Installing

## Requirements

- Node.js 20 or newer (the package ships plain ESM JavaScript; no build step on your side)
- Network access to `duckduckgo.com` and to whatever you want to scrape

No API keys, accounts or browser downloads.

## Where the package comes from

This package is **not on the npm registry**. It is distributed as a tarball from its GitHub Pages
site, https://dixonsolutions.github.io/ratduck-search-mcp/, which serves:

| URL | What it is |
| --- | --- |
| `…/install.sh` | The install script. |
| `…/ratduck-search-mcp-latest.tgz` | The current version. Always matches `main`. |
| `…/ratduck-search-mcp-<version>.tgz` | Every released version, at a stable URL. |
| `…/versions.json` | Machine-readable list of versions and their URLs. |

Each version is also attached to its [GitHub Release](https://github.com/dixonSolutions/ratduck-search-mcp/releases),
which is the permanent copy — Pages is rebuilt from it on every deploy.

## Option 1 — the install script

```bash
curl -fsSL https://dixonsolutions.github.io/ratduck-search-mcp/install.sh | bash
```

It checks your Node version, downloads the tarball, verifies it is not a truncated error page,
installs it globally (falling back to `~/.local` if the global prefix is not writable), tells you
if the resulting binary is not on your PATH, registers the server with the Claude Code CLI when
`claude` is available, and prints the JSON snippet for every other client.

Environment variables it understands:

| Variable | Effect |
| --- | --- |
| `RATDUCK_VERSION` | Install a specific version, e.g. `0.1.0`, instead of the latest. |
| `RATDUCK_NO_CLAUDE=1` | Do not touch the Claude Code CLI config. |
| `RATDUCK_BASE_URL` | Install from a different host — a fork's Pages site, or a local mirror. |

Piping a script from the internet into `bash` is a trust decision. The script is short and
[readable here](../scripts/install.sh) — read it first if you would rather.

## Option 2 — by hand

```bash
curl -fsSLO https://dixonsolutions.github.io/ratduck-search-mcp/ratduck-search-mcp-latest.tgz
npm install -g ./ratduck-search-mcp-latest.tgz
```

Two steps rather than one on purpose: **npm 12 refuses to install from a tarball URL** unless you
opt in, so `npm install -g https://…tgz` fails with `EALLOWREMOTE`. Downloading first works on
every npm version. If you would rather have the one-liner and are on npm 12+:

```bash
npm install -g --allow-remote=all https://dixonsolutions.github.io/ratduck-search-mcp/ratduck-search-mcp-latest.tgz
```

On npm 11 and older the URL form works without the flag.

## Option 3 — as a project dependency

```bash
npm install ./ratduck-search-mcp-latest.tgz
```

The package exports `ratduck-search-mcp/ddg`, `/scrape` and `/filter` as a plain library, with
types, so you can use the search and scraping pieces without running an MCP server at all.

## Updating

Re-run the install script. It always fetches the current `-latest.tgz`. There is no `npm outdated`
signal for a tarball install, so if you want a notification, watch
[releases](https://github.com/dixonSolutions/ratduck-search-mcp/releases) on GitHub.

## Client configuration

### Claude Code

```bash
claude mcp add ratduck -- ratduck-search-mcp
```

Confirm it registered:

```bash
claude mcp list
```

### Claude Desktop

Edit the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ratduck": {
      "command": "ratduck-search-mcp"
    }
  }
}
```

Restart the app afterwards. If the app cannot find the command, give it the absolute path from
`npm prefix -g`/`bin` — GUI apps often do not inherit the PATH your shell has.

### Any other MCP client

The server speaks MCP over stdio, so the shape is always the same: run the command
`ratduck-search-mcp` (or its absolute path) and talk to it on stdin/stdout. Environment variables
from the table below can be passed through the client's `env` block.

```json
{
  "mcpServers": {
    "ratduck": {
      "command": "ratduck-search-mcp",
      "env": {
        "RATDUCK_TIMEOUT_MS": "20000"
      }
    }
  }
}
```

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATDUCK_TIMEOUT_MS` | `15000` | Per-request timeout in milliseconds. |
| `RATDUCK_MAX_BYTES` | `4000000` | Maximum response body accepted, in bytes. |
| `RATDUCK_USER_AGENT` | rotating | Pin one User-Agent instead of rotating through four. |
| `RATDUCK_ALLOW_PRIVATE` | unset | `1` disables the private-address guard. See [architecture.md](architecture.md#the-private-network-guard). |

## Verifying the install

```bash
ratduck-search-mcp --version
ratduck-search-mcp --help
```

Starting it with no arguments is correct behaviour for an MCP server: it waits on stdin for a
client and prints a single line to stderr. Press Ctrl-C to stop it.

## Uninstalling

```bash
npm uninstall -g ratduck-search-mcp
claude mcp remove ratduck   # if you registered it with Claude Code
```
