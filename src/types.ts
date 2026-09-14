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
  bestMatch: RecallBestMatch
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
  readonly source: 'fts' | 'cjk-fallback' | 'session-scan'
  /** Sessions visited by the fallback scan, when it ran. */
  readonly scanned?: number
  /** The fallback scan budget (`cjkFallbackScanMax`), when a scan ran. */
  readonly scanBudget?: number
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
}
