/** Canonical value types for the `recall` tool's declared output. */

/** The strongest matching event of one session, as surfaced by the search backend. */
export interface RecallBestMatch {
  seq: number
  type: string
  time: number
  snippet: string
}

/** One session hit: identity plus its strongest matching event. */
export interface RecallItem {
  sessionId: string
  id8: string
  title: string | null
  createdAt: number
  cwd: string | null
  live: boolean
  persisted: boolean
  /** Newest dsh-session-export artifact for this session, or null (#8). */
  artifactPath: string | null
  /**
   * How fresh the attached report is relative to session activity (P1).
   * Absent without a report, or when nothing could be determined; the
   * sub-fields are optional for the same reason — undeterminable values are
   * omitted rather than nulled, so results without the field (or without
   * sub-fields) keep validating against the declared output schema.
   */
  reportFreshness?: RecallReportFreshness
  bestMatch: RecallBestMatch
}

/**
 * Freshness of one hit's attached export report (P1). `stale: true` certifies
 * that the session demonstrably has events newer than the report; `false` (or
 * an omitted value) only means "no evidence of staleness" — the comparison
 * source is the hit's best-matching event time, which is a lower bound on the
 * session's true latest activity.
 */
export interface RecallReportFreshness {
  /** Report export time, Unix epoch ms: the filename `YYYYMMDD-HHMMSS` slug (local timezone) when parseable, else the file's mtime. */
  exportedAt?: number
  /** True when the report predates the hit's best-matching event (`exportedAt < bestMatch.time`). */
  stale?: boolean
}

/** How this call scoped the corpus. */
export interface RecallScope {
  cwd: string | null
  allProjects: boolean
  sessionId: string | null
}

/** How the matches in a result were produced (v0.5 diagnostics). */
export interface RecallDiagnostics {
  /** Which engine produced the matches. */
  readonly source: 'fts' | 'cjk-fallback' | 'session-scan' | 'raw-scan'
  /** Sessions visited by the fallback scan, when it ran. */
  readonly scanned?: number
  /** The fallback scan budget (`cjkFallbackScanMax`), when a scan ran. */
  readonly scanBudget?: number
  /** True when a scan collected more matches than the page limit and the tail was cut. */
  readonly truncated?: boolean
  /** True when re-ranking (recency decay / pinning) was applied to this page. */
  readonly ranked: boolean
}

/** The `recall` tool's canonical JSON value, validated against the output schema. */
export interface RecallResult {
  query: string
  scope: RecallScope
  count: number
  hasMore: boolean
  items: RecallItem[]
  nextCursor: string | null
  hint: string | null
  /** How many secret-looking fields were redacted in this result (0 when redaction is off). */
  redacted: number
  /** How this result was produced; null when the call failed before searching. */
  diagnostics: RecallDiagnostics | null
}

/** The typed model-facing arguments after schema validation. */
export interface RecallArgs {
  query: string
  session_id?: string
  all_projects?: boolean
  limit?: number
  cursor?: string
  /** Only return sessions/entries newer than this many days. */
  since_days?: number
  /** Only return tool-related events whose tool name matches one of these (substring, case-insensitive). */
  tools?: readonly string[]
  /** Only return failed tool calls (tool results carrying an error). */
  errors_only?: boolean
}
