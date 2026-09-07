/**
 * Operation modes (מצבי פעולה) — dry-run / safe / live / maintenance.
 * Iron rule: there is NO accidental path to live mode — it requires TWO
 * independent flags (SAOS_MODE=live AND SAOS_LIVE_CONFIRM=YES).
 * Default is always dry-run: full computation, honest advisory anchoring,
 * zero external broadcast capability (the sandbox holds no signing vault).
 */

export type SaosMode = "dry-run" | "safe" | "live" | "maintenance";

export interface ModeState {
  mode: SaosMode;
  /** DB writes allowed (seal, receipts, entity rows) */
  writesEnabled: boolean;
  /** live mode armed (requires both flags) */
  liveArmed: boolean;
  /** external broadcast possible (requires liveArmed AND a connected vault — never true in this sandbox) */
  broadcastCapable: boolean;
  detail: string;
}

const VALID_MODES: SaosMode[] = ["dry-run", "safe", "live", "maintenance"];

export function saosMode(): ModeState {
  const raw = (process.env.SAOS_MODE ?? "dry-run").trim().toLowerCase();
  const mode: SaosMode = (VALID_MODES as string[]).includes(raw) ? (raw as SaosMode) : "dry-run";

  if (mode === "safe") {
    return { mode, writesEnabled: false, liveArmed: false, broadcastCapable: false, detail: "safe-mode: כתיבה נדחית — קריאה וחישוב בלבד" };
  }
  if (mode === "maintenance") {
    return { mode, writesEnabled: false, liveArmed: false, broadcastCapable: false, detail: "maintenance: תחזוקה — כתיבה נדחית" };
  }
  if (mode === "live") {
    const confirm = (process.env.SAOS_LIVE_CONFIRM ?? "").trim().toUpperCase();
    if (confirm !== "YES") {
      return {
        mode: "dry-run",
        writesEnabled: true,
        liveArmed: false,
        broadcastCapable: false,
        detail: "SAOS_MODE=live נדחה — חסר SAOS_LIVE_CONFIRM=YES (הגנה מפני הפעלה בטעות)"
      };
    }
    return {
      mode: "live",
      writesEnabled: true,
      liveArmed: true,
      // honest: even armed, this sandbox has no signing vault — broadcast stays impossible
      broadcastCapable: false,
      detail: "live: כתיבה מאושרת; שידור חיצוני נותר בלתי-אפשרי עד חיבור כספת חתימה"
    };
  }
  return { mode: "dry-run", writesEnabled: true, liveArmed: false, broadcastCapable: false, detail: "dry-run (ברירת-מחדל): חישוב מלא, עגינה advisory, אפס שידור" };
}

/** throws when writes are refused by the current mode — fail-closed, message is user-facing */
export function assertWritesEnabled(): ModeState {
  const m = saosMode();
  if (!m.writesEnabled) {
    throw new Error(`mode-refusal: כתיבה אסורה במצב ${m.mode} — הגדר SAOS_MODE=dry-run כדי לאפשר`);
  }
  return m;
}

/** GET-route side effects (receipt/entity persistence) honor writesEnabled; computation never blocked */
export function persistenceAllowed(): boolean {
  return saosMode().writesEnabled;
}
