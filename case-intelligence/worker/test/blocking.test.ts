import { describe, expect, it } from "vitest";
import { blockLawsuits, blockParties, blockProperties, coreOrgName, parsePerson } from "../src/resolve/blocking.js";

const org = (id: string, name: string, aliases: string[] = [], roles: string[] = ["other"]) => ({ id, kind: "organization" as const, canonical_name: name, aliases, party_roles: roles });
const person = (id: string, name: string, aliases: string[] = []) => ({ id, kind: "person" as const, canonical_name: name, aliases, party_roles: ["defendant"] });

describe("name normalization", () => {
  it("strips legal suffixes", () => {
    expect(coreOrgName("Citibank N.A.")).toBe("citibank");
    expect(coreOrgName("BrookWeiner LLC")).toBe("brookweiner");
    expect(coreOrgName("Whitley Penn LLP")).toBe("whitley penn");
    expect(coreOrgName("EquityBuild Finance, LLC")).toBe("equitybuild finance");
  });
  it("parses person names with nicknames and middle initials", () => {
    expect(parsePerson("Jerome H. Cohen")).toMatchObject({ first: "jerome", middle: "h", last: "cohen" });
    expect(parsePerson("Jerry Cohen")).toMatchObject({ first: "jerome", last: "cohen" });
    expect(parsePerson("Jerrine Pennington, as Special Administrator for the Estate of Valerie Pennington")).toMatchObject({ first: "jerrine", last: "pennington" });
    expect(parsePerson("Pennington")).toMatchObject({ first: null, last: "pennington" });
  });
});

describe("party blocking", () => {
  it("merges exact core names and alias matches, adjudicates subsets, keeps different people apart", () => {
    const c = blockParties([
      org("1", "Citibank N.A.", ["Citibank"], ["lender"]), org("2", "Citibank", ["Citibank"], ["claimant"]),
      org("3", "BMO Bank N.A.", ["BMO"]), org("4", "BMO", ["BMO"]),
      org("5", "Prometheum Technologies, Inc."), org("6", "Prometheum"),
      org("7", "Receiver", ["the Receiver"], ["receiver"]),
      person("8", "Kevin B. Duff", ["Receiver", "the Receiver"]),
      person("9", "Jerome H. Cohen", ["Jerome Cohen"]), person("10", "Jerry Cohen"), person("11", "Shaun D. Cohen"),
      person("12", "Jerrine Pennington", ["Pennington"]), person("13", "Valerie Pennington"), person("14", "Pennington", ["Pennington"]),
    ]);
    const find = (l: string, r: string) => c.find((x) => (x.left_id === l && x.right_id === r) || (x.left_id === r && x.right_id === l));
    expect(find("1", "2")).toMatchObject({ rule: "exact_core_name", proposal: "merge", score: 1 });
    expect(find("3", "4")).toMatchObject({ rule: "alias_match", proposal: "merge" });
    expect(find("5", "6")).toMatchObject({ rule: "token_subset_org", proposal: "adjudicate" });
    expect(find("7", "8")).toMatchObject({ rule: "role_term_alias", proposal: "adjudicate" });
    expect(find("9", "10")).toMatchObject({ rule: "person_name_variant", proposal: "merge" });
    expect(find("9", "11")).toMatchObject({ rule: "same_surname_different_first", proposal: "distinct" });
    expect(find("12", "13")).toMatchObject({ proposal: "distinct" });
    expect(find("12", "14")).toMatchObject({ rule: "surname_alias", proposal: "adjudicate" });
    expect(find("1", "3")).toBeUndefined();
  });
  it("never pairs a person with an organization except through a role term", () => {
    const c = blockParties([org("1", "Duff Capital LLC"), person("2", "Kevin B. Duff")]);
    expect(c).toEqual([]);
  });
});

describe("property and lawsuit blocking", () => {
  it("merges by receiver property number and distinguishes different numbers", () => {
    const c = blockProperties([
      { id: "a", address: "4533-47 S Calumet Avenue", receiver_property_number: "Property No. 2" },
      { id: "b", address: "Property 2", receiver_property_number: "Property 2" },
      { id: "c", address: "Property 69", receiver_property_number: "Property 69" },
      { id: "d", address: "Naples property", receiver_property_number: null },
      { id: "e", address: "Jerry Cohen's Naples home (the Naples Property)", receiver_property_number: null },
    ]);
    expect(c.find((x) => x.left_id === "a" && x.right_id === "b")).toMatchObject({ rule: "same_receiver_property_number", proposal: "merge" });
    expect(c.find((x) => x.left_id === "b" && x.right_id === "c")).toMatchObject({ proposal: "distinct" });
    expect(c.find((x) => x.left_id === "d" && x.right_id === "e")).toMatchObject({ rule: "address_token_overlap", proposal: "adjudicate" });
  });
  it("does not treat a reporter citation as a docket number", () => {
    const c = blockLawsuits([
      { id: "a", caption: "SEC v. EquityBuild, Inc.", docket_number: "101 F.4th 526", court: "7th Cir." },
      { id: "b", caption: "SEC v. Equitybuild, Inc.", docket_number: "23-1870", court: "Seventh Circuit" },
    ]);
    // No rule may declare these distinct on a reporter citation; with no distinctive caption tokens they are left for a human.
    expect(c.find((x) => x.proposal === "distinct")).toBeUndefined();
  });
  it("keeps same-caption suits with different dockets distinct and flags caption overlap", () => {
    const c = blockLawsuits([
      { id: "a", caption: "Michigan Shores Apartments, LLC v. EquityBuild, Inc., et al.", docket_number: "2018 CH 9098", court: "Cook" },
      { id: "b", caption: "Michigan Shores Apartments, LLC v. EquityBuild, Inc., et al.", docket_number: "2018 CH 3665", court: "Cook" },
      { id: "c", caption: "Circuit Court Action (Pennington v. defendants; personal injury/wrongful death)", docket_number: null, court: null },
      { id: "d", caption: "Jerrine Pennington as Special Administrator of the Estate of Valerie Pennington v. 4533-47 Calumet LLC", docket_number: "2021 L 010115", court: "Cook" },
    ]);
    expect(c.find((x) => x.left_id === "a" && x.right_id === "b")).toMatchObject({ rule: "same_caption_different_docket", proposal: "distinct" });
    expect(c.find((x) => x.left_id === "c" && x.right_id === "d")).toMatchObject({ rule: "caption_token_overlap", proposal: "adjudicate" });
  });
});
