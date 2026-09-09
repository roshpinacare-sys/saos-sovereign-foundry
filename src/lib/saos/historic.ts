/**
 * Historic anchor references — the public record from the previous network
 * (recorded before this sandbox; partial txids as published in the report).
 * Never fabricated: these are partial references with explicit provenance.
 */

export interface HistoricAnchor {
  network: "STEEM" | "BLURT" | "HIVE" | "TRON";
  txRef: string | null;
  state: string;
  note: string;
}

export const HISTORIC_ANCHORS: HistoricAnchor[] = [
  {
    network: "STEEM",
    txRef: "3452e62bc3bf5b…dee9ee1003",
    state: "anchored",
    note: "custom_json saos.weave.v1 — מאומרת בהיסטוריה החיה, מסומנת כרפרנס חלקי"
  },
  {
    network: "BLURT",
    txRef: "cda701d1dd30e7f906caef2e48f592e4d8844d8c",
    state: "anchored",
    note: "Task 36 (2026-09-09): עוגן שזירה חי — headcorner posting, בלוק 63498486, מאומת קריאה-חוזרה; root-cause מלא: op-enum-12 + chain_id cd8d90f2… (ראה worklog)"
  },
  {
    network: "HIVE",
    txRef: null,
    state: "pending",
    note: "rc-gated: 0.6%<12% — רגן-תקציב, המתנה כנה לפעימה הבאה"
  },
  {
    network: "TRON",
    txRef: null,
    state: "transit",
    note: "root נישא בתוך stateRoot → רכבת tronbridge היומית"
  }
];
