#!/usr/bin/env bash
#
# Remote installer for ratduck-search-mcp.
#
#   curl -fsSL https://raw.githubusercontent.com/dixonSolutions/ratduck-search-mcp/main/scripts/install.sh | bash
#
# Options (environment variables):
#   RATDUCK_VERSION=0.2.0   install a specific version instead of latest
#   RATDUCK_NO_CLAUDE=1     skip registering the server with the Claude Code CLI
#
set -euo pipefail

PACKAGE="ratduck-search-mcp"
VERSION="${RATDUCK_VERSION:-latest}"
MIN_NODE_MAJOR=20

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1" >&2; }
fail() { printf '\033[31m  x %s\033[0m\n' "$1" >&2; exit 1; }

bold "Installing ${PACKAGE}@${VERSION}"

command -v node >/dev/null 2>&1 || fail "node is not installed. Get it from https://nodejs.org (v${MIN_NODE_MAJOR}+)."
command -v npm  >/dev/null 2>&1 || fail "npm is not installed. It ships with Node.js."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  fail "Node ${MIN_NODE_MAJOR}+ is required, found $(node -v)."
fi
info "node $(node -v), npm $(npm -v)"

if npm install -g "${PACKAGE}@${VERSION}"; then
  info "installed globally"
else
  warn "global install failed (permissions?). Retrying with a user prefix."
  PREFIX="${HOME}/.local"
  npm install -g --prefix "${PREFIX}" "${PACKAGE}@${VERSION}" \
    || fail "install failed. Try: sudo npm install -g ${PACKAGE}"
  warn "installed to ${PREFIX}/bin — make sure that directory is on your PATH."
  export PATH="${PREFIX}/bin:${PATH}"
fi

INSTALLED_VERSION="$(ratduck-search-mcp --version 2>/dev/null || echo unknown)"
info "ratduck-search-mcp ${INSTALLED_VERSION}"

if [ "${RATDUCK_NO_CLAUDE:-0}" != "1" ] && command -v claude >/dev/null 2>&1; then
  bold "Registering with Claude Code"
  if claude mcp add ratduck -- ratduck-search-mcp 2>/dev/null; then
    info "added as 'ratduck' — restart Claude Code to pick it up"
  else
    warn "could not add automatically (already registered?). Run this yourself:"
    info "claude mcp add ratduck -- ratduck-search-mcp"
  fi
fi

bold "Done"
cat <<'CONFIG'

  For any MCP client that uses mcpServers JSON, add:

  {
    "mcpServers": {
      "ratduck": {
        "command": "ratduck-search-mcp"
      }
    }
  }

  Tools: ddg_search, ddg_top_results, scrape_url, filter_results
  Docs:  https://github.com/dixonSolutions/ratduck-search-mcp
CONFIG
