/** Plugin-row configuration for dsh-session-recall. */
export interface RecallConfig {
  /** Honor the tool's `all_projects` argument. Default `true`. */
  allowAllProjects?: boolean
  /** Page size when the model omits `limit`. Default `5`. */
  defaultLimit?: number
  /** Largest accepted page size. Default `10`. */
  maxLimit?: number
  /** Teach the model the CJK tokenizer workaround on zero hits. Default `true`. */
  cjkHint?: boolean
}

/** Validated, fully defaulted configuration. */
export interface NormalizedRecallConfig {
  readonly allowAllProjects: boolean
  readonly defaultLimit: number
  readonly maxLimit: number
  readonly cjkHint: boolean
}

export const RECALL_DEFAULT_LIMIT_MAX = 10
export const RECALL_PAGE_LIMIT_MAX = 25

function intIn(value: number | undefined, fallback: number, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, Math.trunc(value)))
}

/** Default, clamp, and cross-check every optional field. */
export function normalizeRecallConfig(config?: RecallConfig): NormalizedRecallConfig {
  const defaultLimit = intIn(config?.defaultLimit, 5, 1, RECALL_DEFAULT_LIMIT_MAX)
  return {
    allowAllProjects: config?.allowAllProjects !== false,
    defaultLimit,
    maxLimit: Math.max(defaultLimit, intIn(config?.maxLimit, 10, 1, RECALL_PAGE_LIMIT_MAX)),
    cjkHint: config?.cjkHint !== false,
  }
}
