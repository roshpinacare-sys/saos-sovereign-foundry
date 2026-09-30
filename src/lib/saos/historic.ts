/**
 * Historic anchor references — the public record from the previous network
 * (recorded before this sandbox; partial txids as published in the report).
 * Never fabricated: these are partial references with explicit provenance.
 *
 * Task 10 (2026-09-30): every row carries an explicit `asOf` — these rows are a
 * HISTORIC snapshot (verified against the chains as of 2026-09-11), never a live
 * status claim. Live per-network status is served from network-status.ts /
 * /api/saos/status; the HIVE "rc-gated" note is superseded by the live RC model.
 */

export interface HistoricAnchor {
  network: "STEEM" | "BLURT" | "HIVE" | "TRON";
  txRef: string | null;
  state: string;
  note: string;
  /** Task 10: explicit snapshot date — a historic row must never pass as live */
  asOf: string;
}

export const HISTORIC_ANCHORS: HistoricAnchor[] = [
  {
    network: "STEEM",
    txRef: "3452e62bc3bf5b…dee9ee1003",
    state: "anchored",
    note: "custom_json saos.weave.v1 — מאומרת בהיסטוריה החיה, מסומנת כרפרנס חלקי",
    asOf: "2026-09-11"
  },
  {
    network: "BLURT",
    txRef: "cda701d1dd30e7f906caef2e48f592e4d8844d8c",
    state: "anchored",
    note: "Task 36 (2026-09-09): עוגן שזירה חי — headcorner posting, בלוק 63498486, מאומת קריאה-חוזרה; root-cause מלא: op-enum-12 + chain_id cd8d90f2… (ראה worklog)",
    asOf: "2026-09-11"
  },
  {
    network: "HIVE",
    txRef: null,
    state: "pending",
    // Task 10: "0.6%<12%" was the frozen pre-live-model RC claim — superseded by
    // hive-rc-live.ts; this row is a historic reference, live status lives in the network card.
    note: "rc-gated: 0.6%<12% — רגן-תקציב, המתנה כנה לפעימה הבאה · רפרנס-היסטורי — סטטוס-חי-בכרטיס-הרשת",
    asOf: "2026-09-11"
  },
  {
    network: "TRON",
    txRef: null,
    state: "transit",
    note: "root נישא בתוך stateRoot → רכבת tronbridge היומית",
    asOf: "2026-09-11"
  }
];
