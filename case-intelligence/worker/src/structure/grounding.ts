// Grounding check: an assertion survives only if its quote can be located on
// the cited page. This is the primary defense against fabricated citations.

export interface GroundingResult {
  ok: boolean;
  method: "exact" | "normalized" | "spaceless" | "fuzzy" | "none";
  char_start: number | null;
  char_end: number | null;
  /** Confidence multiplier: 1 for exact/normalized/spaceless, 0.85 for fuzzy, 0 for none. */
  penalty: number;
}

export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Bigram Dice similarity on normalized strings. */
export function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

export function groundQuote(pageText: string, quote: string, threshold = 0.9): GroundingResult {
  const q = quote.trim();
  if (!q) return { ok: false, method: "none", char_start: null, char_end: null, penalty: 0 };
  const exact = pageText.indexOf(q);
  if (exact >= 0) return { ok: true, method: "exact", char_start: exact, char_end: exact + q.length, penalty: 1 };

  const normPage = normalizeForMatch(pageText);
  const normQuote = normalizeForMatch(q);
  const idx = normPage.indexOf(normQuote);
  if (idx >= 0) return { ok: true, method: "normalized", char_start: idx, char_end: idx + normQuote.length, penalty: 1 };

  // Text layers of scanned filings often split words ("r eceiver", "th e C ourt").
  // A quote whose characters match the page exactly once all whitespace is removed
  // is still a verbatim quote; map the match back to normalized-page offsets.
  const squeezedQuote = normQuote.replace(/\s+/g, "");
  if (squeezedQuote.length >= 12) {
    const map: number[] = [];
    let squeezedPage = "";
    for (let i = 0; i < normPage.length; i++) {
      if (normPage[i] !== " ") { squeezedPage += normPage[i]; map.push(i); }
    }
    const at = squeezedPage.indexOf(squeezedQuote);
    if (at >= 0) return { ok: true, method: "spaceless", char_start: map[at], char_end: map[at + squeezedQuote.length - 1] + 1, penalty: 1 };
  }

  // Sliding window over the normalized page at the quote's length, stepping by
  // a few characters; accept the best window above the threshold.
  const len = normQuote.length;
  if (len >= 12 && normPage.length >= len) {
    let best = 0;
    let bestAt = -1;
    const step = Math.max(1, Math.floor(len / 8));
    for (let i = 0; i + len <= normPage.length; i += step) {
      const sim = diceSimilarity(normPage.slice(i, i + len), normQuote);
      if (sim > best) {
        best = sim;
        bestAt = i;
      }
    }
    if (best >= threshold) return { ok: true, method: "fuzzy", char_start: bestAt, char_end: bestAt + len, penalty: 0.85 };
  }
  return { ok: false, method: "none", char_start: null, char_end: null, penalty: 0 };
}
