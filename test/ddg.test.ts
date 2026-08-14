import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildEffectiveQuery,
  domainOf,
  parseLitePage,
  parseResultsPage,
  unwrapDdgUrl,
} from "../src/ddg.ts";

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const fixture = read("ddg-results.html");
const liteFixture = read("ddg-lite.html");

describe("unwrapDdgUrl", () => {
  it("unwraps organic redirect links", () => {
    assert.equal(
      unwrapDdgUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Ftokio.rs%2F&rut=x"),
      "https://tokio.rs/",
    );
  });

  it("unwraps sponsored y.js links", () => {
    assert.equal(
      unwrapDdgUrl("//duckduckgo.com/y.js?ad_provider=x&u3=https%3A%2F%2Fsponsor.example%2F"),
      "https://sponsor.example/",
    );
  });

  it("passes through direct absolute links", () => {
    assert.equal(unwrapDdgUrl("https://example.com/a"), "https://example.com/a");
  });

  it("rejects junk and non-http schemes", () => {
    assert.equal(unwrapDdgUrl(""), null);
    assert.equal(unwrapDdgUrl("javascript:alert(1)"), null);
    assert.equal(unwrapDdgUrl("//duckduckgo.com/l/?rut=nope"), null);
  });
});

describe("domainOf", () => {
  it("strips www and lowercases", () => {
    assert.equal(domainOf("https://WWW.Example.COM/x"), "example.com");
  });

  it("returns an empty string for junk", () => {
    assert.equal(domainOf("not a url"), "");
  });
});

describe("buildEffectiveQuery", () => {
  it("appends a site operator", () => {
    assert.equal(buildEffectiveQuery("tokio", "docs.rs"), "tokio site:docs.rs");
  });

  it("normalizes a full URL into a host", () => {
    assert.equal(buildEffectiveQuery("tokio", "https://docs.rs/tokio"), "tokio site:docs.rs");
  });

  it("does not double up an existing site operator", () => {
    assert.equal(buildEffectiveQuery("tokio site:docs.rs", "docs.rs"), "tokio site:docs.rs");
  });

  it("is a no-op without a site", () => {
    assert.equal(buildEffectiveQuery("  tokio  "), "tokio");
  });
});

describe("parseResultsPage", () => {
  const parsed = parseResultsPage(fixture);

  it("extracts every result including the ad", () => {
    assert.equal(parsed.results.length, 4);
  });

  it("flags advertisements", () => {
    assert.equal(parsed.results[0]?.isAd, true);
    assert.equal(parsed.results[1]?.isAd, undefined);
  });

  it("resolves titles, urls, domains and snippets", () => {
    const tokio = parsed.results[1]!;
    assert.equal(tokio.title, "Tokio Tutorial");
    assert.equal(tokio.url, "https://tokio.rs/tokio/tutorial");
    assert.equal(tokio.domain, "tokio.rs");
    assert.match(tokio.snippet, /asynchronous runtime for the Rust/);
  });

  it("strips www from domains", () => {
    assert.equal(parsed.results[3]?.domain, "tokio.rs");
  });

  it("captures the next-page form fields", () => {
    assert.equal(parsed.nextForm?.["s"], "23");
    assert.equal(parsed.nextForm?.["dc"], "24");
  });

  it("does not report a block or empty page", () => {
    assert.equal(parsed.blocked, false);
    assert.equal(parsed.empty, false);
  });

  it("detects an anomaly page", () => {
    const blocked = parseResultsPage(
      "<html><body><div>Our systems have detected unusual traffic from your computer network.</div></body></html>",
    );
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.results.length, 0);
  });

  it("detects an empty result page", () => {
    const empty = parseResultsPage('<html><body><div class="no-results">No results.</div></body></html>');
    assert.equal(empty.empty, true);
  });

  it("detects the anomaly modal served by the live endpoints", () => {
    const challenged = parseResultsPage(
      '<html><body><form id="challenge-form" action="//duckduckgo.com/anomaly.js"></form></body></html>',
    );
    assert.equal(challenged.blocked, true);
  });
});

describe("parseLitePage", () => {
  const parsed = parseLitePage(liteFixture);

  it("extracts results from the lite table layout", () => {
    assert.equal(parsed.results.length, 2);
    assert.equal(parsed.results[0]?.title, "Tokio Tutorial");
    assert.equal(parsed.results[0]?.url, "https://tokio.rs/tokio/tutorial");
    assert.equal(parsed.results[0]?.domain, "tokio.rs");
    assert.match(parsed.results[0]?.snippet ?? "", /asynchronous runtime/);
  });

  it("pairs each result with its own snippet", () => {
    assert.match(parsed.results[1]?.snippet ?? "", /API documentation/);
  });

  it("captures the next-page form and ignores the submit button", () => {
    assert.equal(parsed.nextForm?.["s"], "21");
    assert.equal(parsed.nextForm?.["next"], undefined);
  });

  it("reports neither blocked nor empty for a good page", () => {
    assert.equal(parsed.blocked, false);
    assert.equal(parsed.empty, false);
  });

  it("detects a lite anomaly page", () => {
    const blocked = parseLitePage(
      '<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div></body></html>',
    );
    assert.equal(blocked.blocked, true);
  });
});
