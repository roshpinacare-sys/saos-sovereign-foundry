"use client";

import {
  Activity,
  Bot,
  FileClock,
  KeyRound,
  Landmark,
  ListChecks,
  Network,
  RefreshCw,
  Rocket,
  ScrollText,
  ShieldCheck,
  Signature
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Toaster, toast } from "sonner";

import { Badge, Btn, cn } from "@/components/ui/kit";
import { MODE_INFO } from "./labels";
import type { AuthStateResponse, PreflightResponse, RepoStatusResponse, StatusResponse } from "./types";
import { EP, refreshMany, useSaos } from "./api";

import { OverviewTab } from "./overview-tab";
import { BreakthroughTab } from "./breakthrough-tab";
import { ChainTab } from "./chain-tab";
import { SignaturesTab } from "./signatures-tab";
import { NetworksTab } from "./networks-tab";
import { TreasuryTab } from "./treasury-tab";
import { DecisionsTab } from "./decisions-tab";
import { SecurityTab } from "./security-tab";
import { AgentsTab } from "./agents-tab";
import { AuditTab } from "./audit-tab";

const TABS = [
  { value: "overview", label: "סקירה כללית", short: "סקירה", icon: Activity },
  { value: "breakthrough", label: "פריצת הדרך", short: "פריצה", icon: Rocket },
  { value: "chain", label: "שרשרת ואימות", short: "שרשרת", icon: ListChecks },
  { value: "signatures", label: "חתימות ועוגנים", short: "חתימות", icon: Signature },
  { value: "networks", label: "רשתות ומשאבים", short: "רשתות", icon: Network },
  { value: "treasury", label: "קופה חיה", short: "קופה", icon: Landmark },
  { value: "decisions", label: "החלטות בעלים", short: "החלטות", icon: KeyRound },
  { value: "security", label: "אבטחה ומאגר", short: "אבטחה", icon: ShieldCheck },
  { value: "agents", label: "סוכנים", short: "סוכנים", icon: Bot },
  { value: "audit", label: "יומן ובדיקות", short: "יומן", icon: ScrollText }
] as const;

type TabValue = (typeof TABS)[number]["value"];

