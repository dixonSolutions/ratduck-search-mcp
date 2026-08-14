# Installing

## Requirements

- Node.js 20 or newer (the package ships plain ESM JavaScript; no build step on your side)
- Network access to `duckduckgo.com` and to whatever you want to scrape

No API keys, accounts or browser downloads.

## Option 1 — the remote install script

```bash
curl -fsSL https://raw.githubusercontent.com/dixonSolutions/ratduck-search-mcp/main/scripts/install.sh | bash
```

It checks your Node version, installs the package globally (falling back to `~/.local` if the
global prefix is not writable), registers the server with the Claude Code CLI when `claude` is on
your PATH, and prints the JSON snippet for every other client.

Environment variables it understands:

| Variable | Effect |
| --- | --- |
| `RATDUCK_VERSION` | Install a specific version instead of `latest`. |
| `RATDUCK_NO_CLAUDE=1` | Do not touch the Claude Code CLI config. |

Piping a script from the internet into `bash` is a trust decision. The script is short and
[readable here](../scripts/install.sh) — read it first if you would rather.

## Option 2 — npm

```bash
npm install -g ratduck-search-mcp
```

## Option 3 — no install at all

Let the MCP client fetch it on demand with `npx -y ratduck-search-mcp`. Slightly slower on first
launch, always current.

## Client configuration

### Claude Code

```bash
claude mcp add ratduck -- npx -y ratduck-search-mcp
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
      "command": "npx",
      "args": ["-y", "ratduck-search-mcp"]
    }
  }
}
```

Restart the app afterwards.

### Any other MCP client

The server speaks MCP over stdio, so the shape is always the same: run the command
`ratduck-search-mcp` (or `npx -y ratduck-search-mcp`) and talk to it on stdin/stdout. Environment
variables from the table below can be passed through the client's `env` block.

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
