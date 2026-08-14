import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { FetchError, fetchText } from "./http.js";
import type { ScrapeFormat, ScrapeResult, ScrapedLink } from "./types.js";

export interface ScrapeOptions {
  url: string;
  format?: ScrapeFormat;
  /** CSS selector to narrow extraction to part of the page. */
  selector?: string;
  maxChars?: number;
  /** Drop nav/header/footer/aside and other boilerplate before extracting. */
  readability?: boolean;
  timeoutMs?: number;
  /** For the `links` format: keep only links on the page's own host. */
  sameDomainOnly?: boolean;
}

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[aria-hidden=true]",
  ".advert",
  ".advertisement",
  ".cookie-banner",
  ".newsletter",
];

const ALWAYS_STRIP = ["script", "style", "noscript", "template", "svg"];

const MAIN_CANDIDATES = ["main", "article", "[role=main]", "#content", ".content", "#main"];

function collapse(value: string): string {
  return value
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Very small HTML→Markdown conversion: headings, lists, links, code, emphasis. */
function toMarkdown($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>, baseUrl: string): string {
  const parts: string[] = [];

  const renderInline = (node: cheerio.Cheerio<AnyNode>): string => {
    const clone = node.clone();
    clone.find("a").each((_, a) => {
      const el = $(a);
      const text = el.text().trim();
      const href = el.attr("href");
      if (!text) return;
      if (!href || href.startsWith("#")) {
        el.replaceWith(text);
        return;
      }
      el.replaceWith(`[${text}](${absolutize(href, baseUrl) ?? href})`);
    });
    clone.find("strong, b").each((_, n) => {
      $(n).replaceWith(`**${$(n).text().trim()}**`);
    });
    clone.find("em, i").each((_, n) => {
      $(n).replaceWith(`*${$(n).text().trim()}*`);
    });
    clone.find("code").each((_, n) => {
      $(n).replaceWith(`\`${$(n).text().trim()}\``);
    });
    return collapse(clone.text());
  };

  const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table";
  // `addBack` so a selector that targets a block directly (e.g. `h2`) still renders.
  root
    .find(BLOCKS)
    .addBack(BLOCKS)
    .each((_, element) => {
      const node = $(element);
      const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? "";

      if (/^h[1-6]$/.test(tag)) {
        const text = collapse(node.text());
        if (text) parts.push(`${"#".repeat(Number(tag[1]))} ${text}`);
        return;
      }
      if (tag === "pre") {
        const code = node.text().replace(/\s+$/, "");
        if (code.trim()) parts.push(`\`\`\`\n${code}\n\`\`\``);
        return;
      }
      if (tag === "blockquote") {
        const text = collapse(node.text());
        if (text) parts.push(text.split("\n").map((line) => `> ${line}`).join("\n"));
        return;
      }
      if (tag === "li") {
        if (node.parents("pre, blockquote").length > 0) return;
        const text = renderInline(node.clone().children("ul, ol").remove().end());
        if (text) parts.push(`- ${text}`);
        return;
      }
      if (tag === "table") {
        const rows: string[] = [];
        node.find("tr").each((_, tr) => {
          const cells = $(tr)
            .find("th, td")
            .map((__, cell) => collapse($(cell).text()))
            .get();
          if (cells.length > 0) rows.push(`| ${cells.join(" | ")} |`);
        });
        if (rows.length > 0) {
          const columnCount = (rows[0]!.match(/\|/g)?.length ?? 2) - 1;
          rows.splice(1, 0, `|${" --- |".repeat(Math.max(1, columnCount))}`);
          parts.push(rows.join("\n"));
        }
        return;
      }
      // paragraph
      if (node.parents("li, pre, blockquote, table").length > 0) return;
      const text = renderInline(node);
      if (text) parts.push(text);
    });

  if (parts.length === 0) return collapse(root.text());
  return parts.join("\n\n");
}

function absolutize(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractMetadata($: cheerio.CheerioAPI): Record<string, string> {
  const metadata: Record<string, string> = {};
  $("meta").each((_, element) => {
    const node = $(element);
    const key = node.attr("property") ?? node.attr("name") ?? node.attr("itemprop");
    const value = node.attr("content");
    if (key && value && !metadata[key]) metadata[key] = value.slice(0, 2000);
  });
  const canonical = $("link[rel=canonical]").attr("href");
  if (canonical) metadata["canonical"] = canonical;
  const jsonLdTypes: string[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        const type = (entry as { "@type"?: unknown })?.["@type"];
        if (typeof type === "string") jsonLdTypes.push(type);
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  if (jsonLdTypes.length > 0) metadata["jsonLdTypes"] = [...new Set(jsonLdTypes)].join(", ");
  const lang = $("html").attr("lang");
  if (lang) metadata["lang"] = lang;
  return metadata;
}

/** Fetch a URL and extract it in the requested shape. */
export async function scrapeUrl(options: ScrapeOptions): Promise<ScrapeResult> {
  const {
    url,
    format = "markdown",
    selector,
    maxChars = 20_000,
    readability = true,
    timeoutMs,
    sameDomainOnly = false,
  } = options;

  const startedAt = Date.now();
  const response = await fetchText(url, timeoutMs ? { timeoutMs } : {});
  const elapsedMs = Date.now() - startedAt;

  const isHtml = /html|xml/i.test(response.contentType) || /^\s*<(!doctype|html)/i.test(response.text);
  if (!isHtml) {
    const content = response.text.slice(0, maxChars);
    return {
      url,
      finalUrl: response.finalUrl,
      status: response.status,
      contentType: response.contentType || "text/plain",
      title: null,
      description: null,
      format: format === "html" ? "html" : "text",
      content,
      links: [],
      metadata: {},
      truncated: response.text.length > content.length,
      bytes: response.bytes,
      elapsedMs,
    };
  }

  const $ = cheerio.load(response.text);
  const title = $("title").first().text().trim() || $("h1").first().text().trim() || null;
  const description =
    $("meta[name=description]").attr("content")?.trim() ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    null;
  const metadata = extractMetadata($);

  if (format === "links") {
    const links: ScrapedLink[] = [];
    const seen = new Set<string>();
    const host = new URL(response.finalUrl).hostname;
    const scope = selector ? $(selector) : $.root();
    scope.find("a[href]").each((_, element) => {
      const node = $(element);
      const absolute = absolutize(node.attr("href") ?? "", response.finalUrl);
      if (!absolute || seen.has(absolute)) return;
      if (sameDomainOnly && new URL(absolute).hostname !== host) return;
      seen.add(absolute);
      links.push({ text: collapse(node.text()).slice(0, 300), url: absolute });
    });
    return {
      url,
      finalUrl: response.finalUrl,
      status: response.status,
      contentType: response.contentType,
      title,
      description,
      format,
      content: "",
      links: links.slice(0, 500),
      metadata,
      truncated: links.length > 500,
      bytes: response.bytes,
      elapsedMs,
    };
  }

  if (format === "metadata") {
    return {
      url,
      finalUrl: response.finalUrl,
      status: response.status,
      contentType: response.contentType,
      title,
      description,
      format,
      content: "",
      links: [],
      metadata,
      truncated: false,
      bytes: response.bytes,
      elapsedMs,
    };
  }

  for (const noise of readability ? NOISE_SELECTORS : ALWAYS_STRIP) $(noise).remove();

  let root = selector ? $(selector) : $.root();
  if (selector && root.length === 0) {
    throw new FetchError(`Selector "${selector}" matched nothing on ${response.finalUrl}`, "unsupported");
  }
  if (!selector && readability) {
    for (const candidate of MAIN_CANDIDATES) {
      const found = $(candidate).first();
      if (found.length > 0 && collapse(found.text()).length > 200) {
        root = found;
        break;
      }
    }
  }

  let content: string;
  if (format === "html") {
    content = (selector ? root.map((_, el) => $.html(el)).get().join("\n") : $.html()).trim();
  } else if (format === "markdown") {
    content = toMarkdown($, root, response.finalUrl);
  } else {
    content = collapse(root.text());
  }

  const truncated = content.length > maxChars;
  if (truncated) content = `${content.slice(0, maxChars)}\n\n[truncated at ${maxChars} characters]`;

  return {
    url,
    finalUrl: response.finalUrl,
    status: response.status,
    contentType: response.contentType,
    title,
    description,
    format,
    content,
    links: [],
    metadata,
    truncated,
    bytes: response.bytes,
    elapsedMs,
  };
}
