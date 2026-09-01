import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cheerio from "cheerio";
import {
  classifyLink,
  extensionOf,
  extractPageImages,
  grepLinks,
  harvestLinks,
  parseCssUrls,
  parseSrcset,
} from "../src/links.ts";

const BASE = "https://example.com/docs/page.html";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Assets</title>
  <link rel="stylesheet" href="/css/site.css" />
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
  <meta property="og:image" content="https://cdn.example.net/card.png" />
  <meta property="og:image:width" content="1200" />
  <script src="https://cdn.jsdelivr.net/npm/lib@1/lib.min.js"></script>
  <style>.hero { background-image: url("/img/hero.jpg"); } .x { background: url(/img/ignore.css); }</style>
</head>
<body>
  <a href="/docs/guide">Guide</a>
  <a href="https://other.example/post" rel="noopener">Other site</a>
  <a href="/files/report.pdf">The report (PDF)</a>
  <a href="mailto:hi@example.com">Mail</a>
  <a href="#section">Anchor</a>
  <figure>
    <img src="/img/photo.jpg" width="800" height="600" alt="A photo" srcset="/img/photo@2x.jpg 2x, /img/photo@3x.jpg 3x" />
    <figcaption>Caption text</figcaption>
  </figure>
  <img data-src="/img/lazy.png" alt="" />
  <picture>
    <source srcset="/img/wide.avif" type="image/avif" />
    <img src="/img/wide.jpg" alt="Wide" />
  </picture>
  <video poster="/img/poster.jpg" src="/media/clip.mp4"></video>
  <div style="background-image: url('/img/bg.webp')"></div>
  <a href="https://cdn.example.net/font/Inter.woff2">Font</a>
  <iframe src="https://player.example/embed/1" title="Player"></iframe>
