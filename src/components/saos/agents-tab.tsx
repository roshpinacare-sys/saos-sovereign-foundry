"use client";

import { Bot, CheckCircle2, MessageSquare, PlugZap, RefreshCw, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge, Btn, ErrorState, LoadingPanel, Mono, Panel, fmtDateTime } from "@/components/ui/kit";
import { EP, errText, saosFetch, useSaos } from "./api";
import type { AgentBridgeResponse } from "./types";

/**
 * AgentsTab — Task 32: גשר-סוכנים.
 * The owner's live feed of attached agents: every agent message / executed
 * read-only action lands here. The "how to attach" panel shows the exact
 * curl contract any agent (in any chat) needs — one token, one POST.
 */
export function AgentsTab() {
  const bridgeQ = useSaos<AgentBridgeResponse>("agent-bridge", () => saosFetch<AgentBridgeResponse>(EP.agentBridge));
  const [markingBusy, setMarkingBusy] = useState<string | null>(null);

  const data = bridgeQ.state === "ready" ? bridgeQ.data : null;

  async function markAck(id: string) {
    setMarkingBusy(id);
    try {
      const res = await fetch(EP.agentBridge, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "ack" }) });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (body.ok) {
        toast.success("סומן כנקרא");
        void bridgeQ.refresh();
      } else {
        toast.error(body.error ?? "הסימון נכשל");
      }
    } catch {
      toast.error("שגיאת רשת");
    } finally {
      setMarkingBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">גשר-סוכנים — Agents Bridge</h2>
        <p className="text-xs text-zinc-500">סוכנים חיצוניים (בכל צ׳אט) מצטרפים דרך API אחד — כותבים לך כאן ומבצעים פעולות-קריאה בטוחות לפי הצורך.</p>
      </div>

      <AttachHowTo />

      <Panel
        title="פיד הודעות חי מהסוכנים"
        icon={<Bot className="size-4 text-emerald-400" aria-hidden />}
        source="/api/saos/agent-bridge"
        lastChecked={bridgeQ.state === "ready" ? bridgeQ.lastChecked : null}
        onRefresh={bridgeQ.refresh}
        refreshing={bridgeQ.refreshing}
      >
        {bridgeQ.state === "error" ? (
          <ErrorState kind={bridgeQ.err.kind} detail={errText(bridgeQ.err)} onRetry={bridgeQ.refresh} retrying={bridgeQ.refreshing} />
        ) : bridgeQ.state === "loading" ? (
          <LoadingPanel rows={4} label="טוען פיד" />
        ) : !data?.messages?.length ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-center">
            <Bot className="mx-auto size-8 text-zinc-600" aria-hidden />
            <p className="mt-2 text-xs text-zinc-400">עדיין אין הודעות מסוכנים. שלח לסוכן את הפרומט-הצירוף מלמעלה — ההודעה שלו תופיע כאן מיד.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Badge tone={data.fresh ? "warn" : "ok"}>{data.fresh} חדשות</Badge>
              <span>סה״כ {data.total} הודעות · מציג 100 אחרונות</span>
            </div>
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1 [scrollbar-color:theme(colors.zinc.700)_transparent] [scrollbar-width:thin]">
              {data.messages.map((m) => (
                <div key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                      {m.kind === "action" ? <PlugZap className="size-3.5 text-sky-400" aria-hidden /> : <MessageSquare className="size-3.5 text-emerald-400" aria-hidden />}
                      <Mono>{m.agent}</Mono>
                    </span>
                    <Badge tone={m.status === "executed" ? "ok" : m.status === "refused" ? "danger" : m.status === "new" ? "warn" : "neutral"}>
                      {m.status === "new" ? "חדש" : m.status === "executed" ? "בוצע" : m.status === "refused" ? "נדחה" : m.status}
                    </Badge>
                    <span className="ms-auto text-[10px] text-zinc-500">{fmtDateTime(m.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-300">{m.content}</p>
                  {m.result && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[10px] text-zinc-500">תוצאת-פעולה (ציבורי)</summary>
                      <pre dir="ltr" className="mt-1 max-h-40 overflow-auto rounded bg-zinc-900 p-2 text-[10px] text-zinc-400">
                        {m.result.slice(0, 2000)}
                      </pre>
                    </details>
                  )}
                  {m.status === "new" && (
                    <div className="mt-2">
                      <Btn variant="ghost" size="sm" onClick={() => void markAck(m.id)} loading={markingBusy === m.id} ariaLabel="סמן כנקרא">
                        <CheckCircle2 className="size-3" aria-hidden />
                        סמן כנקרא
                      </Btn>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AttachHowTo() {
  const [copied, setCopied] = useState(false);
  const snippet = `curl -X POST "<כתובת-המערכת>/api/saos/agent-bridge" \\
  -H "Content-Type: application/json" \\
  -H "x-agent-token: <הטוקן שקיבלת מהבעלים>" \\
  -d '{"agent":"<שם-הסוכן>","kind":"message","content":"ההודעה שלך לבעלים"}'

# פעולת-קריאה בטוחה (מותר: keys-status | verify-live | health):
curl -X POST "<כתובת-המערכת>/api/saos/agent-bridge" \\
  -H "Content-Type: application/json" \\
  -H "x-agent-token: <הטוקן>" \\
  -d '{"agent":"<שם-הסוכן>","kind":"action","content":"verify-live"}'`;

  return (
    <Panel title="איך מצרפים סוכן (להעתקה לכל צ׳אט)" icon={<Send className="size-4 text-amber-400" aria-hidden />} source="docs/PROMPT-FOR-ALL-AGENTS.md" lastChecked={null} onRefresh={() => {}} refreshing={false}>
      <div className="space-y-3">
        <ol className="list-inside list-decimal space-y-1 text-[11px] leading-relaxed text-zinc-400">
          <li>העבר לסוכן את <strong className="text-zinc-200">טוקן-הגשר</strong> (נוצר פעם אחת, מוחזק רק ב-<Mono>~/.secrets/agent-bridge-token</Mono> מחוץ לריפו) — הוא מוצג בצ׳אט שלך עם הסוכן הראשי.</li>
          <li>הסוכן שולח POST עם <Mono>x-agent-token</Mono> — הודעה תוך שניות לפיד למטה, או פעולת-קריאה מותרת שמבוצעת מיד ונרשמת.</li>
          <li>פעולות מותרות (קריאה-בלבד, ללא מפתחות): <Mono>keys-status</Mono> · <Mono>verify-live</Mono> · <Mono>health</Mono>. כל שאר נדחה ונרשם ביומן-הביקורת.</li>
          <li>סודות אף פעם לא עוברים בגשר — חומר-מפתח רק דרך גיבוי מוצפן או החיבור-החכם בטאב אבטחה.</li>
        </ol>
        <div className="relative">
          <pre dir="ltr" className="max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left text-[10px] leading-relaxed text-zinc-400">
            {snippet}
          </pre>
          <div className="absolute left-2 top-2">
            <Btn
              variant="ghost"
              size="sm"
              ariaLabel="העתקת חוזה-ה-API"
              onClick={() => {
                void navigator.clipboard.writeText(snippet).then(() => {
                  setCopied(true);
                  toast.success("הועתק");
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              <RefreshCw className={copied ? "size-3 rotate-180 text-emerald-400" : "size-3"} aria-hidden />
              {copied ? "הועתק" : "העתק"}
            </Btn>
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5">
          <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
          <p className="text-[10px] leading-relaxed text-zinc-400">
            סיבוב-טוקן: מחיקת <Mono>~/.secrets/agent-bridge-token</Mono> ויצירת קובץ חדש מנטרלת מיד את כל הסוכנים הקיימים (fail-closed). כל ניסיון-גישה שגוי נרשם ביומן-הביקורת.
          </p>
        </div>
      </div>
    </Panel>
  );
}
