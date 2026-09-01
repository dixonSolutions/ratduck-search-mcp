import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { buildImageFilters, extractVqd, imageInfo, parseImagePayload } from "../src/images.ts";

describe("extractVqd", () => {
  it("reads the token out of a quoted assignment", () => {
    assert.equal(extractVqd(`<script>var x={vqd="4-123456789012345678901234567890"};</script>`), "4-123456789012345678901234567890");
  });

  it("reads it out of a JSON blob", () => {
    assert.equal(extractVqd(`{"a":1,"vqd": "4-98765","b":2}`), "4-98765");
  });

  it("reads it out of a query string", () => {
    assert.equal(extractVqd(`<a href="/i.js?q=cats&vqd=4-55555&o=json">x</a>`), "4-55555");
  });

  it("returns null when the page carries no token", () => {
    assert.equal(extractVqd("<html><body>rate limited</body></html>"), null);
  });
});

describe("buildImageFilters", () => {
  it("is six empty slots when nothing is asked for", () => {
    assert.equal(buildImageFilters({ query: "x" }), ",,,,,");
  });

  it("puts each filter in its own slot", () => {
    assert.equal(
      buildImageFilters({
        query: "x",
        timeRange: "week",
        size: "large",
        color: "red",
        type: "photo",
        layout: "wide",
        license: "shareCommercially",
      }),
      "Week,size:Large,color:red,type:photo,layout:Wide,license:ShareCommercially",
    );
  });

  it("spells the two special colour values the way the engine does", () => {
    assert.equal(buildImageFilters({ query: "x", color: "monochrome" }), ",,color:Monochrome,,,");
    assert.equal(buildImageFilters({ query: "x", color: "color" }), ",,color:color,,,");
  });

  it("treats 'any' as unset", () => {
    assert.equal(buildImageFilters({ query: "x", size: "any", type: "any", timeRange: "any" }), ",,,,,");
  });
});

describe("parseImagePayload", () => {
  const payload = JSON.stringify({
    results: [
      {
        title: "A red  panda",
        image: "https://cdn.example.net/panda.JPG?w=900",
        thumbnail: "https://external-content.duckduckgo.com/iu/?u=panda",
        url: "https://www.zoo.example/animals/panda",
        width: 1200,
        height: "800",
        source: "Bing",
      },
      { title: "no image url", image: "", url: "https://x.example/" },
      { title: "not http", image: "data:image/gif;base64,AA", url: "https://x.example/" },
    ],
    next: "i.js?q=panda&s=100&vqd=4-1",
  });

  it("maps the engine's fields onto ImageResult", () => {
    const page = parseImagePayload(payload);
    assert.equal(page.blocked, false);
    assert.equal(page.results.length, 1);
    const [image] = page.results;
    assert.equal(image?.title, "A red panda");
    assert.equal(image?.imageUrl, "https://cdn.example.net/panda.JPG?w=900");
    assert.equal(image?.sourceUrl, "https://www.zoo.example/animals/panda");
    assert.equal(image?.domain, "zoo.example");
    assert.equal(image?.width, 1200);
    assert.equal(image?.height, 800);
    assert.equal(image?.ext, "jpg");
    assert.equal(image?.provider, "Bing");
  });

  it("reads the next page's offset", () => {
    assert.equal(parseImagePayload(payload).next, "100");
    assert.equal(parseImagePayload(`{"results":[],"next":"i.js?q=x"}`).next, null);
  });

  it("reports a non-JSON body as blocked rather than throwing", () => {
    const page = parseImagePayload("<html>anomaly</html>");
    assert.equal(page.blocked, true);
    assert.deepEqual(page.results, []);
  });

  it("reports JSON without a results array as blocked", () => {
    assert.equal(parseImagePayload(`{"error":"rate limited"}`).blocked, true);
  });
});

describe("imageInfo", () => {
  it("reads PNG dimensions", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    assert.deepEqual(imageInfo(png), { format: "png", width: 640, height: 480 });
  });

  it("reads GIF dimensions", () => {
    const gif = Buffer.alloc(13);
    gif.write("GIF89a", 0, "ascii");
    gif.writeUInt16LE(300, 6);
    gif.writeUInt16LE(200, 8);
    assert.deepEqual(imageInfo(gif), { format: "gif", width: 300, height: 200 });
  });

  it("reads JPEG dimensions from the start-of-frame marker", () => {
    const jpeg = Buffer.alloc(40);
    jpeg.writeUInt16BE(0xffd8, 0);
    // An APP0 segment first, so the scan has to walk past something.
    jpeg.writeUInt16BE(0xffe0, 2);
    jpeg.writeUInt16BE(6, 4);
    jpeg.writeUInt16BE(0xffc0, 10);
    jpeg.writeUInt16BE(17, 12);
    jpeg.writeUInt8(8, 14);
    jpeg.writeUInt16BE(768, 15);
    jpeg.writeUInt16BE(1024, 17);
    assert.deepEqual(imageInfo(jpeg), { format: "jpeg", width: 1024, height: 768 });
  });

  it("reads WebP VP8X dimensions", () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii");
    webp.writeUIntLE(1919, 24, 3);
    webp.writeUIntLE(1079, 27, 3);
    assert.deepEqual(imageInfo(webp), { format: "webp", width: 1920, height: 1080 });
  });

  it("reads SVG dimensions, falling back to the viewBox", () => {
    assert.deepEqual(imageInfo(Buffer.from(`<svg width="120" height="60" xmlns="x"></svg>`)), {
      format: "svg",
      width: 120,
      height: 60,
    });
    assert.deepEqual(imageInfo(Buffer.from(`<?xml version="1.0"?><svg viewBox="0 0 24 24"></svg>`)), {
      format: "svg",
      width: 24,
      height: 24,
    });
  });

  it("says so rather than guessing when the format is unknown", () => {
    assert.deepEqual(imageInfo(Buffer.from("not an image at all")), {
      format: "unknown",
      width: null,
      height: null,
    });
  });
});
