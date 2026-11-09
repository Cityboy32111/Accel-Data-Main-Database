// Deterministic post-extraction checks for the modality failures found in the
// 2026-11-08 review. They run after grounding and before anything is stored, and
// they never silently repair: a conflict downgrades confidence and flags the
// assertion for review so the evidence stays visible.

export const OUTCOME_MODALITIES = new Set(["ordered", "approved", "completed", "reported"]);
export const NON_OUTCOME_MODALITIES = new Set(["proposed", "requested", "recommended", "alleged", "argued", "index_reference"]);

/** Words in a quote that signal a request, proposal, recommendation or allegation rather than an outcome. */
const NON_OUTCOME_SIGNALS: { re: RegExp; label: string }[] = [
  { re: /\bshould\s+(?:be|not)\b/i, label: "should be" },
  { re: /\bis\s+appropriate\b/i, label: "is appropriate" },
  { re: /\bproposed\b/i, label: "proposed" },
  { re: /\bsubject\s+to\s+(?:the\s+)?court'?s?\s+approval\b/i, label: "subject to court approval" },
  { re: /\bwith\s+the\s+court'?s\s+approval\b/i, label: "with the court's approval" },
  { re: /\bmoves?\s+(?:for|to|the\s+court)\b/i, label: "moves for" },
  { re: /\brespectfully\s+(?:requests?|submits?|moves?)\b/i, label: "respectfully requests" },
  { re: /\brequests?\s+(?:that|an?\s+order)\b/i, label: "requests" },
  { re: /\bwill\s+pay\b/i, label: "will pay" },
  { re: /\balleg(?:ed|es|ing)\b/i, label: "alleged" },
  { re: /\basserted\s+that\b/i, label: "asserted that" },
  { re: /\bcontends?\b/i, label: "contends" },
  { re: /\brecommends?\b/i, label: "recommends" },
];

const OUTCOME_WORDS = /\b(excluded|subordinated|approved|granted|denied|dismissed|paid|settled|resolved|ordered)\b/i;

export interface LintInput {
  modality: string;
  predicate?: string;
  quote: string;
  object_value: unknown;
  conditions: string | null;
  page_kind: string;
  subject_type: string;
  proceeding?: { scope: string; related_lawsuit_key: string | null } | null;
}

export interface LintResult {
  flags: string[];
  /** Modality after lint; unchanged unless a table-of-contents page forces index_reference. */
  modality: string;
  /** Multiplier applied to confidence (1 = unchanged). */
  confidence_factor: number;
  needs_review: boolean;
}

export function lintAssertion(a: LintInput): LintResult {
  const flags: string[] = [];
  let modality = a.modality;
  let factor = 1;

  const text = `${a.quote} ${typeof a.object_value === "string" ? a.object_value : ""}`;
  const signals = NON_OUTCOME_SIGNALS.filter((s) => s.re.test(text)).map((s) => s.label);

  // 1. An outcome modality on a sentence that signals a request, proposal or allegation.
  if (OUTCOME_MODALITIES.has(modality) && signals.length > 0) {
    flags.push(`modality_conflict: ${modality} but quote signals ${signals.join(", ")}`);
    factor = Math.min(factor, 0.5);
  }

  // 2. An object value that states an outcome word while the modality is not an outcome.
  if (NON_OUTCOME_MODALITIES.has(modality) && typeof a.object_value === "string" && OUTCOME_WORDS.test(a.object_value)
      && !/\b(recommend|propos|request|should|argu|alleg|seek)/i.test(a.object_value)) {
    flags.push(`object_states_outcome: "${a.object_value}" under modality ${modality}`);
    factor = Math.min(factor, 0.6);
  }

  // 3. Table-of-contents pages carry only index references.
  if (a.page_kind === "table_of_contents" && modality !== "index_reference") {
    flags.push(`toc_page: modality ${modality} downgraded to index_reference`);
    modality = "index_reference";
  }
  if (modality === "index_reference") factor = Math.min(factor, 0.6);

  // 4. Conditions mentioned in the quote but not captured.
  if (!a.conditions && /\bsubject\s+to\b|\bwithin\s+\w+\s*\(?\d*\)?\s*(?:business\s+)?days\b|\bprovided\s+that\b|\bexcept\b/i.test(a.quote)) {
    flags.push("conditions_missing: quote contains a qualifier but conditions is null");
    factor = Math.min(factor, 0.8);
  }

  // 5. A document filing date from an ECF header recorded as the case's own date.
  if (a.subject_type === "case" && /^(filed_on|filing_date|filed)$/i.test(a.predicate ?? "")
      && (typeof a.object_value !== "string" || /^\d{4}-\d{2}-\d{2}$/.test(a.object_value) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(a.object_value))) {
    flags.push("document_date_as_case_date: case filed_on with a bare date; ECF headers date the document, not the case");
    factor = Math.min(factor, 0.5);
  }
  if (/\bDocument\s*#?:?\s*\d+\s+Filed:/i.test(a.quote) && a.subject_type === "case" && !/document|dkt|docket|order|motion|report|response|brief/i.test(String(a.object_value))) {
    flags.push("ecf_header_quote: the quote is an ECF header; the fact belongs to the document");
    factor = Math.min(factor, 0.5);
  }

  // 6. A settlement, payment or stay fact on the main case while the page names a related proceeding.
  if (a.subject_type === "case" && a.proceeding?.scope === "related_lawsuit") {
    flags.push("proceeding_mismatch: subject is the main case but proceeding.scope is related_lawsuit");
    factor = Math.min(factor, 0.5);
  }

  return { flags, modality, confidence_factor: factor, needs_review: flags.length > 0 || modality === "index_reference" };
}

// ---------------------------------------------------------------------------
// Authority versus proceeding. A "related lawsuit" whose docket field is really
// a reporter citation (101 F.4th 526, 2024 WL 3069682, 2024 IL App (1st) 231403-U)
// is a cited authority unless an estate party is in its caption; a precedent
// about strangers to the estate must never appear in the proceedings list.
// ---------------------------------------------------------------------------
export const REPORTER_CITATION = /(\b\d+\s+(f\.?\s?(2d|3d|4th)|f\.?\s?supp\.?(\s?(2d|3d))?|u\.?s\.?|s\.?\s?ct\.?|n\.?e\.?\s?(2d|3d)|fed\.?\s?app\'?x\.?)\s+\d+|\b\d{4}\s+wl\s+\d+|\b\d{4}\s+il\s+app\s*\([^)]+\)|\b\d+\s+ill\.?\s?(2d|app))/i;

export interface LawsuitLike {
  key: string;
  caption: string;
  docket_number: string | null;
  court: string | null;
}

export interface AuthorityCheck {
  /** "proceeding" keeps the row; "authority" moves it to authorities; "proceeding_review" keeps it but flags it. */
  classification: "proceeding" | "authority" | "proceeding_review";
  reason: string;
}

/**
 * estateNames: normalized names of the estate's parties (receivership defendants,
 * the receiver, affiliates) known for the case, used to tell an appeal from
 * this receivership apart from a precedent about other parties.
 */
export function classifyLawsuit(l: LawsuitLike, estateNames: string[]): AuthorityCheck {
  const text = `${l.caption} ${l.docket_number ?? ""} ${l.court ?? ""}`;
  const reporter = REPORTER_CITATION.test(l.docket_number ?? "") || REPORTER_CITATION.test(l.caption);
  const cap = l.caption.toLowerCase();
  const namesEstate = estateNames.some((n) => n && cap.includes(n.toLowerCase()));
  if (reporter && !namesEstate) {
    return { classification: "authority", reason: `reporter citation "${(l.docket_number ?? l.caption).slice(0, 40)}" and no estate party in the caption` };
  }
  if (reporter && namesEstate) {
    return { classification: "proceeding_review", reason: "appeal from this receivership identified only by a reporter citation; confirm the appellate docket" };
  }
  if (!l.docket_number && /\bv\.(?=\s)/.test(cap) && !namesEstate) {
    return { classification: "proceeding_review", reason: "captioned case with no docket number and no estate party; may be an authority" };
  }
  void text;
  return { classification: "proceeding", reason: "" };
}
