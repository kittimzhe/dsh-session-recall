/** Plugin-row configuration for dsh-session-recall. */
import { resolve, sep } from 'node:path'
import { normalizeRedactionMode, type RedactionMode } from './redact.ts'

/** What happens when the model passes `all_projects=true`. */
export type AllProjectsPolicy = 'allow' | 'deny' | 'confirm'

export const ALL_PROJECTS_POLICIES: readonly AllProjectsPolicy[] = ['allow', 'deny', 'confirm']

/** What happens when lineage tracing fails while `callerTreeOnly` is on. */
export type LineageFailurePolicy = 'open' | 'closed'

export const LINEAGE_FAILURE_POLICIES: readonly LineageFailurePolicy[] = ['open', 'closed']

export interface RecallConfig {
  /** Honor the tool's `all_projects` argument. Default `true`. */
  allowAllProjects?: boolean
  /** Page size when the model omits `limit`. Default `5`. */
  defaultLimit?: number
  /** Largest accepted page size. Default `10`. */
  maxLimit?: number
  /** Explain CJK zero-hit results with a hint line. Default `true`. */
  cjkHint?: boolean
  /** Fall back to an exact substring scan when a CJK query gets no full-text hits. Default `true`. */
  cjkFallback?: boolean
  /** Max sessions to scan on a cross-session CJK fallback. Default `50`. */
  cjkFallbackScanMax?: number
  /** Redact secret-looking text in snippets and titles. Default `'off'`. */
  redactionMode?: RedactionMode
  /** When non-empty, only sessions started in these project directories are searchable. Default: no restriction. */
  cwdAllowlist?: readonly string[]
  /** Sessions started in these project directories are never searchable. Default: none. */
  cwdDenylist?: readonly string[]
  /**
   * `all_projects` gate: `'allow'` (default, previous behavior), `'deny'`
   * (ignored, with a model-facing hint), or `'confirm'` (the user must
   * approve through the `@deepseek-ai/dsh-user-approval` seam; fail-closed).
   */
  allProjectsPolicy?: AllProjectsPolicy
  /** Re-rank cross-session hits with exponential recency decay (half-life in days). Default: off. */
  recencyHalfLifeDays?: number
  /** Sessions started in these project directories rank first. Default: none. */
  pinnedCwds?: readonly string[]
  /**
   * Restrict recall results to sessions in the calling agent's own lineage
   * (ancestors + self + descendants). Default `true` — other agents in the
   * same project are invisible unless this is set to `false`.
   */
  callerTreeOnly?: boolean
  /**
   * When the session index itself fails (`SESSION_QUERY_PERSISTENCE_FAILED`,
   * e.g. one un-migratable artifact failing every indexed search —
   * deepseek-harness discussion #7995), retry with a direct scan of the
   * persisted session logs instead of failing the call. Default `true`.
   */
  rawScanFallback?: boolean
  /** Max persisted sessions visited by one degraded raw scan. Default `200`. */
  rawScanMaxSessions?: number
  /** Wall-clock ceiling (ms) for one degraded raw scan. Default `20000`. */
  rawScanMaxDurationMs?: number
  /** Compressed-size ceiling (bytes) per session log in a degraded scan. Default 8 MiB. */
  rawScanMaxSessionBytes?: number
  /**
   * When lineage tracing fails while `callerTreeOnly` is on: `'open'` (the
   * default, pre-0.8.3 behavior) degrades to allowing all sessions; `'closed'`
   * refuses the results with a model-facing hint instead of risking
   * over-broad access.
   */
  lineageFailurePolicy?: LineageFailurePolicy
}

/** Validated, fully defaulted configuration. */
export interface NormalizedRecallConfig {
  readonly allowAllProjects: boolean
  readonly defaultLimit: number
  readonly maxLimit: number
  readonly cjkHint: boolean
  readonly cjkFallback: boolean
  readonly cjkFallbackScanMax: number
  readonly redactionMode: RedactionMode
  readonly cwdAllowlist: readonly string[]
  readonly cwdDenylist: readonly string[]
  readonly allProjectsPolicy: AllProjectsPolicy
  readonly recencyHalfLifeDays: number | undefined
  readonly pinnedCwds: readonly string[]
  readonly callerTreeOnly: boolean
  readonly rawScanFallback: boolean
  readonly rawScanMaxSessions: number
  readonly rawScanMaxDurationMs: number
  readonly rawScanMaxSessionBytes: number
  readonly lineageFailurePolicy: LineageFailurePolicy
}

