/** Plugin-row configuration for dsh-session-recall. */
import { normalizeRedactionMode, type RedactionMode } from './redact.ts'

/** What happens when the model passes `all_projects=true`. */
export type AllProjectsPolicy = 'allow' | 'deny' | 'confirm'

export const ALL_PROJECTS_POLICIES: readonly AllProjectsPolicy[] = ['allow', 'deny', 'confirm']

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
    cwdAllowlist: stringList(config?.cwdAllowlist),
    cwdDenylist: stringList(config?.cwdDenylist),
    allProjectsPolicy: normalizePolicy(config?.allProjectsPolicy),
    recencyHalfLifeDays:
      typeof config?.recencyHalfLifeDays === 'number' && Number.isFinite(config.recencyHalfLifeDays) && config.recencyHalfLifeDays > 0
        ? Math.min(3650, Math.trunc(config.recencyHalfLifeDays))
        : undefined,
    pinnedCwds: stringList(config?.pinnedCwds),
  }
}

/** Whether a session cwd is searchable under the allowlist/denylist policy. */
export function cwdAllowed(cwd: string | null | undefined, cfg: NormalizedRecallConfig): boolean {
  if (cwd == null || cwd === '') {
    // Unknown cwd: not denylisted, but an explicit allowlist does not cover it either.
    return cfg.cwdAllowlist.length === 0
  }
  if (cfg.cwdDenylist.includes(cwd)) return false
  if (cfg.cwdAllowlist.length > 0 && !cfg.cwdAllowlist.includes(cwd)) return false
  return true
}
