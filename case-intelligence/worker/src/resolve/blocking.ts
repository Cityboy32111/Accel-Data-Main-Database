// Entity resolution, stage 1: deterministic blocking rules that propose
// candidate pairs with a score and a named rule. Nothing here writes; the
// output is a reviewable list. Pairs at score 1.0 from exact rules are safe to
// apply as rule decisions; everything else goes to an adjudicator (LLM or
// human) and, when applied, opens a review task. Every applied decision is a
// row in entity_resolution_decisions plus a same_as link, and is reversible.

export interface PartyRow {
  id: string;
  kind: "person" | "organization";
  canonical_name: string;
  aliases: string[];
  party_roles: string[];
  created_at?: string;
}

export interface PropertyRow {
  id: string;
  address: string;
  receiver_property_number: string | null;
}

export interface LawsuitRow {
  id: string;
  caption: string;
  docket_number: string | null;
  court: string | null;
}

export interface Candidate {
  entity_type: "party" | "property" | "related_lawsuit";
  left_id: string;
  right_id: string;
  left_label: string;
  right_label: string;
  rule: string;
  score: number;
  /** "merge" when the rule is conclusive; "adjudicate" when a judgment call remains; "distinct" when the rule proves difference. */
  proposal: "merge" | "adjudicate" | "distinct";
  rationale: string;
}

const SUFFIX_TOKENS = new Set(["incorporated", "inc", "llc", "ltd", "limited", "lp", "llp", "plc", "corp", "corporation", "co", "company", "pllc"]);
const SUFFIX_PAIRS = new Set(["n a", "p c", "l l c", "l p"]);
const ROLE_TERMS = new Set([
  "receiver", "the receiver", "court", "the court", "commission", "the commission", "receivership defendants",
  "receivership estate", "objecting lenders", "institutional lenders", "defendants", "plaintiff", "the cohens", "cohens",
]);
const NICKNAMES: Record<string, string> = { jerry: "jerome", mike: "michael", bob: "robert", bill: "william", jim: "james" };

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function coreOrgName(s: string): string {
  let n = normalize(s).replace(/^the /, "");
  for (const pair of SUFFIX_PAIRS) n = n.replace(new RegExp(`\\b${pair}\\b`, "g"), " ");
  const tokens = n.split(" ").filter(Boolean).filter((t) => !SUFFIX_TOKENS.has(t));
  return tokens.join(" ");
}

export function isRoleTerm(name: string): boolean {
  return ROLE_TERMS.has(normalize(name));
}

export interface PersonName { first: string | null; middle: string | null; last: string; suffix: string | null }

export function parsePerson(name: string): PersonName | null {
  const cleaned = name.replace(/,.*$/, "").trim(); // drop ", as Special Administrator ..."
  const tokens = normalize(cleaned).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { first: null, middle: null, last: tokens[0], suffix: null };
  const suffix = /^(jr|sr|ii|iii|iv)$/.test(tokens[tokens.length - 1]) ? tokens.pop()! : null;
  const last = tokens.pop()!;
  const first = tokens.shift() ?? null;
  return { first: first ? NICKNAMES[first] ?? first : null, middle: tokens.join(" ") || null, last, suffix };
}

function aliasSet(p: PartyRow): Set<string> {
  // Collective and role terms ("Receivership Defendants", "the Receiver") are shared by
  // many parties and never evidence that two parties are the same entity.
  return new Set([normalize(p.canonical_name), ...(p.aliases ?? []).map(normalize)].filter((x) => x && !ROLE_TERMS.has(x) && !ROLE_TERMS.has("the " + x)));
}

