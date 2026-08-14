/** Shared result shapes used across search, scrape and filter modules. */

export interface SearchResult {
  /** 1-based position in the unfiltered engine output. */
  rank: number;
  title: string;
  url: string;
  /** Hostname without a leading `www.`. */
  domain: string;
  snippet: string;
  /** Present only when the result came back flagged as an advertisement. */
  isAd?: boolean;
}

export interface SearchResponse {
  query: string;
  /** Query actually sent to the engine, after operators like `site:` were folded in. */
  effectiveQuery: string;
  results: SearchResult[];
  /** How many pages of engine output were fetched. */
  pagesFetched: number;
  /** Non-fatal problems worth surfacing to the caller (rate limits, empty pages, ...). */
  notices: string[];
}

export type ScrapeFormat = "text" | "markdown" | "html" | "links" | "metadata";

export interface ScrapedLink {
  text: string;
  url: string;
}

export interface ScrapeResult {
  url: string;
  /** Final URL after redirects. */
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  description: string | null;
  format: ScrapeFormat;
  /** Rendered content for `text` / `markdown` / `html`. */
  content: string;
  /** Populated for the `links` format. */
  links: ScrapedLink[];
  /** Populated for the `metadata` format: meta tags, OpenGraph, JSON-LD types. */
  metadata: Record<string, string>;
  /** True when `content` was cut off by `maxChars`. */
  truncated: boolean;
  bytes: number;
  elapsedMs: number;
}
