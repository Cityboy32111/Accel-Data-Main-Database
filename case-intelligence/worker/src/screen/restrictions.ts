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
 * Scan the opening pages of a document for restriction markers.
 *
 * Halting is reserved for a filing that is itself sealed. Two signals count:
 * an explicit phrase ("FILED UNDER SEAL", "UNDER SEAL") anywhere in the
 * opening pages, or the bare word in caption position (the first 600
 * characters, where a sealed filing carries its legend) or in all caps.
 * Ordinary prose about sealed bids, sealed envelopes or a motion to seal is
 * recorded as context, not treated as a sealed filing: the EquityBuild sale
 * process orders speak of "public sale through sealed bids".
 */
const CAPTION_CHARS = 600;
const SEALED_PROSE_EXCEPTIONS = /^sealed\s+(bid|bids|bidding|envelope|envelopes|offer|offers)\b|^seal(ed)?\s+the\b/i;

export function screenText(text: string, markers: string[] = DEFAULT_RESTRICTION_MARKERS): ScreenResult {
  const flags = new Set<RestrictionFlag>();
  const matches: ScreenResult["matches"] = [];
  for (const marker of markers) {
    const re = new RegExp(`\\b${marker.replace(/\s+/g, "\\s+")}\\b`, "gi");
    const explicitPhrase = /\s/.test(marker.trim());
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const inCaption = m.index < CAPTION_CHARS;
      const isUpper = m[0] === m[0].toUpperCase();
      const flag = flagFor(marker);
      const trailing = text.slice(m.index, m.index + 40);
      if (flag === "sealed_marker" && SEALED_PROSE_EXCEPTIONS.test(trailing)) continue;
      if (!explicitPhrase && !inCaption && !isUpper) continue;
      flags.add(flag);
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