export const RECALL_DEFAULT_LIMIT_MAX = 10
export const RECALL_PAGE_LIMIT_MAX = 25
export const RECALL_CJK_FALLBACK_SCAN_MAX_DEFAULT = 50
export const RECALL_CJK_FALLBACK_SCAN_MAX_MAX = 500

function intIn(value: number | undefined, fallback: number, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, Math.trunc(value)))
}

function stringList(value: readonly string[] | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

function normalizePolicy(value: AllProjectsPolicy | undefined): AllProjectsPolicy {
  return typeof value === 'string' && (ALL_PROJECTS_POLICIES as readonly string[]).includes(value)
    ? value
    : 'allow'
}

function normalizeLineagePolicy(value: LineageFailurePolicy | undefined): LineageFailurePolicy {
  return typeof value === 'string' && (LINEAGE_FAILURE_POLICIES as readonly string[]).includes(value)
    ? value
    : 'open'
}

/**
 * Normalize a path for allowlist/denylist (and other cwd) comparisons:
 * `path.resolve` collapses `..`/`.` segments and relative forms, then a
 * trailing separator is stripped so `/proj/` and `/proj` are one directory.
 * The empty string passes through unchanged (callers treat it as "unknown
 * cwd"). Relative entries resolve against the host process cwd — the config
 * is normalized once at tool construction, before any call context exists,
 * and session cwds are always absolute host paths recorded at session start.
 */
export function normalizeCwdPath(cwd: string): string {
  if (cwd === '') return cwd
  const resolved = resolve(cwd)
  return resolved.length > 1 && resolved.endsWith(sep) ? resolved.slice(0, -sep.length) : resolved
}

/** Default, clamp, and cross-check every optional field. */
export function normalizeRecallConfig(config?: RecallConfig): NormalizedRecallConfig {
  const defaultLimit = intIn(config?.defaultLimit, 5, 1, RECALL_DEFAULT_LIMIT_MAX)
  return {
    allowAllProjects: config?.allowAllProjects !== false,
    defaultLimit,
    maxLimit: Math.max(defaultLimit, intIn(config?.maxLimit, 10, 1, RECALL_PAGE_LIMIT_MAX)),
    cjkHint: config?.cjkHint !== false,
    cjkFallback: config?.cjkFallback !== false,
    cjkFallbackScanMax: intIn(config?.cjkFallbackScanMax, RECALL_CJK_FALLBACK_SCAN_MAX_DEFAULT, 1, RECALL_CJK_FALLBACK_SCAN_MAX_MAX),
    redactionMode: normalizeRedactionMode(config?.redactionMode),
    cwdAllowlist: stringList(config?.cwdAllowlist).map(normalizeCwdPath),
    cwdDenylist: stringList(config?.cwdDenylist).map(normalizeCwdPath),
    allProjectsPolicy: normalizePolicy(config?.allProjectsPolicy),
    recencyHalfLifeDays:
      typeof config?.recencyHalfLifeDays === 'number' && Number.isFinite(config.recencyHalfLifeDays) && config.recencyHalfLifeDays > 0
        ? Math.min(3650, Math.trunc(config.recencyHalfLifeDays))
        : undefined,
    pinnedCwds: stringList(config?.pinnedCwds),
    callerTreeOnly: config?.callerTreeOnly !== false,
    rawScanFallback: config?.rawScanFallback !== false,
    rawScanMaxSessions: intIn(config?.rawScanMaxSessions, 200, 1, 2000),
    rawScanMaxDurationMs: intIn(config?.rawScanMaxDurationMs, 20_000, 1_000, 120_000),
    rawScanMaxSessionBytes: intIn(config?.rawScanMaxSessionBytes, 8 * 1024 * 1024, 262_144, 64 * 1024 * 1024),
    lineageFailurePolicy: normalizeLineagePolicy(config?.lineageFailurePolicy),
  }
}

/**
 * Whether a session cwd is searchable under the allowlist/denylist policy.
 * Both the incoming cwd and the configured lists are compared in normalized
 * form (see `normalizeCwdPath`), so trailing separators and `..` segments
 * cannot dodge either side of the policy.
 */
export function cwdAllowed(cwd: string | null | undefined, cfg: NormalizedRecallConfig): boolean {
  if (cwd == null || cwd === '') {
    // Unknown cwd: not denylisted, but an explicit allowlist does not cover it either.
    return cfg.cwdAllowlist.length === 0
  }
  const target = normalizeCwdPath(cwd)
  if (cfg.cwdDenylist.includes(target)) return false
  if (cfg.cwdAllowlist.length > 0 && !cfg.cwdAllowlist.includes(target)) return false
  return true
}
