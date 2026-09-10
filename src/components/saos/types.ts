/**
 * Typed contracts for every /api/saos/* surface consumed by the UI.
 * Mirrors the server routes 1:1 — the UI never invents fields.
 */

// ─── /status ─────────────────────────────────────────────────────────────────

export interface StatusResponse {
  ok: boolean;
  error?: string;
  motto: string;
  mode: string;
  modeDetail: string;
  writesEnabled: boolean;
  broadcastCapable: boolean;
  security: {
    authConfigured: boolean;
    rateLimit: { active: boolean; status: number; seal: number; auth: number };
    signer: { signer: string; status: string }[];
  };
  matrix: { network: string; status: string; gate: string | null }[];
  networks: NetworkStatus[];
  historic: { network: string; txRef: string | null; note: string }[];
  seals: SealRow[];
  receipts: { kind: string; digest: string; prevDigest: string | null; at: string }[];
  opsLogged: number;
}

export interface SealRow {
  id: string;
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
  createdAt: string;
  anchors: { network: string; status: string; txid: string | null; gate: string | null }[];
}

// ─── /anchor-preflight ───────────────────────────────────────────────────────

export interface PreflightResponse {
  ok: boolean;
  error?: string;
  readyForAnchor: boolean;
  mode: string;
  liveGateReady: boolean;
  backupFresh: boolean;
  backupVerified: boolean;
  authReady: boolean;
  rateLimitReady: boolean;
  signerReady: boolean;
  externalSignerConnected: boolean;
  pendingSignatureQueue: { open: number; signedExternally: number; recorded: number; expired: number; cancelled: number; failed: number };
  chainStatus: { ok: boolean; seals: number; receipts: number; forks: number[] };
  networks: { network: string; status: string; isReadyForAnchor: boolean; isDryRunOnly: boolean; lastChecked: string }[];
  target: string;
  firstAnchorReadiness: {
    status: "not-ready" | "partial" | "conditional";
    recommendedNetwork: string | null;
    recommendedReason: string;
    blockers: { id: string; detail: string }[];
    requiredResource: string;
    ownerAction: string;
    openCriticalDecisions: number;
    runbook: string;
  };
  blockers: { id: string; detail: string }[];
  warnings: { id: string; detail: string }[];
  checks: { id: string; status: "pass" | "warn" | "fail"; detail: string }[];
  recommendedNextAction: string;
  generatedAt: string;
  note: string;
}

// ─── /live-proof (Task 13 — הוכחת חיים) ──────────────────────────────────────

export interface LiveProofProbe {
  network: string;
  attempted: boolean;
  ok: boolean;
  source: "env" | "public-fallback" | "none";
  sourceHost: string | null;
  headBlock: number | null;
  chainIdHex: string | null;
  headTime: string | null;
  latencyMs: number | null;
  reason: string;
}

export interface LiveProofResponse {
  ok: boolean;
  timestamp: string;
  service: "ok" | "degraded" | "down";
  database: { ok: boolean; counts: Record<string, number> };
  auth: { configured: boolean; sessionEpoch: string | null; revocationReady: boolean };
  rateLimit: { active: boolean; liveProofPerMinute: number; statusPerMinute: number; sealPerMinute: number; authPerMinute: number };
  audit: { recentEvents24h: number; totalEvents: number; lastEventAt: string | null; lastEventKind: string | null };
  backups: { lastBackupAt: string | null; lastVerified: boolean; fresh: boolean; detail: string | null };
  repo: {
    available: boolean;
    branch: string | null;
    sync: "synced" | "ahead" | "unknown";
    unpushedCommits: number | null;
    uncommittedFiles: number | null;
    lastCommitSha12: string | null;
    remoteConfigured: boolean;
    remoteHost: string | null;
  };
  ci: {
    available: boolean;
    reason?: string;
    lastRun?: { status: string | null; conclusion: string | null; headSha12: string | null; startedAt: string | null; event: string | null };
  };
  networks: {
    network: string;
    status: string;
    mode: string;
    chainType: string | null;
    chainId: string | null;
    rpcStatus: string | null;
    blocker: string | null;
    nextAction: string;
    isReadyForAnchor: boolean;
    isDryRunOnly: boolean;
    ownerAction: string;
    requiredResource: string | null;
    liveProbePossible: boolean;
    probe: LiveProofProbe | null;
  }[];
  probesSummary: {
    attempted: number;
    ok: number;
    unreachable: number;
    cached: boolean;
    at: string;
    plan: { network: string; source: string; host: string | null }[];
    note: string;
  };
  preflight: {
    readyForAnchor: boolean;
    blockers: { id: string; detail: string }[];
    warningsCount: number;
    firstAnchorStatus: string;
    recommendedNetwork: string | null;
    ownerAction: string;
    recommendedNextAction: string;
    runbook: string;
  };
  decisions: { openCritical: string[]; needsResource: string[]; openTotal: number; total: number };
  proofRoot: string | null;
  proofHeight: number | null;
  signatureQueue: Record<string, number>;
  liveMode: { mode: string; detail: string; writesEnabled: boolean; liveArmed: boolean };
  safeLive: boolean;
  safety: { broadcastCapable: boolean; transactionAttempted: boolean; signingAttempted: boolean; walletUsed: boolean; note: string };
  errors: string[];
  note: string;
  generatedBy: string;
}

