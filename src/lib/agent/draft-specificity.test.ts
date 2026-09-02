/**
 * The guard against George writing an email that could go to anybody.
 *
 * The failure this catches is not loud. A generic onboarding email is polite,
 * well-formed, and completely useless — it reads as software, gets no reply,
 * and nothing in the system notices. These tests are built from the two real
 * drafts that failed that way, so a future anti-leak tightening that reproduces
 * them fails here first.
 */
import { describe, expect, it } from "vitest";
import { checkDraftSpecificity, type SpecificityFacts } from "./draft-specificity";

const FACTS: SpecificityFacts = {
  dates: ["2026-09-25", "2026-08-14"],
  terms: ["Firewall rules pending with IT", "First campaign sent", null],
};

describe("what counts as specific", () => {
  it("passes on a date the account owns, and names which one", () => {
    const r = checkDraftSpecificity("<p>You go live on 25 September.</p>", FACTS);
    expect(r.ok).toBe(true);
    expect(r.found[0]).toContain("2026-09-25");
  });

  it("recognises the same date however a person writes it", () => {
    for (const form of ["25 September", "September 25", "2026-09-25", "25th September"]) {
      expect(checkDraftSpecificity(`<p>Live on ${form}.</p>`, FACTS).ok).toBe(true);
    }
  });

  it("passes on a named blocker, matched on a word rather than the whole title", () => {
    // George paraphrases, and should. "Firewall rules pending with IT" will not
    // appear verbatim in anything a person would want to receive.
    const r = checkDraftSpecificity(
      "<p>Did IT get the firewall opened up in the end?</p>",
      FACTS,
    );
    expect(r.ok).toBe(true);
    expect(r.found[0]).toContain("firewall");
  });

  it("passes on a milestone the customer cares about", () => {
    expect(checkDraftSpecificity("<p>Keen to get your first campaign out.</p>", FACTS).ok).toBe(
      true,
    );
  });

  it("passes on a date George proposed that is not in the record", () => {
    // Not an account fact, but still something the recipient can act on.
    const r = checkDraftSpecificity("<p>Could you confirm by 12 October?</p>", {
      dates: [],
      terms: [],
    });
    expect(r.ok).toBe(true);
    expect(r.found[0]).toContain("calendar date");
  });
});

describe("what does not count", () => {
  it("fails the email that could go to any customer", () => {
    // This is the real shape of the fault: perfectly polite, entirely generic.
    const r = checkDraftSpecificity(
      "<p>Hi Dana,</p><p>Just checking in on how the setup is going. Is there " +
        "anything blocking your team? Happy to jump on a quick call.</p><p>George</p>",
      FACTS,
    );
    expect(r.ok).toBe(false);
    expect(r.found).toEqual([]);
  });

  it("does not accept a bare weekday as a date", () => {
    // "By Friday" stops being unambiguous the moment the email is read late.
    expect(checkDraftSpecificity("<p>Could you confirm by Friday?</p>", FACTS).ok).toBe(false);
  });

  it("does not accept onboarding boilerplate as a distinctive term", () => {
    // "account", "setup", "onboarding" are true of every email on this path.
    const r = checkDraftSpecificity("<p>Your onboarding account setup is underway.</p>", {
      dates: [],
      terms: ["Account setup onboarding"],
    });
    expect(r.ok).toBe(false);
  });

  it("does not match on markup", () => {
    const r = checkDraftSpecificity(
      '<div class="firewall-notice" data-campaign="1">Hello.</div>',
      FACTS,
    );
    expect(r.ok).toBe(false);
  });

  it("fails an empty draft rather than passing it by default", () => {
    expect(checkDraftSpecificity("", FACTS).ok).toBe(false);
    expect(checkDraftSpecificity("<p></p>", FACTS).ok).toBe(false);
  });
});