</body>
</html>`;

const $ = cheerio.load(PAGE);
const all = harvestLinks($, BASE);
const urls = all.map((link) => link.url);
const byUrl = (needle: string) => all.find((link) => link.url.includes(needle));

describe("extensionOf", () => {
  it("reads the extension off the last path segment", () => {
    assert.equal(extensionOf("https://a.example/x/y/report.PDF?v=2"), "pdf");
    assert.equal(extensionOf("https://a.example/x/y/"), "");
    assert.equal(extensionOf("https://a.example/v1.2/download"), "");
    assert.equal(extensionOf("not a url"), "");
  });
});

describe("parseSrcset", () => {
  it("keeps the URLs and drops the descriptors", () => {
    assert.deepEqual(parseSrcset("a.png 1x, b.png 2x"), ["a.png", "b.png"]);
    assert.deepEqual(parseSrcset("  solo.png  "), ["solo.png"]);
    assert.deepEqual(parseSrcset(""), []);
  });
});

describe("parseCssUrls", () => {
  it("pulls url() targets and skips data URIs", () => {
    assert.deepEqual(
      parseCssUrls(`a{background:url("x.png")} b{background:url(y.gif)} c{background:url(data:image/gif;base64,AA)}`),
      ["x.png", "y.gif"],
    );
  });
});

describe("classifyLink", () => {
  it("trusts the element over the extension", () => {
    assert.equal(classifyLink("https://a.example/image", { tag: "img" }), "image");
    assert.equal(classifyLink("https://a.example/bundle", { tag: "script" }), "script");
    assert.equal(classifyLink("https://a.example/x", { tag: "link", rel: "stylesheet" }), "stylesheet");
  });

  it("falls back to the extension", () => {
    assert.equal(classifyLink("https://a.example/a.pdf", { tag: "a" }), "document");
    assert.equal(classifyLink("https://a.example/a.zip", { tag: "a" }), "archive");
    assert.equal(classifyLink("https://a.example/a.woff2", { tag: "a" }), "font");
    assert.equal(classifyLink("https://a.example/a.mp4", { tag: "a" }), "media");
    assert.equal(classifyLink("https://a.example/a.json", { tag: "a" }), "data");
    assert.equal(classifyLink("https://a.example/page", { tag: "a" }), "page");
  });

  it("reads the type attribute for feeds", () => {
    assert.equal(
      classifyLink("https://a.example/feed.xml", { tag: "link", rel: "alternate", type: "application/rss+xml" }),
      "feed",
    );
  });
});

describe("harvestLinks", () => {
  it("collects anchors, assets and CSS urls, resolving relatives", () => {
    assert.ok(urls.includes("https://example.com/docs/guide"));
    assert.ok(urls.includes("https://example.com/css/site.css"));
    assert.ok(urls.includes("https://cdn.jsdelivr.net/npm/lib@1/lib.min.js"));
    assert.ok(urls.includes("https://example.com/img/photo@2x.jpg"));
    assert.ok(urls.includes("https://example.com/img/hero.jpg"));
    assert.ok(urls.includes("https://example.com/img/bg.webp"));
    assert.ok(urls.includes("https://cdn.example.net/card.png"));
    assert.ok(urls.includes("https://player.example/embed/1"));
  });

  it("drops non-http schemes and bare fragments", () => {
    assert.equal(urls.some((url) => url.startsWith("mailto:")), false);
    assert.equal(urls.some((url) => url.endsWith("#section")), false);
  });

  it("marks internal versus external by the page's own host", () => {
    assert.equal(byUrl("/docs/guide")?.internal, true);
    assert.equal(byUrl("other.example/post")?.internal, false);
    assert.equal(byUrl("other.example/post")?.domain, "other.example");
  });

  it("records where each URL was found", () => {
    assert.equal(byUrl("lib.min.js")?.origin, "script[src]");
    assert.equal(byUrl("/img/hero.jpg")?.origin, "css url()");
    assert.equal(byUrl("card.png")?.origin, "meta[og:image]");
    assert.equal(byUrl("other.example/post")?.rel, "noopener");
  });

  it("keeps anchor text for anchors and alt text for images", () => {
    assert.equal(byUrl("report.pdf")?.text, "The report (PDF)");
    assert.equal(byUrl("/img/photo.jpg")?.text, "A photo");
  });

  it("classifies what it finds", () => {
    assert.equal(byUrl("report.pdf")?.kind, "document");
    assert.equal(byUrl("site.css")?.kind, "stylesheet");
    assert.equal(byUrl("Inter.woff2")?.kind, "font");
    assert.equal(byUrl("clip.mp4")?.kind, "media");
    assert.equal(byUrl("feed.xml")?.kind, "feed");
    assert.equal(byUrl("favicon.ico")?.kind, "image");
    assert.equal(byUrl("/docs/guide")?.kind, "page");
  });

  it("can restrict to anchors or to assets", () => {
    const anchors = harvestLinks($, BASE, { anchorsOnly: true });
    assert.ok(anchors.every((link) => link.origin.startsWith("a[")));
    assert.ok(anchors.some((link) => link.url.endsWith("report.pdf")));

    const assets = harvestLinks($, BASE, { assetsOnly: true });
    assert.equal(assets.some((link) => link.origin.startsWith("a[")), false);
    assert.ok(assets.some((link) => link.url.endsWith("site.css")));
  });
});

describe("grepLinks", () => {
  it("filters by regex over url and text", () => {
    const hits = grepLinks(all, { pattern: "report" });
    assert.deepEqual(hits.map((link) => link.url), ["https://example.com/files/report.pdf"]);
  });

  it("can match on text alone", () => {
    assert.equal(grepLinks(all, { pattern: "Guide", matchOn: "text" }).length, 1);
    assert.equal(grepLinks(all, { pattern: "docs/guide", matchOn: "text" }).length, 0);
  });

  it("inverts like grep -v", () => {
    const kept = grepLinks(all, { pattern: "example\\.com", matchOn: "url", invert: true });
    assert.equal(kept.some((link) => link.domain === "example.com"), false);
    assert.ok(kept.length > 0);
  });

  it("filters by kind and extension", () => {
    assert.ok(grepLinks(all, { kinds: ["image"] }).every((link) => link.kind === "image"));
    const woff = grepLinks(all, { extensions: [".woff2"] });
    assert.deepEqual(woff.map((link) => link.ext), ["woff2"]);
  });

  it("filters by internal / external scope and by host", () => {
    assert.ok(grepLinks(all, { scope: "external" }).every((link) => !link.internal));
    assert.ok(grepLinks(all, { scope: "internal" }).every((link) => link.internal));
    const cdn = grepLinks(all, { includeDomains: ["example.net"] });
    assert.ok(cdn.length > 0);
    assert.ok(cdn.every((link) => link.domain.endsWith("example.net")));
  });

  it("de-duplicates by URL and honours limit", () => {
    const duplicated = [...all, ...all];
    assert.equal(grepLinks(duplicated, { pattern: "report" }).length, 1);
    assert.equal(grepLinks(duplicated, { pattern: "report", unique: false }).length, 2);
    assert.equal(grepLinks(all, { limit: 3 }).length, 3);
  });

  it("rejects an invalid regex with a clear message", () => {
    assert.throws(() => grepLinks(all, { pattern: "([" }), /Invalid pattern/);
  });
});

describe("extractPageImages", () => {
  const images = extractPageImages($, BASE);
  const image = (needle: string) => images.find((item) => item.url.includes(needle));

  it("finds img, srcset, picture, poster, meta, icon and background images", () => {
    assert.ok(image("/img/photo.jpg"));
    assert.ok(image("/img/photo@3x.jpg"));
    assert.ok(image("/img/lazy.png"));
    assert.ok(image("/img/wide.avif"));
    assert.ok(image("/img/poster.jpg"));
    assert.ok(image("card.png"));
    assert.ok(image("favicon.ico"));
    assert.ok(image("/img/bg.webp"));
    assert.ok(image("/img/hero.jpg"));
  });

  it("skips CSS url() targets that are not images", () => {
    assert.equal(image("/img/ignore.css"), undefined);
  });

  it("carries alt text, declared size and origin", () => {
    assert.equal(image("/img/photo.jpg")?.alt, "A photo");
    assert.equal(image("/img/photo.jpg")?.width, 800);
    assert.equal(image("/img/photo.jpg")?.height, 600);
    assert.equal(image("/img/photo.jpg")?.origin, "img[src]");
    assert.equal(image("/img/bg.webp")?.origin, "css background");
  });

  it("falls back to a figcaption when there is no alt", () => {
    assert.equal(image("/img/photo@2x.jpg")?.alt, "A photo");
    assert.equal(image("/img/lazy.png")?.alt, "");
  });

  it("reads icon sizes off the link element", () => {
    assert.equal(image("favicon.ico")?.width, 32);
  });

  it("filters by host, icons, backgrounds, size and pattern", () => {
    assert.ok(extractPageImages($, BASE, { sameDomainOnly: true }).every((item) => item.internal));
    assert.equal(
      extractPageImages($, BASE, { excludeIcons: true }).some((item) => item.url.includes("favicon")),
      false,
    );
    assert.equal(
      extractPageImages($, BASE, { excludeBackgrounds: true }).some((item) => item.origin === "css background"),
      false,
    );
    // Images with no declared size survive a min-size filter; the small icon does not.
    const large = extractPageImages($, BASE, { minWidth: 100 });
    assert.equal(large.some((item) => item.url.includes("favicon")), false);
    assert.ok(large.some((item) => item.url.includes("/img/photo.jpg")));
    assert.deepEqual(
      extractPageImages($, BASE, { pattern: "poster" }).map((item) => item.url),
      ["https://example.com/img/poster.jpg"],
    );
  });

  it("caps the list on request", () => {
    assert.equal(extractPageImages($, BASE, { limit: 2 }).length, 2);
  });
});
