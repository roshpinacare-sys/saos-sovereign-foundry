"use client";

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Coins,
  FileText,
  Gauge,
  Play,
  Rocket,
  ShieldCheck,
  Wifi,
  WifiOff
} from "lucide-react";

import { Badge, Btn, Card, CardContent, CardHeader, CardTitle, Mono, cn, fmtDateTime } from "@/components/ui/kit";
import { EP, errText, type SaosError } from "./api";
import type { BreakthroughDemoResponse } from "./types";

/**
 * פריצת הדרך — Breakthrough (Task 14, חלק ז׳).
 * חלון הראווה של ההדגמה החיה: שעון אטומי מבוזר על ראשי 6 הרשתות —
 * נמדד חי (latency, proof size, verification), טבלת השוואה לתעשייה,
 * מדריך אימות צד-שלישי, והצהרת בטיחות. אפס סודות בפלט.
 */
export function BreakthroughTab() {
  const [data, setData] = useState<BreakthroughDemoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SaosError | null>(null);

  const runDemo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(EP.breakthroughDemo, { cache: "no-store", headers: { "Content-Type": "application/json" } });
      if (res.status === 429) {
        setError({ kind: "rate", message: "rate-limited", retryAfterSec: Number(res.headers.get("retry-after") ?? "60") });
        return;
      }
      const body = (await res.json()) as BreakthroughDemoResponse;
      if (body.ok === false) {
        setError({ kind: "api", message: "demo failed" });
        return;
      }
      setData(body);
    } catch {
      setError({ kind: "network" });
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* hero */}
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle icon={<Rocket className="size-4 text-amber-400" aria-hidden />}>פריצת הדרך — Breakthrough</CardTitle>
          <Badge tone="gold">שעון אטומי מבוזר · Cross-Chain Atomic State Proof</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-zinc-200">
            ברגע אחד, ראשי <span className="font-bold text-amber-300">6 רשתות הטרוגניות</span> (Graphene · TVM · EVM · SVM) נקשרים ל
            <span className="font-bold text-amber-300">שורש Merkle אחד (32 בייט)</span> — הוכחה שכל צד שלישי יכול לאמת מול ה-RPCs הציבוריים,{" "}
            <span className="font-bold text-emerald-300">בלי מפתחות, בלי גז, בעלות $0.00</span>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="primary" size="md" onClick={runDemo} loading={loading} ariaLabel="הרץ הדגמה חיה של השעון האטומי המבוזר">
              {!loading && <Play className="size-4" aria-hidden />} הרץ הדגמה חיה
            </Btn>
            {data && (
              <Btn variant="outline" size="sm" onClick={runDemo} loading={loading} ariaLabel="הרץ את ההדגמה שוב">
                הרצה נוספת
              </Btn>
            )}
            <span className="text-[11px] text-zinc-500">קריאה-בלבד · אין עסקה · אין שידור · אין חתימה · אין ארנק</span>
          </div>
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-sm text-rose-200">
              ההדגמה לא רצה: {errText(error)}
              {error.kind === "rate" && error.retryAfterSec ? ` — נסה בעוד ~${error.retryAfterSec} שניות` : ""}
            </div>
          )}
        </CardContent>
      </Card>

      {data && <DemoResults d={data} />}
      {data && <ComparisonTable d={data} />}
    </div>
  );
}

