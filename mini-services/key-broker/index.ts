/**
 * key-broker (:3040) — שער-החתימה של מישור-הריבונות (owner directive 2026-09-10:
 * "קח לו את הכוח אין מה לעשות איתו ותמשיך עוד הרבה").
 *
 * רקע (SYSTEM-AUDIT-2026-09-10 §F5): מישור-הריבונות (12 סוכנים × EVM-7רשתות+TRON+SOL+BTC)
 * חי-על-הדיסק וחסר ממשק-חתימה — ה-HUB הציג את key-broker.token כ"שער" בעוד שום-מאזין
 * מעולם לא נבנה. השער הזה הוא היד-המפעילה החסרה.
 *
 * עקרונות קשיחים:
 *  - FAIL-CLOSED: טוקן או רישום חסרים → degraded; כל-הנקודות המאובטחות 503.
 *  - אפס-יציאת-חומר-מפתח: pk/seed/מנמוניק לא יוצאים מהזיכרון — לא בתגובות, לא בלוגים,
 *    לא בשגיאות. התגובות נושאות רק כתובות (פומבי) וחתימות (פומביות).
 *  - Bearer-only: טוקן מ-~/.secrets/key-broker.token, השוואה timing-safe.
 *  - רישום-אמת: integrity pk→address נמדד בזמן-עלייה (EVM/TRON/SOL 12/12).
 *  - BTC = watch-only ברישום (pub ללא pk) → יכולת-חתימה לא מוצהרת.
 *  - פורט-תפוס → יציאה נקייה (המפקח יחייה).
 *
 * מקורות (paths בלבד — אף-ערך לא נדפס):
 *  - טוקן:  ~/.secrets/key-broker.token          (0600)
 *  - רישום: ~/.secrets/keys-restored/agent/keys/wallets-registry.json (0600)
 *    ניתן להכוונה ב-SOVEREIGN_REGISTRY_PATH (למשל לאימוץ אטימה מאוחה עתידית).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { timingSafeEqual } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 as sha256h } from "@noble/hashes/sha2";

const PORT = 3040;
const VERSION = "1.0.0";
const STARTED_AT = Date.now();
const HOME = os.homedir();
const TOKEN_PATH = path.join(HOME, ".secrets", "key-broker.token");
const REGISTRY_PATH =
  process.env.SOVEREIGN_REGISTRY_PATH ||
  path.join(HOME, ".secrets", "keys-restored", "agent", "keys", "wallets-registry.json");
const LOG_PATH = path.join(import.meta.dir, "key-broker.log");
const MAX_MESSAGE_BYTES = 10_000;
const PLANE_CACHE_MS = 60_000;

type Account = {
  agent: string;
  idx: number;
  evm?: { address: string; nets?: unknown; path?: string; pk?: string };
  tron?: { address: string; path?: string; pk?: string };
  sol?: { address: string; pk?: string };
  btc?: { address: string; path?: string; pub?: string };
};
type Registry = { accounts: Account[] };

function log(level: string, msg: string) {
  // choke point: אימות/חומר-גולמי לעולם לא נדפס
  const safe = String(msg)
    .replace(/Authorization:\s*(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "Authorization: [REDACTED]")
    .replace(/\b[0-9a-f]{64,}\b/gi, "[HEX-REDACTED]");
  const line = `${new Date().toISOString()} [${level}] ${safe}`;
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
  console.log(line);
}

// ── load state (fail-closed) ───────────────────────────────────────────────
let tokenBytes: Uint8Array | null = null;
let registry: Registry | null = null;
let integrity: { evm: string; tron: string; sol: string; computedAt: string } | null = null;

function loadToken(): void {
  try {
    tokenBytes = new TextEncoder().encode(fs.readFileSync(TOKEN_PATH, "utf8").trim());
  } catch {
    tokenBytes = null;
  }
}
function loadRegistry(): void {
  try {
    const j = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as Registry;
    if (!Array.isArray(j.accounts) || !j.accounts.length) throw new Error("empty accounts");
    registry = j;
  } catch (e) {
    registry = null;
    log("WARN", `registry load failed at ${REGISTRY_PATH}: ${String((e as Error).message).slice(0, 120)}`);
  }
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58enc(b: Uint8Array): string {
  const hex = Buffer.from(b).toString("hex");
  if (!hex) return "";
  let x = BigInt("0x" + hex), out = "";
  while (x > 0n) { out = B58[Number(x % 58n)] + out; x /= 58n; }
  for (const byte of b) { if (byte === 0) out = "1" + out; else break; }
  return out;
}
function b58check(b: Uint8Array): string {
  const buf = Buffer.from(b);
  return b58enc(Buffer.concat([buf, Buffer.from(sha256h(sha256h(buf)).slice(0, 4))]));
}
function evmAddrFromPk(pkHex: string): string {
  const p = String(pkHex).replace(/^0x/, "").toLowerCase();
  const P = (secp256k1 as unknown as { ProjectivePoint: { fromPrivateKey: (b: bigint) => { toRawBytes: (c: boolean) => Uint8Array } } }).ProjectivePoint;
  const pubU = P.fromPrivateKey(BigInt("0x" + p)).toRawBytes(false);
  return "0x" + Buffer.from(keccak_256(pubU.slice(1)).slice(12)).toString("hex");
}
function tronAddrFromPk(pkHex: string): string {
  const p = String(pkHex).replace(/^0x/, "").toLowerCase();
  const P = (secp256k1 as unknown as { ProjectivePoint: { fromPrivateKey: (b: bigint) => { toRawBytes: (c: boolean) => Uint8Array } } }).ProjectivePoint;
  const pubU = P.fromPrivateKey(BigInt("0x" + p)).toRawBytes(false);
  return b58check(Buffer.concat([Buffer.from([0x41]), Buffer.from(keccak_256(pubU.slice(1)).slice(12))]));
}
function solAddrFromSeed(seed32: Uint8Array): string {
  return b58enc(ed25519.getPublicKey(seed32));
}

/** integrity: כל-pk ברישום חייב להפיק את הכתובת שלו — אחרת הרישום פסול-עבודה */
function measureIntegrity(): { evm: string; tron: string; sol: string; computedAt: string } | null {
  if (!registry) return null;
  let evmOk = 0, evmHas = 0, tronOk = 0, tronHas = 0, solOk = 0, solHas = 0;
  for (const a of registry.accounts) {
    try {
      if (a.evm?.pk && a.evm?.address) { evmHas++; if (evmAddrFromPk(a.evm.pk).toLowerCase() === a.evm.address.toLowerCase()) evmOk++; }
      if (a.tron?.pk && a.tron?.address) { tronHas++; if (tronAddrFromPk(a.tron.pk) === a.tron.address) tronOk++; }
      if (a.sol?.pk && a.sol?.address) {
        solHas++;
        const raw = Buffer.from(String(a.sol.pk).replace(/^0x/, ""), "hex");
        const seed = raw.length === 64 ? raw.subarray(32) : raw; // 64B = seed||pub, 32B = seed
        if (seed.length === 32 && solAddrFromSeed(seed) === a.sol.address) solOk++;
      }
    } catch {}
  }
  return {
    evm: `${evmOk}/${evmHas}`,
    tron: `${tronOk}/${tronHas}`,
    sol: `${solOk}/${solHas}`,
    computedAt: new Date().toISOString(),
  };
}

