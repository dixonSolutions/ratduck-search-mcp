import { Buffer } from "node:buffer";
import { FetchError, fetchBinary, fetchText } from "./http.js";
import { buildEffectiveQuery, domainOf } from "./ddg.js";
import { extensionOf } from "./links.js";
import type { ImageResult, ImageSearchResponse, ViewedImage } from "./types.js";

/**
 * DuckDuckGo image search. Unlike web search there is no no-JavaScript HTML
 * front end for images: the page is a shell that calls `i.js`, and `i.js`
 * refuses to answer without a `vqd` token minted by the shell. So the flow is
 * two requests — fetch the shell for the token, then hit the JSON endpoint.
 */

const TOKEN_URL = "https://duckduckgo.com/";
const IMAGE_URL = "https://duckduckgo.com/i.js";

export type ImageSize = "any" | "small" | "medium" | "large" | "wallpaper";
export type ImageType = "any" | "photo" | "clipart" | "gif" | "transparent" | "line";
export type ImageLayout = "any" | "square" | "tall" | "wide";
export type ImageColor =
  | "any"
  | "color"
  | "monochrome"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "brown"
  | "black"
  | "gray"
  | "teal"
  | "white";
export type ImageLicense =
  | "any"
  | "public"
  | "share"
  | "shareCommercially"
  | "modify"
  | "modifyCommercially";
export type ImageTimeRange = "any" | "day" | "week" | "month" | "year";

export interface ImageSearchOptions {
  query: string;
  maxResults?: number;
  region?: string;
  /** DuckDuckGo only offers on/off for image safe search; `moderate` maps to on. */
  safeSearch?: "off" | "moderate" | "strict";
  size?: ImageSize;
  type?: ImageType;
  layout?: ImageLayout;
  color?: ImageColor;
  license?: ImageLicense;
  timeRange?: ImageTimeRange;
  /** Restrict to a single site, folded into the query as `site:`. */
  site?: string;
  /** Hosts to drop from the output entirely, matched against the source page. */
  excludeDomains?: string[];
  /** Hard cap on how many pages of engine output to fetch. Each page is ~100 hits. */
  maxPages?: number;
}

const SIZE_CODES: Record<Exclude<ImageSize, "any">, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  wallpaper: "Wallpaper",
};

const TYPE_CODES: Record<Exclude<ImageType, "any">, string> = {
  photo: "photo",
  clipart: "clipart",
  gif: "gif",
  transparent: "transparent",
  line: "line",
};

const LAYOUT_CODES: Record<Exclude<ImageLayout, "any">, string> = {
  square: "Square",
  tall: "Tall",
  wide: "Wide",
};

const LICENSE_CODES: Record<Exclude<ImageLicense, "any">, string> = {
  public: "Public",
  share: "Share",
  shareCommercially: "ShareCommercially",
  modify: "Modify",
  modifyCommercially: "ModifyCommercially",
};

const TIME_CODES: Record<Exclude<ImageTimeRange, "any">, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

/**
 * Build the `f` parameter, which DuckDuckGo expects as six comma-separated
 * slots: time, size, color, type, layout, license. Empty slots stay empty.
 */
export function buildImageFilters(options: ImageSearchOptions): string {
  const color =
    options.color && options.color !== "any"
      ? options.color === "color"
        ? "color:color"
        : options.color === "monochrome"
          ? "color:Monochrome"
          : `color:${options.color}`
      : "";
  const slots = [
    options.timeRange && options.timeRange !== "any" ? TIME_CODES[options.timeRange] : "",
    options.size && options.size !== "any" ? `size:${SIZE_CODES[options.size]}` : "",
    color,
    options.type && options.type !== "any" ? `type:${TYPE_CODES[options.type]}` : "",
    options.layout && options.layout !== "any" ? `layout:${LAYOUT_CODES[options.layout]}` : "",
    options.license && options.license !== "any" ? `license:${LICENSE_CODES[options.license]}` : "",
  ];
  return slots.join(",");
}

