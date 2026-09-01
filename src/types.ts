/** Shared result shapes used across search, scrape, image and filter modules. */

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

/** One hit from DuckDuckGo's image search. */
export interface ImageResult {
  /** 1-based position in the engine output. */
  rank: number;
  title: string;
  /** Direct URL of the full-size image, ready for `view_image`. */
  imageUrl: string;
  /** DuckDuckGo-hosted thumbnail — smaller, and served even when the origin blocks hotlinking. */
  thumbnailUrl: string;
  /** The page the image appears on. */
  sourceUrl: string;
  /** Hostname of `sourceUrl` without a leading `www.`. */
  domain: string;
  width: number;
  height: number;
  /** File extension of `imageUrl`, lowercase and without the dot, when the path has one. */
  ext: string;
  /** Which upstream index the hit came from, e.g. `Bing`. */
  provider: string;
}

export interface ImageSearchResponse {
  query: string;
  /** Query actually sent to the engine, after `site:` was folded in. */
  effectiveQuery: string;
  results: ImageResult[];
  pagesFetched: number;
  notices: string[];
}

/** Coarse bucket a URL falls into, derived from the element it came from and its extension. */
export type LinkKind =
  | "page"
  | "image"
  | "script"
  | "stylesheet"
  | "media"
  | "document"
  | "archive"
  | "font"
  | "feed"
  | "data"
  | "other";

/** Any URL found on a page — a link to another site, or an asset the page loads. */
export interface HarvestedLink {
  url: string;
  /** Anchor text, `alt`, or the element's own label. Empty when the element has none. */
  text: string;
  /** Where it was found, e.g. `a[href]`, `img[srcset]`, `link[rel=stylesheet]`, `css url()`. */
  origin: string;
  kind: LinkKind;
  /** Hostname without a leading `www.`. */
  domain: string;
  /** True when the URL is on the same host as the page it was found on. */
  internal: boolean;
  /** Lowercase file extension without the dot, empty when the path has none. */
  ext: string;
  /** `rel` attribute, for anchors and `<link>` elements that carry one. */
  rel?: string;
}

/** An image referenced by a page, with whatever the markup said about it. */
export interface PageImage {
  url: string;
  /** `alt` text, or the anchor/figcaption text when the markup has no alt. */
  alt: string;
  title: string;
  /** Declared width/height when the markup gives them, else null. */
  width: number | null;
  height: number | null;
  /** Where it was found, e.g. `img[src]`, `og:image`, `css background`. */
  origin: string;
  domain: string;
  internal: boolean;
  ext: string;
}

export type ScrapeFormat = "text" | "markdown" | "html" | "links" | "images" | "assets" | "metadata";

/** A link or asset found on a scraped page. Same shape as `HarvestedLink`. */
export type ScrapedLink = HarvestedLink;

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
  /** Populated for the `links` and `assets` formats. */
  links: ScrapedLink[];
  /** Populated for the `images` format. */
  images: PageImage[];
  /** Populated for the `metadata` format: meta tags, OpenGraph, JSON-LD types. */
  metadata: Record<string, string>;
  /** True when `content` was cut off by `maxChars`, or the list was cut off by its cap. */
  truncated: boolean;
  bytes: number;
  elapsedMs: number;
}

/** A fetched image, ready to hand to a vision-capable client. */
export interface ViewedImage {
  url: string;
  finalUrl: string;
  status: number;
  mimeType: string;
  /** Base64 of the raw image bytes. */
  data: string;
  bytes: number;
  /** Pixel dimensions sniffed from the file header, null when the format is unknown. */
  width: number | null;
  height: number | null;
  format: string;
  elapsedMs: number;
}
