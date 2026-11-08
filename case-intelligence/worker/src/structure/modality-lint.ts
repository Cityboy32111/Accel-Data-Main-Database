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

  // 5. A settlement, payment or stay fact on the main case while the page names a related proceeding.
  if (a.subject_type === "case" && a.proceeding?.scope === "related_lawsuit") {
    flags.push("proceeding_mismatch: subject is the main case but proceeding.scope is related_lawsuit");
    factor = Math.min(factor, 0.5);
  }

  return { flags, modality, confidence_factor: factor, needs_review: flags.length > 0 || modality === "index_reference" };
}
