# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/dixonSolutions/ratduck-search-mcp/security/advisories/new)
rather than opening a public issue. Expect an initial response within a few days.

## Threat model, briefly

This server fetches URLs and returns web content to an AI agent. Two things follow from that:

**Server-side request forgery.** URLs reaching `scrape_url` may originate from search results or
from the content of another page — that is, from strangers. Every target is therefore resolved and
checked against loopback, RFC1918, link-local (including the `169.254.169.254` cloud metadata
address), CGNAT and reserved ranges before any request is made, for both literal IPs and hostnames
that resolve into those ranges. `RATDUCK_ALLOW_PRIVATE=1` disables this and should only be set for
local development.

**Prompt injection.** Everything this server returns — titles, snippets, page text — is written by
whoever controls the site. A page can contain text shaped like an instruction to the agent. The
server labels its output as untrusted in its MCP instructions, but it cannot enforce that; the
client is responsible for treating tool results as data. If you are building on this, do not give
an agent both this server and irreversible capabilities without a human in the loop.

Other measures: response bodies are size-capped before decoding, requests time out, only http and
https schemes are accepted, and redirects are followed by `fetch` with the final URL reported back
so the caller can see where it actually landed.

## Supported versions

The latest published version. Fixes go out as a new release rather than as backports.
