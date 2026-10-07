/**
 * brief-worker.ts — roast 61: the LLM call lives in an EPHEMERAL CHILD.
 * =============================================================================
 * Measured live (2026-09-10): a z-ai-web-dev-sdk chat call inside the
 * long-lived chief-of-staff process KILLS the whole process when the service
 * runs detached in the background (nohup/setsid — every `bun run dev` boot
 * died silently during cycle #1's LLM call; same death at 01:44 ended the
 * original sandbox instance; foreground runs always survived). The SDK is a
 * crash-prone dependency — so it is isolated: this one-shot worker does
 * create() + completions and streams the content to stdout. If the SDK
 * crashes, only the WORKER dies: the parent catches the non-zero exit,
 * records lastError honestly, stays UP, and retries next cycle.
 *
 * Protocol: stdin = JSON {system, user} · stdout = the briefing content ·
 * non-zero exit + stderr = failure (never logged by the parent verbatim
 * beyond 160 chars, redaction still applies upstream).
 */
import ZAI from "z-ai-web-dev-sdk";

interface BriefInput { system: string; user: string }

const raw = await Bun.stdin.text();
let input: BriefInput;
try {
  input = JSON.parse(raw) as BriefInput;
} catch {
  console.error("bad stdin json");
  process.exit(2);
}

try {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "assistant", content: input.system },
      { role: "user", content: input.user }
    ],
    thinking: { type: "disabled" }
  });
  const content = completion.choices[0]?.message?.content ?? "";
  if (!content.trim()) {
    console.error("empty LLM response");
    process.exit(3);
  }
  process.stdout.write(content);
  process.exit(0);
} catch (e) {
  console.error(String((e as Error)?.message ?? e).slice(0, 300));
  process.exit(1);
}
