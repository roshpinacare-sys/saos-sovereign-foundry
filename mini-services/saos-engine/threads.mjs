/**
 * threads.mjs — R233 · מדד-עומק-שיח ("שיח מתפתח שגם יפיק תועלת רב-גוונית").
 *
 * מטריצת-השיחות של R231 מודדת כיסוי (מי כבר הגיב). המודול הזה מודד את
 * מה שקורה אחרי התגובה הראשונה — האם השיחה באמת מתפתחת:
 *   1. שכבה-2 (layer2) — תגובות-לתגובות: האם מישהו המשיך את השיח שנפתח
 *   2. הגב-מחבר (authorResponded) — מחבר-הפוסט עצמו ענה למגיבים (סימן
 *      החיים החזק ביותר של שיחה חיה, וההוגן ביותר למגיבים שלנו)
 *   3. זמן-תגובה ראשון (firstFleetReplyH) — כמה שעות לקח לצי להגיב
 *   4. עומק-שיחה (depth) — 1 + שכבה-2 + הגב-מחבר (1..3 שכבות)
 *   5. ציון-שיח 0..10 — כיסוי + שכבה-2 + הגב-מחבר + זמן-תגובה
 *
 * הליבה הפורית (threadMetrics/threadSummary) נבדקת-וקטורים ב-selftest —
 * אפס-רשת. הרשת מאוזנת: עד 8 פוסטים טריים × עד 4 תגובות-צי לפוסט =
 * ≤40 קריאות פומביות; כל-כשל מבודד — המדידה כנה גם בחלקה.
 */
import { rpcCall } from "./measure.mjs";
import { FLEET_ROSTER } from "./coordination.mjs";

const FLEET_SET = new Set(FLEET_ROSTER.map((a) => a.name));

/* ── pure core (selftest-vectorable, zero network) ───────────────────── */
/**
 * pure: thread metrics for one post from its reply layers.
 * layer1: [{author, permlink, createdIso}] — direct replies to the post
 * layer2: [{author, parentAuthor}]        — replies to replies
 * returns per-post depth metrics + conversation score 0..10
 */
export function threadMetrics(post, layer1, layer2, { nowMs = Date.now() } = {}) {
  const l1 = Array.isArray(layer1) ? layer1.filter((r) => r && typeof r.author === "string") : [];
  const l2 = Array.isArray(layer2) ? layer2.filter((r) => r && typeof r.author === "string") : [];
  const fleetL1 = l1.filter((r) => FLEET_SET.has(r.author));
  const author = post?.author ?? null;
  // the post author is IN the conversation if they appear in layer-1
  // (replying under their own post) or anywhere in layer-2 (replying to a replier)
  const authorResponded = author != null && (l1.some((r) => r.author === author) || l2.some((r) => r.author === author));
  const createdMs = post?.createdMs ?? null;
  let firstFleetReplyH = null;
  if (createdMs != null) {
    for (const r of fleetL1) {
      const t = r.createdIso ? Date.parse(r.createdIso.endsWith("Z") ? r.createdIso : `${r.createdIso}Z`) : NaN;
      if (Number.isFinite(t) && t >= createdMs) {
        const h = Math.round(((t - createdMs) / 3600_000) * 10) / 10;
        if (firstFleetReplyH == null || h < firstFleetReplyH) firstFleetReplyH = h;
      }
    }
  }
  const depth = 1 + (l2.length > 0 ? 1 : 0) + (authorResponded ? 1 : 0);
  const coveragePct = Number.isFinite(post?.coveragePct) ? post.coveragePct : 0;
  const covPts = Math.min(4, (coveragePct / 25) * 4);            // 0..4
  const l2Pts = Math.min(3, l2.length);                           // 0..3
  const respPts = authorResponded ? 2 : 0;                        // 0..2
  const latPts = firstFleetReplyH != null && firstFleetReplyH <= 6 ? 1 : 0; // 0..1
  const score = Math.round((covPts + l2Pts + respPts + latPts) * 10) / 10;
  return {
    author, permlink: post?.permlink ?? null,
    layer1Count: l1.length, layer2Count: l2.length,
    fleetRepliers: fleetL1.length, authorResponded, firstFleetReplyH,
    depth, developed: l2.length > 0,
    score: Math.min(10, score),
  };
}

/** pure: fleet-level summary — the "שיח מתפתח" answer for the day */
export function threadSummary(metrics) {
  const m = (Array.isArray(metrics) ? metrics : []).filter((x) => x && x.permlink);
  if (!m.length) return { postsMeasured: 0, developed: 0, avgDepth: null, avgLayer2: null, authorResponseRate: null, avgScore: null };
  const avg = (arr) => Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;
  return {
    postsMeasured: m.length,
    developed: m.filter((x) => x.developed).length,
    avgDepth: avg(m.map((x) => x.depth)),
    avgLayer2: avg(m.map((x) => x.layer2Count)),
    authorResponseRate: Math.round((m.filter((x) => x.authorResponded).length / m.length) * 100),
    avgScore: avg(m.map((x) => x.score)),
  };
}

/* ── bounded network enrichment (public reads, fail-isolated) ────────── */
/** layer-2 fetch: replies TO a reply (parent = the reply's own author+permlink) */
export async function fetchLayer2(replyAuthor, replyPermlink) {
  const r = await rpcCall("condenser_api.get_content_replies", [replyAuthor, replyPermlink]);
  return r.ok ? (r.result ?? []).map((c) => ({ author: c.author, parentAuthor: replyAuthor })) : [];
}

/**
 * enrich engagement rows with layer-1/layer-2 reply data.
 * rows: engagementMatrix rows (author, permlink, ageH, coveragePct...)
 * bounded: ≤maxPosts posts × ≤perPost layer-1 fleet replies scanned.
 */
export async function enrichThreads(rows, { nowMs = Date.now(), maxPosts = 8, perPost = 4, maxAgeH = 48 } = {}) {
  const fresh = (Array.isArray(rows) ? rows : [])
    .filter((p) => p?.author && p?.permlink && Number.isFinite(p.ageH) && p.ageH <= maxAgeH)
    .slice(0, maxPosts);
  const metrics = [];
  for (const p of fresh) {
    try {
      const r1 = await rpcCall("condenser_api.get_content_replies", [p.author, p.permlink]);
      const layer1 = (r1.ok ? r1.result ?? [] : [])
        .map((c) => ({ author: c.author, permlink: c.permlink ?? null, createdIso: c.created ?? null }));
      const layer2 = [];
      const fleetOnes = layer1.filter((r) => FLEET_SET.has(r.author) && r.permlink).slice(0, perPost);
      for (const f of fleetOnes) {
        try {
          layer2.push(...(await fetchLayer2(f.author, f.permlink)));
        } catch { /* per-reply fail-isolated */ }
      }
      metrics.push(threadMetrics(p, layer1, layer2, { nowMs }));
    } catch { /* per-post fail-isolated */ }
  }
  return { ok: true, metrics, summary: threadSummary(metrics), at: new Date(nowMs).toISOString() };
}
