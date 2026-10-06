import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R231 · TREND-RADAR ANALYST BRIDGE (engine-called, backend-only law).
 * The engine's trend radar sweeps the chain (trending inside our context
 * tags) + hands over the web-intel findings; this bridge turns the raw
 * signals into SCORED TOPICS WITH TALK TRACKS — what the fleet can actually
 * TALK about, in OUR contexts (crypto, DPoS, network development, AI
 * agents — "התפתחות של רשת כמו שלנו ועל האפשרויות"). The viralbench
 * pattern (what's hot → what to say) applied to our own lanes.
 * The engine re-checks and bounds every topic — the bridge drafts, the
 * engine decides.
 */
const SYSTEM_PROMPT = `You are a trend analyst for a blockchain-technology research initiative active in the Steem community.
Your job: turn raw engagement signals (chain-trending posts, external findings) into a small set of conversation topics the community will actually engage with.
HARD LAW:
- Topics must live INSIDE the provided context lanes (crypto, DPoS, blockchain network development, AI agents, Web3 possibilities). Off-lane topics are unusable.
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation collectives, internal codenames, or that any accounts are connected.
- No financial advice, no profit promises, no price targets.
- Every topic MUST carry its grounding: reference the provided signals by their titles (basedOn). A topic with no grounding is unusable.
- talkTrack = 2-4 concrete conversation starters (questions or angles) that OPEN a developing discussion, not a monologue.
Output STRICT JSON only, no markdown fences:
{"topics":[{"topic":"...","angle":"...","talkTrack":"...","tags":["tag1","tag2"],"score":7.5,"basedOn":["signal title 1"]}]}
score = 0-10 expected engagement potential inside these communities.`;

export async function POST(req: Request) {
  let body: { chainTrends?: unknown; intelFindings?: unknown; contexts?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const chainTrends = Array.isArray(body.chainTrends) ? body.chainTrends.slice(0, 14) : [];
  const intelFindings = Array.isArray(body.intelFindings) ? body.intelFindings.slice(0, 8) : [];
  const contexts = Array.isArray(body.contexts) ? body.contexts.slice(0, 12).map(String) : ["steem", "crypto", "defi", "technology", "ai", "web3", "blockchain", "dpos"];

  const userPrompt = [
    `CONTEXT LANES (topics must stay inside these): ${contexts.join(", ")}`,
    "",
    "CHAIN SIGNALS — currently trending posts in these communities (title | tag | votes | replies | age-hours | engagement score):",
    chainTrends.map((t) => {
      const s = t as { title?: string; tag?: string; votes?: number; replies?: number; ageH?: number; score?: number };
      return `- ${(s.title ?? "?").slice(0, 100)} | ${s.tag ?? "?"} | v${s.votes ?? 0} r${s.replies ?? 0} | ${s.ageH ?? "?"}h | score ${s.score ?? "?"}`;
    }).join("\n") || "- none this sweep",
    "",
    "EXTERNAL FINDINGS (sourced web intel):",
    intelFindings.map((f) => {
      const s = f as { title?: string; host?: string };
      return `- ${(s.title ?? "?").slice(0, 100)} (${s.host ?? "?"})`;
    }).join("\n") || "- none this sweep",
    "",
    "Produce 4-6 distinct topics: what is trending NOW that our community conversations should engage with, each with a talk track of openers that invite replies.",
    "Vary the angles: one educational explainer, one open question, one tooling/workflow, one network-development/possibilities piece.",
    "Return STRICT JSON only.",
  ].join("\n");

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let topics: unknown = [];
    try {
      const parsed = JSON.parse(jsonText);
      topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
    } catch {
      return NextResponse.json({ ok: false, error: "unparseable LLM output", raw: raw.slice(0, 400) }, { status: 502 });
    }
    return NextResponse.json({ ok: true, topics, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
