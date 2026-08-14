#!/usr/bin/env bash
#
# Remote installer for ratduck-search-mcp.
#
#   curl -fsSL https://dixonsolutions.github.io/ratduck-search-mcp/install.sh | bash
#
# The package is not on the npm registry. It is distributed as a tarball from
# GitHub Pages, which npm can install from directly.
#
# Options (environment variables):
#   RATDUCK_VERSION=0.2.0   install a specific version instead of the latest
#   RATDUCK_NO_CLAUDE=1     skip registering the server with the Claude Code CLI
#
set -euo pipefail

PACKAGE="ratduck-search-mcp"
BASE_URL="${RATDUCK_BASE_URL:-https://dixonsolutions.github.io/ratduck-search-mcp}"
MIN_NODE_MAJOR=20

if [ -n "${RATDUCK_VERSION:-}" ]; then
  TARBALL_URL="${BASE_URL}/${PACKAGE}-${RATDUCK_VERSION}.tgz"
  LABEL="${RATDUCK_VERSION}"
else
  TARBALL_URL="${BASE_URL}/${PACKAGE}-latest.tgz"
  LABEL="latest"
fi

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1" >&2; }
fail() { printf '\033[31m  x %s\033[0m\n' "$1" >&2; exit 1; }

bold "Installing ${PACKAGE} (${LABEL})"
info "source: ${TARBALL_URL}"

command -v node >/dev/null 2>&1 || fail "node is not installed. Get it from https://nodejs.org (v${MIN_NODE_MAJOR}+)."
command -v npm  >/dev/null 2>&1 || fail "npm is not installed. It ships with Node.js."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  fail "Node ${MIN_NODE_MAJOR}+ is required, found $(node -v)."
fi
info "node $(node -v), npm $(npm -v)"

# Download first, then install from the local file. npm 12 refuses to fetch
# tarball URLs unless allow-remote is set, and a local path sidesteps that
# without asking anyone to loosen their npm config.
TMPDIR_RATDUCK="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_RATDUCK}"' EXIT
TARBALL_FILE="${TMPDIR_RATDUCK}/${PACKAGE}.tgz"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "${TARBALL_URL}" -o "${TARBALL_FILE}" \
    || fail "could not download ${TARBALL_URL}. Check the version, or see ${BASE_URL} for what exists."
elif command -v wget >/dev/null 2>&1; then
  wget -qO "${TARBALL_FILE}" "${TARBALL_URL}" \
    || fail "could not download ${TARBALL_URL}. Check the version, or see ${BASE_URL} for what exists."
else
  fail "neither curl nor wget is available to download the tarball."
fi

SIZE="$(wc -c < "${TARBALL_FILE}")"
[ "${SIZE}" -gt 1000 ] || fail "downloaded file is only ${SIZE} bytes — that is not the tarball."
info "downloaded ${SIZE} bytes"

if npm install -g "${TARBALL_FILE}"; then
  info "installed globally"
else
  warn "global install failed (permissions?). Retrying with a user prefix."
  PREFIX="${HOME}/.local"
  npm install -g --prefix "${PREFIX}" "${TARBALL_FILE}" \
    || fail "install failed. Try: sudo npm install -g ${TARBALL_FILE}"
  warn "installed to ${PREFIX}/bin — make sure that directory is on your PATH."
  export PATH="${PREFIX}/bin:${PATH}"
fi

if command -v ratduck-search-mcp >/dev/null 2>&1; then
  info "ratduck-search-mcp $(ratduck-search-mcp --version 2>/dev/null || echo '(installed)')"
else
  BIN_DIR="$(npm prefix -g 2>/dev/null)/bin"
  warn "installed, but 'ratduck-search-mcp' is not on your PATH."
  info "add this to your shell profile:  export PATH=\"${BIN_DIR}:\$PATH\""
  info "or use the full path in your MCP client config: ${BIN_DIR}/ratduck-search-mcp"
fi

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
