import { describe, expect, it } from "vitest";
import { PoliteFetcher, parseRobots, robotsAllows } from "../src/acquire/fetcher.js";

const robots = "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n";

describe("robots handling", () => {
  it("parses allow and disallow rules for the wildcard agent", () => {
    const rules = parseRobots(robots, "AccelCaseIntelligence/0.1");
    expect(rules.disallow).toEqual(["/wp-admin/"]);
    expect(rules.allow).toEqual(["/wp-admin/admin-ajax.php"]);
  });

  it("allows document paths and refuses disallowed ones", () => {
    const rules = parseRobots(robots);
    expect(robotsAllows(rules, "/wp-content/uploads/2026/11/x.pdf")).toBe(true);
    expect(robotsAllows(rules, "/wp-admin/options.php")).toBe(false);
    expect(robotsAllows(rules, "/wp-admin/admin-ajax.php")).toBe(true);
  });
});

describe("polite fetcher", () => {
  function fakeFetch(responses: Record<string, { status: number; body: string | Uint8Array; type?: string }>) {
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      const r = responses[url] ?? { status: 404, body: "" };
      return new Response(r.body as BodyInit, { status: r.status, headers: { "content-type": r.type ?? "text/plain" } });
    }) as typeof fetch;
    return { impl, calls };
  }

  it("waits at least the minimum delay between requests", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const { impl } = fakeFetch({
      "https://example.test/robots.txt": { status: 200, body: robots },
      "https://example.test/a.html": { status: 200, body: "<html></html>", type: "text/html" },
      "https://example.test/b.html": { status: 200, body: "<html></html>", type: "text/html" },
    });
    const f = new PoliteFetcher({
      userAgent: "test",
      minDelayMs: 3000,
      fetchImpl: impl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await f.getText("https://example.test/a.html");
    await f.getText("https://example.test/b.html");
    expect(sleeps.filter((s) => s > 0)).toEqual([3000, 3000]);
  });

  it("refuses robots-disallowed paths before making the request", async () => {
    const { impl, calls } = fakeFetch({ "https://example.test/robots.txt": { status: 200, body: robots } });
    const f = new PoliteFetcher({ userAgent: "test", minDelayMs: 0, fetchImpl: impl });
    await expect(f.getText("https://example.test/wp-admin/secret.html")).rejects.toThrow(/robots\.txt disallows/);
    expect(calls).toEqual(["https://example.test/robots.txt"]);
  });

  it("refuses a non-PDF answer where a PDF was expected", async () => {
    const { impl } = fakeFetch({
      "https://example.test/robots.txt": { status: 200, body: robots },
      "https://example.test/doc.pdf": { status: 200, body: "<html>Please log in</html>", type: "text/html" },
    });
    const f = new PoliteFetcher({ userAgent: "test", minDelayMs: 0, fetchImpl: impl });
    await expect(f.getPdf("https://example.test/doc.pdf")).rejects.toThrow(/did not return a PDF/);
  });

  it("hashes a real PDF payload", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const { impl } = fakeFetch({
      "https://example.test/robots.txt": { status: 200, body: robots },
      "https://example.test/doc.pdf": { status: 200, body: pdf, type: "application/pdf" },
    });
    const f = new PoliteFetcher({ userAgent: "test", minDelayMs: 0, fetchImpl: impl });
    const r = await f.getPdf("https://example.test/doc.pdf");
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.bytes.length).toBe(pdf.length);
  });
});
