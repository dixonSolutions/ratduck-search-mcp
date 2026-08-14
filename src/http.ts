import dns from "node:dns/promises";
import net from "node:net";

/** Thrown for anything the caller can act on: blocked host, timeout, bad status. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "blocked"
      | "timeout"
      | "status"
      | "too_large"
      | "network"
      | "unsupported",
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
];

let uaCursor = 0;

export function nextUserAgent(): string {
  const override = process.env.RATDUCK_USER_AGENT;
  if (override) return override;
  const ua = USER_AGENTS[uaCursor % USER_AGENTS.length]!;
  uaCursor += 1;
  return ua;
}

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  /** Skip the private-network guard. Only used for the DuckDuckGo endpoints. */
  allowPrivate?: boolean;
}

export interface FetchTextResult {
  text: string;
  status: number;
  finalUrl: string;
  contentType: string;
  bytes: number;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.RATDUCK_TIMEOUT_MS ?? 15_000);
const DEFAULT_MAX_BYTES = Number(process.env.RATDUCK_MAX_BYTES ?? 4_000_000);

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number) as [number, number, number, number];
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (version === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
    // IPv4-mapped addresses (::ffff:10.0.0.1)
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}

/**
 * Refuse loopback / RFC1918 / link-local destinations so a prompt-injected URL
 * cannot turn this server into an internal-network probe.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError(`Not a valid URL: ${rawUrl}`, "unsupported");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError(`Only http/https URLs are supported, got ${url.protocol}`, "unsupported");
  }
  if (process.env.RATDUCK_ALLOW_PRIVATE === "1") return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new FetchError(`Refusing to fetch private host: ${host}`, "blocked");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new FetchError(`Refusing to fetch private address: ${host}`, "blocked");
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new FetchError(`DNS lookup failed for ${host}`, "network");
  }
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new FetchError(`Refusing to fetch host resolving to a private address: ${host}`, "blocked");
  }
  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch a URL as text, with timeout, bounded body size and retry on 429/5xx. */
export async function fetchText(rawUrl: string, options: FetchOptions = {}): Promise<FetchTextResult> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    retries = 2,
    allowPrivate = false,
  } = options;

  if (!allowPrivate) await assertPublicUrl(rawUrl);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(rawUrl, {
        method,
        body,
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": nextUserAgent(),
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          // Deliberately no accept-encoding: undici only decompresses responses
          // when it set that header itself.
          "upgrade-insecure-requests": "1",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": method === "POST" ? "same-origin" : "none",
          "sec-fetch-user": "?1",
          ...headers,
        },
      });

      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        lastError = new FetchError(
          `Upstream returned ${response.status}`,
          "status",
          response.status,
        );
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared && declared > maxBytes) {
        throw new FetchError(
          `Response is ${declared} bytes, over the ${maxBytes} byte limit`,
          "too_large",
        );
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        throw new FetchError(
          `Response is ${buffer.byteLength} bytes, over the ${maxBytes} byte limit`,
          "too_large",
        );
      }
      const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/"/g, "");
      let text: string;
      try {
        text = new TextDecoder(charset || "utf-8").decode(buffer);
      } catch {
        text = new TextDecoder("utf-8").decode(buffer);
      }

      return {
        text,
        status: response.status,
        finalUrl: response.url || rawUrl,
        contentType,
        bytes: buffer.byteLength,
      };
    } catch (error) {
      if (error instanceof FetchError && error.code !== "status") throw error;
      lastError = error;
      const aborted = error instanceof Error && error.name === "AbortError";
      if (aborted && attempt >= retries) {
        throw new FetchError(`Request to ${rawUrl} timed out after ${timeoutMs}ms`, "timeout");
      }
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof FetchError) throw lastError;
  throw new FetchError(
    `Request to ${rawUrl} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    "network",
  );
}
