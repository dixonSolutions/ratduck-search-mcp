import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { viewImage } from "../src/images.ts";
import { createServer as createMcpServer } from "../src/server.ts";

process.env["RATDUCK_ALLOW_PRIVATE"] = "1";

/** A 1x1 GIF is the smallest real image to serve. */
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const PAGE = `<!DOCTYPE html>
<html><head><title>Gallery</title><link rel="icon" href="/favicon.ico" /></head>
<body>
  <img src="/img/photo.png" alt="A photo" width="400" height="300" />
  <a href="/files/report.pdf">Report</a>
  <a href="https://external.example/">Elsewhere</a>
  <script src="/js/app.js"></script>
</body></html>`;

let server: Server;
let origin: string;
let lastHeaders: Record<string, string | string[] | undefined> = {};

before(async () => {
  server = createServer((request, response) => {
    lastHeaders = request.headers;
    if (request.url === "/page") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGE);
      return;
    }
    if (request.url === "/not-an-image") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>nope</body></html>");
      return;
    }
    if (request.url === "/missing") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("gone");
      return;
    }
    if (request.url === "/untyped") {
      // No content-type at all: the sniffed header has to carry the decision.
      response.writeHead(200);
      response.end(GIF);
      return;
    }
    response.writeHead(200, { "content-type": "image/gif" });
    response.end(GIF);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("viewImage", () => {
  it("returns the image base64-encoded with its real dimensions", async () => {
    const image = await viewImage({ url: `${origin}/pixel.gif` });
    assert.equal(image.status, 200);
    assert.equal(image.mimeType, "image/gif");
    assert.equal(image.format, "gif");
    assert.equal(image.width, 1);
    assert.equal(image.height, 1);
    assert.equal(image.bytes, GIF.byteLength);
    assert.equal(Buffer.from(image.data, "base64").equals(GIF), true);
  });

  it("accepts an image the server did not label, using the sniffed format", async () => {
    const image = await viewImage({ url: `${origin}/untyped` });
    assert.equal(image.mimeType, "image/gif");
    assert.equal(image.format, "gif");
  });

  it("refuses a response that is not an image", async () => {
    await assert.rejects(() => viewImage({ url: `${origin}/not-an-image` }), /not an image/);
  });

  it("surfaces an upstream error status", async () => {
    await assert.rejects(() => viewImage({ url: `${origin}/missing` }), /returned 404/);
  });

  it("refuses anything over maxBytes", async () => {
    await assert.rejects(() => viewImage({ url: `${origin}/pixel.gif`, maxBytes: 10 }), /over the 10 byte limit/);
  });

  it("sends a referer when one is given", async () => {
    await viewImage({ url: `${origin}/pixel.gif`, referer: "https://example.com/gallery" });
    assert.equal(lastHeaders["referer"], "https://example.com/gallery");
  });
});

describe("view_image over MCP", () => {
  it("hands the client an image content block, not a link to one", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      name: "view_image",
      arguments: { url: `${origin}/pixel.gif` },
    });
    const content = response.content as Array<Record<string, string>>;
    assert.equal(content[0]?.type, "text");
    assert.match(content[0]?.text ?? "", /image\/gif · 1x1/);
    assert.equal(content[1]?.type, "image");
    assert.equal(content[1]?.mimeType, "image/gif");
    assert.equal(Buffer.from(content[1]?.data ?? "", "base64").equals(GIF), true);

    await client.close();
  });

  it("lists a local page's images and greps its assets over MCP", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const images = await client.callTool({ name: "page_images", arguments: { url: `${origin}/page` } });
    const imageText = (images.content as Array<{ text: string }>)[0]!.text;
    assert.match(imageText, /2 image\(s\)/);
    assert.match(imageText, /alt: A photo/);

    const grep = await client.callTool({
      name: "grep_links",
      arguments: { url: `${origin}/page`, extensions: ["pdf"] },
    });
    const grepText = (grep.content as Array<{ text: string }>)[0]!.text;
    assert.match(grepText, /1 link\(s\) matched/);
    assert.match(grepText, /\[document\].*report\.pdf/);

    await client.close();
  });
});
