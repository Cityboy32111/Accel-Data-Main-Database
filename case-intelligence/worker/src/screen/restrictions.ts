// Screening stage: restriction markers and personal-data masking.
// Runs before any LLM call. Sealed markers halt processing; PII is masked in
// stored page text while the original stays only in private Storage.

export const DEFAULT_RESTRICTION_MARKERS = [
  "FILED UNDER SEAL",
  "UNDER SEAL",
  "SEALED",
  "CONFIDENTIAL",
  "PROTECTIVE ORDER",
  "RESTRICTED",
];

export type RestrictionFlag =
  | "sealed_marker"
  | "protective_order_reference"
  | "confidential_marker"
  | "restricted_marker"
  | "redaction_present"
  | "pii_detected";

export interface ScreenResult {
  flags: RestrictionFlag[];
  /** Flags that must halt processing until a reviewer clears the document. */
  halting: RestrictionFlag[];
  matches: { marker: string; context: string }[];
}

const HALTING: RestrictionFlag[] = ["sealed_marker"];

function flagFor(marker: string): RestrictionFlag {
  const m = marker.toUpperCase();
  if (m.includes("SEAL")) return "sealed_marker";
  if (m.includes("PROTECTIVE")) return "protective_order_reference";
  if (m.includes("CONFIDENTIAL")) return "confidential_marker";
  return "restricted_marker";
}

/**
 * Scan the opening pages of a document for restriction markers. A marker only
 * counts when it appears as a standalone phrase in caption-like context (the
 * word "sealed" inside ordinary prose about a sealed envelope would otherwise
 * halt every filing that discusses one). We approximate caption context as:
 * uppercase match, or the phrase appearing in the first 1,500 characters.
 */
export function screenText(text: string, markers: string[] = DEFAULT_RESTRICTION_MARKERS): ScreenResult {
  const flags = new Set<RestrictionFlag>();
  const matches: ScreenResult["matches"] = [];
  const head = text.slice(0, 1500);
  for (const marker of markers) {
    const re = new RegExp(`\\b${marker.replace(/\s+/g, "\\s+")}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const inHead = m.index < head.length;
      const isUpper = m[0] === m[0].toUpperCase();
      if (!inHead && !isUpper) continue;
      // "sealed" appearing in a docket-text style phrase like "motion to seal" is not a sealed filing.
      flags.add(flagFor(marker));
      matches.push({ marker, context: text.slice(Math.max(0, m.index - 60), m.index + marker.length + 60) });
      if (matches.length > 20) break;
    }
  }
  if (/\[REDACTED\]|\bREDACTED\b|█{3,}/.test(text)) flags.add("redaction_present");
  const pii = detectPii(text);
  if (pii.total > 0) flags.add("pii_detected");
  const flagList = [...flags];
  return { flags: flagList, halting: flagList.filter((f) => HALTING.includes(f)), matches };
}

export interface PiiCounts {
  ssn: number;
  accountNumber: number;
  dateOfBirth: number;
  total: number;
}

const SSN_RE = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
const ACCOUNT_RE = /\b(?:acct|account|a\/c)\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d[\d -]{7,}\d)\b/gi;
const DOB_RE = /\b(?:DOB|date of birth)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi;

export function detectPii(text: string): PiiCounts {
  const ssn = (text.match(SSN_RE) ?? []).length;
  const accountNumber = (text.match(ACCOUNT_RE) ?? []).length;
  const dateOfBirth = (text.match(DOB_RE) ?? []).length;
  return { ssn, accountNumber, dateOfBirth, total: ssn + accountNumber + dateOfBirth };
}

/** Mask personal identifiers in page text before it is stored or sent to a model. */
export function maskPii(text: string): { text: string; counts: PiiCounts } {
  const counts = detectPii(text);
  let out = text.replace(SSN_RE, "[SSN REDACTED]");
  out = out.replace(ACCOUNT_RE, (whole, digits: string) => whole.replace(digits, "[ACCOUNT REDACTED]"));
  out = out.replace(DOB_RE, (whole, date: string) => whole.replace(date, "[DOB REDACTED]"));
  return { text: out, counts };
}
