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
  deferred: { label: "נדחה על-ידי הבעלים", tone: "neutral" }
};
