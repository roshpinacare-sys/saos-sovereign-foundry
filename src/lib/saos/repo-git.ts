/**
 * Read-only git snapshot helper (Task 13) — shared by /api/saos/repo-status
 * and /api/saos/live-proof.
 *
 * Discipline: subprocess with short timeout, read-only git commands only,
 * every failure resolves to null (never throws into the request path),
 * metadata only — branch/sha/counts — NEVER file contents, never the remote
 * URL (only whether it exists and its host).
 */

import { execFile } from "child_process";

export function gitRun(cmd: string, args: string[], timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: process.cwd(), timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? null : stdout.toString().trim());
    });
  });
}

export interface GitSnapshot {
  available: boolean;
  branch: string | null;
  lastCommit: { sha: string; subject: string | null; at: string | null } | null;
  uncommittedFiles: number | null;
  uncommittedSample: string[];
  unpushedCommits: number | null;
  remoteConfigured: boolean;
  remoteHost: string | null;
}

/** collect the repo state — one snapshot, all fields best-effort */
export async function gitSnapshot(): Promise<GitSnapshot> {
  const [branch, headSubject, headIso, headSha, dirty, unpushed, remoteUrl] = await Promise.all([
    gitRun("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitRun("git", ["log", "-1", "--pretty=%s"]),
    gitRun("git", ["log", "-1", "--pretty=%cI"]),
    gitRun("git", ["rev-parse", "--short=12", "HEAD"]),
    gitRun("git", ["status", "--porcelain"]),
    gitRun("git", ["rev-list", "--count", "origin/main..HEAD"]),
    gitRun("git", ["remote", "get-url", "origin"])
  ]);
  const available = branch !== null;
  const dirtyLines = dirty ? dirty.split("\n").filter(Boolean) : [];
  // remote URL is reported scrubbed — only whether it exists and its host
  const remoteHost = remoteUrl
    ? (remoteUrl.match(/@([^/]+)\//)?.[1] ?? remoteUrl.replace(/^https?:\/\//, "").split("/")[0])
    : null;
  return {
    available,
    branch: available ? branch : null,
    lastCommit: available && headSha ? { sha: headSha, subject: headSubject, at: headIso } : null,
    uncommittedFiles: available ? dirtyLines.length : null,
    uncommittedSample: dirtyLines.slice(0, 10),
    unpushedCommits: available && unpushed !== null ? Number(unpushed) : null,
    remoteConfigured: remoteUrl !== null,
    remoteHost
  };
}