// ─── /verify-chain ───────────────────────────────────────────────────────────

export interface VerifyChainResponse {
  ok: boolean;
  error?: string;
  scope: string;
  mode?: string;
  receiptChain?: { ok: boolean; checked: number; digestErrors: number[]; linkErrors: number[]; forks: number[] };
  seals?: { height: number; root: string; leafCount: number; rootMatches: boolean; verifiedLeaves: number; invalidLeaves: number; proofResult: string }[];
  totals?: { sealsChecked: number; leafCount: number; verifiedLeaves: number; invalidLeaves: number };
  proofResult: string;
  root: string | null;
  height: number | null;
  leafCount: number | null;
  verifiedLeaves: number | null;
  invalidLeaves: number | null;
  errors: string[];
  receipt?: string;
  persisted?: boolean;
}

// ─── /signer ─────────────────────────────────────────────────────────────────

export type SignatureStatus =
  | "pending"
  | "awaiting-approval"
  | "signed-externally"
  | "recorded"
  | "failed"
  | "expired"
  | "cancelled";

export interface SignerResponse {
  ok: boolean;
  error?: string;
  registry: { signer: string; status: string; detail: string; emits: string; acceptsBack: string }[];
  counts: { awaitingApproval: number; recorded: number; byStatus: Record<string, number> };
  pending: SignatureRow[];
}

export interface SignatureRow {
  id: string;
  network: string;
  kind: string;
  purpose: string;
  signer: string;
  signerStatus: string;
  status: SignatureStatus;
  payloadHash: string;
  digestToSign: string;
  payload: Record<string, unknown>;
  sealHeight: number | null;
  sealRoot: string | null;
  resultPublic: { txid: string; proofRef: string | null; anchorRef: string | null } | null;
  verificationStatus: "verified" | "unverified" | "not-checked" | null;
  txid: string | null;
  proofRef: string | null;
  anchorRef: string | null;
  verified: boolean | null;
  verificationSource: string | null;
  cancelReason: string | null;
  resultAt: string | null;
  expiresAt: string;
  createdAt: string;
  auditTrail: { at: string; kind: string; actor: string; detail: string }[];
}

// ─── /networks (from /status.networks) ───────────────────────────────────────

export interface NetworkStatus {
  network: "STEEM" | "BLURT" | "HIVE" | "TRON" | "ETHEREUM" | "SOLANA";
  status: "anchored" | "pending" | "gated" | "transit";
  mode: "advisory" | "direct";
  lastChecked: string;
  lastVerifiedAnchor: string | null;
  nextAction: string;
  blocker: string | null;
  requiredResource: string | null;
  unblockPlan: string[];
  isReadyForAnchor: boolean;
  isDryRunOnly: boolean;
  // Task 11: decision-grade blocker disclosure
  ownerOptions: string[];
  ownerAction: string;
  estimatedTime: string | null;
  estimatedCost: string | null;
  resourceLiveChecked: boolean;
  // Task 12: chain identity & RPC presence
  chainType?: "graphene" | "tvm" | "evm" | "solana-runtime";
  chainId?: string | null;
  anchorTypes?: string[];
  rpcStatus?: "not-configured" | "public" | "configured";
  liveProbePossible?: boolean;
}

