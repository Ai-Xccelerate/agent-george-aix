/**
 * A meeting recap is never sent by George.
 *
 * On 2026-08-20 the transcript path ran with emailSendPolicy "internal_only"
 * while its framing prompt said "you may send it". George recapped 16 meetings
 * to 14 colleagues, correctly following the instruction it had been given.
 * Three other sources — the operating-model policy, the playbook, and the base
 * prompt — all said a recap is a draft for the PM. Prose lost an argument with
 * prose.
 *
 * So the guarantee is structural, not textual: under policy "none",
 * runGeorgeAutonomous removes send_email_draft from the tool list, and a model
 * cannot call a tool it does not have. These tests pin that structure, because
 * the failure mode was a one-word edit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(process.cwd(), "src/lib/agent", p), "utf8");

describe("the transcript run cannot send at all", () => {
  const processEvent = src("process-event.ts");

  it("runs the transcript handler with the no-send policy", () => {
    // The exact regression: this line read "internal_only".
    const transcriptCall = processEvent.slice(
      processEvent.indexOf("agent-george-transcript/0.1"),
    );
    const policy = transcriptCall.match(/emailSendPolicy:\s*"(\w+)"/);
    expect(policy?.[1]).toBe("none");
  });

  it("strips the send tool under that policy, rather than trusting the prompt", () => {
    // If this filter is ever removed, "none" becomes advice instead of a limit.
    const runAutonomous = src("run-autonomous.ts");
    expect(runAutonomous).toContain('emailSendPolicy === "internal_only"');
    expect(runAutonomous).toMatch(/filter\(\(n\) => !n\.endsWith\("send_email_draft"\)\)/);
  });
});

describe("no source tells George it may send a recap", () => {
  it("the transcript framing does not grant send permission", () => {
    const processEvent = src("process-event.ts");
    const framing = processEvent.slice(
      processEvent.indexOf("function buildTranscriptFramingPrompt"),
    );
    // The removed wording, and anything close to it.
    expect(framing).not.toContain("you may send it");
    expect(framing.toLowerCase()).toContain("do not send it");
  });

  it("the framing names the PM as the reader, not the attendees", () => {
    const processEvent = src("process-event.ts");
    const framing = processEvent.slice(
      processEvent.indexOf("function buildTranscriptFramingPrompt"),
    );
    expect(framing).toContain("for the PM to review");
  });

  it("the proactive scan does not list recaps among what it may send", () => {
    const scan = src("run-proactive-scan.ts");
    // It previously said "recap/nudge emails ... you may send".
    expect(scan).not.toMatch(/recap\/nudge/);
    expect(scan).toContain("MEETING RECAPS ARE ALWAYS DRAFT-ONLY");
  });

  it("the operating-model policy still says never sent", () => {
    // This one was already correct and was being contradicted. Keep it that way.
    const model = src("operating-model.ts");
    const idx = model.indexOf("auto_draft_recap");
    expect(model.slice(idx, idx + 900)).toContain("(never sent)");
  });
});

describe("the framing does not ask for something it cannot do", () => {
  it("routes escalation through raise_decision instead of an email to the manager", () => {
    // With no send tool, "send a one-line heads-up to your manager" was an
    // instruction George could only fail — it would burn a turn discovering the
    // tool was absent.
    const processEvent = src("process-event.ts");
    const framing = processEvent.slice(
      processEvent.indexOf("function buildTranscriptFramingPrompt"),
    );
    expect(framing).toContain("raise_decision");
    expect(framing).not.toContain("send a one-line heads-up");
  });
});
