import type { SearchResult } from "./types.js";

export interface FilterOptions {
  /** Keep only results on these domains (suffix match, so `bbc.co.uk` matches `news.bbc.co.uk`). */
  includeDomains?: string[];
  /** Drop results on these domains (suffix match). */
  excludeDomains?: string[];
  /** Every term must appear in title, snippet or URL (case-insensitive). */
  mustIncludeTerms?: string[];
  /** Any occurrence of these terms drops the result. */
  mustExcludeTerms?: string[];
  /** JavaScript regular expression tested against `title + snippet + url`. */
  matchRegex?: string;
  regexFlags?: string;
  /** Drop results whose URL path is empty (bare homepages). */
  excludeHomepages?: boolean;
  /** Keep at most this many results per domain. */
  maxPerDomain?: number;
  /** Require a snippet of at least this length. */
  minSnippetLength?: number;
  limit?: number;
}

export interface RankOptions {
  /** Terms that boost a result when present. Defaults to the query's own words. */
  keywords?: string[];
  /** Domains whose results get a score bonus. */
  preferDomains?: string[];
  /** Weight of DuckDuckGo's own ordering (0 = ignore it, 1 = trust it heavily). */
  engineWeight?: number;
}

export interface RankedResult extends SearchResult {
  score: number;
  /** Human-readable reasons the score came out the way it did. */
  reasons: string[];
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function domainMatches(domain: string, pattern: string): boolean {
  const target = normalizeDomain(pattern);
  if (!target) return false;
  return domain === target || domain.endsWith(`.${target}`);
}

function haystack(result: SearchResult): string {
  return `${result.title}\n${result.snippet}\n${result.url}`.toLowerCase();
}

/** Apply the declarative filters in `options`, preserving input order. */
export function filterResults(results: SearchResult[], options: FilterOptions = {}): SearchResult[] {
  const {
    includeDomains,
    excludeDomains,
    mustIncludeTerms,
    mustExcludeTerms,
    matchRegex,
    regexFlags = "i",
    excludeHomepages = false,
    maxPerDomain,
    minSnippetLength,
    limit,
  } = options;

  let regex: RegExp | null = null;
  if (matchRegex) {
    try {
      regex = new RegExp(matchRegex, regexFlags);
    } catch (error) {
      throw new Error(
        `Invalid matchRegex ${JSON.stringify(matchRegex)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const perDomain = new Map<string, number>();
  const output: SearchResult[] = [];

  for (const result of results) {
    const text = haystack(result);

    if (includeDomains?.length && !includeDomains.some((d) => domainMatches(result.domain, d))) continue;
    if (excludeDomains?.length && excludeDomains.some((d) => domainMatches(result.domain, d))) continue;
    if (mustIncludeTerms?.length && !mustIncludeTerms.every((t) => text.includes(t.toLowerCase()))) continue;
    if (mustExcludeTerms?.length && mustExcludeTerms.some((t) => text.includes(t.toLowerCase()))) continue;
    if (regex && !regex.test(`${result.title}\n${result.snippet}\n${result.url}`)) continue;
    if (minSnippetLength && result.snippet.length < minSnippetLength) continue;
    if (excludeHomepages) {
      try {
        const path = new URL(result.url).pathname.replace(/\/+$/, "");
        if (path === "") continue;
      } catch {
        continue;
      }
    }
    if (maxPerDomain) {
      const seen = perDomain.get(result.domain) ?? 0;
      if (seen >= maxPerDomain) continue;
      perDomain.set(result.domain, seen + 1);
    }

    output.push(result);
    if (limit && output.length >= limit) break;
  }

  return output;
}

const AUTHORITY_HINTS: Array<[RegExp, number, string]> = [
  [/\.(gov|edu|mil)$/, 1.5, "authoritative TLD"],
  [/^(en\.)?wikipedia\.org$/, 1.2, "wikipedia"],
  [/^(github\.com|gitlab\.com)$/, 1.0, "source hosting"],
  [/^(stackoverflow\.com|serverfault\.com|superuser\.com)$/, 0.9, "stack exchange"],
  [/^(docs?\.|developer\.)/, 0.9, "documentation host"],
  [/(pinterest\.|quora\.com|answers\.|\.blogspot\.)/, -1.0, "low-signal host"],
];

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "for", "on", "is", "how", "what", "why", "with",
]);

function keywordsFrom(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/site:\S+/g, " ")
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Score results by keyword coverage, host authority and engine position, then
 * sort best-first. This is what "top results" means for the agent-facing tool.
 */
export function rankResults(
  results: SearchResult[],
  query: string,
  options: RankOptions = {},
): RankedResult[] {
  const { preferDomains = [], engineWeight = 1 } = options;
  const keywords = options.keywords?.length ? options.keywords.map((k) => k.toLowerCase()) : keywordsFrom(query);

  const ranked = results.map((result) => {
    const reasons: string[] = [];
    let score = 0;

    // Engine position: first result gets the full weight, decaying with rank.
    const positional = engineWeight * (3 / Math.sqrt(result.rank));
    score += positional;
    if (positional > 0) reasons.push(`engine rank #${result.rank}`);

    if (keywords.length > 0) {
      const title = result.title.toLowerCase();
      const snippet = result.snippet.toLowerCase();
      const url = result.url.toLowerCase();
      let hitsInTitle = 0;
      let hitsAnywhere = 0;
      for (const keyword of keywords) {
        if (title.includes(keyword)) hitsInTitle += 1;
        if (title.includes(keyword) || snippet.includes(keyword) || url.includes(keyword)) hitsAnywhere += 1;
      }
      const coverage = hitsAnywhere / keywords.length;
      score += coverage * 3 + (hitsInTitle / keywords.length) * 2;
      reasons.push(`${hitsAnywhere}/${keywords.length} keywords matched (${hitsInTitle} in title)`);
    }

    for (const [pattern, weight, label] of AUTHORITY_HINTS) {
      if (pattern.test(result.domain)) {
        score += weight;
        reasons.push(`${weight > 0 ? "+" : ""}${weight} ${label}`);
      }
    }

    if (preferDomains.some((d) => domainMatches(result.domain, d))) {
      score += 2;
      reasons.push("preferred domain");
    }

    if (result.snippet.length > 120) {
      score += 0.5;
      reasons.push("substantial snippet");
    }
    if (result.isAd) {
      score -= 5;
      reasons.push("-5 advertisement");
    }

    return { ...result, score: Math.round(score * 1000) / 1000, reasons };
  });

  return ranked.sort((a, b) => b.score - a.score || a.rank - b.rank);
}

/** Filter, then rank, then take the best `count`. */
export function topResults(
  results: SearchResult[],
  query: string,
  count = 5,
  filterOptions: FilterOptions = {},
  rankOptions: RankOptions = {},
): RankedResult[] {
  return rankResults(filterResults(results, filterOptions), query, rankOptions).slice(0, count);
}
