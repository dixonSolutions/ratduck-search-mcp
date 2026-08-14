import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { search } from "./ddg.js";
import { filterResults, rankResults, type FilterOptions } from "./filter.js";
import { FetchError } from "./http.js";
import { scrapeUrl } from "./scrape.js";
import type { RankedResult } from "./filter.js";
import type { ScrapeResult, SearchResult } from "./types.js";

const searchResultSchema = z.object({
  rank: z.number().int().min(1),
  title: z.string(),
  url: z.string(),
  domain: z.string(),
  snippet: z.string().default(""),
  isAd: z.boolean().optional(),
});

const filterShape = {
  includeDomains: z.array(z.string()).optional().describe("Keep only these domains (suffix match)."),
  excludeDomains: z.array(z.string()).optional().describe("Drop these domains (suffix match)."),
  mustIncludeTerms: z.array(z.string()).optional().describe("Every term must appear in title, snippet or URL."),
  mustExcludeTerms: z.array(z.string()).optional().describe("Drop a result if any term appears."),
  matchRegex: z.string().optional().describe("Regex tested against title + snippet + URL."),
  regexFlags: z.string().optional().describe("Flags for matchRegex. Default 'i'."),
  excludeHomepages: z.boolean().optional().describe("Drop bare homepages with no URL path."),
  maxPerDomain: z.number().int().min(1).optional().describe("Cap results per domain."),
  minSnippetLength: z.number().int().min(0).optional().describe("Require a snippet of at least N characters."),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

function textResult(text: string, structured?: Record<string, unknown>): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text }] };
  if (structured) result.structuredContent = structured;
  return result;
}

