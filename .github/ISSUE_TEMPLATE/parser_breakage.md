---
name: Parser breakage
about: DuckDuckGo results stopped parsing
labels: bug, parser
---

**Query used**

**What `notices` said**

**Raw HTML**
Attach the page body, or the relevant fragment. This is the single most useful thing you can
include — the fix is almost always a selector change plus a new fixture.

Grab it with:

```bash
curl -s -A "Mozilla/5.0" "https://html.duckduckgo.com/html/?q=YOUR+QUERY" > page.html
```