function DemoResults({ d }: { d: BreakthroughDemoResponse }) {
  const [showGuide, setShowGuide] = useState(false);
  const [showLimits, setShowLimits] = useState(false);
  const demo = d.demo;
  const available = demo.available && demo.root;
  const m = demo.metrics;

  return (
    <>
      {/* statement + root */}
      <Card className={cn(available ? "border-emerald-500/40" : "border-amber-500/40")}>
        <CardHeader>
          <CardTitle icon={available ? <CheckCircle2 className="size-4 text-emerald-400" aria-hidden /> : <WifiOff className="size-4 text-amber-400" aria-hidden />}>
            תוצאות ההדגמה החיה
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {available ? (
              <Badge tone="ok">שורש הורכב · {demo.witnesses.ok}/6 עדים</Badge>
            ) : (
              <Badge tone="warn">אין עדים — כישלון כנה, לא הומצאו נתונים</Badge>
            )}
            {demo.probesCached && <Badge tone="neutral">מטמון בדיקות 60 שנ׳</Badge>}
            <Badge tone="neutral">{fmtDateTime(d.timestamp)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-zinc-300">{demo.statement}</p>

          {demo.root && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
              <div className="text-[11px] font-bold text-zinc-300">השורש האטומי (Atomic Root):</div>
              <div dir="ltr">
                <Mono className="mt-1 block break-all text-left text-[11px] leading-relaxed text-emerald-300">{demo.root}</Mono>
              </div>
              {demo.verification?.allVerified && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-300">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  {demo.verification.proofsVerifiedOk}/{demo.verification.proofsGenerated} הוכחות-כלילה אומתו מחדש ב-{demo.verification.verifyTimeMs}ms ·{" "}
                  {demo.metrics?.verifyHashOps ?? 0} פעולות hash לאימות
                </div>
              )}
            </div>
          )}

          {/* metrics tiles */}
          {m && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricTile icon={<Clock3 className="size-3.5 text-amber-400" aria-hidden />} label="זמן חישוב כולל" value={`${fmtMs(demo.timings?.totalComputeMs ?? 0)}ms`} hint="עלים+עץ+הוכחות+אימות" />
              <MetricTile icon={<Gauge className="size-3.5 text-amber-400" aria-hidden />} label="גודל הוכחה" value={`${m.proofSizeBytesJson}B`} hint={`JSON · ${(m.proofSizeBytesRaw ?? 0).toFixed(0)}B גלם`} />
              <MetricTile icon={<ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />} label="זמן אימות" value={`${fmtMs(demo.verification?.verifyTimeMs ?? 0)}ms`} hint="צד שלישי: אותן פעולות" />
              <MetricTile icon={<Coins className="size-3.5 text-emerald-400" aria-hidden />} label="עלות" value="$0.00" hint="keyless · 0 גז · 0 עסקאות" />
            </div>
          )}

          {/* witnesses grid */}
          <div>
            <div className="mb-1.5 text-xs font-bold text-zinc-300">עדי הרשתות (witnesses) — ראשים ציבוריים שנקראו חי:</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {demo.networks.map((n) => (
                <div key={n.network} className={cn("rounded-lg border p-2.5", n.witnessed ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/70")}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-bold text-zinc-200">{n.network}</span>
                    {n.witnessed ? <Wifi className="size-3 text-emerald-400" aria-hidden /> : <WifiOff className="size-3 text-zinc-500" aria-hidden />}
                  </div>
                  <div className="mt-1 text-[10px] leading-tight text-zinc-400">{n.witnessed ? "עד · נכלל בשורש" : (n.reason ?? "לא נכלל")}</div>
                  {n.witnessed && n.headBlock !== null && (
                    <div className="mt-0.5 font-mono text-[10px] text-emerald-400/90" dir="ltr">
                      #{n.headBlock.toLocaleString("en-US")}
                    </div>
                  )}
                  {n.witnessed && n.sourceHost && (
                    <div className="mt-0.5 truncate font-mono text-[9px] text-zinc-600" dir="ltr" title={n.sourceHost}>
                      {n.sourceHost}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {demo.witnesses.excluded && demo.witnesses.excluded.length > 0 && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                נופו בכנות מהשורש: {demo.witnesses.excluded.map((x) => x.network).join(", ")} — המערכת לעולם לא ממציאה עד.
              </p>
            )}
          </div>

          {/* timings + checkpoint */}
          {demo.timings && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px] text-zinc-400 sm:grid-cols-5">
              <TimingRow label="עלים" ms={demo.timings.leafPhaseMs} />
              <TimingRow label="עץ Merkle" ms={demo.timings.treePhaseMs} />
              <TimingRow label="הוכחות" ms={demo.timings.proofPhaseMs} />
              <TimingRow label="אימות" ms={demo.timings.verifyPhaseMs} />
              <TimingRow label="סה״כ" ms={demo.timings.totalComputeMs} bold />
            </div>
          )}
          {demo.checkpoint?.digest && (
            <div className="text-[11px] leading-relaxed text-zinc-400">
              צ׳קפוינט נרשם בשרשרת הראיות: <Mono className="text-zinc-300">{demo.checkpoint.digest.slice(0, 20)}…</Mono>
              {demo.checkpoint.prevDigest ? (
                <>
                  {" "}· משורשר אחרי <Mono className="text-zinc-500">{demo.checkpoint.prevDigest.slice(0, 12)}…</Mono>
                </>
              ) : null}{" "}
              · {demo.checkpoint.persisted ? "נשמר (שעון מצטבר)" : "חושב בלבד (מצב ללא שמירה)"}
            </div>
          )}

          {/* security + guide */}
          {demo.security && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-[11px] font-bold text-zinc-300">
                ביטחון: SHA-256 — {demo.security.commitmentPreimageBits}-bit preimage / {demo.security.commitmentCollisionBits}-bit collision · {demo.security.witnessCount ?? demo.witnesses.ok} עדים מ-
                {demo.security.independentConsensusSets ?? demo.witnesses.families} קבוצות-קונצנזוס נפרדות
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{demo.security.note}</p>
              <Btn variant="ghost" size="sm" className="mt-1" onClick={() => setShowLimits((v) => !v)} ariaLabel="הצג את מגבלות ההוכחה">
                <ChevronDown className={cn("size-3.5 transition-transform", showLimits && "rotate-180")} aria-hidden /> מגבלות ({demo.security.limitations.length}) — כנות
              </Btn>
              {showLimits && (
                <ul className="mt-1 space-y-1">
                  {demo.security.limitations.map((l, i) => (
                    <li key={i} className="text-[10px] leading-relaxed text-zinc-400">
                      • {l}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <Btn variant="ghost" size="sm" onClick={() => setShowGuide((v) => !v)} ariaLabel="הצג מדריך אימות צד שלישי">
              <ChevronDown className={cn("size-3.5 transition-transform", showGuide && "rotate-180")} aria-hidden /> איך צד שלישי מאמת בעצמו (בלי לסמוך עלינו)
            </Btn>
            {showGuide && demo.verificationGuide && (
              <ol className="mt-1.5 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                {demo.verificationGuide.map((g) => (
                  <li key={g.step} className="text-[11px] leading-relaxed text-zinc-300">
                    <span className="font-bold text-amber-300">{g.step}:</span> {g.detail}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-500" aria-hidden />
            {d.safety.note}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function ComparisonTable({ d }: { d: BreakthroughDemoResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle icon={<FileText className="size-4 text-amber-400" aria-hidden />}>אנחנו מול התעשייה</CardTitle>
        <Badge tone="info">SAOS נמדד חי · השאר ערכי-עזר מתיעוד ציבורי</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="overflow-x-auto scroll-slim">
          <table className="w-full min-w-[720px] border-collapse text-right">
            <thead>
              <tr className="border-b border-zinc-800 text-[11px] text-zinc-400">
                <th className="px-2 py-2 font-semibold">מערכת</th>
                <th className="px-2 py-2 font-semibold">השהיה (latency)</th>
                <th className="px-2 py-2 font-semibold">גודל הוכחה</th>
                <th className="px-2 py-2 font-semibold">עלות</th>
                <th className="px-2 py-2 font-semibold">מודל אמון</th>
                <th className="px-2 py-2 font-semibold">Keyless</th>
                <th className="px-2 py-2 font-semibold">מדידה</th>
              </tr>
            </thead>
            <tbody>
              {d.comparison.rows.map((r) => (
                <tr key={r.system} className={cn("border-b border-zinc-900 text-[11px]", r.ours && "bg-amber-500/5 font-semibold")}>
                  <td className="px-2 py-2 text-zinc-200">
                    {r.ours ? <Rocket className="me-1 inline size-3 text-amber-400" aria-hidden /> : null}
                    {r.system}
                    <div className="text-[10px] font-normal text-zinc-500">{r.kind}</div>
                  </td>
                  <td className="px-2 py-2 text-zinc-300">{r.latency}</td>
                  <td className="px-2 py-2 text-zinc-300">{r.proofSize}</td>
                  <td className="px-2 py-2 text-zinc-300">{r.cost}</td>
                  <td className="px-2 py-2 text-zinc-400">{r.trustModel}</td>
                  <td className="px-2 py-2">
                    {r.keyless ? <Badge tone="ok">כן</Badge> : <Badge tone="neutral">לא</Badge>}
                  </td>
                  <td className="px-2 py-2">{r.measured ? <Badge tone="gold">נמדד חי</Badge> : <Badge tone="neutral">עזר</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">{d.comparison.note}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
            <FileText className="size-3" aria-hidden /> המסמך המלא: docs/BREAKTHROUGH.md · ההשוואה המפורטת: docs/breakthrough-comparison.md · האודיט: docs/technological-audit.md
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base font-bold text-zinc-100" dir="ltr">
        {value}
      </div>
      <div className="text-[9px] leading-tight text-zinc-500">{hint}</div>
    </div>
  );
}

function fmtMs(n: number): string {
  return Number(n.toFixed(1)).toString();
}

function TimingRow({ label, ms, bold = false }: { label: string; ms: number; bold?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1", bold && "font-bold text-zinc-200")}>
      {bold ? <Clock3 className="size-3 text-amber-400" aria-hidden /> : null}
      {label}: <span dir="ltr" className="font-mono">{ms}ms</span>
    </span>
  );
}