// ─── /plans ──────────────────────────────────────────────────────────────────

export interface PlansResponse {
  ok: boolean;
  error?: string;
  energyPlans: {
    id: string;
    network: string;
    mode: string;
    trxStaked: number | null;
    energyOut: number | null;
    settlements: number | null;
    burnCost: number | null;
    rcFloorPct: number | null;
    notes: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }[];
  economySnapshots: { id: string; label: string; inputs: Record<string, unknown>; streams: Record<string, unknown>; totalPerDay: number; flywheelPct: number; createdAt: string }[];
  counts: { energyPlans: number; economySnapshots: number };
}

// ─── /audit ──────────────────────────────────────────────────────────────────

export interface AuditResponse {
  ok: boolean;
  error?: string;
  counts: { total: number; denied: number; byKind: { kind: string; count: number }[] };
  events: { id: string; kind: string; actor: string; action: string; allowed: boolean; ipHash: string | null; detail: string | null; createdAt: string }[];
}

// ─── /live-gate ──────────────────────────────────────────────────────────────

export interface LiveGateResponse {
  ok: boolean;
  error?: string;
  readyForLive: boolean;
  blockers: { id: string; detail: string }[];
  warnings: { id: string; detail: string }[];
  checks: { id: string; status: "pass" | "warn" | "fail"; detail: string }[];
  mode?: string;
  [k: string]: unknown;
}

// ─── /kernel ─────────────────────────────────────────────────────────────────

export interface KernelResponse {
  ok: boolean;
  error?: string;
  result: { ok: boolean; stateRoot: string; gasUsed: number; checks: { name: string; pass: boolean; detail?: string }[] };
  receipt: string;
  persisted?: boolean;
}

// ─── /seal (POST) ────────────────────────────────────────────────────────────

export interface SealPostResponse {
  ok: boolean;
  error?: string;
  idempotent?: boolean;
  seal?: { id: string; height: number; root: string; leavesCount: number; stateRoot: string; gasUsed: number; createdAt: string; anchors?: { network: string; status: string; gate: string | null }[] };
  receipt?: { digest: string } | null;
}

// ─── /repo-status ────────────────────────────────────────────────────────────

export interface RepoStatusResponse {
  ok: boolean;
  error?: string;
  git: {
    available: boolean;
    branch: string | null;
    lastCommit: { sha: string; subject: string | null; at: string | null } | null;
    uncommittedFiles: number | null;
    uncommittedSample: string[];
    unpushedCommits: number | null;
    remoteConfigured: boolean;
    remoteHost: string | null;
  };
  backups: {
    directory: boolean;
    count: number;
    recent: { name: string; createdAt: string | null; files: number; bytes: number; verified: boolean | null }[];
    lastVerifiedAt: string | null;
    lastVerifiedOk: boolean;
  };
  secrets: {
    authConfigured: boolean;
    envFilePresent: boolean;
    envFilePerms: string | null;
    envValuesExposed: false;
    adminKeyFileInTree: boolean;
    adminKeyRule: string;
    scanPerformedAt: string;
    scanCoveredFiles: number;
    scanMatches: { file: string; pattern: string }[];
    scanNote: string;
  };
  knownOpenItems: string[];
  mode: string;
  generatedAt: string;
  note: string;
}

// ─── /decisions ──────────────────────────────────────────────────────────────

export type DecisionRecordedStatus =
  | "open"
  | "decided-default"
  | "decided-custom"
  | "needs-resource"
  | "resolved-external"
  | "deferred"
  | "rejected";

export interface DecisionRow {
  key: string;
  name: string;
  description: string;
  category: "security" | "resources" | "governance" | "release";
  severity: "critical" | "high" | "medium";
  options: string[];
  safeDefault: string;
  risk: string;
  cost: string;
  time: string;
  requiredAction: string;
  phase: "now" | "before-anchor" | "before-live";
  ownerRole: string;
  critical: boolean;
  sourceRef: string;
  // spec-named aliases (Task 11)
  id: string;
  title: string;
  defaultSafeAction: string;
  requiredOwnerAction: string;
  timeEstimate: string;
  // recorded state
  recordedStatus: DecisionRecordedStatus;
  status: DecisionRecordedStatus;
  note: string | null;
  decidedAt: string | null;
  updatedAt: string | null;
  auditTrail: { at: string; actor: string; detail: string }[];
}

