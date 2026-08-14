import * as cheerio from "cheerio";
import { FetchError, fetchText } from "./http.js";
import type { SearchResponse, SearchResult } from "./types.js";

const ENDPOINTS = {
  html: "https://html.duckduckgo.com/html/",
  lite: "https://lite.duckduckgo.com/lite/",
} as const;

export type Endpoint = keyof typeof ENDPOINTS;

/** DuckDuckGo region codes, e.g. `us-en`, `uk-en`, `pl-pl`, or `wt-wt` for no region. */
export type SafeSearch = "off" | "moderate" | "strict";
export type TimeRange = "any" | "day" | "week" | "month" | "year";

export interface SearchOptions {
  query: string;
  maxResults?: number;
  region?: string;
  safeSearch?: SafeSearch;
  timeRange?: TimeRange;
  /** Restrict to a single site, folded into the query as `site:`. */
  site?: string;
  /** Domains to drop from the output entirely. */
  excludeDomains?: string[];
  includeAds?: boolean;
  /** Hard cap on engine pages fetched (each page is ~25-30 results). */
  maxPages?: number;
  /**
   * Which DuckDuckGo front end to scrape. `html` is richer; `lite` is a
   * smaller page that sometimes survives rate limiting when `html` does not.
   * The default tries `html` and falls back to `lite` if it gets challenged.
   */
  endpoint?: Endpoint;
}

const SAFE_SEARCH_CODES: Record<SafeSearch, string> = {
  strict: "1",
  moderate: "-1",
  off: "-2",
};

const TIME_RANGE_CODES: Record<TimeRange, string> = {
  any: "",
  day: "d",
  week: "w",
  month: "m",
  year: "y",
};

export function buildEffectiveQuery(query: string, site?: string): string {
  const trimmed = query.trim();
  if (!site) return trimmed;
  const host = site.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!host) return trimmed;
  if (new RegExp(`site:${escapeRegex(host)}\\b`, "i").test(trimmed)) return trimmed;
  return `${trimmed} site:${host}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** DuckDuckGo wraps outbound links as `//duckduckgo.com/l/?uddg=<encoded>`. */
