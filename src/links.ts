import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { HarvestedLink, LinkKind, PageImage } from "./types.js";

/**
 * Harvesting every URL a page references — the links it points at *and* the
 * assets it loads — plus grep-style filtering over the result.
 */

const EXTENSION_KINDS: Array<[LinkKind, string[]]> = [
  ["image", ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "tif", "tiff", "heic", "jxl"]],
  ["media", ["mp4", "webm", "ogv", "mov", "avi", "mkv", "m3u8", "mp3", "wav", "ogg", "oga", "m4a", "flac", "aac", "opus"]],
  ["document", ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "epub", "csv", "tsv", "txt", "md"]],
  ["archive", ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg", "exe", "msi", "deb", "rpm", "apk", "jar", "whl"]],
  ["font", ["woff", "woff2", "ttf", "otf", "eot"]],
  ["script", ["js", "mjs", "cjs", "jsx", "ts", "tsx", "wasm", "map"]],
  ["stylesheet", ["css", "scss", "less"]],
  ["data", ["json", "jsonld", "xml", "yaml", "yml", "toml", "sql", "ndjson"]],
  ["feed", ["rss", "atom"]],
];

const KIND_BY_EXTENSION = new Map<string, LinkKind>();
for (const [kind, extensions] of EXTENSION_KINDS) {
  for (const extension of extensions) KIND_BY_EXTENSION.set(extension, kind);
}

export const LINK_KINDS: LinkKind[] = [
  "page",
  "image",
  "script",
  "stylesheet",
  "media",
  "document",
  "archive",
  "font",
  "feed",
  "data",
  "other",
];

