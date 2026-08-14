import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterResults, rankResults, topResults } from "../src/filter.ts";
import type { SearchResult } from "../src/types.ts";

const results: SearchResult[] = [
  {
    rank: 1,
    title: "Pinterest board about rust",
    url: "https://pinterest.com/",
    domain: "pinterest.com",
    snippet: "pictures",
  },
  {
    rank: 2,
    title: "Tokio Tutorial - async runtime",
    url: "https://tokio.rs/tokio/tutorial",
    domain: "tokio.rs",
    snippet: "Tokio is an asynchronous runtime for the Rust programming language with plenty of detail here.",
  },
  {
    rank: 3,
    title: "Async book",
    url: "https://rust-lang.github.io/async-book/",
    domain: "rust-lang.github.io",
    snippet: "The async book for Rust.",
  },
  {
    rank: 4,
    title: "NIST guidance",
    url: "https://nist.gov/async",
    domain: "nist.gov",
    snippet: "Unrelated.",
  },
  {
    rank: 5,
    title: "Tokio API docs",
    url: "https://docs.rs/tokio/latest/tokio/",
    domain: "docs.rs",
    snippet: "API documentation for the Tokio async runtime crate.",
  },
];

describe("filterResults", () => {
  it("returns everything when no options are given", () => {
    assert.equal(filterResults(results).length, results.length);
  });

  it("filters by include domain with suffix matching", () => {
    const filtered = filterResults(results, { includeDomains: ["github.io"] });
    assert.deepEqual(filtered.map((r) => r.domain), ["rust-lang.github.io"]);
  });

  it("filters by exclude domain", () => {
    const filtered = filterResults(results, { excludeDomains: ["pinterest.com"] });
    assert.equal(filtered.some((r) => r.domain === "pinterest.com"), false);
  });

  it("requires every mustIncludeTerm", () => {
    const filtered = filterResults(results, { mustIncludeTerms: ["tokio", "runtime"] });
    assert.deepEqual(filtered.map((r) => r.rank), [2, 5]);
  });

  it("drops anything matching mustExcludeTerms", () => {
    const filtered = filterResults(results, { mustExcludeTerms: ["pictures"] });
    assert.equal(filtered.length, 4);
  });

  it("applies a regex over title, snippet and url", () => {
    const filtered = filterResults(results, { matchRegex: "docs\\.rs|async-book" });
    assert.deepEqual(filtered.map((r) => r.rank), [3, 5]);
  });

  it("raises a clear error on an invalid regex", () => {
    assert.throws(() => filterResults(results, { matchRegex: "([" }), /Invalid matchRegex/);
  });

  it("drops bare homepages", () => {
    const filtered = filterResults(results, { excludeHomepages: true });
    assert.equal(filtered.some((r) => r.domain === "pinterest.com"), false);
  });

  it("caps results per domain", () => {
    const duplicated = [...results, { ...results[1]!, rank: 6, url: "https://tokio.rs/other" }];
    const filtered = filterResults(duplicated, { maxPerDomain: 1 });
    assert.equal(filtered.filter((r) => r.domain === "tokio.rs").length, 1);
  });

  it("enforces a minimum snippet length", () => {
    const filtered = filterResults(results, { minSnippetLength: 40 });
    assert.deepEqual(filtered.map((r) => r.rank), [2, 5]);
  });

  it("honours the limit", () => {
    assert.equal(filterResults(results, { limit: 2 }).length, 2);
  });
});

describe("rankResults", () => {
  it("promotes keyword-matching results over engine order", () => {
    const ranked = rankResults(results, "tokio async runtime");
    assert.equal(ranked[0]?.domain, "tokio.rs");
    assert.equal(ranked.at(-1)?.domain, "pinterest.com");
  });

  it("gives every result a score and reasons", () => {
    const ranked = rankResults(results, "tokio");
    for (const result of ranked) {
      assert.equal(typeof result.score, "number");
      assert.ok(result.reasons.length > 0);
    }
  });

  it("boosts preferred domains", () => {
    const baseline = rankResults(results, "async").find((r) => r.domain === "docs.rs")!;
    const boosted = rankResults(results, "async", { preferDomains: ["docs.rs"] }).find(
      (r) => r.domain === "docs.rs",
    )!;
    assert.ok(boosted.score > baseline.score);
  });

  it("can ignore engine order entirely", () => {
    const ranked = rankResults(results, "async", { engineWeight: 0 });
    assert.equal(ranked.every((r) => !r.reasons.some((reason) => reason.startsWith("engine rank"))), true);
  });

  it("penalises advertisements", () => {
    const withAd = rankResults([{ ...results[1]!, isAd: true }], "tokio async runtime")[0]!;
    const withoutAd = rankResults([results[1]!], "tokio async runtime")[0]!;
    assert.ok(Math.abs(withAd.score - (withoutAd.score - 5)) < 1e-6);
    assert.ok(withAd.reasons.includes("-5 advertisement"));
  });
});

describe("topResults", () => {
  it("filters, ranks and truncates in one call", () => {
    const top = topResults(results, "tokio async runtime", 2, { excludeDomains: ["pinterest.com"] });
    assert.equal(top.length, 2);
    assert.equal(top.some((r) => r.domain === "pinterest.com"), false);
    assert.ok(top[0]!.score >= top[1]!.score);
  });
});