loadToken();
loadRegistry();
integrity = measureIntegrity();
log("INFO", `key-broker up on :${PORT} v${VERSION} — token=${!!tokenBytes} registry=${registry ? registry.accounts.length + " accounts" : "MISSING"} integrity=${integrity ? `evm ${integrity.evm} · tron ${integrity.tron} · sol ${integrity.sol}` : "n/a"}`);

// ── auth ───────────────────────────────────────────────────────────────────
function authorized(req: Request): boolean {
  if (!tokenBytes) return false;
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return false;
  const given = new TextEncoder().encode(m[1].trim());
  if (given.length !== tokenBytes.length) return false;
  return timingSafeEqual(given, tokenBytes);
}

function json(obj: unknown, status = 200): Response {
  return Response.json(obj as Record<string, unknown>, { status });
}

// ── plane surface (public fields only — pk/pub stripped) ────────────────────
let planeCache: { at: number; body: unknown } | null = null;
function planeBody(): unknown {
  if (planeCache && Date.now() - planeCache.at < PLANE_CACHE_MS) return planeCache.body;
  if (!registry) return null;
  const body = {
    generatedAt: new Date().toISOString(),
    source: "registry-on-disk (paths only, never values)",
    accounts: registry.accounts.map((a) => ({
      agent: a.agent,
      idx: a.idx,
      evm: a.evm ? { address: a.evm.address, nets: a.evm.nets, path: a.evm.path } : null,
      tron: a.tron ? { address: a.tron.address, path: a.tron.path } : null,
      sol: a.sol ? { address: a.sol.address } : null,
      btc: a.btc ? { address: a.btc.address, path: a.btc.path, watchOnly: true } : null,
    })),
    integrity,
  };
  planeCache = { at: Date.now(), body };
  return body;
}