export interface DecisionsResponse {
  ok: boolean;
  error?: string;
  counts: { total: number; open: number; openCritical: number; decided: number; needsResource: number };
  decisions: DecisionRow[];
  sourceNote: string;
}

// ─── /auth ───────────────────────────────────────────────────────────────────

export interface AuthStateResponse {
  ok: boolean;
  authConfigured: boolean;
  authenticated: boolean;
  actor: string;
  error?: string;
}

// ─── /auth/revoke-all (POST) ─────────────────────────────────────────────────

export interface RevokeAllResponse {
  ok: boolean;
  error?: string;
  revokedAt?: string;
  note?: string;
}

// ─── /breakthrough-demo (Task 14) ────────────────────────────────────────────

export interface BreakthroughComparisonRow {
  system: string;
  kind: string;
  latency: string;
  proofSize: string;
  cost: string;
  trustModel: string;
  keyless: boolean;
  measured: boolean;
  ours: boolean;
}

export interface BreakthroughDemoResponse {
  ok: boolean;
  timestamp: string;
  demo: {
    kind: string;
    available: boolean;
    statement: string;
    networks: {
      network: string;
      witnessed: boolean;
      headBlock: number | null;
      chainIdHex: string | null;
      headTime: string | null;
      sourceHost: string | null;
      readAt: string | null;
      reason?: string;
    }[];
    witnesses: {
      total: number;
      ok: number;
      failed: number;
      families: number;
      excluded?: { network: string; reason: string }[];
      note: string;
    };
    root: string | null;
    leaves?: string[];
    treeHeight?: number;
    proof?: { index: number; leaf: string; root: string; path: { sibling: string; dir: "L" | "R" }[] } | null;
    verification?: {
      proofsGenerated: number;
      proofsVerifiedOk: number;
      allVerified: boolean;
      verifyTimeMs: number;
      method: string;
    };
    checkpoint?: { digest: string | null; prevDigest: string | null; persisted: boolean; kind: string };
    timings?: {
      leafPhaseMs: number;
      treePhaseMs: number;
      proofPhaseMs: number;
      verifyPhaseMs: number;
      totalComputeMs: number;
    };
    metrics?: {
      rootSizeBytes: number;
      leafSizeBytes: number;
      proofSizeBytesJson: number;
      proofSizeBytesRaw: number;
      verifyHashOps: number;
      costUsd: string;
      keyless: boolean;
      gasUsed: number;
      transactionsSent: number;
    };
    security?: {
      hashAlgorithm: string;
      commitmentPreimageBits: number;
      commitmentCollisionBits: number;
      witnessFamilies: string[];
      independentConsensusSets?: number;
      witnessCount?: number;
      note: string;
      limitations: string[];
    };
    verificationGuide?: { step: string; detail: string }[];
    probesCached?: boolean;
  };
  comparison: { note: string; rows: BreakthroughComparisonRow[] };
  safety: { broadcast: boolean; transaction: boolean; signing: boolean; wallet: boolean; liveCalls: string; broadcastCapable: boolean; note: string };
  errors: string[];
  note: string;
  generatedBy: string;
}

// ── Task 29: owner key entry point (signer /keys/status + /keys/ingest) ──────

export interface OwnerKeySlot {
  loaded: boolean;
  role?: string;
  derived?: string | null;
  expected?: string | null;
  match?: boolean | null;
  error?: string;
}

export interface OwnerKeysStatusResponse {
  ok: boolean;
  error?: string;
  main?: {
    account: string;
    networks: Record<string, { posting: OwnerKeySlot; active: OwnerKeySlot; owner?: OwnerKeySlot }>;
  };
  fleet?: Array<{ username: string; posting: { loaded: boolean }; active: { loaded: boolean } }>;
  sealedAt?: string | null;
  version?: string;
  drift?: {
    lastCheck: string | null;
    openDrifts: number;
    summary?: { ok?: number; drift?: number; errors?: number } | null;
  };
}

