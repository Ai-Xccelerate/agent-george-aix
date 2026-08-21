/**
 * The meeting-recap feature is gone, and these tests keep it gone.
 *
 * George drafted post-meeting recaps because that was a task in the CSM role he
 * was originally built for. At AI Xccelerate it is redundant — Scribe already
 * sends recaps to the people who attended — so George writing another one was
 * duplicate work aimed at the same readers.
 *
 * On 2026-08-20 the dormant task woke up when a Scribe sync bug was fixed, ran
 * ~490 times, and mailed 16 unrequested recaps to fourteen colleagues.
 *
 * It was DELETED rather than disabled. A disabled-but-present feature is exactly
 * what caused this: it sat unused until something upstream changed, and a toggle
 * would eventually have been flipped back by someone with a sensible-sounding
 * reason. These tests assert absence, not configuration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POLICY_CATALOG, resolvePolicies } from "./operating-model";

const src = (p: string) => readFileSync(join(process.cwd(), "src/lib/agent", p), "utf8");

/** The transcript path: the framing prompt, which is what the model reads. */
function transcriptFraming(): string {
  const f = src("process-event.ts");
  const start = f.indexOf("function buildTranscriptFramingPrompt");
  if (start < 0) throw new Error("buildTranscriptFramingPrompt not found");
  return f.slice(start, f.indexOf("\n}", start));
}

describe("the recap task no longer exists", () => {
  it("is not mentioned anywhere the model reads on the transcript path", () => {
    // The grep test. Any reappearance of the word here means the instruction is
    // back, whatever it claims to be for.
    expect(transcriptFraming().toLowerCase()).not.toContain("recap");
  });

  it("does not ask for a draft of any kind", () => {
    const framing = transcriptFraming().toLowerCase();
    expect(framing).not.toContain("draft a");
    expect(framing).not.toContain("leave it as a draft");
  });

  it("has no recap policy to switch back on", () => {
    // Runtime, not grep: the removal comment names the id it removed, which is
    // the point of the comment. What matters is that the catalog has no such
    // policy, so nothing renders it and nothing can toggle it.
    expect(POLICY_CATALOG.some((p) => /recap/i.test(p.id))).toBe(false);
    expect(POLICY_CATALOG.some((p) => /recap/i.test(p.label))).toBe(false);
  });

  it("ignores a stored override for the deleted policy instead of breaking", () => {
    // Orgs configured before the removal may still have auto_draft_recap in their
    // operating_policy jsonb. A stale reference to a deleted policy is exactly the
    // kind of thing that fails silently, so assert it is simply dropped.
    const resolved = resolvePolicies({ auto_draft_recap: true } as never);
    expect("auto_draft_recap" in resolved).toBe(false);
    expect(Object.keys(resolved).length).toBeGreaterThan(0);
  });

  it("is gone from the base prompt too", () => {
    const prompt = src("prompt.ts");
    expect(prompt).not.toContain("draft a recap email");
  });

  it("is gone from read_transcript's description, where a stale instruction bites hardest", () => {
    const tools = src("tools.ts");
    const start = tools.indexOf('"read_transcript"');
    const description = tools.slice(start, start + 600);
    expect(description.toLowerCase()).not.toContain("recap");
  });
});

describe("a transcript event produces nothing outbound", () => {
  it("runs with no send tool at all", () => {
    // Absence of the tool is the guarantee. The prompt is not.
    const f = src("process-event.ts");
    const transcriptCall = f.slice(f.indexOf("agent-george-transcript/0.1"));
    expect(transcriptCall.match(/emailSendPolicy:\s*"(\w+)"/)?.[1]).toBe("none");
  });

  it("still strips send_email_draft under that policy", () => {
    // If this filter goes, "none" becomes advice instead of a limit.
    const runAutonomous = src("run-autonomous.ts");
    expect(runAutonomous).toMatch(/filter\(\(n\) => !n\.endsWith\("send_email_draft"\)\)/);
  });

  it("tells the model the silence is deliberate", () => {
    // Otherwise the model spends a turn looking for a send tool, or apologising
    // for not having one.
    const framing = transcriptFraming();
    expect(framing).toContain("no send tool");
  });

  it("says so in the handler too, so nobody mistakes it for unfinished", () => {
    expect(src("process-event.ts")).toContain("TRANSCRIPT EVENTS ARE SILENT BY DESIGN");
  });
});

describe("the transcript run does account work instead", () => {
  it("writes health signals", () => {
    expect(transcriptFraming()).toContain("record_health_check");
  });

  it("writes plan and objective state", () => {
    const framing = transcriptFraming();
    expect(framing).toContain("update_onboarding_step");
    expect(framing).toContain("update_objective");
  });

  it("routes anything needing a person to the queue, not to email", () => {
    expect(transcriptFraming()).toContain("raise_decision");
  });

  it("references only tools that exist", () => {
    // The old framing told George to call `find_contact`, which is not a tool.
    // An instruction naming a phantom tool burns a turn and teaches the model
    // that instructions here are unreliable.
    const framing = transcriptFraming();
    const named = [...framing.matchAll(/\\`([a-z_]{4,})\\`/g)].map((m) => m[1]);
    const toolsFile = src("tools.ts");
    for (const name of new Set(named)) {
      if (name === "read_knowledge_doc" || name.includes("_id")) continue;
      expect(toolsFile, `framing names a tool that does not exist: ${name}`).toContain(
        `"${name}"`,
      );
    }
  });
});

describe("the proactive scan cannot send either", () => {
  it("uses the no-send policy", () => {
    // The recap restriction there was a sentence in a prompt. With the feature
    // deleted the sentence goes, so the permission had to go with it — otherwise
    // removing the words would leave the path looser than before.
    const scan = src("run-proactive-scan.ts");
    expect(scan.match(/emailSendPolicy:\s*"(\w+)"/)?.[1]).toBe("none");
  });

  it("no longer mentions recaps in anything the model reads", () => {
    // Scoped to the prompt builder: comments elsewhere in the file explain why
    // the send permission was removed, and that history is worth keeping.
    const f = src("run-proactive-scan.ts");
    const start = f.indexOf("function buildScanPrompt");
    expect(f.slice(start).toLowerCase()).not.toContain("recap");
  });
});
