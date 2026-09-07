"use client";

import {
  Activity,
  FileClock,
  KeyRound,
  ListChecks,
  Network,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Signature
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Toaster, toast } from "sonner";

import { Badge, Btn, cn } from "@/components/ui/kit";
import { MODE_INFO } from "./labels";
import type { AuthStateResponse, PreflightResponse, RepoStatusResponse, StatusResponse } from "./types";
import { EP, refreshMany, useSaos } from "./api";

import { OverviewTab } from "./overview-tab";
import { ChainTab } from "./chain-tab";
import { SignaturesTab } from "./signatures-tab";
import { NetworksTab } from "./networks-tab";
import { DecisionsTab } from "./decisions-tab";
import { SecurityTab } from "./security-tab";
import { AuditTab } from "./audit-tab";

const TABS = [
  { value: "overview", label: "סקירה כללית", short: "סקירה", icon: Activity },
  { value: "chain", label: "שרשרת ואימות", short: "שרשרת", icon: ListChecks },
  { value: "signatures", label: "חתימות ועוגנים", short: "חתימות", icon: Signature },
  { value: "networks", label: "רשתות ומשאבים", short: "רשתות", icon: Network },
  { value: "decisions", label: "החלטות בעלים", short: "החלטות", icon: KeyRound },
  { value: "security", label: "אבטחה ומאגר", short: "אבטחה", icon: ShieldCheck },
  { value: "audit", label: "יומן ובדיקות", short: "יומן", icon: ScrollText }
] as const;

type TabValue = (typeof TABS)[number]["value"];

export function CommandCenter() {
  const [active, setActive] = useState<TabValue>("overview");
  const [refreshingAll, setRefreshingAll] = useState(false);

  const statusQ = useSaos<StatusResponse>("status", () => fetch(EP.status).then((r) => r.json() as Promise<StatusResponse>));
  const preflightQ = useSaos<PreflightResponse>("preflight", () => fetch(EP.preflight).then((r) => r.json() as Promise<PreflightResponse>));
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => fetch(EP.repoStatus).then((r) => r.json() as Promise<RepoStatusResponse>));
  const authQ = useSaos<AuthStateResponse>("auth", () => fetch(EP.auth).then((r) => r.json() as Promise<AuthStateResponse>));

  const mode = statusQ.state === "ready" ? statusQ.data.mode : null;
  const modeInfo = mode ? MODE_INFO[mode] : null;

  const refreshAll = useCallback(() => {
    setRefreshingAll(true);
    refreshMany([
      { key: "status", fetcher: () => fetch(EP.status).then((r) => r.json()) },
      { key: "preflight", fetcher: () => fetch(EP.preflight).then((r) => r.json()) },
      { key: "repo-status", fetcher: () => fetch(EP.repoStatus).then((r) => r.json()) },
      { key: "decisions", fetcher: () => fetch(EP.decisions).then((r) => r.json()) },
      { key: "signer", fetcher: () => fetch(EP.signer).then((r) => r.json()) },
      { key: "auth", fetcher: () => fetch(EP.auth).then((r) => r.json()) }
    ]).then(() => {
      setRefreshingAll(false);
      toast.success("כל הפאנלים הראשיים רועננו");
    });
  }, []);

  const openCritical = useMemo(() => (preflightQ.state === "ready" ? preflightQ.data.blockers.length : 0), [preflightQ]);

  return (
    <Tabs.Root dir="rtl" value={active} onValueChange={(v) => setActive(v as TabValue)} className="flex min-h-screen flex-col">
      <Toaster richColors position="top-center" dir="rtl" closeButton />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-amber-500 focus:px-3 focus:py-2 focus:text-zinc-950"
      >
        דלג לתוכן הראשי
      </a>

      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <ShieldCheck className="size-5 shrink-0 text-amber-400" aria-hidden />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold leading-tight text-zinc-100">SAOS — מרכז שליטה מבצעי</h1>
              <p className="truncate text-[11px] leading-tight text-zinc-500">Sovereign Foundry v2 · עגינה חוצת-רשתות</p>
            </div>
          </div>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            {modeInfo && (
              <Badge tone={modeInfo.tone} title={statusQ.state === "ready" ? statusQ.data.modeDetail : undefined}>
                <span aria-hidden>▸</span> מצב {modeInfo.label}
              </Badge>
            )}
            {openCritical > 0 && (
              <Badge tone="danger" title="בדוק את הפאנל חסימות פעילות">
                {openCritical} חסימות
              </Badge>
            )}
            <Btn
              variant={authQ.state === "ready" && authQ.data.authenticated ? "outline" : "ghost"}
              size="sm"
              ariaLabel="מצב התחברות — מעבר למסך אבטחה ומאגר"
              onClick={() => setActive("security")}
            >
              <KeyRound className="size-3.5" aria-hidden />
              {authQ.state === "ready" ? (authQ.data.authenticated ? "מחובר" : "לא מחובר") : "…"}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={refreshAll} loading={refreshingAll} ariaLabel="רענן את כל הפאנלים הראשיים" title="רענן הכול">
              <RefreshCw className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">רענן הכול</span>
            </Btn>
          </div>
        </div>

        <Tabs.List aria-label="מסכי מרכז השליטה" className="scroll-slim mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 pb-px sm:px-5">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors",
                "min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amber-400",
                "border-transparent text-zinc-500 hover:text-zinc-300",
                "data-[state=active]:border-amber-400 data-[state=active]:text-amber-300"
              )}
            >
              <t.icon className="size-3.5" aria-hidden />
              <span className="hidden md:inline">{t.label}</span>
              <span className="md:hidden">{t.short}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6 sm:py-6">
        {TABS.map((t) => (
          <Tabs.Content key={t.value} value={t.value} className="focus-visible:outline-none">
            {t.value === "overview" && <OverviewTab onNavigate={(tab) => setActive(tab as TabValue)} />}
            {t.value === "chain" && <ChainTab />}
            {t.value === "signatures" && <SignaturesTab />}
            {t.value === "networks" && <NetworksTab />}
            {t.value === "decisions" && <DecisionsTab />}
            {t.value === "security" && <SecurityTab />}
            {t.value === "audit" && <AuditTab />}
          </Tabs.Content>
        ))}
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] text-zinc-500 sm:px-6">
          <span className="flex items-center gap-1.5">
            <FileClock className="size-3" aria-hidden />
            {statusQ.state === "ready" ? `נתוני מערכת חיים · ${statusQ.data.seals.length} חותמות אחרונות במטמון התצוגה` : "מתחבר ל-API…"}
          </span>
          {repoQ.state === "ready" && (
            <span className="flex items-center gap-1.5">
              ריפו {repoQ.data.git.branch ?? "—"}
              {typeof repoQ.data.git.unpushedCommits === "number" && repoQ.data.git.unpushedCommits > 0
                ? ` · ${repoQ.data.git.unpushedCommits} קומיטים לא נדחפו`
                : " · מסונכרן"}
            </span>
          )}
          <span className="ms-auto">מקורות: /api/saos/* · קריאה-בלבד · ה-API לעולם לא מחזיר 500</span>
        </div>
      </footer>
    </Tabs.Root>
  );
}