function useClock(): string {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function CommandCenter() {
  const [active, setActive] = useState<TabValue>("overview");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const clock = useClock();

  const statusQ = useSaos<StatusResponse>("status", () => fetch(EP.status).then((r) => r.json() as Promise<StatusResponse>));
  const preflightQ = useSaos<PreflightResponse>("preflight", () => fetch(EP.preflight).then((r) => r.json() as Promise<PreflightResponse>));
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => fetch(EP.repoStatus).then((r) => r.json() as Promise<RepoStatusResponse>));
  const authQ = useSaos<AuthStateResponse>("auth", () => fetch(EP.auth).then((r) => r.json() as Promise<AuthStateResponse>));

  const mode = statusQ.state === "ready" ? statusQ.data.mode : null;
  const modeInfo = mode ? MODE_INFO[mode] : null;
  const activeTab = TABS.find((t) => t.value === active);

  const refreshAll = useCallback(() => {
    setRefreshingAll(true);
    refreshMany([
      { key: "status", fetcher: () => fetch(EP.status).then((r) => r.json()) },
      { key: "preflight", fetcher: () => fetch(EP.preflight).then((r) => r.json()) },
      { key: "repo-status", fetcher: () => fetch(EP.repoStatus).then((r) => r.json()) },
      { key: "decisions", fetcher: () => fetch(EP.decisions).then((r) => r.json()) },
      { key: "signer", fetcher: () => fetch(EP.signer).then((r) => r.json()) },
      { key: "auth", fetcher: () => fetch(EP.auth).then((r) => r.json()) },
      { key: "treasury", fetcher: () => fetch(EP.treasury).then((r) => r.json()) }
    ]).then(() => {
      setRefreshingAll(false);
      toast.success("כל הפאנלים הראשיים רועננו");
    });
  }, []);

  const openCritical = useMemo(() => (preflightQ.state === "ready" ? preflightQ.data.blockers.length : 0), [preflightQ]);

  const navItem = (t: (typeof TABS)[number], mobile = false) => (
    <Tabs.Trigger
      key={t.value}
      value={t.value}
      className={cn(
        "group relative flex shrink-0 items-center gap-2.5 rounded-xl border px-3 text-xs font-semibold transition-all duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400",
        mobile
          ? "min-h-[38px] gap-1.5 py-2"
          : "min-h-[42px] w-full py-2.5",
        "border-transparent text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200",
        "data-[state=active]:border-emerald-400/30 data-[state=active]:bg-gradient-to-l data-[state=active]:from-emerald-400/[0.14] data-[state=active]:to-amber-400/[0.08] data-[state=active]:text-emerald-200 data-[state=active]:shadow-[0_0_20px_-8px_rgba(52,211,153,0.55)]",
        "data-[state=active]:before:absolute data-[state=active]:before:inset-y-1.5 data-[state=active]:before:-skew-x-12",
        mobile ? "data-[state=active]:before:right-0 data-[state=active]:before:w-0.5" : "data-[state=active]:before:right-0 data-[state=active]:before:w-[3px] data-[state=active]:before:rounded-full data-[state=active]:before:bg-gradient-to-b data-[state=active]:before:from-emerald-400 data-[state=active]:before:to-amber-400"
      )}
    >
      <t.icon className={cn("size-4 shrink-0 transition-colors", "data-[state=active]:text-emerald-300")} aria-hidden />
      <span className={mobile ? "" : "whitespace-nowrap"}>{mobile ? t.short : t.label}</span>
    </Tabs.Trigger>
  );

  return (
    <Tabs.Root dir="rtl" value={active} onValueChange={(v) => setActive(v as TabValue)} className="flex min-h-screen flex-col lg:grid lg:grid-cols-[248px_1fr]">
      {/* ─── console rail (desktop) ─── */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-4 border-l border-white/[0.07] bg-zinc-950/60 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-3 px-1.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/25 via-amber-400/10 to-emerald-400/10 shadow-[0_0_26px_-6px_rgba(245,184,65,0.55)]">
            <ShieldCheck className="size-5 text-amber-300" aria-hidden />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="font-display text-[15px] font-bold tracking-wide">
              <span className="text-gradient-gold">SAOS</span>
            </div>
            <div className="text-[10px] font-medium text-zinc-500">Sovereign Foundry</div>
          </div>
          <span className="ms-auto rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-px font-display text-[9px] font-bold tracking-widest text-emerald-300">
            v4
          </span>
        </div>

        <Tabs.List aria-label="מסכי מרכז השליטה" className="scroll-slim flex flex-1 flex-col gap-1 overflow-y-auto pe-1">
          {TABS.map((t) => navItem(t))}
        </Tabs.List>

        <div className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
          {modeInfo && (
            <Badge tone={modeInfo.tone} className="w-full justify-center" title={statusQ.state === "ready" ? statusQ.data.modeDetail : undefined}>
              <span aria-hidden>▸</span> מצב {modeInfo.label}
            </Badge>
          )}
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="pulse-dot inline-block size-1.5 rounded-full bg-emerald-400 text-emerald-400" aria-hidden />
              חי
            </span>
            <span className="font-display tabular-nums tracking-widest text-zinc-400" dir="ltr">{clock || "--:--:--"}</span>
          </div>
        </div>
      </aside>

      {/* ─── main column ─── */}
      <div className="flex min-h-screen flex-col">
        <header className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-6">
            {/* mobile brand */}
            <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-400/20 to-emerald-400/10">
                <ShieldCheck className="size-4 text-amber-300" aria-hidden />
              </span>
              <div className="min-w-0 leading-tight">
                <div className="font-display text-sm font-bold"><span className="text-gradient-gold">SAOS</span> <span className="text-[9px] font-bold tracking-widest text-emerald-300">v4</span></div>
                <div className="truncate text-[10px] text-zinc-500">{activeTab?.label}</div>
              </div>
            </div>
            {/* desktop context */}
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <h1 className="truncate text-sm font-bold text-zinc-200">
                {activeTab?.label}
              </h1>
              <span className="text-[11px] text-zinc-600">/ מרכז שליטה מבצעי</span>
            </div>

            <div className="ms-auto flex flex-wrap items-center gap-2">
              {openCritical > 0 && (
                <Badge tone="danger" title="בדוק את הפאנל חסימות פעילות">
                  {openCritical} חסימות
                </Badge>
              )}
              <span className="hidden items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-display text-[11px] tabular-nums tracking-widest text-zinc-400 md:flex" dir="ltr" aria-label="שעון חי">
                <span className="pulse-dot inline-block size-1.5 rounded-full bg-emerald-400 text-emerald-400" aria-hidden />
                {clock || "--:--:--"}
              </span>
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

          {/* mobile nav rail */}
          <Tabs.List aria-label="מסכי מרכז השליטה" className="scroll-slim mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-2 pb-2 sm:px-5 lg:hidden">
            {TABS.map((t) => navItem(t, true))}
          </Tabs.List>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1200px] flex-1 px-3 py-4 sm:px-6 sm:py-6">
          {TABS.map((t) => (
            <Tabs.Content key={t.value} value={t.value} className="focus-visible:outline-none">
              {t.value === "overview" && <OverviewTab onNavigate={(tab) => setActive(tab as TabValue)} />}
              {t.value === "breakthrough" && <BreakthroughTab />}
              {t.value === "chain" && <ChainTab />}
              {t.value === "signatures" && <SignaturesTab />}
              {t.value === "networks" && <NetworksTab />}
              {t.value === "treasury" && <TreasuryTab />}
              {t.value === "decisions" && <DecisionsTab />}
              {t.value === "security" && <SecurityTab />}
              {t.value === "agents" && <AgentsTab />}
              {t.value === "audit" && <AuditTab />}
            </Tabs.Content>
          ))}
        </main>

        <footer className="mt-auto border-t border-white/[0.06] bg-zinc-950/70 backdrop-blur">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] text-zinc-500 sm:px-6">
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
            <span className="ms-auto flex items-center gap-1.5">
              <span className="pulse-dot inline-block size-1.5 rounded-full bg-emerald-400 text-emerald-400" aria-hidden />
              מקורות: /api/saos/* · קריאה-בלבד · ה-API לעולם לא מחזיר 500
            </span>
          </div>
        </footer>
      </div>

      {/* out-of-grid placements: toaster + skip link live AFTER the two grid
          columns so auto-placement never gets confused by in-flow siblings */}
      <Toaster richColors position="top-center" dir="rtl" closeButton />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-emerald-400 focus:px-3 focus:py-2 focus:text-zinc-950"
      >
        דלג לתוכן הראשי
      </a>
    </Tabs.Root>
  );
}
