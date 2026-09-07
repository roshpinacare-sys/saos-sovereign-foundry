"use client";

import type { SignatureStatus } from "./types";

/** signature lifecycle → Hebrew label + tone (never color-only: labels always shown) */
export const SIGNATURE_STATUS: Record<SignatureStatus, { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" | "gold" }> = {
  pending: { label: "ממתין לחותם", tone: "info" },
  "awaiting-approval": { label: "ממתין לאישור", tone: "warn" },
  "signed-externally": { label: "נחתם חיצונית", tone: "gold" },
  recorded: { label: "רשום ומאומת", tone: "ok" },
  failed: { label: "נכשל", tone: "danger" },
  expired: { label: "פג תוקף", tone: "neutral" },
  cancelled: { label: "בוטל", tone: "neutral" }
};

export const NETWORK_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" }> = {
  anchored: { label: "נעוגן", tone: "ok" },
  pending: { label: "ממתין עוגן", tone: "info" },
  gated: { label: "חסום שער", tone: "danger" },
  transit: { label: "במעבר", tone: "warn" }
};

// Task 12: chain identity + RPC presence labels (never color-only — text always shown)
export const CHAIN_TYPE_LABEL: Record<string, string> = {
  graphene: "Graphene (משפחת STEEM/HIVE)",
  tvm: "TVM (TRON)",
  evm: "EVM (אתריום)",
  "solana-runtime": "Solana runtime"
};

export const RPC_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "info" | "neutral" }> = {
  "not-configured": { label: "RPC לא מוגדר — dry-run", tone: "neutral" },
  public: { label: "RPC ציבורי (ללא מפתח) — קריאה בלבד", tone: "info" },
  configured: { label: "RPC מוגדר", tone: "ok" }
};

export const ANCHOR_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" }> = {
  anchored: { label: "נעוגן", tone: "ok" },
  pending: { label: "ממתין", tone: "info" },
  gated: { label: "חסום", tone: "danger" },
  transit: { label: "במעבר", tone: "warn" }
};

export const MODE_INFO: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" | "gold"; desc: string }> = {
  "dry-run": { label: "dry-run", tone: "info", desc: "חישוב מלא, אפס שידור" },
  safe: { label: "safe", tone: "neutral", desc: "קריאה בלבד — כתיבה נדחית" },
  live: { label: "live", tone: "warn", desc: "כתיבה מאושרת — עדיין ללא שידור עד חיבור חותם" },
  maintenance: { label: "maintenance", tone: "danger", desc: "מצב תחזוקה — כתיבה נדחית" }
};

export const DECISION_PHASE_ORDER = ["now", "before-anchor", "before-live"] as const;

export const DECISION_PHASE_LABEL: Record<string, string> = {
  now: "נדרש עכשיו",
  "before-anchor": "נדרש לפני עוגן",
  "before-live": "נדרש לפני מצב חי"
};

export const DECISION_RECORDED: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" }> = {
  open: { label: "פתוחה — דורשת החלטה", tone: "warn" },
  "decided-default": { label: "הוחלט — ברירת המחדל הבטוחה", tone: "ok" },
  "decided-custom": { label: "הוחלט — אפשרות חלופית", tone: "info" },
  "needs-resource": { label: "דורשת משאב — ממתינה למימון/פעולת בעלים", tone: "danger" },
  "resolved-external": { label: "טופלה מחוץ למערכת", tone: "ok" },
  deferred: { label: "נדחה לסבב עתידי", tone: "neutral" },
  rejected: { label: "נדחה על-ידי הבעלים", tone: "neutral" }
};

export const VERIFICATION_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  verified: { label: "מאומת מול הרשת", tone: "ok" },
  unverified: { label: "לא מאומת — לא עוגן סופי", tone: "warn" },
  "not-checked": { label: "טרם נבדק מול רשת", tone: "neutral" }
};

export const DECISION_CATEGORY: Record<string, string> = {
  security: "אבטחה",
  resources: "משאבים",
  governance: "ניהול",
  release: "שחרור"
};
