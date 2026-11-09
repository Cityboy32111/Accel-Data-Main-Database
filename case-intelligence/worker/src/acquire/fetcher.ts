// Polite fetcher: one connection, a minimum delay between requests, a
// descriptive User-Agent, robots.txt respect, and content hashing. The fetcher
// never follows a login or challenge page: any non-200, non-PDF answer is an
// error, not something to work around.

import { createHash } from "node:crypto";

export interface FetcherOptions {
  userAgent: string;
  minDelayMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

export function parseRobots(text: string, userAgent = "*"): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [] };
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    switch (key.trim().toLowerCase()) {
      case "user-agent":
        applies = value === "*" || userAgent.toLowerCase().includes(value.toLowerCase());
        break;
      case "disallow":
        if (applies && value) rules.disallow.push(value);
        break;
      case "allow":
        if (applies && value) rules.allow.push(value);
        break;
    }
  }
  return rules;
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    list.filter((p) => path.startsWith(p)).sort((a, b) => b.length - a.length)[0] ?? "";
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  if (!disallow) return true;
  return allow.length >= disallow.length;
}

export class PoliteFetcher {
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private robotsCache = new Map<string, RobotsRules>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: FetcherOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.opts.minDelayMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }

  async robotsFor(url: string): Promise<RobotsRules> {
    const origin = new URL(url).origin;
    const cached = this.robotsCache.get(origin);
    if (cached) return cached;
    await this.throttle();
    const res = await this.fetchImpl(`${origin}/robots.txt`, {
      headers: { "User-Agent": this.opts.userAgent },
    });
    const rules = res.ok ? parseRobots(await res.text(), this.opts.userAgent) : { disallow: [], allow: [] };
    this.robotsCache.set(origin, rules);
    return rules;
  }

  async getText(url: string): Promise<string> {
    await this.assertAllowed(url);
    await this.throttle();
    const res = await this.fetchImpl(url, { headers: { "User-Agent": this.opts.userAgent, Accept: "text/html" } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.text();
  }

  async getPdf(url: string): Promise<{ bytes: Uint8Array; sha256: string; contentType: string | null }> {
    await this.assertAllowed(url);
    await this.throttle();
    const res = await this.fetchImpl(url, {
      headers: { "User-Agent": this.opts.userAgent, Accept: "application/pdf" },
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const contentType = res.headers.get("content-type");
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    if (!isPdf) {
      throw new Error(`GET ${url} did not return a PDF (content-type ${contentType ?? "unknown"}); refusing to continue`);
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { bytes, sha256, contentType };
  }

  private async assertAllowed(url: string): Promise<void> {
    const rules = await this.robotsFor(url);
    const path = new URL(url).pathname;
    if (!robotsAllows(rules, path)) {
      throw new Error(`robots.txt disallows ${path}; refusing to fetch`);
    }
  }
}
