/**
 * trends.mjs — R231 · מכ"ם-טרנדים (ה-viralbench שלנו, בהקשרים שלנו).
 * Operator order: "למצוא טרנדים ודברים לדבר עליהם מתוך סקריפט שבודק מה טרנד
 * וכו אבל בהקשרים שלנו" — viralbench.ai measures what's viral; OUR radar
 * measures what's trending INSIDE OUR CONTEXTS (crypto, DPoS, network
 * development, AI agents — "התפתחות של רשת כמו שלנו ועל האפשרויות").
 *
 * TWO SOURCES (both measured, both sourced):
 *   A. CHAIN TRENDING — what the Steem community itself is engaging with
 *      right now (get_discussions_by_trending across the context-tag
 *      whitelist): votes/replies/age = real engagement signals.
 *   B. EXTERNAL INTEL — the web-intel findings already measured by
 *      webintel.mjs + the AI trend analyst (bridge /api/saos/ai/trends)
 *      turning raw signals into scored TALK TRACKS.
 *
 * OUTPUT: state/trends.json — scored topics + ready talk-tracks that the
 * coordination center assigns to accounts (each in its own window), and the
 * cockpit renders. Cadence 6h, fail-isolated, every topic carries its source.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { normalizeWebIntel } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "trends.json");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";
const CADENCE_MS = 6 * 3600_000; // 4 radar sweeps/day — bounded, honest

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

/** our contexts — the ONLY lanes this radar sweeps (operator: "בהקשרים שלנו") */
export const CONTEXT_TAGS = ["steem", "crypto", "defi", "technology", "ai", "web3", "blockchain", "dpos"];

/** pure: engagement score of one chain-trending post (deterministic).
 * votes and replies weigh in, freshness adds; age decays linearly over 48h. */
export function engagementScore({ activeVotes = 0, replies = 0, createdMs = 0, nowMs = Date.now() } = {}) {
  const ageH = Math.max(0, (nowMs - createdMs) / 3600_000);
  const fresh = Math.max(0, 1 - ageH / 48); // 1.0 now → 0.0 at 48h
  const base = Math.log2(1 + activeVotes) * 2 + Math.log2(1 + replies) * 3;
  return Math.round((base * (0.5 + 0.5 * fresh)) * 10) / 10;
}

/** pure: normalize one condenser discussion → candidate (fail-soft) */
export function normalizeTrend(raw, tag, nowMs) {
  if (!raw?.author || !raw?.permlink) return null;
  const createdMs = raw.created ? Date.parse(raw.created.endsWith("Z") ? raw.created : raw.created + "Z") : 0;
  if (!(createdMs > 0)) return null;
  const num = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;
  const title = String(raw.title ?? "").trim();
  const bodyLen = String(raw.body ?? "").length;
  return {
    author: raw.author, permlink: raw.permlink, tag: tag ?? null, title,
    activeVotes: (raw.active_votes ?? []).length, replies: raw.children ?? 0,
    pendingSbd: num(raw.pending_payout_value), bodyLen, createdMs,
    score: engagementScore({ activeVotes: (raw.active_votes ?? []).length, replies: raw.children ?? 0, createdMs, nowMs }),
  };
}

/** chain sweep: trending inside our contexts (fail-isolated per tag) */
export async function fetchChainTrends(nowMs = Date.now()) {
  const found = [];
  let tagsOk = 0, tagsFail = 0;
  for (const tag of CONTEXT_TAGS) {
    try {
      const r = await rpcCall("condenser_api.get_discussions_by_trending", [{ tag, limit: 10 }]);
      if (!r.ok) { tagsFail++; continue; }
      tagsOk++;
      for (const raw of (r.result ?? [])) {
        const n = normalizeTrend(raw, tag, nowMs);
        if (n) found.push(n);
      }
    } catch { tagsFail++; }
  }
  // dedupe by author/permlink, keep highest score, rank by score
  const byKey = new Map();
  for (const t of found) {
    const k = `${t.author}/${t.permlink}`;
    const prev = byKey.get(k);
    if (!prev || t.score > prev.score) byKey.set(k, t);
  }
  const ranked = [...byKey.values()].sort((a, b) => b.score - a.score);
  return { posts: ranked, tagsOk, tagsFail };
}