export function blockParties(parties: PartyRow[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (c: Candidate) => {
    const key = [c.left_id, c.right_id].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  for (let i = 0; i < parties.length; i++) {
    for (let j = i + 1; j < parties.length; j++) {
      const a = parties[i], b = parties[j];
      const la = a.canonical_name, lb = b.canonical_name;
      const base = { entity_type: "party" as const, left_id: a.id, right_id: b.id, left_label: la, right_label: lb };
      const roleA = isRoleTerm(la), roleB = isRoleTerm(lb);

      // Role terms are never merged by rule; they are adjudicated against the named entity they stand for.
      if (roleA !== roleB) {
        const named = roleA ? b : a;
        const aliases = new Set([normalize(named.canonical_name), ...(named.aliases ?? []).map(normalize)]);
        const term = normalize(roleA ? la : lb).replace(/^the /, "");
        if (aliases.has(term) || aliases.has("the " + term)) {
          push({ ...base, rule: "role_term_alias", score: 0.7, proposal: "adjudicate", rationale: `"${roleA ? la : lb}" is a role term that the other party lists as an alias` });
        }
        continue;
      }
      if (roleA && roleB) continue;

      if (a.kind !== b.kind) continue;

      if (a.kind === "organization") {
        const ca = coreOrgName(la), cb = coreOrgName(lb);
        if (ca && ca === cb) {
          push({ ...base, rule: "exact_core_name", score: 1, proposal: "merge", rationale: `identical name after removing legal suffixes ("${ca}")` });
          continue;
        }
        const sa = aliasSet(a), sb = aliasSet(b);
        const shared = [...sa].filter((x) => sb.has(x) && x.length >= 3);
        if (shared.length) {
          const conclusive = sa.has(normalize(lb)) || sb.has(normalize(la));
          push({ ...base, rule: "alias_match", score: conclusive ? 0.95 : 0.8, proposal: conclusive ? "merge" : "adjudicate", rationale: `shared alias "${shared[0]}"` });
          continue;
        }
        const ta = ca.split(" "), tb = cb.split(" ");
        const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
        if (short.length >= 1 && short.every((t) => long.includes(t)) && short.join(" ") !== long.join(" ") && short[0].length >= 3) {
          push({ ...base, rule: "token_subset_org", score: 0.75, proposal: "adjudicate", rationale: `"${short.join(" ")}" is a token subset of "${long.join(" ")}"` });
          continue;
        }
      } else {
        const pa = parsePerson(la), pb = parsePerson(lb);
        if (!pa || !pb || pa.last !== pb.last) continue;
        if (pa.first && pb.first && pa.first !== pb.first) {
          push({ ...base, rule: "same_surname_different_first", score: 0, proposal: "distinct", rationale: `same surname, different first names (${pa.first} / ${pb.first})` });
          continue;
        }
        if (pa.first && pb.first && pa.first === pb.first) {
          const middleConflict = pa.middle && pb.middle && pa.middle[0] !== pb.middle[0];
          if (middleConflict) {
            push({ ...base, rule: "middle_initial_conflict", score: 0.2, proposal: "adjudicate", rationale: `same first and last name, conflicting middle names` });
          } else {
            push({ ...base, rule: "person_name_variant", score: 0.95, proposal: "merge", rationale: `same first and last name; middle name or nickname differs only` });
          }
          continue;
        }
        // surname-only reference versus a full name
        const sa = aliasSet(a), sb = aliasSet(b);
        const shared = [...sa].filter((x) => sb.has(x));
        push({ ...base, rule: shared.length ? "surname_alias" : "surname_only", score: shared.length ? 0.7 : 0.5, proposal: "adjudicate", rationale: shared.length ? `surname-only reference sharing alias "${shared[0]}"` : "surname-only reference; needs context" });
      }
    }
  }
  return out;
}

export function blockProperties(props: PropertyRow[]): Candidate[] {
  const out: Candidate[] = [];
  const num = (p: PropertyRow) => {
    const m = `${p.receiver_property_number ?? ""} ${p.address}`.match(/propert(?:y|ies)\s*(?:no\.?\s*)?(\d+)/i);
    return m ? m[1] : null;
  };
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
    const a = props[i], b = props[j];
    const base = { entity_type: "property" as const, left_id: a.id, right_id: b.id, left_label: a.address, right_label: b.address };
    const na = num(a), nb = num(b);
    if (na && nb) {
      if (na === nb) out.push({ ...base, rule: "same_receiver_property_number", score: 1, proposal: "merge", rationale: `both are receiver Property ${na}` });
      else out.push({ ...base, rule: "different_receiver_property_number", score: 0, proposal: "distinct", rationale: `Property ${na} vs Property ${nb}` });
      continue;
    }
    const ta = new Set(normalize(a.address).split(" ")), tb = new Set(normalize(b.address).split(" "));
    const shared = [...ta].filter((t) => tb.has(t) && t.length >= 4 && !/^(property|street|avenue|the|home)$/.test(t));
    if (shared.length) out.push({ ...base, rule: "address_token_overlap", score: 0.6, proposal: "adjudicate", rationale: `shared address tokens: ${shared.join(", ")}` });
  }
  return out;
}

export function blockLawsuits(suits: LawsuitRow[]): Candidate[] {
  const out: Candidate[] = [];
  // A reporter citation (101 F.4th 526, 2024 WL 3069682, 2024 IL App (1st) 231403-U) is not a docket number.
  const REPORTER = /\b(f\.?\s?(2d|3d|4th)|f\.?\s?supp|wl|u\.?s\.?|il app|n\.?e\.?\s?(2d|3d)|fed\.?\s?appx)\b/i;
  const dock = (s: LawsuitRow) => {
    const raw = s.docket_number ?? "";
    if (!raw || REPORTER.test(raw)) return null;
    return raw.replace(/\s+/g, "").toLowerCase();
  };
  const sig = (s: LawsuitRow) => new Set(normalize(s.caption).split(" ").filter((t) => t.length >= 4 && !/^(action|court|circuit|county|cook|llc|inc|equitybuild|defendants|personal|injury|wrongful|death|administrator|estate|special|deceased)$/.test(t)));
  for (let i = 0; i < suits.length; i++) for (let j = i + 1; j < suits.length; j++) {
    const a = suits[i], b = suits[j];
    const base = { entity_type: "related_lawsuit" as const, left_id: a.id, right_id: b.id, left_label: a.caption, right_label: b.caption };
    const da = dock(a), db = dock(b);
    if (da && db) {
      if (da === db) { out.push({ ...base, rule: "same_docket_number", score: 1, proposal: "merge", rationale: `same docket number ${a.docket_number}` }); continue; }
      if (normalize(a.caption) === normalize(b.caption)) { out.push({ ...base, rule: "same_caption_different_docket", score: 0, proposal: "distinct", rationale: `same caption but different docket numbers (${a.docket_number} / ${b.docket_number})` }); continue; }
    }
    const sa = sig(a), sb = sig(b);
    const shared = [...sa].filter((t) => sb.has(t));
    if (shared.length) out.push({ ...base, rule: "caption_token_overlap", score: 0.6, proposal: "adjudicate", rationale: `shared caption tokens: ${shared.join(", ")}${da || db ? "" : "; neither has a docket number"}` });
  }
  return out;
}
