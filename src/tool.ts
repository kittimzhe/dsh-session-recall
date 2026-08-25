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
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionSearchCursor,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
  SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'
import { SessionSearchCursor as brandCursor } from '@deepseek-ai/dsh-session-query'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type { NormalizedRecallConfig, RecallConfig } from './config.ts'
import { normalizeRecallConfig } from './config.ts'
import { cjkZeroHitHint, recallContentBlocks, recallPresentationMeta } from './render.ts'
import type { RecallArgs, RecallItem, RecallResult } from './types.ts'
import { clamp, id8, normalizeQuery } from './util.ts'

/** The ctx.sessionQuery surface this tool consumes (structural, for testability). */
export interface RecallQueryEngine {
  searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>
  searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage>
  readTitleSnapshots(sessionIds: readonly string[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]>
}

export const RECALL_TOOL_DESCRIPTION = [
  'Search the FULL TEXT of past and current session transcripts on this machine (your own conversation history with this user).',
  'Use it when the user refers to earlier work ("that bug we fixed last week", "the font we chose for my resume") or when prior context was compacted away.',
  'Matches whole words/phrases (English and code identifiers work best); returns the best-matching event snippet per session plus the session id.',
  'Then use the read tool on files, or ask the user, to go deeper — this tool only points at history, it does not resume sessions.',
  'Scoping: by default only sessions started in the current project directory; pass all_projects=true to search everywhere.',
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

function recallError(query: string, error: unknown): RecallResult {
  return {
    query,
    scope: { cwd: null, allProjects: false, sessionId: null },
    count: 0,
    hasMore: false,
    items: [],
    nextCursor: null,
    hint: friendlyError(error),
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
  },
} as const

/**
 * Build the `recall` ToolDefinition around a concrete sessionQuery engine.
 * Pure construction — no registration happens here.
 */
export function createRecallTool(config?: RecallConfig, engine?: RecallQueryEngine): ToolDefinition {
  const cfg: NormalizedRecallConfig = normalizeRecallConfig(config)
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
      const wantAll = args.all_projects === true && cfg.allowAllProjects
      const scope = { cwd: agentCwd, allProjects: wantAll, sessionId: args.session_id ?? null }

      try {
        if (args.session_id != null && args.session_id !== '') {
          const sessionId = brandSessionId(args.session_id)
          const page = await engine.searchEvents(
            { sessionId, query, limit, cursor: brand(args.cursor) },
            { signal: exec.signal },
          )
          const items = eventItems(page, sessionId)
          return { query, scope, count: items.length, hasMore: page.nextCursor != null, items, nextCursor: page.nextCursor ?? null, hint: cjkZeroHitHint(query, items.length === 0, cfg.cjkHint) }
        }

        const request: SessionSearchRequest = { query, limit }
        if (!wantAll && agentCwd != null) request.sessionFilters = [{ kind: 'cwd', values: [agentCwd] }]
        if (args.cursor != null && args.cursor !== '') request.cursor = brand(args.cursor)
        const page = await engine.searchSessions(request, { signal: exec.signal })
        const titles = await titlesFor(engine, page.items.map((hit) => hit.header.id), exec.signal)
        const items = toItems(page.items, titles)
        return { query, scope, count: items.length, hasMore: page.nextCursor != null, items, nextCursor: page.nextCursor ?? null, hint: cjkZeroHitHint(query, items.length === 0, cfg.cjkHint) }
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