// ── signing core ───────────────────────────────────────────────────────────
function parseMessage(message: unknown, encoding: unknown): { ok: true; bytes: Uint8Array } | { ok: false; err: string } {
  if (typeof message !== "string" || message.length === 0) return { ok: false, err: "message required (non-empty string)" };
  let bytes: Uint8Array;
  if (encoding === "hex") {
    const hex = message.replace(/^0x/, "");
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return { ok: false, err: "encoding=hex requires valid hex string" };
    bytes = new Uint8Array(Buffer.from(hex, "hex"));
  } else {
    bytes = new TextEncoder().encode(message);
  }
  if (bytes.length > MAX_MESSAGE_BYTES) return { ok: false, err: `message too large (${bytes.length} > ${MAX_MESSAGE_BYTES} bytes)` };
  return { ok: true, bytes };
}

function personalHash(prefix: string, bytes: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(`${prefix}${bytes.length}`);
  return keccak_256(Buffer.concat([Buffer.from(header), Buffer.from(bytes)]));
}

function evmSign(privHex: string, bytes: Uint8Array): { address: string; signature: string; scheme: string } {
  const P = secp256k1 as unknown as {
    sign: (h: Uint8Array, pk: Uint8Array, o?: Record<string, unknown>) => unknown;
    ProjectivePoint: { fromPrivateKey: (b: bigint) => { toRawBytes: (c: boolean) => Uint8Array } };
  };
  const priv = new Uint8Array(Buffer.from(privHex.replace(/^0x/, ""), "hex"));
  const hash = personalHash("\x19Ethereum Signed Message:\n", bytes);
  const sig = P.sign(hash, priv, { prehash: false }) as { r: bigint; s: bigint; recovery?: number };
  const rec = typeof sig.recovery === "number" ? sig.recovery : 0;
  const r = Buffer.from(sig.r.toString(16).padStart(64, "0"), "hex");
  const s = Buffer.from(sig.s.toString(16).padStart(64, "0"), "hex");
  const signature = "0x" + Buffer.concat([r, s, Buffer.from([27 + rec])]).toString("hex");
  const address = evmAddrFromPk(privHex);
  return { address, signature, scheme: "evm-personal_sign (EIP-191), 65B r||s||v" };
}

function tronSign(privHex: string, bytes: Uint8Array): { address: string; signature: string; scheme: string } {
  const P = secp256k1 as unknown as {
    sign: (h: Uint8Array, pk: Uint8Array, o?: Record<string, unknown>) => unknown;
  };
  const priv = new Uint8Array(Buffer.from(privHex.replace(/^0x/, ""), "hex"));
  const hash = personalHash("\x19TRON Signed Message:\n", bytes);
  const sig = P.sign(hash, priv, { prehash: false }) as { r: bigint; s: bigint; recovery?: number };
  const rec = typeof sig.recovery === "number" ? sig.recovery : 0;
  const r = Buffer.from(sig.r.toString(16).padStart(64, "0"), "hex");
  const s = Buffer.from(sig.s.toString(16).padStart(64, "0"), "hex");
  const signature = Buffer.concat([r, s, Buffer.from([27 + rec])]).toString("hex");
  const address = tronAddrFromPk(privHex);
  return { address, signature, scheme: "tron-signed-message (0x19 TRON header), 65B r||s||v" };
}