/** Pull the `vqd` token out of the search-page shell. Exported for tests. */
export function extractVqd(html: string): string | null {
  const patterns = [
    /vqd=["']([^"']+)["']/,
    /vqd=([0-9-]+[a-z0-9-]*)&/i,
    /"vqd":\s*["']([^"']+)["']/,
    /vqd=([^&"'\s]+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const token = match?.[1];
    if (token && token.length > 2) return token;
  }
  return null;
}

interface RawImage {
  title?: unknown;
  image?: unknown;
  thumbnail?: unknown;
  url?: unknown;
  height?: unknown;
  width?: unknown;
  source?: unknown;
}

export interface ParsedImagePage {
  results: Array<Omit<ImageResult, "rank">>;
  /** Offset of the next page, when the engine offers one. */
  next: string | null;
  blocked: boolean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Parse one `i.js` payload. Exported so it can be tested without the network. */
export function parseImagePayload(body: string): ParsedImagePage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A challenge page or an error string comes back as HTML, not JSON.
    return { results: [], next: null, blocked: true };
  }

  const payload = parsed as { results?: unknown; next?: unknown };
  if (!Array.isArray(payload.results)) return { results: [], next: null, blocked: true };

  const results: Array<Omit<ImageResult, "rank">> = [];
  for (const raw of payload.results as RawImage[]) {
    const imageUrl = asString(raw.image);
    if (!/^https?:\/\//i.test(imageUrl)) continue;
    const sourceUrl = asString(raw.url);
    results.push({
      title: asString(raw.title).replace(/\s+/g, " ").trim(),
      imageUrl,
      thumbnailUrl: asString(raw.thumbnail),
      sourceUrl,
      domain: domainOf(sourceUrl) || domainOf(imageUrl),
      width: asNumber(raw.width),
      height: asNumber(raw.height),
      ext: extensionOf(imageUrl),
      provider: asString(raw.source),
    });
  }

  // `next` looks like `i.js?q=...&s=100&...`; only the offset matters to us.
  const next = typeof payload.next === "string" ? (/[?&]s=(\d+)/.exec(payload.next)?.[1] ?? null) : null;
  return { results, next, blocked: false };
}

/** Fetch the search shell and mint a `vqd` token for the query. */
async function fetchVqd(query: string): Promise<string | null> {
  const url = `${TOKEN_URL}?${new URLSearchParams({ q: query, ia: "images", iax: "images" }).toString()}`;
  const response = await fetchText(url, { allowPrivate: true, retries: 1 });
  return extractVqd(response.text);
}

async function fetchImagePage(
  query: string,
  vqd: string,
  filters: string,
  region: string,
  safeSearch: string,
  offset: string,
): Promise<string> {
  const params = new URLSearchParams({
    l: region,
    o: "json",
    q: query,
    vqd,
    f: filters,
    p: safeSearch,
  });
  if (offset !== "0") params.set("s", offset);
  const response = await fetchText(`${IMAGE_URL}?${params.toString()}`, {
    allowPrivate: true,
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      referer: "https://duckduckgo.com/",
      "x-requested-with": "XMLHttpRequest",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    },
  });
  return response.text;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a DuckDuckGo image search, paging until `maxResults` is satisfied. */
export async function searchImages(options: ImageSearchOptions): Promise<ImageSearchResponse> {
  const {
    query,
    maxResults = 20,
    region = "wt-wt",
    safeSearch = "moderate",
    site,
    excludeDomains = [],
    maxPages = 3,
  } = options;

  if (!query.trim()) throw new FetchError("Query must not be empty", "unsupported");

  const effectiveQuery = buildEffectiveQuery(query, site);
  const notices: string[] = [];
  const excluded = new Set(excludeDomains.map((domain) => domain.replace(/^www\./i, "").toLowerCase()));
  const filters = buildImageFilters(options);
  // The image endpoint only knows on (1) and off (-1); there is no moderate tier.
  const safeSearchCode = safeSearch === "off" ? "-1" : "1";

  const vqd = await fetchVqd(effectiveQuery);
  if (!vqd) {
    throw new FetchError(
      "Could not obtain a DuckDuckGo image-search token (vqd). The search page may be rate-limiting; retry shortly.",
      "blocked",
    );
  }

  const collected: ImageResult[] = [];
  const seen = new Set<string>();
  let offset = "0";
  let pagesFetched = 0;
  let rank = 0;

  for (let page = 0; page < Math.max(1, maxPages); page += 1) {
    if (page > 0) await delay(500);

    const parsed = parseImagePayload(
      await fetchImagePage(effectiveQuery, vqd, filters, region, safeSearchCode, offset),
    );
    pagesFetched += 1;

    if (parsed.blocked) {
      notices.push(
        "DuckDuckGo returned a rate-limit / anomaly response for image search. Wait a few seconds and retry, or lower maxResults.",
      );
      break;
    }
    if (parsed.results.length === 0) {
      if (collected.length === 0) notices.push("DuckDuckGo reported no images for this query.");
      break;
    }

    for (const item of parsed.results) {
      if (excluded.has(item.domain)) continue;
      if (seen.has(item.imageUrl)) continue;
      seen.add(item.imageUrl);
      rank += 1;
      collected.push({ rank, ...item });
      if (collected.length >= maxResults) break;
    }

    if (collected.length >= maxResults) break;
    if (!parsed.next) break;
    offset = parsed.next;
  }

  return {
    query,
    effectiveQuery,
    results: collected.slice(0, maxResults),
    pagesFetched,
    notices,
  };
}

/**
 * Fetching an image so a vision-capable client can actually look at it.
 */

const MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
};

export interface ImageInfo {
  format: string;
  width: number | null;
  height: number | null;
}

/**
 * Read pixel dimensions straight out of the file header. Covers the formats a
 * web page actually serves; anything else comes back with nulls rather than an
 * error, since a client can still display it.
 */
export function imageInfo(buffer: Buffer): ImageInfo {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { format: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { format: "gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 26 && buffer.toString("ascii", 0, 2) === "BM") {
    return { format: "bmp", width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) };
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        format: "webp",
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunk === "VP8 ") {
      return {
        format: "webp",
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { format: "webp", width: null, height: null };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    // Walk the JPEG segment chain to the first start-of-frame marker.
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1] ?? 0;
      const length = buffer.readUInt16BE(offset + 2);
      // SOF0-SOF15, skipping the four markers in that range that are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          format: "jpeg",
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      if (length <= 0) break;
      offset += 2 + length;
    }
    return { format: "jpeg", width: null, height: null };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(buffer.toString("ascii", 8, 12))) {
    return { format: "avif", width: null, height: null };
  }
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 512));
  if (/<svg[\s>]/i.test(head)) {
    const width = /\bwidth\s*=\s*["']?(\d+)/i.exec(head)?.[1];
    const height = /\bheight\s*=\s*["']?(\d+)/i.exec(head)?.[1];
    const viewBox = /viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i.exec(head);
    return {
      format: "svg",
      width: width ? Number(width) : viewBox?.[1] ? Math.round(Number(viewBox[1])) : null,
      height: height ? Number(height) : viewBox?.[2] ? Math.round(Number(viewBox[2])) : null,
    };
  }
  return { format: "unknown", width: null, height: null };
}

export interface ViewImageOptions {
  url: string;
  /** Refuse anything larger, before decoding. Default 3 MB. */
  maxBytes?: number;
  timeoutMs?: number;
  /** Send this page as the referer — some hosts refuse hotlinked images without it. */
  referer?: string;
}

/**
 * Fetch an image and return it base64-encoded, ready to hand to a client as
 * image content. Non-image responses are refused so a redirect to an HTML
 * error page does not arrive as a broken picture.
 */
export async function viewImage(options: ViewImageOptions): Promise<ViewedImage> {
  const { url, maxBytes = 3_000_000, timeoutMs, referer } = options;

  const startedAt = Date.now();
  const response = await fetchBinary(url, {
    maxBytes,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(referer ? { headers: { referer } } : {}),
  });
  const elapsedMs = Date.now() - startedAt;

  const info = imageInfo(response.body);
  const declared = response.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const looksLikeImage = declared.startsWith("image/") || info.format !== "unknown";
  if (!looksLikeImage) {
    throw new FetchError(
      `${response.finalUrl} returned ${declared || "an unknown content type"}, not an image`,
      "unsupported",
    );
  }

  return {
    url,
    finalUrl: response.finalUrl,
    status: response.status,
    mimeType: declared.startsWith("image/") ? declared : (MIME_BY_FORMAT[info.format] ?? "image/png"),
    data: response.body.toString("base64"),
    bytes: response.bytes,
    width: info.width,
    height: info.height,
    format: info.format,
    elapsedMs,
  };
}
