/**
 * The `recall` tool: model-facing cross-session full-text search over the
 * trusted `ctx.sessionQuery` seam.
 *
 * The official `@deepseek-ai/dsh-session-query` service deliberately ships no
 * model-facing tool ("No registries or model-facing tool — … a model-facing
 * tool is absent") and no caller authorization ("a model tool or UI must
 * constrain which sessions its caller may inspect"). This plugin fills both
 * gaps: it registers one typed `recall` tool and constrains every call to the
 * calling agent's own project cwd unless the model explicitly widens the
 * scope and the deployment allows it.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SearchMatchesResultView, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  SessionEventResultFilter,
  SessionEventSearchDocument,
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionRecord,
  SessionSearchCursor,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
  SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'
import { SessionSearchCursor as brandCursor } from '@deepseek-ai/dsh-session-query'
import { SessionId as brandSessionId, type SessionId } from '@deepseek-ai/dsh-session'
import type { NormalizedRecallConfig, RecallConfig } from './config.ts'
import { cwdAllowed, normalizeRecallConfig } from './config.ts'
import { redactText } from './redact.ts'
import { cjkFallbackHint, cjkZeroHitHint, recallContentBlocks, recallPresentationMeta } from './render.ts'
import type { RecallArgs, RecallItem, RecallResult } from './types.ts'
import { clamp, hasCJK, id8, normalizeQuery, snippetAround, splitTerms } from './util.ts'

/** The ctx.sessionQuery surface this tool consumes (structural, for testability). */
export interface RecallQueryEngine {
  searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>
  searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage>
  readTitleSnapshots(sessionIds: readonly string[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]>
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  filterEvents(sessionId: SessionId, filters: readonly SessionEventResultFilter[]): Promise<SessionEventSearchDocument[]>
}

export const RECALL_TOOL_DESCRIPTION = [
  'Search the FULL TEXT of past and current session transcripts on this machine (your own conversation history with this user).',
  'Use it when the user refers to earlier work ("that bug we fixed last week", "the font we chose for my resume") or when prior context was compacted away.',
  'Matches whole words/phrases for English and code identifiers; a zero-hit Chinese (CJK) query automatically falls back to a substring scan in which every whitespace-separated term must match. Returns the best-matching event snippet per session plus the session id.',
  'Then use the read tool on files, or ask the user, to go deeper — this tool only points at history, it does not resume sessions.',
  'Scoping: by default only sessions started in the current project directory; pass all_projects=true to search everywhere (the deployment may ignore it or require user approval).',
  'When the deployment enables redaction, secret-looking text in snippets appears as [REDACTED] or a #hash marker — treat it as removed; do not try to reconstruct or echo it.',
  'The first search after startup may be slow while the index builds.',
].join(' ')

function errCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function friendlyError(error: unknown): string {
  const code = errCode(error)
  switch (code) {
    case 'SESSION_QUERY_SEARCH_DISABLED':
      return (
        'full-text search is disabled for this deployment: the session-query backend row needs a dedicated on-disk path and ' +
        "an openAt of 'first-search' or 'startup'. This plugin's bundle patch already sets that for shipped web profiles — " +
        'if you overrode the session-query-sqlite row yourself, check its config.'
      )
    case 'SESSION_QUERY_INVALID_CURSOR':
    case 'SESSION_QUERY_STALE_CURSOR':
      return 'the cursor is stale (the index moved on). Start a fresh recall call without a cursor.'
    case 'SESSION_QUERY_SESSION_NOT_FOUND':
      return 'no session with that session_id exists. Search without session_id to discover candidate sessions first.'
    case 'SESSION_QUERY_INVALID_QUERY':
      return 'the query was empty after trimming. Pass a non-empty search phrase.'
    case 'SESSION_QUERY_INVALID_LIMIT':
      return 'the limit was out of range. Pass an integer between 1 and the deployment max (default 10).'
    case 'SESSION_QUERY_ABORTED':
      return 'the search was cancelled before it finished.'
    default:
      return `session search failed${code != null ? ` (${code})` : ''}: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** The approval verdict vocabulary mirrored from `@deepseek-ai/dsh-user-approval`. */
export type RecallApprovalVerdict = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * Optional user-approval seam for the `all_projects` gate (`allProjectsPolicy:
 * 'confirm'`). Receives the tool run context (for the agent) and a
 * human-readable reason; `'allowed-once'` is the only grant. Wired from
 * `ctx.approval` in the plugin entry; fail-closed when absent.
 */
export type RecallApprover = (exec: ToolRunContext, reason: string) => Promise<RecallApprovalVerdict>

function recallError(query: string, error: unknown): RecallResult {
  return {
    query,
    scope: { cwd: null, allProjects: false, sessionId: null },
    count: 0,
    hasMore: false,
    items: [],
    nextCursor: null,
    hint: friendlyError(error),
    redacted: 0,
  }
}

function brand(value: string | undefined): SessionSearchCursor | undefined {
  return value == null || value === '' ? undefined : brandCursor(value)
}

/** Best-effort title enrichment; a failed batch degrades to untitled rows. */
async function titlesFor(
  engine: RecallQueryEngine,
  sessionIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (sessionIds.length === 0) return map
  try {
    const results = await engine.readTitleSnapshots(sessionIds, signal)
    for (const r of results) {
      map.set(r.sessionId, r.status === 'fulfilled' ? (r.value.title?.title ?? null) : null)
    }
  } catch {
    // swallow: titles are decorative
  }
  return map
}

function toItems(hits: readonly SessionSearchHit[], titles: Map<string, string | null>): RecallItem[] {
  return hits.map((hit) => ({
    sessionId: hit.header.id,
    id8: id8(hit.header.id),
    title: titles.get(hit.header.id) ?? null,
    createdAt: hit.header.createdAt,
    cwd: hit.header.cwd ?? null,
    live: hit.live,
    persisted: hit.persisted,
    bestMatch: { seq: hit.bestMatch.seq, type: hit.bestMatch.type, time: hit.bestMatch.time, snippet: hit.bestMatch.snippet },
  }))
}

function eventItems(page: SessionEventSearchPage, sessionId: string): RecallItem[] {
  return page.items.map((event) => ({
    sessionId,
    id8: id8(sessionId),
    title: null,
    createdAt: page.session.createdAt,
    cwd: page.session.cwd ?? null,
    live: true,
    persisted: false,
    bestMatch: { seq: event.seq, type: event.type, time: event.time, snippet: event.snippet },
  }))
}

/** Snippet window kept consistent with the tool's text projection. */
const CJK_SNIPPET_CHARS = 120

/**
 * Decompose a query into ANDed literal-text clauses. A space-separated CJK
 * query like "简历 模板" must match each term as a substring (so it recovers
 * "简历模板"), not a whitespace-joined literal (which would require the space
 * to be present verbatim). `highlight` is the first term, guaranteed present
 * whenever the ANDed scan matches.
 */
function cjkTextFilters(query: string): { filters: Array<{ kind: 'text'; text: string }>; highlight: string } {
  const terms = splitTerms(query)
  return { filters: terms.map((term) => ({ kind: 'text', text: term })), highlight: terms[0] ?? query }
}

/**
 * CJK substring-scan fallback for zero-hit full-text searches. SQLite FTS5's
 * `unicode61` tokenizer treats an uninterrupted CJK run as one token, so a
 * short Chinese phrase inside a longer sentence never matches the index. The
 * official sessionQuery service's `filterEvents` text clause is a literal
 * Unicode/case-insensitive regex scan that is deliberately independent of FTS
 * providers, so scanning each scoped session with it recovers the exact
 * substring matches the full-text index cannot see.
 */
async function cjkScanSessions(
  engine: RecallQueryEngine,
  query: string,
  agentCwd: string | null,
  wantAll: boolean,
  cfg: NormalizedRecallConfig,
  scanMax: number,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<RecallItem[]> {
  const all = await engine.listSessions(signal)
  const scoped = !wantAll && agentCwd != null ? all.filter((record) => record.header.cwd === agentCwd) : all
  const candidates = scoped.filter((record) => cwdAllowed(record.header.cwd, cfg))
  const items: RecallItem[] = []
  for (const record of candidates.slice(0, scanMax)) {
    if (items.length >= limit) break
    const { filters, highlight } = cjkTextFilters(query)
    const docs = await engine.filterEvents(record.header.id, filters)
    if (docs.length === 0) continue
    const doc = docs[0]
    if (doc === undefined) continue
    items.push({
      sessionId: record.header.id,
      id8: id8(record.header.id),
      title: null,
      createdAt: record.header.createdAt,
      cwd: record.header.cwd ?? null,
      live: record.live,
      persisted: record.persisted,
      bestMatch: { seq: doc.seq, type: doc.type, time: doc.time, snippet: snippetAround(doc.text, highlight, CJK_SNIPPET_CHARS) },
    })
  }
  return items
}

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

const recallOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: { cwd: nullableString, allProjects: { type: 'boolean' }, sessionId: nullableString },
    },
    count: { type: 'integer' },
    hasMore: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' },
          id8: { type: 'string' },
          title: nullableString,
          createdAt: { type: 'integer' },
          cwd: nullableString,
          live: { type: 'boolean' },
          persisted: { type: 'boolean' },
          bestMatch: {
            type: 'object',
            additionalProperties: false,
            properties: { seq: { type: 'integer' }, type: { type: 'string' }, time: { type: 'integer' }, snippet: { type: 'string' } },
          },
        },
      },
    },
    nextCursor: nullableString,
    hint: nullableString,
    redacted: { type: 'integer' },
  },
} as const

/**
 * Build the `recall` ToolDefinition around a concrete sessionQuery engine.
 * Pure construction — no registration happens here.
 */
export function createRecallTool(config?: RecallConfig, engine?: RecallQueryEngine, approver?: RecallApprover): ToolDefinition {
  const cfg: NormalizedRecallConfig = normalizeRecallConfig(config)

  /** Apply configured redaction to titles and snippets; report a model-facing note. */
  function applyRedaction(items: RecallItem[]): { items: RecallItem[]; redacted: number; hint: string | null } {
    if (cfg.redactionMode === 'off') return { items, redacted: 0, hint: null }
    let redacted = 0
    const out = items.map((item) => {
      const title = item.title == null ? null : redactText(item.title, cfg.redactionMode)
      const snippet = redactText(item.bestMatch.snippet, cfg.redactionMode)
      redacted += (title?.count ?? 0) + snippet.count
      return {
        ...item,
        title: title == null ? null : title.text,
        bestMatch: { ...item.bestMatch, snippet: snippet.text },
      }
    })
    const hint = redacted > 0 ? `${redacted} secret-looking field(s) were redacted from this result (mode: ${cfg.redactionMode}).` : null
    return { items: out, redacted, hint }
  }

  function joinHints(...parts: Array<string | null | undefined>): string | null {
    const kept = parts.filter((part): part is string => part != null && part !== '')
    return kept.length > 0 ? kept.join(' ') : null
  }

  /** Ask the approval seam whether this all_projects call may proceed. */
  async function decideAllProjects(exec: ToolRunContext, query: string): Promise<RecallApprovalVerdict> {
    if (approver == null) return 'unavailable'
    try {
      return await approver(exec, `recall: search sessions from ALL project directories (query: "${query}")`)
    } catch {
      return 'unavailable'
    }
  }

  return defineTool({
    name: 'recall',
    description: RECALL_TOOL_DESCRIPTION,
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    parameters: {
      query: { type: 'string', required: true, description: 'Literal phrase to search for in past transcript text (word/phrase match, not regex; FTS operators are treated as data).' },
      session_id: { type: 'string', description: 'Restrict the search to events of this one session (use after a cross-session hit pointed you here).' },
      all_projects: { type: 'boolean', description: 'Search sessions from ALL project directories instead of only the current one. Ignored when the deployment disallows it.' },
      limit: { type: 'integer', description: `Page size, default ${cfg.defaultLimit}, at most ${cfg.maxLimit}.` },
      cursor: { type: 'string', description: 'Opaque continuation cursor from a previous recall result with hasMore=true.' },
    },
    output: {
      schema: recallOutputSchema,
      render: (_args, value) => recallContentBlocks(value as RecallResult),
      presentationMeta: (_args, value) => recallPresentationMeta(value as RecallResult),
    },
    async execute(args: RecallArgs, exec: ToolRunContext): Promise<RecallResult> {
      const query = normalizeQuery(args.query)
      if (engine == null) return recallError(query, new Error('no sessionQuery engine was wired into this plugin instance'))
      if (query === '') return recallError(query, Object.assign(new Error('empty query'), { code: 'SESSION_QUERY_INVALID_QUERY' }))

      const limit = clamp(Math.trunc(args.limit ?? cfg.defaultLimit), 1, cfg.maxLimit)
      const agentCwd = exec.agent?.session.header?.cwd ?? null

      const scopeHints: string[] = []
      let wantAll = false
      if (args.session_id == null && args.all_projects === true) {
        if (!cfg.allowAllProjects || cfg.allProjectsPolicy === 'deny') {
          scopeHints.push('all_projects was ignored: cross-project search is disabled by this deployment. Searched the current project only.')
        } else if (cfg.allProjectsPolicy === 'confirm') {
          const verdict = await decideAllProjects(exec, query)
          if (verdict === 'allowed-once') wantAll = true
          else scopeHints.push(`all_projects was not approved (${verdict}); searched the current project only.`)
        } else {
          wantAll = true
        }
      }
      const scope = { cwd: agentCwd, allProjects: wantAll, sessionId: args.session_id ?? null }

      if (args.session_id == null && !wantAll && agentCwd != null && !cwdAllowed(agentCwd, cfg)) {
        return {
          query,
          scope,
          count: 0,
          hasMore: false,
          items: [],
          nextCursor: null,
          hint: 'the current project directory is excluded by the recall scope policy (cwd allowlist/denylist). Ask the user to adjust the plugin configuration if this is unexpected.',
          redacted: 0,
        }
      }

      try {
        if (args.session_id != null && args.session_id !== '') {
          const sessionId = brandSessionId(args.session_id)
          const page = await engine.searchEvents(
            { sessionId, query, limit, cursor: brand(args.cursor) },
            { signal: exec.signal },
          )
          if (!cwdAllowed(page.session.cwd ?? null, cfg)) {
            return {
              query,
              scope,
              count: 0,
              hasMore: false,
              items: [],
              nextCursor: null,
              hint: 'that session belongs to a project directory excluded by the recall scope policy (cwd allowlist/denylist).',
              redacted: 0,
            }
          }
          let items = eventItems(page, sessionId)
          let hint: string | null = null
          if (items.length === 0 && hasCJK(query) && cfg.cjkFallback) {
            const { filters, highlight } = cjkTextFilters(query)
            const docs = await engine.filterEvents(sessionId, filters)
            if (docs.length > 0) {
              items = docs.slice(0, limit).map((doc) => ({
                sessionId,
                id8: id8(sessionId),
                title: null,
                createdAt: page.session.createdAt,
                cwd: page.session.cwd ?? null,
                live: true,
                persisted: false,
                bestMatch: { seq: doc.seq, type: doc.type, time: doc.time, snippet: snippetAround(doc.text, highlight, CJK_SNIPPET_CHARS) },
              }))
            }
            hint = items.length > 0 ? cjkFallbackHint(items.length, cfg.cjkHint) : cjkZeroHitHint(query, true, cfg.cjkHint)
          } else if (items.length === 0) {
            hint = cjkZeroHitHint(query, true, cfg.cjkHint)
          }
          const red = applyRedaction(items)
          return {
            query,
            scope,
            count: red.items.length,
            hasMore: page.nextCursor != null,
            items: red.items,
            nextCursor: page.nextCursor ?? null,
            hint: joinHints(hint, red.hint),
            redacted: red.redacted,
          }
        }

        const request: SessionSearchRequest = { query, limit }
        if (!wantAll && agentCwd != null) request.sessionFilters = [{ kind: 'cwd', values: [agentCwd] }]
        if (args.cursor != null && args.cursor !== '') request.cursor = brand(args.cursor)
        const page = await engine.searchSessions(request, { signal: exec.signal })
        const titles = await titlesFor(engine, page.items.map((hit) => hit.header.id), exec.signal)
        let items = toItems(page.items, titles).filter((item) => cwdAllowed(item.cwd, cfg))
        let hint: string | null = null
        let fallbackRan = false
        if (items.length === 0 && hasCJK(query) && cfg.cjkFallback) {
          fallbackRan = true
          const scanned = await cjkScanSessions(engine, query, agentCwd, wantAll, cfg, cfg.cjkFallbackScanMax, limit, exec.signal)
          const scanTitles = await titlesFor(engine, scanned.map((item) => item.sessionId), exec.signal)
          items = scanned.map((item) => ({ ...item, title: scanTitles.get(item.sessionId) ?? null }))
          hint = items.length > 0 ? cjkFallbackHint(items.length, cfg.cjkHint) : cjkZeroHitHint(query, true, cfg.cjkHint)
        } else if (items.length === 0) {
          hint = cjkZeroHitHint(query, true, cfg.cjkHint)
        }
        const red = applyRedaction(items)
        return {
          query,
          scope,
          count: red.items.length,
          hasMore: !fallbackRan && page.nextCursor != null,
          items: red.items,
          nextCursor: !fallbackRan ? (page.nextCursor ?? null) : null,
          hint: joinHints(hint, ...scopeHints, red.hint),
          redacted: red.redacted,
        }
      } catch (error) {
        return recallError(query, error)
      }
    },
    presentResult: (_args, result) => {
      const meta = result.meta as unknown as
        | { query: string; count: number; hasMore: boolean; items: Array<{ label: string; id8: string; seq: number; snippet: string }> }
        | undefined
      if (meta == null || !Array.isArray(meta.items)) return undefined
      const view: SearchMatchesResultView = {
        card: 'search',
        shape: 'matches',
        title: `recall "${meta.query}"`,
        files: meta.items.map((item) => ({
          path: `${item.label} · ${item.id8}`,
          matches: [{ lineNumber: item.seq, line: item.snippet }],
        })),
        truncated: meta.hasMore,
        total: meta.count,
      }
      return view
    },
  })
}