/** Resolve `href` against `baseUrl`, dropping fragments and non-http(s) schemes. */
export function absolutize(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Lowercase extension of a URL's last path segment, without the dot. */
export function extensionOf(url: string): string {
  try {
    const segment = new URL(url).pathname.split("/").pop() ?? "";
    const dot = segment.lastIndexOf(".");
    if (dot <= 0) return "";
    const extension = segment.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(extension) ? extension : "";
  } catch {
    return "";
  }
}

interface KindHints {
  /** Element the URL came from, lowercase. */
  tag?: string;
  rel?: string;
  type?: string;
}

/**
 * Bucket a URL. The element it came from wins where that is unambiguous (an
 * `<img>` is an image whether or not its URL ends in `.png`), and the file
 * extension decides the rest.
 */
export function classifyLink(url: string, hints: KindHints = {}): LinkKind {
  const rel = hints.rel?.toLowerCase() ?? "";
  const type = hints.type?.toLowerCase() ?? "";

  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/") || type.startsWith("audio/")) return "media";
  if (type.startsWith("font/")) return "font";
  if (/rss|atom/.test(type)) return "feed";

  switch (hints.tag) {
    case "img":
      return "image";
    case "script":
      return "script";
    case "video":
    case "audio":
    case "track":
      return "media";
    default:
      break;
  }

  if (rel) {
    if (/stylesheet/.test(rel)) return "stylesheet";
    if (/icon|apple-touch|image_src/.test(rel)) return "image";
  }

  const byExtension = KIND_BY_EXTENSION.get(extensionOf(url));
  if (byExtension) return byExtension;
  return hints.tag === "a" || hints.tag === "area" || hints.tag === "link" ? "page" : "other";
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** `a.png 1x, b.png 2x` becomes `["a.png", "b.png"]`; descriptors are dropped. */
export function parseSrcset(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/** Pull every `url(...)` target out of a chunk of CSS. */
export function parseCssUrls(css: string): string[] {
  const found: string[] = [];
  for (const match of css.matchAll(CSS_URL)) {
    const target = match[2]?.trim();
    if (target && !target.startsWith("data:")) found.push(target);
  }
  return found;
}

interface Candidate {
  href: string;
  text: string;
  origin: string;
  hints: KindHints;
  rel?: string;
}

function tagOf(element: AnyNode): string {
  return (element as { tagName?: string }).tagName?.toLowerCase() ?? "";
}

/** Every element attribute on the page that can carry a URL. */
function candidatesFrom($: cheerio.CheerioAPI): Candidate[] {
  const candidates: Candidate[] = [];
  const push = (
    href: string | undefined,
    text: string,
    origin: string,
    hints: KindHints,
    rel?: string,
  ): void => {
    if (!href) return;
    const candidate: Candidate = { href, text: collapse(text).slice(0, 300), origin, hints };
    if (rel) candidate.rel = rel;
    candidates.push(candidate);
  };

  $("a[href], area[href]").each((_, element) => {
    const node = $(element);
    const tag = tagOf(element);
    push(
      node.attr("href"),
      node.text() || node.attr("title") || node.attr("alt") || "",
      `${tag}[href]`,
      { tag, type: node.attr("type") ?? "" },
      node.attr("rel"),
    );
  });

  $("link[href]").each((_, element) => {
    const node = $(element);
    const rel = node.attr("rel") ?? "";
    push(
      node.attr("href"),
      node.attr("title") ?? rel,
      `link[rel=${rel || "?"}]`,
      { tag: "link", rel, type: node.attr("type") ?? "" },
      rel,
    );
  });

  $("script[src]").each((_, element) => {
    push($(element).attr("src"), "", "script[src]", { tag: "script" });
  });

  $("img").each((_, element) => {
    const node = $(element);
    const alt = node.attr("alt") ?? "";
    for (const attribute of ["src", "data-src", "data-original", "data-lazy-src"]) {
      push(node.attr(attribute), alt, `img[${attribute}]`, { tag: "img" });
    }
    for (const source of parseSrcset(node.attr("srcset") ?? "")) {
      push(source, alt, "img[srcset]", { tag: "img" });
    }
  });

  $("source").each((_, element) => {
    const node = $(element);
    const type = node.attr("type") ?? "";
    const tag = node.parent().is("picture") ? "img" : "video";
    push(node.attr("src"), "", "source[src]", { tag, type });
    for (const source of parseSrcset(node.attr("srcset") ?? "")) {
      push(source, "", "source[srcset]", { tag, type });
    }
  });

  $("video, audio").each((_, element) => {
    const node = $(element);
    const tag = tagOf(element);
    push(node.attr("src"), "", `${tag}[src]`, { tag });
    push(node.attr("poster"), "", `${tag}[poster]`, { tag: "img" });
  });

  $("track[src]").each((_, element) => {
    push($(element).attr("src"), $(element).attr("label") ?? "", "track[src]", { tag: "track" });
  });

  $("iframe[src], embed[src]").each((_, element) => {
    const node = $(element);
    const tag = tagOf(element);
    push(node.attr("src"), node.attr("title") ?? "", `${tag}[src]`, {
      tag,
      type: node.attr("type") ?? "",
    });
  });

  $("object[data]").each((_, element) => {
    const node = $(element);
    push(node.attr("data"), "", "object[data]", { tag: "object", type: node.attr("type") ?? "" });
  });

  $("form[action]").each((_, element) => {
    push($(element).attr("action"), "", "form[action]", { tag: "a" });
  });

  $("meta[content]").each((_, element) => {
    const node = $(element);
    const key = (node.attr("property") ?? node.attr("name") ?? "").toLowerCase();
    if (!/^(og:image|og:video|og:audio|og:url|twitter:image)/.test(key)) return;
    if (/:(width|height|type|alt|secure_url)$/.test(key)) return;
    const tag = key.includes("image") ? "img" : key.includes("url") ? "a" : "video";
    push(node.attr("content"), key, `meta[${key}]`, { tag });
  });

  $("[style]").each((_, element) => {
    for (const target of parseCssUrls($(element).attr("style") ?? "")) {
      push(target, "", "css url()", {});
    }
  });

  $("style").each((_, element) => {
    for (const target of parseCssUrls($(element).text())) {
      push(target, "", "css url()", {});
    }
  });

  return candidates;
}

export interface HarvestOptions {
  /** Keep only anchors (`a` / `area`) — what `format: "links"` has always meant. */
  anchorsOnly?: boolean;
  /** Keep everything except anchors: the resources the page loads. */
  assetsOnly?: boolean;
}

/**
 * Walk a parsed document and return every http(s) URL it references, in
 * document order, de-duplicated by URL plus the element it came from.
 */
export function harvestLinks(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  options: HarvestOptions = {},
): HarvestedLink[] {
  const pageHost = hostOf(baseUrl);
  const seen = new Set<string>();
  const links: HarvestedLink[] = [];

  for (const candidate of candidatesFrom($)) {
    const isAnchor = candidate.origin.startsWith("a[") || candidate.origin.startsWith("area[");
    if (options.anchorsOnly && !isAnchor) continue;
    if (options.assetsOnly && isAnchor) continue;

    const url = absolutize(candidate.href, baseUrl);
    if (!url) continue;
    const key = `${url} ${candidate.origin}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const domain = hostOf(url);
    const link: HarvestedLink = {
      url,
      text: candidate.text,
      origin: candidate.origin,
      kind: classifyLink(url, candidate.hints),
      domain,
      internal: domain === pageHost,
      ext: extensionOf(url),
    };
    if (candidate.rel) link.rel = candidate.rel;
    links.push(link);
  }

  return links;
}

export interface LinkGrepOptions {
  /** Regular expression the link must match. */
  pattern?: string;
  /** Flags for `pattern`. Default `i`. */
  patternFlags?: string;
  /** Case-insensitive substring the link must contain. */
  contains?: string;
  /** What `pattern` and `contains` are tested against. Default `both`. */
  matchOn?: "url" | "text" | "both";
  /** Keep only the links that do *not* match, the way `grep -v` does. */
  invert?: boolean;
  /** Keep only these kinds. */
  kinds?: LinkKind[];
  /** Keep only these file extensions, with or without a leading dot. */
  extensions?: string[];
  /** `internal` = same host as the page, `external` = anywhere else. Default `all`. */
  scope?: "all" | "internal" | "external";
  /** Keep only these hosts (suffix match, so `example.com` matches `cdn.example.com`). */
  includeDomains?: string[];
  /** Drop these hosts (suffix match). */
  excludeDomains?: string[];
  /** Collapse a URL found through several elements down to its first hit. Default true. */
  unique?: boolean;
  limit?: number;
}

function domainMatches(domain: string, pattern: string): boolean {
  const target = pattern
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  if (!target) return false;
  return domain === target || domain.endsWith(`.${target}`);
}

function compile(pattern: string | undefined, flags: string): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(
      `Invalid pattern ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Apply grep-style filters to harvested links, preserving document order. */
export function grepLinks(links: HarvestedLink[], options: LinkGrepOptions = {}): HarvestedLink[] {
  const {
    pattern,
    patternFlags = "i",
    contains,
    matchOn = "both",
    invert = false,
    kinds,
    extensions,
    scope = "all",
    includeDomains,
    excludeDomains,
    unique = true,
    limit,
  } = options;

  const regex = compile(pattern, patternFlags);
  const wantedKinds = kinds?.length ? new Set<LinkKind>(kinds) : null;
  const wantedExtensions = extensions?.length
    ? new Set(extensions.map((extension) => extension.replace(/^\./, "").toLowerCase()))
    : null;
  const needle = contains?.toLowerCase();

  const seen = new Set<string>();
  const output: HarvestedLink[] = [];

  for (const link of links) {
    if (unique && seen.has(link.url)) continue;
    if (wantedKinds && !wantedKinds.has(link.kind)) continue;
    if (wantedExtensions && !wantedExtensions.has(link.ext)) continue;
    if (scope === "internal" && !link.internal) continue;
    if (scope === "external" && link.internal) continue;
    if (includeDomains?.length && !includeDomains.some((d) => domainMatches(link.domain, d))) continue;
    if (excludeDomains?.length && excludeDomains.some((d) => domainMatches(link.domain, d))) continue;

    if (regex || needle) {
      const haystack =
        matchOn === "url" ? link.url : matchOn === "text" ? link.text : `${link.url}\n${link.text}`;
      let hit = true;
      if (regex) hit = regex.test(haystack);
      if (hit && needle) hit = haystack.toLowerCase().includes(needle);
      if (hit === invert) continue;
    } else if (invert) {
      // `invert` with nothing to match against would drop every link; treat it as a no-op.
      continue;
    }

    if (unique) seen.add(link.url);
    output.push(link);
    if (limit && output.length >= limit) break;
  }

  return output;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface PageImageOptions {
  /** Keep only images served from the page's own host. */
  sameDomainOnly?: boolean;
  /** Drop favicons, apple-touch icons and other `link rel=icon` images. */
  excludeIcons?: boolean;
  /** Drop images referenced from CSS `url(...)` rather than from markup. */
  excludeBackgrounds?: boolean;
  /** Drop images whose declared size is below this. Images with no declared size are kept. */
  minWidth?: number;
  minHeight?: number;
  /** Regular expression the image URL, alt or title must match. */
  pattern?: string;
  patternFlags?: string;
  limit?: number;
}

/**
 * Collect the images a page shows: `<img>` (including lazy-load attributes and
 * srcset candidates), `<picture>` sources, video posters, OpenGraph and Twitter
 * card images, link icons, and CSS `url(...)` backgrounds.
 */
export function extractPageImages(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  options: PageImageOptions = {},
): PageImage[] {
  const {
    sameDomainOnly = false,
    excludeIcons = false,
    excludeBackgrounds = false,
    minWidth,
    minHeight,
    pattern,
    patternFlags = "i",
    limit,
  } = options;

  const regex = compile(pattern, patternFlags);
  const pageHost = hostOf(baseUrl);
  const seen = new Set<string>();
  const images: PageImage[] = [];

  const add = (
    href: string | undefined,
    origin: string,
    attributes: { alt?: string; title?: string; width?: string; height?: string } = {},
  ): void => {
    if (!href) return;
    const url = absolutize(href, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const domain = hostOf(url);
    images.push({
      url,
      alt: collapse(attributes.alt ?? "").slice(0, 300),
      title: collapse(attributes.title ?? "").slice(0, 300),
      width: toNumber(attributes.width),
      height: toNumber(attributes.height),
      origin,
      domain,
      internal: domain === pageHost,
      ext: extensionOf(url),
    });
  };

  $("img").each((_, element) => {
    const node = $(element);
    const attributes = {
      alt: node.attr("alt") || node.closest("figure").find("figcaption").first().text() || "",
      title: node.attr("title") ?? "",
      width: node.attr("width") ?? "",
      height: node.attr("height") ?? "",
    };
    add(node.attr("src"), "img[src]", attributes);
    for (const attribute of ["data-src", "data-original", "data-lazy-src"]) {
      add(node.attr(attribute), `img[${attribute}]`, attributes);
    }
    for (const source of parseSrcset(node.attr("srcset") ?? "")) {
      add(source, "img[srcset]", attributes);
    }
  });

  $("picture source").each((_, element) => {
    const node = $(element);
    const attributes = { alt: node.parent().find("img").first().attr("alt") ?? "" };
    add(node.attr("src"), "picture source[src]", attributes);
    for (const source of parseSrcset(node.attr("srcset") ?? "")) {
      add(source, "picture source[srcset]", attributes);
    }
  });

  $("video[poster]").each((_, element) => {
    add($(element).attr("poster"), "video[poster]", { title: $(element).attr("title") ?? "" });
  });

  $("meta[content]").each((_, element) => {
    const node = $(element);
    const key = (node.attr("property") ?? node.attr("name") ?? "").toLowerCase();
    if (!/^(og:image|twitter:image)/.test(key)) return;
    if (/:(width|height|type|alt)$/.test(key)) return;
    add(node.attr("content"), `meta[${key}]`, { alt: key });
  });

  if (!excludeIcons) {
    $("link[href]").each((_, element) => {
      const node = $(element);
      const rel = (node.attr("rel") ?? "").toLowerCase();
      if (!/icon|apple-touch|image_src/.test(rel)) return;
      const sizes = node.attr("sizes")?.match(/^(\d+)x(\d+)$/i);
      add(node.attr("href"), `link[rel=${rel}]`, {
        alt: rel,
        ...(sizes ? { width: sizes[1] as string, height: sizes[2] as string } : {}),
      });
    });
  }

  if (!excludeBackgrounds) {
    const fromCss = (target: string): void => {
      const resolved = absolutize(target, baseUrl);
      if (!resolved) return;
      const extension = extensionOf(resolved);
      // Extensionless CSS urls are usually image CDNs; anything with an
      // extension has to actually look like an image.
      if (extension && KIND_BY_EXTENSION.get(extension) !== "image") return;
      add(target, "css background", {});
    };
    $("[style]").each((_, element) => {
      for (const target of parseCssUrls($(element).attr("style") ?? "")) fromCss(target);
    });
    $("style").each((_, element) => {
      for (const target of parseCssUrls($(element).text())) fromCss(target);
    });
  }

  const filtered = images.filter((image) => {
    if (sameDomainOnly && !image.internal) return false;
    if (minWidth && image.width !== null && image.width < minWidth) return false;
    if (minHeight && image.height !== null && image.height < minHeight) return false;
    if (regex && !regex.test(`${image.url}\n${image.alt}\n${image.title}`)) return false;
    return true;
  });

  return limit ? filtered.slice(0, limit) : filtered;
}
