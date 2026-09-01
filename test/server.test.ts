import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

async function connectedClient(): Promise<Client> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("MCP server", () => {
  it("exposes the eight documented tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        "ddg_images",
        "ddg_search",
        "ddg_top_results",
        "filter_results",
        "grep_links",
        "page_images",
        "scrape_url",
        "view_image",
      ],
    );
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
      assert.equal(tool.inputSchema.type, "object");
    }
    await client.close();
  });

  it("filters results locally without touching the network", async () => {
    const client = await connectedClient();
    const response = await client.callTool({
      name: "filter_results",
      arguments: {
        query: "tokio async",
        results: [
          { rank: 1, title: "Pinterest", url: "https://pinterest.com/", domain: "pinterest.com", snippet: "" },
          {
            rank: 2,
            title: "Tokio async runtime",
            url: "https://tokio.rs/",
            domain: "tokio.rs",
            snippet: "async runtime",
          },
        ],
        excludeDomains: ["pinterest.com"],
      },
    });
    const text = (response.content as Array<{ type: string; text: string }>)[0]!.text;
    assert.match(text, /2 in → 1 out/);
    assert.match(text, /tokio\.rs/);
    assert.equal(text.includes("pinterest"), false);
    await client.close();
  });

  it("declares the image tools with the arguments they document", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const images = tools.find((tool) => tool.name === "ddg_images");
    const view = tools.find((tool) => tool.name === "view_image");
    const grep = tools.find((tool) => tool.name === "grep_links");
    assert.ok(images?.inputSchema.properties && "size" in images.inputSchema.properties);
    assert.ok(view?.inputSchema.properties && "referer" in view.inputSchema.properties);
    assert.ok(grep?.inputSchema.properties && "kinds" in grep.inputSchema.properties);
    await client.close();
  });

  it("applies the private-network guard to image fetches too", async () => {
    const client = await connectedClient();
    const response = await client.callTool({
      name: "view_image",
      arguments: { url: "http://169.254.169.254/latest/meta-data/photo.png" },
    });
    assert.equal(response.isError, true);
    const text = (response.content as Array<{ type: string; text: string }>)[0]!.text;
    assert.match(text, /Refusing to fetch private address/);
    await client.close();
  });

  it("reports a tool error instead of throwing when a URL is refused", async () => {
    const client = await connectedClient();
    const response = await client.callTool({
      name: "scrape_url",
      arguments: { url: "http://169.254.169.254/latest/meta-data/" },
    });
    assert.equal(response.isError, true);
    const text = (response.content as Array<{ type: string; text: string }>)[0]!.text;
    assert.match(text, /Refusing to fetch private address/);
    await client.close();
  });
});