function errorResult(error: unknown): ToolResult {
  const message =
    error instanceof FetchError
      ? `${error.message} (${error.code})`
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

function renderResults(results: SearchResult[] | RankedResult[]): string {
  if (results.length === 0) return "No results.";
  return results
    .map((result, index) => {
      const score = "score" in result ? ` · score ${result.score}` : "";
      const reasons = "reasons" in result && result.reasons.length > 0 ? `\n   why: ${result.reasons.join("; ")}` : "";
      const snippet = result.snippet ? `\n   ${result.snippet}` : "";
      return `${index + 1}. ${result.title}\n   ${result.url}\n   [${result.domain}${score}]${snippet}${reasons}`;
    })
    .join("\n\n");
}

function pickFilterOptions(args: Record<string, unknown>): FilterOptions {
  const options: FilterOptions = {};
  for (const key of Object.keys(filterShape) as Array<keyof typeof filterShape>) {
    const value = args[key];
    if (value !== undefined) (options as Record<string, unknown>)[key] = value;
  }
  return options;
}

function renderScrape(result: ScrapeResult): string {
  const header = [
    `URL: ${result.finalUrl}${result.finalUrl === result.url ? "" : ` (redirected from ${result.url})`}`,
    `Status: ${result.status} · ${result.contentType || "unknown type"} · ${result.bytes} bytes · ${result.elapsedMs}ms`,
    result.title ? `Title: ${result.title}` : null,
    result.description ? `Description: ${result.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (result.format === "links") {
    const body = result.links.length === 0
      ? "No links found."
      : result.links.map((link) => `- ${link.text || "(no text)"} → ${link.url}`).join("\n");
    return `${header}\n\n${result.links.length} link(s):\n${body}`;
  }
  if (result.format === "metadata") {
    const entries = Object.entries(result.metadata);
    const body = entries.length === 0
      ? "No metadata found."
      : entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
    return `${header}\n\n${body}`;
  }
  return `${header}\n\n---\n${result.content}`;
}

/** Register every RatDuck tool on an MCP server instance. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "ddg_search",
    {
      title: "DuckDuckGo search",
      description:
        "Search the web via DuckDuckGo's no-JavaScript HTML endpoint and return ranked-by-engine results " +
        "(title, URL, domain, snippet). Supports site restriction, region, safe search, time range and domain filters.",
      inputSchema: {
        query: z.string().min(1).describe("The search query. DuckDuckGo operators like site:, filetype:, quotes all work."),
        maxResults: z.number().int().min(1).max(50).optional().describe("How many results to return. Default 10."),
        site: z.string().optional().describe("Restrict to one site, e.g. 'nodejs.org'."),
        region: z.string().optional().describe("Region code such as us-en, uk-en, pl-pl. Default wt-wt (no region)."),
        safeSearch: z.enum(["off", "moderate", "strict"]).optional().describe("Default moderate."),
        timeRange: z.enum(["any", "day", "week", "month", "year"]).optional().describe("Restrict result age. Default any."),
        excludeDomains: z.array(z.string()).optional().describe("Domains to drop from the results."),
        includeAds: z.boolean().optional().describe("Include sponsored results. Default false."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const response = await search({
          query: args.query,
          ...(args.maxResults !== undefined && { maxResults: args.maxResults }),
          ...(args.site !== undefined && { site: args.site }),
          ...(args.region !== undefined && { region: args.region }),
          ...(args.safeSearch !== undefined && { safeSearch: args.safeSearch }),
          ...(args.timeRange !== undefined && { timeRange: args.timeRange }),
          ...(args.excludeDomains !== undefined && { excludeDomains: args.excludeDomains }),
          ...(args.includeAds !== undefined && { includeAds: args.includeAds }),
        });
        const notices = response.notices.length > 0 ? `\n\nNotices:\n- ${response.notices.join("\n- ")}` : "";
        return textResult(
          `Query: ${response.effectiveQuery}\n${response.results.length} result(s) from ${response.pagesFetched} page(s).\n\n${renderResults(response.results)}${notices}`,
          { ...response },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ddg_top_results",
    {
      title: "DuckDuckGo top results",
      description:
        "Search DuckDuckGo, apply filters, then re-rank by keyword coverage, host authority and engine position " +
        "to surface the best few results. Optionally fetches each winner's page content in one call.",
      inputSchema: {
        query: z.string().min(1).describe("The search query."),
        count: z.number().int().min(1).max(20).optional().describe("How many top results to return. Default 5."),
        candidates: z.number().int().min(1).max(50).optional().describe("How many raw results to consider before ranking. Default 25."),
        site: z.string().optional().describe("Restrict to one site."),
        region: z.string().optional(),
        timeRange: z.enum(["any", "day", "week", "month", "year"]).optional(),
        preferDomains: z.array(z.string()).optional().describe("Domains that get a ranking bonus."),
        keywords: z.array(z.string()).optional().describe("Override the keywords used for scoring. Defaults to the query words."),
        engineWeight: z.number().min(0).max(3).optional().describe("How much to trust DuckDuckGo's own order. Default 1."),
        fetchContent: z.boolean().optional().describe("Also scrape each top result's page. Default false."),
        contentChars: z.number().int().min(200).max(50_000).optional().describe("Per-page character budget when fetchContent is on. Default 3000."),
        ...filterShape,
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const count = args.count ?? 5;
        const response = await search({
          query: args.query,
          maxResults: args.candidates ?? 25,
          ...(args.site !== undefined && { site: args.site }),
          ...(args.region !== undefined && { region: args.region }),
          ...(args.timeRange !== undefined && { timeRange: args.timeRange }),
        });

        const filtered = filterResults(response.results, pickFilterOptions(args as Record<string, unknown>));
        const ranked = rankResults(filtered, response.effectiveQuery, {
          ...(args.keywords !== undefined && { keywords: args.keywords }),
          ...(args.preferDomains !== undefined && { preferDomains: args.preferDomains }),
          ...(args.engineWeight !== undefined && { engineWeight: args.engineWeight }),
        }).slice(0, count);

        let body = renderResults(ranked);
        const pages: Array<Record<string, unknown>> = [];

        if (args.fetchContent && ranked.length > 0) {
          const maxChars = args.contentChars ?? 3000;
          const scraped = await Promise.all(
            ranked.map(async (result) => {
              try {
                const page = await scrapeUrl({ url: result.url, format: "markdown", maxChars });
                return { url: result.url, title: page.title, content: page.content, error: null };
              } catch (error) {
                return {
                  url: result.url,
                  title: result.title,
                  content: "",
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            }),
          );
          pages.push(...scraped);
          body += `\n\n=== Page content ===\n${scraped
            .map((page, index) =>
              page.error
                ? `--- [${index + 1}] ${page.url}\n(could not fetch: ${page.error})`
                : `--- [${index + 1}] ${page.title ?? page.url}\n${page.url}\n\n${page.content}`,
            )
            .join("\n\n")}`;
        }

        const notices = response.notices.length > 0 ? `\n\nNotices:\n- ${response.notices.join("\n- ")}` : "";
        return textResult(
          `Query: ${response.effectiveQuery}\n${response.results.length} candidate(s) → ${filtered.length} after filters → top ${ranked.length}.\n\n${body}${notices}`,
          { query: response.effectiveQuery, results: ranked, pages, notices: response.notices },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "scrape_url",
    {
      title: "Scrape a URL",
      description:
        "Fetch any http(s) URL and extract it as markdown, plain text, raw HTML, a link list, or page metadata. " +
        "Supports a CSS selector to target part of the page. Private/loopback addresses are refused.",
      inputSchema: {
        url: z.string().url().describe("Absolute http(s) URL to fetch."),
        format: z
          .enum(["markdown", "text", "html", "links", "metadata"])
          .optional()
          .describe("Extraction format. Default markdown."),
        selector: z.string().optional().describe("CSS selector to narrow extraction, e.g. 'article' or '#main'."),
        maxChars: z.number().int().min(200).max(200_000).optional().describe("Character budget for the content. Default 20000."),
        readability: z.boolean().optional().describe("Strip nav/header/footer/aside boilerplate. Default true."),
        sameDomainOnly: z.boolean().optional().describe("For format=links: keep only same-host links. Default false."),
        timeoutMs: z.number().int().min(1000).max(60_000).optional().describe("Request timeout. Default 15000."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const result = await scrapeUrl({
          url: args.url,
          ...(args.format !== undefined && { format: args.format }),
          ...(args.selector !== undefined && { selector: args.selector }),
          ...(args.maxChars !== undefined && { maxChars: args.maxChars }),
          ...(args.readability !== undefined && { readability: args.readability }),
          ...(args.sameDomainOnly !== undefined && { sameDomainOnly: args.sameDomainOnly }),
          ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
        });
        return textResult(renderScrape(result), { ...result });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "filter_results",
    {
      title: "Filter and re-rank results",
      description:
        "Apply domain/term/regex filters to a set of search results you already have, and optionally re-rank them. " +
        "Use this to narrow a previous ddg_search without spending another request on DuckDuckGo.",
      inputSchema: {
        results: z.array(searchResultSchema).describe("Results from a previous ddg_search call."),
        query: z.string().optional().describe("Query used for keyword scoring when rank is true."),
        rank: z.boolean().optional().describe("Re-rank the survivors best-first. Default true."),
        limit: z.number().int().min(1).max(50).optional().describe("Cap the number returned."),
        preferDomains: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
        ...filterShape,
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const input: SearchResult[] = args.results.map((result) => ({
          ...result,
          snippet: result.snippet ?? "",
        }));
        const filtered = filterResults(input, {
          ...pickFilterOptions(args as Record<string, unknown>),
          ...(args.limit !== undefined && { limit: args.limit }),
        });
        const shouldRank = args.rank ?? true;
        const output = shouldRank
          ? rankResults(filtered, args.query ?? "", {
              ...(args.keywords !== undefined && { keywords: args.keywords }),
              ...(args.preferDomains !== undefined && { preferDomains: args.preferDomains }),
            }).slice(0, args.limit ?? filtered.length)
          : filtered;

        return textResult(
          `${input.length} in → ${output.length} out${shouldRank ? " (re-ranked)" : ""}.\n\n${renderResults(output)}`,
          { results: output },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
