/**
 * Live network tests. Skipped unless RATDUCK_LIVE=1, because they hit
 * DuckDuckGo for real and are therefore rate-limit-flaky in CI.
 *
 *   npm run test:live
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { search } from "../src/ddg.ts";
import { topResults } from "../src/filter.ts";
import { searchImages, viewImage } from "../src/images.ts";
import { scrapeUrl } from "../src/scrape.ts";

const live = process.env["RATDUCK_LIVE"] === "1";

describe("live DuckDuckGo", { skip: live ? false : "set RATDUCK_LIVE=1 to run" }, () => {
  it("returns results for a common query", async () => {
    const response = await search({ query: "model context protocol specification", maxResults: 10 });
    assert.ok(response.results.length > 0, `no results; notices: ${response.notices.join(", ")}`);
    for (const result of response.results) {
      assert.match(result.url, /^https?:\/\//);
      assert.ok(result.title.length > 0);
    }
  });

  it("honours a site restriction", async () => {
    const response = await search({ query: "streamable http", site: "modelcontextprotocol.io", maxResults: 5 });
    assert.ok(response.results.every((r) => r.domain.endsWith("modelcontextprotocol.io")));
  });

  it("pages past the first result page", async () => {
    const response = await search({ query: "typescript", maxResults: 40, maxPages: 3 });
    assert.ok(response.pagesFetched > 1, "expected more than one page");
    assert.ok(response.results.length > 25);
  });

  it("ranks and scrapes end to end", async () => {
    const response = await search({ query: "duckduckgo html endpoint", maxResults: 20 });
    const top = topResults(response.results, response.effectiveQuery, 3, { excludeHomepages: true });
    assert.ok(top.length > 0);
    const page = await scrapeUrl({ url: top[0]!.url, maxChars: 2000 });
    assert.ok(page.content.length > 0);
  });

  it("returns images for a common query", async () => {
    const response = await searchImages({ query: "red panda", maxResults: 12 });
    assert.ok(response.results.length > 0, `no images; notices: ${response.notices.join(", ")}`);
    for (const image of response.results) {
      assert.match(image.imageUrl, /^https?:\/\//);
      assert.match(image.sourceUrl, /^https?:\/\//);
    }
  });

  it("honours an image size filter", async () => {
    const response = await searchImages({ query: "mountain landscape", maxResults: 8, size: "large" });
    assert.ok(response.results.length > 0);
  });

  it("fetches an image found by image search", async () => {
    const response = await searchImages({ query: "wikipedia logo", maxResults: 5 });
    assert.ok(response.results.length > 0);
    const image = await viewImage({ url: response.results[0]!.thumbnailUrl });
    assert.ok(image.bytes > 0);
    assert.match(image.mimeType, /^image\//);
  });

  it("greps a real page for its assets", async () => {
    const result = await scrapeUrl({
      url: "https://modelcontextprotocol.io/",
      format: "assets",
    });
    assert.ok(result.links.length > 0);
    assert.ok(result.links.some((link) => link.kind === "stylesheet" || link.kind === "script"));
  });

  it("lists the images on a real page", async () => {
    const result = await scrapeUrl({ url: "https://en.wikipedia.org/wiki/Red_panda", format: "images" });
    assert.ok(result.images.length > 0);
    assert.ok(result.images.every((image) => /^https?:\/\//.test(image.url)));
  });
});