export interface OwnerKeysIngestResponse {
  ok: boolean;
  error?: string;
  ingested?: Array<{ account: string; network: string; role: string; derived: string; sealedAt: string }>;
  refused?: Array<{ network?: string; account?: string; match?: boolean; derived?: string | null; error?: string; checked?: Array<{ account: string; match: boolean }> }>;
  sealedAt?: string | null;
}

// ─── /keys-map (Task 45) — every key, organized, ON the main screen ──────────

export interface KeysMapFileRow {
  path: string;
  exists: boolean;
  bytes: number;
  note: string;
}

export interface KeysMapAddressRow {
  label: string;
  address: string;
}

export interface KeysMapChainKeys {
  reachable: boolean;
  error?: string;
  sealedAt?: string | null;
  account?: string;
  networks?: Record<string, { posting: OwnerKeySlot; active: OwnerKeySlot; owner?: OwnerKeySlot }> | null;
  fleet?: Array<{ username: string; posting: { loaded: boolean }; active: { loaded: boolean } }>;
}

export interface KeysMapResponse {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  directive?: string;
  admin?: {
    configured: boolean;
    material: string | null;
    masked: string | null;
    hashMatch: boolean | null;
    source: string | null;
    withheld?: string | null; // Task 46: material gated same-origin only — cross-origin requests get this marker instead
  };
  login?: { devAutoSession: boolean; hint: string };
  chainKeys?: KeysMapChainKeys;
  wallets?: {
    derivation: string;
    tron: KeysMapAddressRow[];
    eth: KeysMapAddressRow[];
    sol: KeysMapAddressRow[];
    outflows: KeysMapAddressRow[];
  };
  files?: KeysMapFileRow[];
}

export interface VerifyLiveResponse {
  ok: boolean;
  error?: string;
  summary?: { slots?: number; drift?: number; errors?: number };
  checkedAt?: string | null;
  skipped?: boolean;
  reason?: string | null;
  drifts?: Array<{ account: string; network: string; role: string; expected: string; derived: string; at: string }>;
}

export interface AgentBridgeResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{
    id: string;
    agent: string;
    kind: string;
    content: string;
    status: string;
    result?: string | null;
    meta?: string | null;
    createdAt: string;
  }>;
  total?: number;
  fresh?: number;
}

// ─── Treasury (Task 41) — live cross-chain balances, public data only ───────

export interface TreasuryBalanceRow {
  label: string;
  address: string;
  status: "ok" | "error";
  error?: string;
  native?: number;
  nativeSymbol?: string;
  usdt?: number;
  activated?: boolean;
}

export interface TreasuryGrapheneRow {
  label: string;
  chain: string;
  status: "ok" | "error";
  error?: string;
  liquid?: string;
  liquidNum?: number;
  debt?: string;
  vested?: string;
  created?: string;
}

export interface TreasuryOutflowRow {
  label: string;
  address: string;
  chain: "TRON" | "SOLANA";
  status: "ok" | "error";
  error?: string;
  native?: number;
  nativeSymbol?: string;
  /** what this address received from our wallets (forensic on-chain trace, 2026-09-10) */
  receivedFromUs?: number;
  note?: string;
}

export interface TreasuryResponse {
  ok: boolean;
  generatedAt: string;
  cache?: string;
  degraded?: boolean;
  error?: string;
  account: string;
  summary: {
    totalTrx: number | null;
    /** TRX sitting on the whole photo-wallet family (idx0..idx5) — totalTrx above == this since Task 44 */
    totalTrxFamily: number | null;
    totalTronUsdt: number | null;
    totalEth: number | null;
    totalEthUsdt: number | null;
    totalSol: number | null;
    totalSolUsdt: number | null;
    grapheneLiquid: number | null;
    gapToUsdtSettlement: number | null;
  };
  constants: { trxPerUsdtTransfer: number };
  /** forensic money-flow story (Task 44 recon, on-chain verified) */
  flow: {
    externalInTrx: number;
    sweptOutTrx: number;
    burnedFeesTrx: number | null;
    story: string[];
    outflows: TreasuryOutflowRow[];
  };
  chains: {
    tron: { rows: TreasuryBalanceRow[]; explorer: string };
    evm: { rows: TreasuryBalanceRow[]; explorer: string };
    solana: { rows: TreasuryBalanceRow[]; explorer: string };
    graphene: { rows: TreasuryGrapheneRow[] };
  };
}