export function unwrapDdgUrl(href: string): string | null {
  if (!href) return null;
  const absolute = href.startsWith("//") ? `https:${href}` : href;
  try {
    const url = new URL(absolute, "https://duckduckgo.com");
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) {
      // `/l/?uddg=` wraps organic results, `/y.js?u3=` wraps sponsored ones.
      const target = url.searchParams.get("uddg") ?? url.searchParams.get("u3");
      if (!target) return null;
      let decoded = target;
      if (/^https?%3A/i.test(target)) {
        try {
          decoded = decodeURIComponent(target);
        } catch {
          decoded = target;
        }
      }
      const resolved = new URL(decoded, "https://duckduckgo.com");
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
      return resolved.toString();
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface ParsedPage {
  results: Omit<SearchResult, "rank">[];
  /** Hidden form fields for the "next page" POST, when DuckDuckGo offers one. */
  nextForm: Record<string, string> | null;
  blocked: boolean;
  empty: boolean;
}

/** Parse one page of `html.duckduckgo.com/html/` output. Exported for tests. */
export function parseResultsPage(html: string): ParsedPage {
  const $ = cheerio.load(html);
  const results: Omit<SearchResult, "rank">[] = [];

  $("div.result, div.web-result").each((_, element) => {
    const node = $(element);
    if (node.hasClass("result--more") || node.hasClass("result--no-result")) return;

    const anchor = node.find("a.result__a").first();
    const rawHref = anchor.attr("href") ?? "";
    const url = unwrapDdgUrl(rawHref);
    if (!url) return;

    const title = normalizeWhitespace(anchor.text());
    if (!title) return;

    const snippet = normalizeWhitespace(node.find(".result__snippet").first().text());
    const isAd = node.hasClass("result--ad") || node.find(".badge--ad").length > 0;

    const result: Omit<SearchResult, "rank"> = {
      title,
      url,
      domain: domainOf(url),
      snippet,
    };
    if (isAd) result.isAd = true;
    results.push(result);
  });

  return {
    results,
    nextForm: extractNextForm($, "div.nav-link form, form.nav-link-form"),
    blocked: isBlocked(html, results.length),
    empty: $(".no-results").length > 0 || $(".result--no-result").length > 0,
  };
}

/**
 * Parse one page of `lite.duckduckgo.com/lite/` output. The lite front end is
 * a plain table: a link row, a snippet row and a display-URL row per result.
 * Exported for tests.
 */
export function parseLitePage(html: string): ParsedPage {
  const $ = cheerio.load(html);
  const results: Omit<SearchResult, "rank">[] = [];

  $("a.result-link").each((_, element) => {
    const anchor = $(element);
    const url = unwrapDdgUrl(anchor.attr("href") ?? "");
    if (!url) return;
    const title = normalizeWhitespace(anchor.text());
    if (!title) return;

    // The snippet lives in the next `td.result-snippet` after this link's row.
    const row = anchor.closest("tr");
    const snippet = normalizeWhitespace(row.nextAll("tr").find("td.result-snippet").first().text());
    const isAd = row.find(".badge--ad").length > 0 || /\/y\.js/.test(anchor.attr("href") ?? "");

    const result: Omit<SearchResult, "rank"> = { title, url, domain: domainOf(url), snippet };
    if (isAd) result.isAd = true;
    results.push(result);
  });

  return {
    results,
    nextForm: extractNextForm($, "form"),
    blocked: isBlocked(html, results.length),
    empty: /no results/i.test($("body").text()) && results.length === 0,
  };
}

function isBlocked(html: string, resultCount: number): boolean {
  return (
    resultCount === 0 &&
    /anomaly-modal|anomaly\.js|challenge-form|unusual traffic|blocked your ip/i.test(html)
  );
}

/** Collect the hidden fields of the "next page" form, if the page offers one. */
function extractNextForm($: cheerio.CheerioAPI, selector: string): Record<string, string> | null {
  const forms = $(selector).filter((_, form) => $(form).find("input[name='s']").length > 0);
  const form = forms.last();
  if (form.length === 0) return null;
  const fields: Record<string, string> = {};
  form.find("input[name]").each((_, input) => {
    const node = $(input);
    if (node.attr("type") === "submit") return;
    const name = node.attr("name");
    if (name) fields[name] = node.attr("value") ?? "";
  });
  return Object.keys(fields).length > 0 ? fields : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFor(endpoint: Endpoint, html: string): ParsedPage {
  return endpoint === "lite" ? parseLitePage(html) : parseResultsPage(html);
}

/** GET the first page, or POST the engine's own next-page form for later ones. */
async function fetchPage(
  endpoint: Endpoint,
  baseParams: Record<string, string>,
  nextForm: Record<string, string> | null,
): Promise<string> {
  const base = ENDPOINTS[endpoint];
  if (!nextForm) {
    const url = `${base}?${new URLSearchParams(baseParams).toString()}`;
    return (await fetchText(url, { allowPrivate: true, headers: { referer: "https://duckduckgo.com/" } })).text;
  }
  const body = new URLSearchParams({ ...baseParams, ...nextForm }).toString();
  return (
    await fetchText(base, {
      method: "POST",
      body,
      allowPrivate: true,
      headers: { "content-type": "application/x-www-form-urlencoded", referer: base },
    })
  ).text;
}

/**
 * Run a DuckDuckGo search by scraping the no-JavaScript HTML endpoint,
 * paging until `maxResults` is satisfied or the engine stops offering pages.
 */
export async function search(options: SearchOptions): Promise<SearchResponse> {
  const {
    query,
    maxResults = 10,
    region = "wt-wt",
    safeSearch = "moderate",
    timeRange = "any",
    site,
    excludeDomains = [],
    includeAds = false,
    maxPages = 4,
  } = options;

  if (!query.trim()) throw new FetchError("Query must not be empty", "unsupported");

  const effectiveQuery = buildEffectiveQuery(query, site);
  const notices: string[] = [];
  const excluded = new Set(excludeDomains.map((d) => d.replace(/^www\./i, "").toLowerCase()));

  const baseParams: Record<string, string> = {
    q: effectiveQuery,
    kl: region,
    kp: SAFE_SEARCH_CODES[safeSearch],
  };
  const df = TIME_RANGE_CODES[timeRange];
  if (df) baseParams["df"] = df;

  const collected: SearchResult[] = [];
  const seenUrls = new Set<string>();
  let nextForm: Record<string, string> | null = null;
  let pagesFetched = 0;
  let rank = 0;
  let endpoint: Endpoint = options.endpoint ?? "html";
  const allowFallback = options.endpoint === undefined;
  let usedFallback = false;

  for (let page = 0; page < Math.max(1, maxPages); page += 1) {
    if (page > 0) await delay(500);

    let parsed = parseFor(endpoint, await fetchPage(endpoint, baseParams, page === 0 ? null : nextForm));
    pagesFetched += 1;

    // The html front end gets challenged more often than lite; retry there once.
    if (parsed.blocked && allowFallback && !usedFallback && endpoint === "html") {
      usedFallback = true;
      endpoint = "lite";
      notices.push("html.duckduckgo.com was rate-limited; retried against lite.duckduckgo.com.");
      await delay(700);
      parsed = parseFor(endpoint, await fetchPage(endpoint, baseParams, page === 0 ? null : nextForm));
      pagesFetched += 1;
    }

    if (parsed.blocked) {
      notices.push(
        "DuckDuckGo returned a rate-limit / anomaly page. Wait a few seconds and retry, or lower maxResults.",
      );
      break;
    }
    if (parsed.empty && collected.length === 0) {
      notices.push("DuckDuckGo reported no results for this query.");
      break;
    }

    for (const item of parsed.results) {
      if (!includeAds && item.isAd) continue;
      if (excluded.has(item.domain)) continue;
      const key = item.url.replace(/#.*$/, "");
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      rank += 1;
      collected.push({ rank, ...item });
      if (collected.length >= maxResults) break;
    }

    if (collected.length >= maxResults) break;
    if (parsed.results.length === 0) {
      notices.push(`Page ${pagesFetched} returned no parsable results; stopping.`);
      break;
    }
    nextForm = parsed.nextForm;
    if (!nextForm) break;
  }

  return {
    query,
    effectiveQuery,
    results: collected.slice(0, maxResults),
    pagesFetched,
    notices,
  };
}
