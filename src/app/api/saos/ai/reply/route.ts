import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * R232 · REPLY COMPOSER BRIDGE (engine-called, backend-only law).
 * The window executor (engine execute.mjs) composes fleet-engagement replies
 * here when headcorner's engage window opens. Input = ONLY what we actually
 * read from the target post (title + excerpt) + the trend radar's talk track.
 * Output = one short community-toned reply that OPENS a discussion.
 * HARD LAWS (mirrored from the R231 trend-analyst bridge):
 * - never reveal/hint coordinated multi-account activity or automation
 * - no financial advice, no profit promises, no price targets
 * - reference only the provided material — no invented facts
 * - end with an open question that invites a developing conversation
 * The engine bounds (≤700 chars) and journals every reply.
 */
const SYSTEM_PROMPT = `You write short community replies on a blockchain social platform (Steem) for a technology-research initiative.
You receive a post title, an excerpt of what it actually says, and optionally a trending talk-track (a conversation angle currently relevant in the community).
Write ONE reply, 2-4 sentences (max ~450 chars), community-toned, in ENGLISH unless the excerpt is clearly Hebrew.
HARD LAW:
- Engage the SPECIFIC content given (reference its concrete point) — never invent facts about the post beyond the excerpt.
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, bots, or internal codenames. Write as one curious community member.
- No financial advice, no price targets, no profit promises.
- The LAST sentence must be an open question that invites a real reply (a developing conversation, not a monologue).
- Plain text only: no markdown headers, no links, no hashtags.
Return STRICT JSON only: {"text":"..."}`;

export async function POST(req: Request) {
  let body: { title?: unknown; excerpt?: unknown; talkTrack?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const title = String(body.title ?? "").slice(0, 200);
  const excerpt = String(body.excerpt ?? "").slice(0, 600);
  const talkTrack = String(body.talkTrack ?? "").slice(0, 300);
  if (!title && !excerpt) {
    return NextResponse.json({ ok: false, error: "title or excerpt required" }, { status: 400 });
  }

  const userPrompt = [
    `POST TITLE: ${title || "(untitled)"}`,
    excerpt ? `POST EXCERPT (what it actually says): ${excerpt}` : "POST EXCERPT: (none — rely on the title only, stay generic-positive)",
    talkTrack ? `TRENDING TALK-TRACK (may be woven in only if relevant to this post): ${talkTrack}` : "",
    "",
    "Write the one reply now. STRICT JSON: {\"text\":\"...\"}",
  ].filter(Boolean).join("\n");

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
    let text = "";
    try {
      const parsed = JSON.parse(jsonText);
      text = String(parsed?.text ?? "");
    } catch {
      // LLM answered in prose — take it as the text itself (still bounded)
      text = jsonText;
    }
    text = text.trim().slice(0, 700);
    if (text.length < 20) {
      return NextResponse.json({ ok: false, error: "reply too short", raw: raw.slice(0, 200) }, { status: 502 });
    }
    return NextResponse.json({ ok: true, text, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
