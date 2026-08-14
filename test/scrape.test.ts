import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { scrapeUrl } from "../src/scrape.ts";

process.env["RATDUCK_ALLOW_PRIVATE"] = "1";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Test Page</title>
  <meta name="description" content="A page for tests." />
  <meta property="og:site_name" content="RatDuck" />
  <link rel="canonical" href="https://example.com/canonical" />
  <script type="application/ld+json">{"@type":"Article","headline":"x"}</script>
  <style>body { color: red }</style>
</head>
<body>
  <nav><a href="/nav-link">Navigation</a></nav>
  <main>
    <h1>Main Heading</h1>
    <p>First paragraph with a <a href="/relative">relative link</a> and <strong>bold</strong> text.</p>
    <h2>Sub heading</h2>
    <ul><li>Item one</li><li>Item two</li></ul>
    <pre><code>const x = 1;</code></pre>
    <blockquote>Quoted line.</blockquote>
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
    <p>A closing paragraph that makes the main element comfortably longer than the two hundred character threshold used to pick the main content region, so the readability heuristic selects it.</p>
    <a href="https://external.example/page">External</a>
    <a href="javascript:alert(1)">Bad</a>
  </main>
  <footer><a href="/footer-link">Footer</a></footer>
  <script>console.log("noise")</script>
</body>
</html>`;

let server: Server;
let origin: string;

before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/plain") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("just text");
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("scrapeUrl", () => {
  it("converts a page to markdown and drops boilerplate", async () => {
    const result = await scrapeUrl({ url: origin });
    assert.equal(result.status, 200);
    assert.equal(result.title, "Test Page");
    assert.equal(result.description, "A page for tests.");
    assert.match(result.content, /^# Main Heading/m);
    assert.match(result.content, /## Sub heading/);
    assert.match(result.content, /- Item one/);
    assert.match(result.content, /```\nconst x = 1;\n```/);
    assert.match(result.content, /> Quoted line\./);
    assert.match(result.content, /\| A \| B \|/);
    assert.match(result.content, /\*\*bold\*\*/);
    assert.equal(result.content.includes("Navigation"), false);
    assert.equal(result.content.includes("Footer"), false);
    assert.equal(result.content.includes("console.log"), false);
  });

  it("absolutizes links inside markdown", async () => {
    const result = await scrapeUrl({ url: origin });
    assert.match(result.content, /\[relative link\]\(http:\/\/127\.0\.0\.1:\d+\/relative\)/);
  });

  it("extracts plain text", async () => {
    const result = await scrapeUrl({ url: origin, format: "text" });
    assert.match(result.content, /Main Heading/);
    assert.equal(result.content.includes("#"), false);
  });

  it("returns raw html", async () => {
    const result = await scrapeUrl({ url: origin, format: "html", readability: false });
    assert.match(result.content, /<h1>Main Heading<\/h1>/);
  });

  it("lists links, resolving relatives and skipping non-http schemes", async () => {
    const result = await scrapeUrl({ url: origin, format: "links" });
    const urls = result.links.map((link) => link.url);
    assert.ok(urls.includes("https://external.example/page"));
    assert.ok(urls.some((url) => url.endsWith("/relative")));
    assert.equal(urls.some((url) => url.startsWith("javascript:")), false);
  });

  it("filters links to the same host on request", async () => {
    const result = await scrapeUrl({ url: origin, format: "links", sameDomainOnly: true });
    assert.equal(result.links.some((link) => link.url.includes("external.example")), false);
  });

  it("extracts metadata including canonical and JSON-LD types", async () => {
    const result = await scrapeUrl({ url: origin, format: "metadata" });
    assert.equal(result.metadata["og:site_name"], "RatDuck");
    assert.equal(result.metadata["canonical"], "https://example.com/canonical");
    assert.equal(result.metadata["jsonLdTypes"], "Article");
    assert.equal(result.metadata["lang"], "en");
  });

  it("honours a CSS selector", async () => {
    const result = await scrapeUrl({ url: origin, selector: "h2" });
    assert.equal(result.content.trim(), "## Sub heading");
  });

  it("errors clearly when a selector matches nothing", async () => {
    await assert.rejects(() => scrapeUrl({ url: origin, selector: ".nope" }), /matched nothing/);
  });

  it("truncates at maxChars", async () => {
    const result = await scrapeUrl({ url: origin, maxChars: 50 });
    assert.equal(result.truncated, true);
    assert.match(result.content, /\[truncated at 50 characters\]$/);
  });

  it("passes non-html bodies through as text", async () => {
    const result = await scrapeUrl({ url: `${origin}/plain` });
    assert.equal(result.format, "text");
    assert.equal(result.content, "just text");
  });

  it("reports the final url after a redirect", async () => {
    const result = await scrapeUrl({ url: `${origin}/redirect` });
    assert.equal(result.finalUrl, `${origin}/`);
  });
});
