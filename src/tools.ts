import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { search } from "./ddg.js";
import { filterResults, rankResults, type FilterOptions } from "./filter.js";
import { FetchError } from "./http.js";
import { searchImages, viewImage } from "./images.js";
import { LINK_KINDS, type LinkGrepOptions } from "./links.js";
import { scrapeUrl } from "./scrape.js";
import type { RankedResult } from "./filter.js";
import type {
  HarvestedLink,
  ImageResult,
  LinkKind,
  PageImage,
  ScrapeResult,
  SearchResult,
} from "./types.js";

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

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ToolResult = {
  content: ToolContent[];
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

const linkGrepShape = {
  pattern: z.string().optional().describe("Regular expression the link must match."),
  patternFlags: z.string().optional().describe("Flags for pattern. Default 'i'."),
  contains: z.string().optional().describe("Case-insensitive substring the link must contain."),
  matchOn: z.enum(["url", "text", "both"]).optional().describe("What pattern/contains test against. Default both."),
  invert: z.boolean().optional().describe("Keep only non-matching links, like grep -v."),
  kinds: z.array(z.enum(LINK_KINDS as [LinkKind, ...LinkKind[]])).optional().describe("Keep only these kinds of link."),
  extensions: z.array(z.string()).optional().describe("Keep only these file extensions, e.g. ['pdf','svg']."),
  scope: z.enum(["all", "internal", "external"]).optional().describe("internal = same host as the page. Default all."),
  includeDomains: z.array(z.string()).optional().describe("Keep only these hosts (suffix match)."),
  excludeDomains: z.array(z.string()).optional().describe("Drop these hosts (suffix match)."),
  unique: z.boolean().optional().describe("Collapse a URL found via several elements to one row. Default true."),
  limit: z.number().int().min(1).max(2000).optional().describe("Cap how many links come back. Default 200."),
};

function pickLinkGrepOptions(args: Record<string, unknown>): LinkGrepOptions {
  const options: LinkGrepOptions = {};
  for (const key of Object.keys(linkGrepShape) as Array<keyof typeof linkGrepShape>) {
    const value = args[key];
    if (value !== undefined) (options as Record<string, unknown>)[key] = value;
  }
  return options;
}

function renderImageResults(results: ImageResult[]): string {
  if (results.length === 0) return "No images.";
  return results
    .map((result, index) => {
      const size = result.width && result.height ? `${result.width}x${result.height}` : "size unknown";
      const provider = result.provider ? ` · via ${result.provider}` : "";
      return [
        `${index + 1}. ${result.title || "(untitled)"}`,
        `   image: ${result.imageUrl}`,
        `   thumb: ${result.thumbnailUrl}`,
        `   page:  ${result.sourceUrl}`,
        `   [${result.domain} · ${size}${result.ext ? ` · ${result.ext}` : ""}${provider}]`,
      ].join("\n");
    })
    .join("\n\n");
}

function renderPageImages(images: PageImage[]): string {
  if (images.length === 0) return "No images found.";
  return images
    .map((image, index) => {
      const size = image.width && image.height ? ` · ${image.width}x${image.height}` : "";
      const alt = image.alt ? `\n   alt: ${image.alt}` : "";
      const title = image.title ? `\n   title: ${image.title}` : "";
      return `${index + 1}. ${image.url}\n   [${image.origin} · ${image.internal ? "same site" : image.domain}${size}]${alt}${title}`;
    })
    .join("\n");
}

function renderHarvestedLinks(links: HarvestedLink[]): string {
  if (links.length === 0) return "No links matched.";
  const counts = new Map<string, number>();
  for (const link of links) counts.set(link.kind, (counts.get(link.kind) ?? 0) + 1);
  const summary = [...counts.entries()].map(([kind, count]) => `${kind}: ${count}`).join(", ");
  const body = links
    .map((link) => {
      const label = link.text ? ` "${link.text}"` : "";
      return `- [${link.kind}${link.internal ? "" : " · external"}] ${link.url}${label} (${link.origin})`;
    })
    .join("\n");
  return `${summary}\n\n${body}`;
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

  if (result.format === "links" || result.format === "assets") {
    const body = result.links.length === 0
      ? "No links found."
      : result.links
          .map((link) => `- [${link.kind}] ${link.text || "(no text)"} → ${link.url}`)
          .join("\n");
    return `${header}\n\n${result.links.length} ${result.format === "assets" ? "asset" : "link"}(s):\n${body}`;
  }
  if (result.format === "images") {
    return `${header}\n\n${result.images.length} image(s):\n${renderPageImages(result.images)}`;
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
          .enum(["markdown", "text", "html", "links", "images", "assets", "metadata"])
          .optional()
          .describe(
            "Extraction format. Default markdown. 'links' lists anchors, 'assets' lists the resources " +
              "the page loads, 'images' lists the images it shows.",
          ),
        selector: z.string().optional().describe("CSS selector to narrow extraction, e.g. 'article' or '#main'."),
        maxChars: z.number().int().min(200).max(200_000).optional().describe("Character budget for the content. Default 20000."),
        readability: z.boolean().optional().describe("Strip nav/header/footer/aside boilerplate. Default true."),
        sameDomainOnly: z
          .boolean()
          .optional()
          .describe("For format=links/assets/images: keep only same-host URLs. Default false."),
        includeAssets: z
          .boolean()
          .optional()
          .describe("For format=links: also list assets (images, scripts, styles, media). Default false."),
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
          ...(args.includeAssets !== undefined && { includeAssets: args.includeAssets }),
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

  server.registerTool(
    "ddg_images",
    {
      title: "DuckDuckGo image search",
      description:
        "Search DuckDuckGo Images and return direct image URLs, thumbnails, pixel dimensions and the page " +
        "each image came from. Filter by size, colour, type, layout, licence, site and recency. " +
        "Pass an imageUrl from here to view_image to actually look at the picture.",
      inputSchema: {
        query: z.string().min(1).describe("What to look for, e.g. 'red panda cub'."),
        maxResults: z.number().int().min(1).max(100).optional().describe("How many images to return. Default 20."),
        site: z.string().optional().describe("Restrict to one site, e.g. 'nasa.gov'."),
        region: z.string().optional().describe("Region code such as us-en, uk-en, pl-pl. Default wt-wt."),
        safeSearch: z.enum(["off", "moderate", "strict"]).optional().describe("Default moderate. DuckDuckGo images only distinguishes on from off."),
        size: z.enum(["any", "small", "medium", "large", "wallpaper"]).optional(),
        type: z.enum(["any", "photo", "clipart", "gif", "transparent", "line"]).optional(),
        layout: z.enum(["any", "square", "tall", "wide"]).optional(),
        color: z
          .enum([
            "any", "color", "monochrome", "red", "orange", "yellow", "green", "blue",
            "purple", "pink", "brown", "black", "gray", "teal", "white",
          ])
          .optional(),
        license: z
          .enum(["any", "public", "share", "shareCommercially", "modify", "modifyCommercially"])
          .optional()
          .describe("Usage rights filter."),
        timeRange: z.enum(["any", "day", "week", "month", "year"]).optional().describe("Restrict image age."),
        excludeDomains: z.array(z.string()).optional().describe("Source sites to drop."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const response = await searchImages({
          query: args.query,
          ...(args.maxResults !== undefined && { maxResults: args.maxResults }),
          ...(args.site !== undefined && { site: args.site }),
          ...(args.region !== undefined && { region: args.region }),
          ...(args.safeSearch !== undefined && { safeSearch: args.safeSearch }),
          ...(args.size !== undefined && { size: args.size }),
          ...(args.type !== undefined && { type: args.type }),
          ...(args.layout !== undefined && { layout: args.layout }),
          ...(args.color !== undefined && { color: args.color }),
          ...(args.license !== undefined && { license: args.license }),
          ...(args.timeRange !== undefined && { timeRange: args.timeRange }),
          ...(args.excludeDomains !== undefined && { excludeDomains: args.excludeDomains }),
        });
        const notices = response.notices.length > 0 ? `\n\nNotices:\n- ${response.notices.join("\n- ")}` : "";
        return textResult(
          `Query: ${response.effectiveQuery}\n${response.results.length} image(s) from ${response.pagesFetched} page(s).\n\n${renderImageResults(response.results)}${notices}`,
          { ...response },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "view_image",
    {
      title: "View an image",
      description:
        "Fetch an image by URL and return the picture itself, so it can actually be looked at rather than " +
        "just linked. Reports the real pixel dimensions and file type. Use it on an imageUrl from ddg_images " +
        "or a URL from page_images. Private/loopback addresses are refused, and the image is untrusted content.",
      inputSchema: {
        url: z.string().url().describe("Absolute http(s) URL of the image."),
        maxBytes: z
          .number()
          .int()
          .min(1000)
          .max(8_000_000)
          .optional()
          .describe("Refuse anything larger, before decoding. Default 3000000."),
        referer: z
          .string()
          .url()
          .optional()
          .describe("Page to claim as the referer. Some hosts refuse hotlinked images without one."),
        timeoutMs: z.number().int().min(1000).max(60_000).optional().describe("Request timeout. Default 15000."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const image = await viewImage({
          url: args.url,
          ...(args.maxBytes !== undefined && { maxBytes: args.maxBytes }),
          ...(args.referer !== undefined && { referer: args.referer }),
          ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
        });
        const size = image.width && image.height ? `${image.width}x${image.height}` : "unknown size";
        const { data, ...rest } = image;
        return {
          content: [
            {
              type: "text",
              text:
                `${image.finalUrl}${image.finalUrl === image.url ? "" : ` (redirected from ${image.url})`}\n` +
                `${image.mimeType} · ${size} · ${image.bytes} bytes · ${image.elapsedMs}ms`,
            },
            { type: "image", data, mimeType: image.mimeType },
          ],
          structuredContent: { ...rest },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "page_images",
    {
      title: "List a page's images",
      description:
        "List every image a page shows — img tags (including lazy-loaded and srcset variants), picture " +
        "sources, video posters, OpenGraph/Twitter card images, icons and CSS backgrounds — with alt text, " +
        "declared size and origin. Filter by host, size, pattern or kind. Follow up with view_image to see one.",
      inputSchema: {
        url: z.string().url().describe("Absolute http(s) URL of the page."),
        selector: z.string().optional().describe("CSS selector to limit the search to part of the page."),
        sameDomainOnly: z.boolean().optional().describe("Keep only images served from the page's own host."),
        excludeIcons: z.boolean().optional().describe("Drop favicons and apple-touch icons. Default false."),
        excludeBackgrounds: z.boolean().optional().describe("Drop CSS url() background images. Default false."),
        minWidth: z.number().int().min(1).optional().describe("Drop images declaring a smaller width. Images with no declared size are kept."),
        minHeight: z.number().int().min(1).optional().describe("Drop images declaring a smaller height."),
        pattern: z.string().optional().describe("Regex the image URL, alt or title must match."),
        patternFlags: z.string().optional().describe("Flags for pattern. Default 'i'."),
        limit: z.number().int().min(1).max(1000).optional().describe("Cap how many images come back. Default 100."),
        timeoutMs: z.number().int().min(1000).max(60_000).optional().describe("Request timeout. Default 15000."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const result = await scrapeUrl({
          url: args.url,
          format: "images",
          maxItems: args.limit ?? 100,
          ...(args.selector !== undefined && { selector: args.selector }),
          ...(args.sameDomainOnly !== undefined && { sameDomainOnly: args.sameDomainOnly }),
          ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
          imageFilter: {
            ...(args.excludeIcons !== undefined && { excludeIcons: args.excludeIcons }),
            ...(args.excludeBackgrounds !== undefined && { excludeBackgrounds: args.excludeBackgrounds }),
            ...(args.minWidth !== undefined && { minWidth: args.minWidth }),
            ...(args.minHeight !== undefined && { minHeight: args.minHeight }),
            ...(args.pattern !== undefined && { pattern: args.pattern }),
            ...(args.patternFlags !== undefined && { patternFlags: args.patternFlags }),
          },
        });
        const truncated = result.truncated ? `\n(list truncated at ${args.limit ?? 100})` : "";
        return textResult(
          `${result.finalUrl}\n${result.images.length} image(s)${truncated}\n\n${renderPageImages(result.images)}`,
          { url: result.finalUrl, title: result.title, images: result.images, truncated: result.truncated },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "grep_links",
    {
      title: "Grep a page's links and assets",
      description:
        "Harvest every URL a page references — links to other sites and the assets it loads (images, " +
        "scripts, stylesheets, media, documents, archives, fonts, feeds) — then grep them with a regex or " +
        "substring. Filter by kind, file extension, internal vs external, or host. Use it to find every PDF " +
        "on a page, every outbound link, every script a site pulls from a CDN, and so on.",
      inputSchema: {
        url: z.string().url().describe("Absolute http(s) URL of the page to harvest."),
        selector: z.string().optional().describe("CSS selector to limit the harvest to part of the page."),
        include: z
          .enum(["all", "links", "assets"])
          .optional()
          .describe("'links' = anchors only, 'assets' = only what the page loads, 'all' = both. Default all."),
        timeoutMs: z.number().int().min(1000).max(60_000).optional().describe("Request timeout. Default 15000."),
        ...linkGrepShape,
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const include = args.include ?? "all";
        const limit = args.limit ?? 200;
        const result = await scrapeUrl({
          url: args.url,
          format: include === "assets" ? "assets" : "links",
          includeAssets: include === "all",
          maxItems: limit,
          ...(args.selector !== undefined && { selector: args.selector }),
          ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
          // One past the cap, so `truncated` can tell "exactly this many" from "more than this".
          linkFilter: { ...pickLinkGrepOptions(args as Record<string, unknown>), limit: limit + 1 },
        });
        const links: HarvestedLink[] = result.links;
        const truncated = result.truncated ? `\n(list truncated at ${limit})` : "";
        return textResult(
          `${result.finalUrl}\n${links.length} link(s) matched${truncated}\n\n${renderHarvestedLinks(links)}`,
          { url: result.finalUrl, title: result.title, links, truncated: result.truncated },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