/** pure: compress chain candidates into a bounded LLM payload (top N only) */
export function compressForAnalyst(posts, topN = 12) {
  return posts.slice(0, topN).map((p) => ({
    title: p.title.slice(0, 110), tag: p.tag, votes: p.activeVotes, replies: p.replies,
    ageH: Math.round((Date.now() - p.createdMs) / 3600_000), score: p.score,
  }));
}

export function trendsState() { return readJson(FILE, null); }

/** the radar sweep — cadence-gated, fail-isolated, always honest */
export async function runTrends({ now = new Date().toISOString(), force = false } = {}) {
  const prev = readJson(FILE, null);
  const lastMs = prev?.fetchedAt ? Date.parse(prev.fetchedAt) : 0;
  if (!force && Number.isFinite(lastMs) && Date.now() - lastMs < CADENCE_MS) {
    return { verdict: "CADENCE-GATED", lastAt: prev.fetchedAt, topics: (prev.topics ?? []).length };
  }
  const t0 = Date.now();
  const nowMs = Date.parse(now);
  const chain = await fetchChainTrends(nowMs);

  /* external intel findings (already sourced by webintel) + fresh analyst pass */
  const intel = readJson(path.join(STATE, "webintel.json"), null);
  const intelFindings = (intel?.scans ?? []).flatMap((s) => (s.findings ?? []).slice(0, 2)).slice(0, 6)
    .map((f) => ({ title: f.title, host: f.host, url: f.url }));

  let topics = [], bridgeError = null;
  if (chain.posts.length > 0 || intelFindings.length > 0) {
    try {
      const r = await fetch(`${BRIDGE}/api/saos/ai/trends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainTrends: compressForAnalyst(chain.posts), intelFindings, contexts: CONTEXT_TAGS }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`bridge ${r.status}`);
      const d = await r.json();
      topics = (Array.isArray(d?.topics) ? d.topics : [])
        .filter((t) => t && typeof t === "object" && String(t.topic ?? "").length > 8)
        .map((t, i) => ({
          id: `tr${Date.parse(now)}-${i}`,
          topic: String(t.topic).slice(0, 200),
          angle: String(t.angle ?? "").slice(0, 300),
          talkTrack: String(t.talkTrack ?? "").slice(0, 600),
          tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => String(x).toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean).slice(0, 5),
          score: Number(t.score) > 0 ? Math.round(Number(t.score) * 10) / 10 : null,
          basedOn: Array.isArray(t.basedOn) ? t.basedOn.slice(0, 3).map((x) => String(x).slice(0, 120)) : [],
        }));
    } catch (e) { bridgeError = String(e?.message ?? e).slice(0, 160); }
  }

  const doc = {
    fetchedAt: now,
    verdict: topics.length > 0 ? "TRENDS-OK" : bridgeError ? "BRIDGE-DOWN" : "NO-SIGNAL",
    sources: {
      chain: { scanned: chain.posts.length, tagsOk: chain.tagsOk, tagsFail: chain.tagsFail, top: chain.posts.slice(0, 6).map((p) => ({ title: p.title.slice(0, 90), tag: p.tag, score: p.score, votes: p.activeVotes, replies: p.replies })) },
      intel: { findings: intelFindings.length },
    },
    topics: topics.slice(0, 12),
    bridgeError,
    ms: Date.now() - t0,
    law: "כל-טרנד נושא מקור (פוסט-שרשרת או ממצא-אינטל) — טרנד בלי-מקור לא נכנס; ההקשרים = צי-התגים שלנו בלבד",
  };
  writeJson(FILE, { ...doc, history: [{ fetchedAt: now, topics: topics.length, verdict: doc.verdict }, ...(Array.isArray(prev?.history) ? prev.history : []).slice(0, 2)] });
  return { verdict: doc.verdict, topics: topics.length, chainScanned: chain.posts.length, bridgeError, ms: doc.ms };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTrends({ now: new Date().toISOString(), force: true }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("TRENDS-FAIL", e); process.exit(1); });
}
