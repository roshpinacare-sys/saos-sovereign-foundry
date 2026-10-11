# saos-sovereign-foundry — the AGENT OPS CONSOLE (v1)

**ROLE (declared 2026-10-11, task 10-c un-silence sweep):** the fleet's
**agent-operations console, line v1** — the operator surface for the agent
mesh: `mini-services/` organs (chief-of-staff, fleet-cure, rotation-keeper,
key-broker, vault-guardian, external-signer) plus the anchor-* API routes.
Its successor/evolution is `saos-sovereign-platform` (console v2,
local-machine). **Both stay alive as defined roles — not dead duplicates:**
v1 is the lean ops face; v2 is the full local-machine console.

**Why it was silenced (measured):** stale-by-design + billing wall. Its
workflows were always event-driven (PR + workflow_dispatch, zero cron — the
"stale since 10-07" verdict was the design, not decay), and the red runs are
the org-wide Actions billing signature (0 steps, ~2s, empty logs, private
repo — owner billing decision, not a code failure).

**Revival path (one paragraph):** nothing in the code is broken — the wall
is the billing. When the owner restores Actions minutes, three moves bring
this console fully back: (1) dispatch `ci.yml` for a green build/typecheck
line (its own header documents that CI is where the production build finally
gets verified), (2) run `scripts/api-check.mjs` + `concurrency-check.mjs`
against a throwaway local SQLite, and (3) re-point the mini-services organs
at the live engine — at that moment fleet-heal will also find this repo
green-ready on its own probes. No rewrite needed; the revival is operational,
not architectural.

## What is here

- Next.js 16 + Prisma console (API routes incl. anchor-*), zero cron.
- `mini-services/` — the agent-ops organs listed above.
- `.github/workflows/` — `ci.yml`, `gitleaks.yml`, `workflow-yaml-guard.yml`
  — all PR + workflow_dispatch only, all valid YAML (verified 2026-10-11),
  none consumes secrets beyond GITHUB_TOKEN.
- `scripts/` — api-check / concurrency-check / backup / restore truth tools.