function solSign(seedHex: string, bytes: Uint8Array): { address: string; signature: string; scheme: string } {
  const raw = Buffer.from(seedHex.replace(/^0x/, ""), "hex");
  const seed = raw.length === 64 ? raw.subarray(32) : raw;
  if (seed.length !== 32) throw new Error("sol pk must be 32B seed or 64B seed||pub");
  const pub = ed25519.getPublicKey(seed);
  const sig = ed25519.sign(bytes, seed);
  return {
    address: b58enc(pub),
    signature: Buffer.from(sig).toString("hex"),
    scheme: "solana-ed25519 (64B sig; hex here, base58 in wallets)",
  };
}

function accountByAgent(agent: unknown): Account | null {
  if (typeof agent !== "string" || !registry) return null;
  return registry.accounts.find((a) => a.agent === agent) ?? null;
}

// ── server ─────────────────────────────────────────────────────────────────
try {
  Bun.serve({
    port: PORT,
    async fetch(req: Request) {
      const u = new URL(req.url);
      const method = req.method;

      if (u.pathname === "/ping" && method === "GET") {
        // probe פומבי-מינימלי (למפקח): אפס-תוכן-רגיש, גם-degraded משיב
        return json({ ok: true, service: "key-broker", version: VERSION, degraded: !tokenBytes || !registry });
      }

      const degraded = !tokenBytes || !registry;
      if (!authorized(req)) {
        log("WARN", `401 ${method} ${u.pathname} (degraded=${degraded})`);
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      if (degraded) {
        return json({ ok: false, error: "fail-closed: token or registry missing on disk" }, 503);
      }

      if (u.pathname === "/health" && method === "GET") {
        return json({
          ok: true, service: "key-broker", version: VERSION, plane: "sovereign",
          uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
          accounts: registry!.accounts.length,
          integrity,
          tokenPresent: !!tokenBytes,
        });
      }

      if (u.pathname === "/keys/sovereign-plane" && method === "GET") {
        const body = planeBody();
        if (!body) return json({ ok: false, error: "registry unavailable" }, 503);
        return json({ ok: true, ...({} as object), plane: body });
      }

      if (u.pathname === "/sign/capabilities" && method === "GET") {
        return json({
          ok: true,
          capabilities: [
            { plane: "evm", networks: "ethereum,bsc,polygon,arbitrum,optimism,base,avalanche", scheme: "personal_sign (EIP-191)", signing: true },
            { plane: "tron", networks: "tron", scheme: "TRON signed message", signing: true },
            { plane: "sol", networks: "solana", scheme: "ed25519", signing: true },
            { plane: "btc", networks: "bitcoin", scheme: "P2WPKH m/84'/0'/0'/0/i", signing: false, reason: "registry holds pub only — watch-only by design" },
          ],
          limits: { maxMessageBytes: MAX_MESSAGE_BYTES, encodings: ["utf8", "hex"] },
        });
      }

      if (u.pathname === "/sign" && method === "POST") {
        let body: Record<string, unknown> = {};
        try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ ok: false, error: "invalid json" }, 400); }
        const a = accountByAgent(body.agent);
        if (!a) return json({ ok: false, error: "unknown agent" }, 400);
        const parsed = parseMessage(body.message, body.encoding);
        if (!parsed.ok) return json({ ok: false, error: parsed.err }, 400);
        const plane = String(body.plane || "evm").toLowerCase();
        try {
          let result: { address: string; signature: string; scheme: string };
          if (plane === "evm") {
            if (!a.evm?.pk) return json({ ok: false, error: "agent has no evm key" }, 400);
            result = evmSign(a.evm.pk, parsed.bytes);
          } else if (plane === "tron") {
            if (!a.tron?.pk) return json({ ok: false, error: "agent has no tron key" }, 400);
            result = tronSign(a.tron.pk, parsed.bytes);
          } else if (plane === "sol") {
            if (!a.sol?.pk) return json({ ok: false, error: "agent has no sol key" }, 400);
            result = solSign(a.sol.pk, parsed.bytes);
          } else {
            return json({ ok: false, error: "plane must be evm|tron|sol" }, 400);
          }
          const fp = Buffer.from(sha256h(parsed.bytes)).toString("hex").slice(0, 12);
          log("INFO", `sign ok agent=${a.agent} plane=${plane} address=${result.address} msgSha12=${fp} msgLen=${parsed.bytes.length}`);
          return json({ ok: true, agent: a.agent, plane, ...result });
        } catch (e) {
          log("ERROR", `sign failed agent=${a.agent} plane=${plane}: ${String((e as Error).message).slice(0, 120)}`);
          return json({ ok: false, error: "signing failed (details logged, no key material involved)" }, 500);
        }
      }

      if (u.pathname === "/verify" && method === "POST") {
        let body: Record<string, unknown> = {};
        try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ ok: false, error: "invalid json" }, 400); }
        const a = accountByAgent(body.agent);
        if (!a) return json({ ok: false, error: "unknown agent" }, 400);
        const parsed = parseMessage(body.message, body.encoding);
        if (!parsed.ok) return json({ ok: false, error: parsed.err }, 400);
        const plane = String(body.plane || "evm").toLowerCase();
        const sigHex = String(body.signature || "").replace(/^0x/, "");
        try {
          let valid = false;
          if (plane === "evm" || plane === "tron") {
            if (sigHex.length !== 130) return json({ ok: false, error: "signature must be 65 bytes hex" }, 400);
            const prefix = plane === "evm" ? "\x19Ethereum Signed Message:\n" : "\x19TRON Signed Message:\n";
            const hash = personalHash(prefix, parsed.bytes);
            const rec = parseInt(sigHex.slice(128, 130), 16);
            if (rec < 27 || rec > 28) return json({ ok: false, error: "v must be 27|28" }, 400);
            const sig = secp256k1.Signature.fromCompact(sigHex.slice(0, 128)).addRecoveryBit(rec - 27);
            const pubU = sig.recoverPublicKey(hash).toRawBytes(false);
            const addr = plane === "evm"
              ? "0x" + Buffer.from(keccak_256(pubU.slice(1)).slice(12)).toString("hex")
              : b58check(Buffer.concat([Buffer.from([0x41]), Buffer.from(keccak_256(pubU.slice(1)).slice(12))]));
            const expected = plane === "evm" ? a.evm?.address : a.tron?.address;
            valid = !!expected && addr.toLowerCase() === expected.toLowerCase();
          } else if (plane === "sol") {
            const raw = Buffer.from(String(a.sol?.pk || "").replace(/^0x/, ""), "hex");
            const seed = raw.length === 64 ? raw.subarray(32) : raw;
            const pub = ed25519.getPublicKey(seed);
            valid = ed25519.verify(new Uint8Array(Buffer.from(sigHex, "hex")), parsed.bytes, pub);
          } else {
            return json({ ok: false, error: "plane must be evm|tron|sol" }, 400);
          }
          const fp = Buffer.from(sha256h(parsed.bytes)).toString("hex").slice(0, 12);
          log("INFO", `verify agent=${a.agent} plane=${plane} valid=${valid} msgSha12=${fp}`);
          return json({ ok: true, agent: a.agent, plane, valid });
        } catch (e) {
          log("ERROR", `verify failed agent=${a.agent} plane=${plane}: ${String((e as Error).message).slice(0, 120)}`);
          return json({ ok: false, error: "verification failed (details logged)" }, 500);
        }
      }

      return new Response("key-broker :3040 — /ping (GET) · /health · /keys/sovereign-plane · /sign/capabilities · POST /sign · POST /verify (Bearer)\n");
    },
  });
} catch (e) {
  console.log(`port ${PORT} busy — exiting cleanly (${String((e as Error)?.message || e).slice(0, 80)})`);
  process.exit(0);
}
