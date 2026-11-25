import { describe, expect, it } from 'vitest'
import type { SessionEventResultFilter, SessionEventSearchDocument, SessionEventSearchPage, SessionLineageTrace, SessionRecord, SessionSearchHit, SessionSearchPage, SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createRecallTool, type RecallQueryEngine } from '../src/tool.ts'
import type { RecallResult } from '../src/types.ts'

/** Recorded calls plus canned responses for one fake engine. */
interface FakeEngine extends RecallQueryEngine {
  sessionsRequests: Array<Record<string, unknown>>
  eventsRequests: Array<Record<string, unknown>>
  titleCalls: string[][]
  titleError?: Error
  defaultEventSession: { createdAt: number; cwd: string | undefined }
  listCalls: number
  listResult: SessionRecord[]
  filterCalls: string[]
  filterArgs: Array<readonly SessionEventResultFilter[]>
  filterResults: Map<string, SessionEventSearchDocument[]>
  lineageTraceCalls: unknown[]
  lineageTraceResult: SessionLineageTrace | null
}

function hit(id: string, cwd: string | undefined, snippet: string, seq = 1): SessionSearchHit {
  return {
    header: { version: 1, id, createdAt: new Date(2026, 7, 20).getTime(), ...(cwd != null ? { cwd } : {}) },
    live: true,
    persisted: true,
    artifactPath: null,
    bestMatch: { sessionId: id, seq, type: 'user/message', time: new Date(2026, 7, 20).getTime(), surface: 'current', snippet },
  } as unknown as SessionSearchHit
}

function record(id: string, cwd: string | undefined, createdAt = new Date(2026, 7, 20).getTime()): SessionRecord {
  return { header: { version: 1, id, createdAt, ...(cwd != null ? { cwd } : {}) }, live: true, persisted: true } as unknown as SessionRecord
}

function doc(sessionId: string, text: string, seq = 3): SessionEventSearchDocument {
  return { sessionId, seq, type: 'assistant/message', time: new Date(2026, 7, 20).getTime(), surface: 'current', text } as unknown as SessionEventSearchDocument
}

function makeEngine(page: Partial<SessionSearchPage<SessionSearchHit>> = {}, eventPage?: SessionEventSearchPage): FakeEngine {
  const engine: FakeEngine = {
    sessionsRequests: [],
    eventsRequests: [],
    titleCalls: [],
    listCalls: 0,
    listResult: [],
    filterCalls: [],
    filterArgs: [],
    filterResults: new Map(),
    defaultEventSession: { createdAt: new Date(2026, 7, 20).getTime(), cwd: '/proj' },
    async searchSessions(request) {
      engine.sessionsRequests.push(request as unknown as Record<string, unknown>)
      return { items: page.items ?? [], ...(page.nextCursor != null ? { nextCursor: page.nextCursor } : {}) } as SessionSearchPage<SessionSearchHit>
    },
    async searchEvents(request) {
      engine.eventsRequests.push(request as unknown as Record<string, unknown>)
      return (eventPage ?? { items: [], session: engine.defaultEventSession }) as SessionEventSearchPage
    },
    async readTitleSnapshots(ids): Promise<SessionTitleObservationResult[]> {
      engine.titleCalls.push([...ids])
      if (engine.titleError != null) throw engine.titleError
      return ids.map((sessionId) => ({
        sessionId,
        status: 'fulfilled',
        value: { session: {} as object, title: { title: `title of ${sessionId}`, eventSeq: 1, updatedAt: 0, messageSeqs: [], source: { kind: 'user' } } },
      })) as unknown as SessionTitleObservationResult[]
    },
    async listSessions() {
      engine.listCalls += 1
      return engine.listResult
    },
    async filterEvents(sessionId, filters) {
      engine.filterCalls.push(sessionId)
      engine.filterArgs.push(filters)
      return engine.filterResults.get(sessionId) ?? []
    },
    lineageTraceCalls: [],
    lineageTraceResult: null,
    async traceSession(sessionId) {
      engine.lineageTraceCalls.push(sessionId)
      if (engine.lineageTraceResult != null) return engine.lineageTraceResult
      return {
        target: { header: { id: String(sessionId), createdAt: 0, version: 0 } },
        ancestors: [],
        descendants: [],
        complete: true,
        root: { header: { id: String(sessionId), createdAt: 0, version: 0 } },
      } as unknown as SessionLineageTrace
    },
  }
  return engine
}

function makeExec(cwd?: string, sessionId = 'caller-session-1'): ToolRunContext {
  return {
    callId: 'c1',
    name: 'recall',
    arguments: {},
    signal: new AbortController().signal,
    agent: { session: { id: sessionId, header: { cwd } } },
  } as unknown as ToolRunContext
}

async function run(tool: ToolDefinition, args: Record<string, unknown>, cwd?: string): Promise<RecallResult> {
  return (await tool.execute(args, makeExec(cwd))) as RecallResult
}

describe('recall tool definition', () => {
  it('declares the name, timeout, concurrency, and schema-compatible output', () => {
    const tool = createRecallTool({ callerTreeOnly: false }, makeEngine())
    expect(tool.name).toBe('recall')
    expect(tool.timeoutMs).toBe(30_000) // 10s indexed + headroom for the degraded raw scan
    // defineTool validates args before classifying, so only a valid call opts in.
    expect(tool.isConcurrencySafe?.({ query: 'x' })).toBe(true)
    expect(tool.isConcurrencySafe?.({})).not.toBe(true)

    const sample: RecallResult = {
      query: 'q',
      scope: { cwd: null, allProjects: false, sessionId: null },
      count: 1,
      hasMore: false,
      redacted: 0,
      diagnostics: { source: 'fts', ranked: false },
      items: [
        {
          sessionId: 's1',
          id8: 's1',
          title: null,
          createdAt: 1,
          cwd: null,
          live: true,
          persisted: false,
          artifactPath: null,
          bestMatch: { seq: 1, type: 't', time: 1, snippet: 'x' },
        },
        {
          sessionId: 's2',
          id8: 's2',
          title: null,
          createdAt: 1,
          cwd: null,
          live: false,
          persisted: true,
          artifactPath: '/proj/dsh-transcripts/transcript-s2-20261001-090000.md',
          bestMatch: { seq: 2, type: 't', time: 1, snippet: 'y' },
        },
      ],
      nextCursor: null,
      hint: null,
    }
    expect(validateJsonSchemaValue(tool.output.schema, sample)).toEqual([])
  })

  it('attaches the newest exported artifact path per hit (#8)', async () => {
    const engine = makeEngine({
      items: [hit('session-ca62e005-4274-477b-bd56-9d9508edb040', '/proj', 'resume template font')],
    })
    const listDir = (dir: string): string[] => {
      expect(dir).toBe('/proj/dsh-transcripts')
      return ['transcript-ca62e005-20260901-120000.md', 'transcript-ca62e005-20261001-090000.html']
    }
    const out = await run(
      createRecallTool({ callerTreeOnly: false }, engine, undefined, listDir),
      { query: 'resume template' },
      '/proj',
    )
    expect(out.items).toHaveLength(1)
    expect(out.items[0]?.artifactPath).toBe('/proj/dsh-transcripts/transcript-ca62e005-20261001-090000.html')
  })

  it('carries null artifactPath when no export exists (#8)', async () => {
    const engine = makeEngine({
      items: [hit('session-ca62e005-4274-477b-bd56-9d9508edb040', '/proj', 'resume template font')],
    })
    const out = await run(
      createRecallTool({ callerTreeOnly: false }, engine, undefined, () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }),
      { query: 'resume template' },
      '/proj',
    )
    expect(out.items[0]?.artifactPath).toBeNull()
  })
})

describe('recall execute — report freshness (#8 / P1)', () => {
  // The hit() fixture pins bestMatch.time to 2026-08-20 local time.
  const id = 'session-ca62e005-4274-477b-bd56-9d9508edb040'

  function listDirOf(names: string[]): (dir: string) => string[] {
    return (dir) => {
      expect(dir).toBe('/proj/dsh-transcripts')
      return names
    }
  }

  function hitAtTime(time: number): SessionSearchHit {
    const h = hit(id, '/proj', 'resume template font')
    ;(h.bestMatch as { time: number }).time = time
    return h
  }

  it('marks the hit stale when the report predates the matched event', async () => {
    const engine = makeEngine({ items: [hit(id, '/proj', 'resume template font')] })
    const out = await run(
      createRecallTool({ callerTreeOnly: false }, engine, undefined, listDirOf(['transcript-ca62e005-20260701-000000.md'])),
      { query: 'resume template' },
      '/proj',
    )
    expect(out.items[0]?.artifactPath).toBe('/proj/dsh-transcripts/transcript-ca62e005-20260701-000000.md')
    expect(out.items[0]?.reportFreshness).toEqual({
      exportedAt: new Date(2026, 6, 1, 0, 0, 0).getTime(),
      stale: true, // 2026-07-01 export < 2026-08-20 matched event
    })
  })

  it('reports fresh when the report is newer than the matched event', async () => {
    const engine = makeEngine({ items: [hit(id, '/proj', 'resume template font')] })
    const out = await run(
      createRecallTool({ callerTreeOnly: false }, engine, undefined, listDirOf(['bundle-ca62e005-20261001-090000.zip'])),
      { query: 'resume template' },
      '/proj',
    )
    expect(out.items[0]?.reportFreshness).toEqual({
      exportedAt: new Date(2026, 9, 1, 9, 0, 0).getTime(),
      stale: false, // 2026-10-01 export ≥ 2026-08-20 matched event
    })
  })

  it('omits the field entirely when no report exists (unknown, not false)', async () => {
    const engine = makeEngine({ items: [hit(id, '/proj', 'resume template font')] })
    const out = await run(
      createRecallTool({ callerTreeOnly: false }, engine, undefined, () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }),
      { query: 'resume template' },
      '/proj',
    )
    expect(out.items[0]?.reportFreshness).toBeUndefined()
    expect('reportFreshness' in (out.items[0] ?? {})).toBe(false)
  })

  it('omits stale when the matched event carries no usable time (0 from the raw scan)', async () => {
    const engine = makeEngine({ items: [hitAtTime(0)] })
    const out = await run(
      createRecallTool({ callerTreeOnly: false }, engine, undefined, listDirOf(['transcript-ca62e005-20260701-000000.md'])),
      { query: 'resume template' },
      '/proj',
    )
    expect(out.items[0]?.reportFreshness).toEqual({ exportedAt: new Date(2026, 6, 1, 0, 0, 0).getTime() })
  })

  it('derives exportedAt from the file mtime when the filename has no slug', async () => {
    const engine = makeEngine({ items: [hit(id, '/proj', 'resume template font')] })
    const out = await run(
      createRecallTool(
        { callerTreeOnly: false },
        engine,
        undefined,
        listDirOf(['transcript-ca62e005-final.md']),
        () => ({ mtimeMs: 555 }),
      ),
      { query: 'resume template' },
      '/proj',
    )
    expect(out.items[0]?.reportFreshness).toEqual({ exportedAt: 555, stale: true }) // mtime far predates the event
  })

  it('computes freshness on CJK fallback hits the same way', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('session-zh', '/proj')]
    engine.filterResults.set('session-zh', [doc('session-zh', '简历模板的字体已嵌入')])
    const out = await run(
      createRecallTool({ callerTreeOnly: false }, engine, undefined, listDirOf(['transcript-zh-20260701-000000.md'])),
      { query: '字体' },
      '/proj',
    )
    expect(out.items[0]?.artifactPath).toBe('/proj/dsh-transcripts/transcript-zh-20260701-000000.md')
    expect(out.items[0]?.reportFreshness).toEqual({ exportedAt: new Date(2026, 6, 1, 0, 0, 0).getTime(), stale: true })
  })

  it('validates results carrying reportFreshness, and old results without it, against the declared schema', () => {
    const tool = createRecallTool({ callerTreeOnly: false }, makeEngine())
    const item = {
      sessionId: 's2',
      id8: 's2',
      title: null,
      createdAt: 1,
      cwd: '/proj',
      live: false,
      persisted: true,
      artifactPath: '/proj/dsh-transcripts/transcript-s2-20261001-090000.md',
      bestMatch: { seq: 2, type: 't', time: 1, snippet: 'y' },
    }
    const base = {
      query: 'q',
      scope: { cwd: null, allProjects: false, sessionId: null },
      count: 1,
      hasMore: false,
      items: [item],
      nextCursor: null,
      hint: null,
      redacted: 0,
      diagnostics: { source: 'fts', ranked: false },
    }
    // New shape: full, stale-omitted, and field-omitted variants all validate.
    expect(validateJsonSchemaValue(tool.output.schema, {
      ...base,
      items: [{ ...item, reportFreshness: { exportedAt: 1_700_000_000_000, stale: true } }],
    })).toEqual([])
    expect(validateJsonSchemaValue(tool.output.schema, {
      ...base,
      items: [{ ...item, reportFreshness: { exportedAt: 1_700_000_000_000 } }],
    })).toEqual([])
    // Old shape (pre-0.9 results): no field at all, no sub-fields forced.
    expect(validateJsonSchemaValue(tool.output.schema, base)).toEqual([])
  })
})

describe('recall execute — cross-session path', () => {
  it('scopes to the calling agent cwd by default', async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'found the resume template')] })
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: 'resume template' }, '/proj')

    expect(engine.sessionsRequests).toHaveLength(1)
    expect(engine.sessionsRequests[0]?.sessionFilters).toEqual([{ kind: 'cwd', values: ['/proj'] }])
    expect(engine.sessionsRequests[0]?.limit).toBe(5)
    expect(out.scope).toEqual({ cwd: '/proj', allProjects: false, sessionId: null })
    expect(out.count).toBe(1)
    expect(out.items[0]?.title).toBe('title of session-a1')
    expect(out.items[0]?.id8).toBe('a1')
    expect(out.hasMore).toBe(false)
    expect(out.hint).toBeNull()
  })

  it('drops the cwd filter only when all_projects is requested and allowed', async () => {
    const engine = makeEngine({ items: [] })
    const tool = createRecallTool({ callerTreeOnly: false }, engine)

    await run(tool, { query: 'x', all_projects: true }, '/proj')
    expect(engine.sessionsRequests[0]?.sessionFilters).toBeUndefined()

    const strict = createRecallTool({ allowAllProjects: false }, makeEngine({ items: [] }))
    const out = await run(strict, { query: 'x', all_projects: true }, '/proj')
    expect((strict as unknown as { engine: undefined }) && out.scope.allProjects).toBe(false)
  })

  it('omits the filter when the agent has no cwd', async () => {
    const engine = makeEngine({ items: [] })
    await run(createRecallTool({ callerTreeOnly: false }, engine), { query: 'x' }, undefined)
    expect(engine.sessionsRequests[0]?.sessionFilters).toBeUndefined()
  })

  it('clamps limit into the configured max and forwards the cursor', async () => {
    const engine = makeEngine({ items: [], nextCursor: 'next-1' as never })
    const tool = createRecallTool({ callerTreeOnly: false,  defaultLimit: 3, maxLimit: 7  }, engine)
    await run(tool, { query: 'x', limit: 99, cursor: 'opaque-token' })
    expect(engine.sessionsRequests[0]?.limit).toBe(7)
    expect(engine.sessionsRequests[0]?.cursor).toBe('opaque-token')
  })

  it('degrades title failures to untitled rows', async () => {
    const engine = makeEngine({ items: [hit('session-b2', '/proj', 'snip')] })
    engine.titleError = new Error('title backend down')
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: 'x' }, '/proj')
    expect(out.items[0]?.title).toBeNull()
  })

  it('falls back to a zero-hit hint when no session contains the CJK substring', async () => {
    const engine = makeEngine({ items: [] })
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '简历模板' }, '/proj')
    expect(engine.listCalls).toBe(1)
    expect(out.items).toEqual([])
    expect(out.hint).toContain('no matches')

    const ascii = makeEngine({ items: [] })
    const out2 = await run(createRecallTool({ callerTreeOnly: false }, ascii), { query: 'nothing here' }, '/proj')
    expect(out2.hint).toBeNull()
    expect(ascii.listCalls).toBe(0)
  })
})

describe('recall execute — CJK substring fallback', () => {
  it('recovers cross-session CJK substring hits the full-text index missed', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('session-zh1', '/proj'), record('session-zh2', '/proj')]
    engine.filterResults.set('session-zh2', [doc('session-zh2', '宋体字体很好看，就用它了')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '字体' }, '/proj')

    expect(engine.filterCalls).toEqual(['session-zh1', 'session-zh2'])
    expect(out.count).toBe(1)
    expect(out.items[0]?.sessionId).toBe('session-zh2')
    expect(out.items[0]?.bestMatch.snippet).toContain('字体')
    expect(out.hint).toContain('substring scan')
  })

  it('recovers a space-separated multi-word CJK query by ANDing each term as a substring', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('session-zh', '/proj')]
    engine.filterResults.set('session-zh', [doc('session-zh', '正在调简历模板的字体间距')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '简历 模板' }, '/proj')

    expect(engine.filterArgs[0]).toEqual([{ kind: 'text', text: '简历' }, { kind: 'text', text: '模板' }])
    expect(out.count).toBe(1)
    expect(out.items[0]?.sessionId).toBe('session-zh')
    expect(out.items[0]?.bestMatch.snippet).toContain('简历')
  })

  it('respects cwd scope when scanning sessions', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('other-cwd', '/elsewhere'), record('here', '/proj')]
    engine.filterResults.set('here', [doc('here', '字体文件已下载')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '字体' }, '/proj')
    expect(engine.filterCalls).toEqual(['here'])
    expect(out.items[0]?.sessionId).toBe('here')
  })

  it('scans every session when all_projects is allowed', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('other-cwd', '/elsewhere'), record('here', '/proj')]
    engine.filterResults.set('other-cwd', [doc('other-cwd', '字体')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '字体', all_projects: true }, '/proj')
    expect(engine.filterCalls).toEqual(['other-cwd', 'here'])
    expect(out.items[0]?.sessionId).toBe('other-cwd')
  })

  it('sets no continuation cursor after a fallback page', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('s1', '/proj')]
    engine.filterResults.set('s1', [doc('s1', '字体')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '字体' }, '/proj')
    expect(out.hasMore).toBe(false)
    expect(out.nextCursor).toBeNull()
  })

  it('skips the fallback when disabled but still hints', async () => {
    const engine = makeEngine({ items: [] })
    const out = await run(createRecallTool({ callerTreeOnly: false,  cjkFallback: false  }, engine), { query: '字体' }, '/proj')
    expect(engine.listCalls).toBe(0)
    expect(out.hint).toContain('no matches')
  })

  it('recovers within-session CJK hits via filterEvents', async () => {
    const engine = makeEngine({}, { items: [], session: { createdAt: 5, cwd: '/proj' } } as unknown as SessionEventSearchPage)
    engine.filterResults.set('session-zh', [doc('session-zh', '字体已嵌入简历')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '字体', session_id: 'session-zh' }, '/proj')
    expect(engine.filterCalls).toEqual(['session-zh'])
    expect(out.count).toBe(1)
    expect(out.items[0]?.bestMatch.snippet).toContain('字体')
    expect(out.hint).toContain('substring scan')
  })

  it('recovers a multi-word CJK query within one session', async () => {
    const engine = makeEngine({}, { items: [], session: { createdAt: 5, cwd: '/proj' } } as unknown as SessionEventSearchPage)
    engine.filterResults.set('session-zh', [doc('session-zh', '深度学习框架的选择')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '深度学习 框架', session_id: 'session-zh' }, '/proj')
    expect(engine.filterArgs[0]).toEqual([{ kind: 'text', text: '深度学习' }, { kind: 'text', text: '框架' }])
    expect(out.count).toBe(1)
    expect(out.items[0]?.bestMatch.snippet).toContain('深度学习')
  })
})

describe('recall execute — CJK fallback scan quality (v0.8.3)', () => {
  const DAY = 86_400_000
  const BASE = new Date(2026, 8, 1).getTime()

  it('spends the scan budget on the newest sessions (old ones are crowded out)', async () => {
    const engine = makeEngine({ items: [] })
    // listSessions order is oldest-first here: the pre-0.8.3 scan would have
    // spent the whole budget on the two oldest sessions and never reached the
    // fresh one.
    engine.listResult = [
      record('session-ancient', '/proj', BASE),
      record('session-middle', '/proj', BASE + DAY),
      record('session-fresh', '/proj', BASE + 2 * DAY),
    ]
    engine.filterResults.set('session-ancient', [doc('session-ancient', '古老的字体记录')])
    engine.filterResults.set('session-fresh', [doc('session-fresh', '最新的字体记录')])
    const out = await run(createRecallTool({ callerTreeOnly: false, cjkFallbackScanMax: 2 }, engine), { query: '字体' }, '/proj')

    expect(engine.filterCalls).toEqual(['session-fresh', 'session-middle']) // newest first; ancient never probed
    expect(out.items.map((item) => item.sessionId)).toEqual(['session-fresh'])
    expect(out.diagnostics).toEqual({ source: 'cjk-fallback', scanned: 2, scanBudget: 2, ranked: false, truncated: false })
  })

  it('scans the full budget before truncating to the page limit', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [
      record('session-1', '/proj', BASE),
      record('session-2', '/proj', BASE + DAY),
      record('session-3', '/proj', BASE + 2 * DAY),
    ]
    for (const id of ['session-1', 'session-2', 'session-3']) engine.filterResults.set(id, [doc(id, '字体命中')])
    const out = await run(
      createRecallTool({ callerTreeOnly: false, cjkFallbackScanMax: 10 }, engine),
      { query: '字体', limit: 2 },
      '/proj',
    )

    expect(engine.filterCalls).toHaveLength(3) // no early break once the limit is reached
    expect(out.diagnostics).toEqual({ source: 'cjk-fallback', scanned: 3, scanBudget: 10, ranked: false, truncated: true })
    expect(out.count).toBe(2)
    expect(out.items.map((item) => item.sessionId)).toEqual(['session-3', 'session-2']) // newest first
  })

  it('probes sessions with bounded concurrency and stays deterministic (same input → same output)', async () => {
    const buildEngine = (): FakeEngine => {
      const engine = makeEngine({ items: [] })
      engine.listResult = Array.from({ length: 12 }, (_, i) => record(`session-${String(i).padStart(2, '0')}`, '/proj', BASE + i * DAY))
      for (const i of [0, 3, 7, 11]) {
        const id = `session-${String(i).padStart(2, '0')}`
        engine.filterResults.set(id, [doc(id, `字体出现在 ${id}`)])
      }
      return engine
    }
    const first = await run(createRecallTool({ callerTreeOnly: false }, buildEngine()), { query: '字体' }, '/proj')
    const second = await run(createRecallTool({ callerTreeOnly: false }, buildEngine()), { query: '字体' }, '/proj')
    expect(first.items).toEqual(second.items) // identical inputs → identical pages
    expect(first.items.map((item) => item.sessionId)).toEqual(['session-11', 'session-07', 'session-03', 'session-00'])

    // Concurrency proof: track how many filterEvents probes are in flight at
    // once — parallel (> 1) but bounded (≤ the 8-per-batch chunk size).
    const engine = buildEngine()
    let inFlight = 0
    let maxInFlight = 0
    engine.filterEvents = async (sessionId: string, filters: readonly SessionEventResultFilter[]) => {
      engine.filterCalls.push(sessionId)
      engine.filterArgs.push(filters)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return engine.filterResults.get(sessionId) ?? []
    }
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '字体' }, '/proj')
    expect(engine.filterCalls).toHaveLength(12)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(8)
    expect(out.items).toEqual(first.items)
  })
})

describe('recall execute — within-session path', () => {
  it('searches events and skips title enrichment', async () => {
    const engine = makeEngine()
    const tool = createRecallTool({ callerTreeOnly: false }, engine)
    const out = await run(tool, { query: 'font', session_id: 'session-ca62e005' }, '/proj')

    expect(engine.eventsRequests).toHaveLength(1)
    expect(engine.eventsRequests[0]?.sessionId).toBe('session-ca62e005')
    expect(engine.sessionsRequests).toHaveLength(0)
    expect(engine.titleCalls).toHaveLength(0)
    expect(out.scope.sessionId).toBe('session-ca62e005')
    expect(out.items).toEqual([])
    expect(out.hint).toBeNull() // empty canned event page, ASCII query
  })
})

describe('recall execute — scope policy (v0.4)', () => {
  it('filters denylisted cwds out of cross-session hits', async () => {
    const engine = makeEngine({ items: [hit('session-ok', '/proj', 'found it'), hit('session-no', '/secret', 'found it too')] })
    const out = await run(createRecallTool({ cwdDenylist: ['/secret'] , callerTreeOnly: false}, engine), { query: 'found' }, '/proj')
    expect(out.count).toBe(1)
    expect(out.items[0]?.sessionId).toBe('session-ok')
  })

  it('restricts to the allowlist in cross-session hits', async () => {
    const engine = makeEngine({ items: [hit('session-ok', '/proj', 'found it'), hit('session-no', '/elsewhere', 'found it too')] })
    const out = await run(createRecallTool({ cwdAllowlist: ['/proj'] , callerTreeOnly: false}, engine), { query: 'found' }, '/proj')
    expect(out.count).toBe(1)
    expect(out.items[0]?.cwd).toBe('/proj')
  })

  it('blocks the current cwd itself when it is not allowed', async () => {
    const engine = makeEngine({ items: [hit('session-x', '/proj', 'found it')] })
    const out = await run(createRecallTool({ cwdAllowlist: ['/other'] , callerTreeOnly: false}, engine), { query: 'found' }, '/proj')
    expect(out.count).toBe(0)
    expect(out.hint).toContain('scope policy')
    expect(engine.sessionsRequests).toHaveLength(0)
  })

  it('blocks a session_id call into a denylisted cwd', async () => {
    const engine = makeEngine({}, { items: [doc('session-s', 'hello')], session: { createdAt: 5, cwd: '/secret' } } as unknown as SessionEventSearchPage)
    const out = await run(createRecallTool({ cwdDenylist: ['/secret'] , callerTreeOnly: false}, engine), { query: 'hello', session_id: 'session-s' }, '/proj')
    expect(out.count).toBe(0)
    expect(out.hint).toContain('scope policy')
  })

  it('skips denylisted candidates in the CJK fallback scan', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('session-keep', '/proj'), record('session-skip', '/secret')]
    engine.filterResults.set('session-keep', [doc('session-keep', '改简历字体')])
    const out = await run(createRecallTool({ cwdDenylist: ['/secret'] , callerTreeOnly: false}, engine), { query: '字体' }, '/proj')
    expect(out.count).toBe(1)
    expect(engine.filterCalls).toEqual(['session-keep'])
  })

  it('matches cwd policy after normalization: trailing slash and .. cannot dodge (v0.8.3)', async () => {
    // Denylist written with a trailing slash still blocks the session whose
    // header cwd lacks it, through the cross-session hit filter.
    const engine = makeEngine({ items: [hit('session-ok', '/proj', 'found it'), hit('session-no', '/secret', 'found it too')] })
    const out = await run(createRecallTool({ cwdDenylist: ['/secret/'] , callerTreeOnly: false}, engine), { query: 'found' }, '/proj')
    expect(out.count).toBe(1)
    expect(out.items[0]?.sessionId).toBe('session-ok')

    // A caller cwd written with a traversal shape still passes an allowlist
    // entry it resolves to, and the backend session filter sees the
    // normalized path.
    const allowed = makeEngine({ items: [] })
    await run(createRecallTool({ cwdAllowlist: ['/real/proj'] , callerTreeOnly: false}, allowed), { query: 'x' }, '/real/other/../proj')
    expect(allowed.sessionsRequests[0]?.sessionFilters).toEqual([{ kind: 'cwd', values: ['/real/proj'] }])

    // The same traversal shape pointing OUTSIDE the allowlist is refused.
    const refused = makeEngine({ items: [] })
    const outRefused = await run(createRecallTool({ cwdAllowlist: ['/real/proj'] , callerTreeOnly: false}, refused), { query: 'x' }, '/real/other/../elsewhere')
    expect(outRefused.count).toBe(0)
    expect(outRefused.hint).toContain('scope policy')
    expect(refused.sessionsRequests).toHaveLength(0)
  })
})

describe('recall execute — all_projects gate (v0.4)', () => {
  it("policy 'deny' ignores all_projects and explains it", async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'found it')] })
    const out = await run(createRecallTool({ allProjectsPolicy: 'deny' , callerTreeOnly: false}, engine), { query: 'found', all_projects: true }, '/proj')
    expect(engine.sessionsRequests[0]?.sessionFilters).toEqual([{ kind: 'cwd', values: ['/proj'] }])
    expect(out.hint).toContain('all_projects was ignored')
  })

  it("policy 'confirm' honors an approved widen", async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/elsewhere', 'found it')] })
    const asks: string[] = []
    const out = await run(
      createRecallTool({ callerTreeOnly: false,  allProjectsPolicy: 'confirm'  }, engine, async (_exec, reason) => {
        asks.push(reason)
        return 'allowed-once'
      }),
      { query: 'found', all_projects: true },
      '/proj',
    )
    expect(asks).toHaveLength(1)
    expect(asks[0]).toContain('ALL project directories')
    expect(engine.sessionsRequests[0]?.sessionFilters).toBeUndefined()
    expect(out.scope.allProjects).toBe(true)
    expect(out.hint).toBeNull()
  })

  it("policy 'confirm' falls back to cwd scope on rejection", async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'found it')] })
    const out = await run(
      createRecallTool({ callerTreeOnly: false,  allProjectsPolicy: 'confirm'  }, engine, async () => 'rejected'),
      { query: 'found', all_projects: true },
      '/proj',
    )
    expect(engine.sessionsRequests[0]?.sessionFilters).toEqual([{ kind: 'cwd', values: ['/proj'] }])
    expect(out.hint).toContain('not approved (rejected)')
  })

  it("policy 'confirm' fails closed without an approver", async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'found it')] })
    const out = await run(createRecallTool({ allProjectsPolicy: 'confirm' , callerTreeOnly: false}, engine), { query: 'found', all_projects: true }, '/proj')
    expect(out.hint).toContain('not approved (unavailable)')
    expect(engine.sessionsRequests[0]?.sessionFilters).toEqual([{ kind: 'cwd', values: ['/proj'] }])
  })

  it("policy 'confirm' swallows a throwing approver as unavailable", async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'found it')] })
    const out = await run(
      createRecallTool({ callerTreeOnly: false,  allProjectsPolicy: 'confirm'  }, engine, async () => {
        throw new Error('answerer exploded')
      }),
      { query: 'found', all_projects: true },
      '/proj',
    )
    expect(out.hint).toContain('not approved (unavailable)')
  })
})

describe('recall execute — redaction (v0.4)', () => {
  it('masks secrets in snippets and reports the count', async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'used Bearer abc123def456ghi789jkl here')] })
    const out = await run(createRecallTool({ redactionMode: 'mask' , callerTreeOnly: false}, engine), { query: 'used' }, '/proj')
    expect(out.items[0]?.bestMatch.snippet).toContain('Bearer [REDACTED]')
    expect(out.items[0]?.bestMatch.snippet).not.toContain('abc123def456ghi789jkl')
    expect(out.redacted).toBeGreaterThanOrEqual(1)
    expect(out.hint).toContain('redacted')
  })

  it('hashes the same secret to the same marker across hits', async () => {
    const engine = makeEngine({
      items: [hit('session-a1', '/proj', 'used Bearer abc123def456ghi789jkl here'), hit('session-b2', '/proj', 'again Bearer abc123def456ghi789jkl here')],
    })
    const out = await run(createRecallTool({ callerTreeOnly: false,  redactionMode: 'hash'  }, engine), { query: 'Bearer' }, '/proj')
    const markers = out.items.map((item) => item.bestMatch.snippet.match(/#[0-9a-f]{8}/)?.[0])
    expect(markers[0]).toBeDefined()
    expect(markers[0]).toBe(markers[1])
    expect(out.redacted).toBe(2)
  })

  it('does nothing in off mode', async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'used Bearer abc123def456ghi789jkl here')] })
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: 'used' }, '/proj')
    expect(out.items[0]?.bestMatch.snippet).toContain('abc123def456ghi789jkl')
    expect(out.redacted).toBe(0)
    expect(out.hint).toBeNull()
  })
})

describe('recall execute — ranking & diagnostics (v0.5)', () => {
  const DAY = 86_400_000

  function hitAt(id: string, cwd: string | undefined, snippet: string, matchTime: number): SessionSearchHit {
    const base = hit(id, cwd, snippet)
    ;(base.bestMatch as { time: number }).time = matchTime
    return base
  }

  it('reports fts source and no ranking by default', async () => {
    const engine = makeEngine({ items: [hit('session-a1', '/proj', 'found it')] })
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: 'found' }, '/proj')
    expect(out.diagnostics).toEqual({ source: 'fts', ranked: false })
  })

  it('reorders hits under recency decay: newer overtakes older rank-1', async () => {
    const engine = makeEngine({
      items: [hitAt('session-old', '/proj', 'found it', Date.now() - 90 * DAY), hitAt('session-new', '/proj', 'found it', Date.now() - DAY)],
    })
    const out = await run(createRecallTool({ callerTreeOnly: false,  recencyHalfLifeDays: 30  }, engine), { query: 'found' }, '/proj')
    expect(out.items.map((item) => item.sessionId)).toEqual(['session-new', 'session-old'])
    expect(out.diagnostics).toMatchObject({ source: 'fts', ranked: true })
  })

  it('floats pinned cwd hits to the top', async () => {
    const engine = makeEngine({ items: [hitAt('session-plain', '/plain', 'found it', Date.now()), hitAt('session-pin', '/proj', 'found it', Date.now() - 300 * DAY)] })
    const out = await run(createRecallTool({ callerTreeOnly: false,  pinnedCwds: ['/proj']  }, engine), { query: 'found' }, '/proj')
    expect(out.items.map((item) => item.sessionId)).toEqual(['session-pin', 'session-plain'])
  })

  it('keeps backend order when ranking is configured but disabled by value', async () => {
    const engine = makeEngine({ items: [hitAt('session-old', '/proj', 'found it', Date.now() - 90 * DAY), hitAt('session-new', '/proj', 'found it', Date.now() - DAY)] })
    const out = await run(createRecallTool({ callerTreeOnly: false,  recencyHalfLifeDays: 0  }, engine), { query: 'found' }, '/proj')
    expect(out.items.map((item) => item.sessionId)).toEqual(['session-old', 'session-new'])
    expect(out.diagnostics).toEqual({ source: 'fts', ranked: false })
  })

  it('diagnoses the cross-session cjk fallback with scan counts', async () => {
    const engine = makeEngine({ items: [] })
    engine.listResult = [record('session-keep', '/proj'), record('session-keep2', '/proj')]
    engine.filterResults.set('session-keep', [doc('session-keep', '改简历字体')])
    const out = await run(createRecallTool({ callerTreeOnly: false,  cjkFallbackScanMax: 10  }, engine), { query: '字体' }, '/proj')
    // scanned counts VISITED sessions (both), not matching ones (one); the
    // whole budget is scanned before truncating to the page limit, and
    // `truncated` reports whether that cut dropped collected matches.
    expect(out.diagnostics).toEqual({ source: 'cjk-fallback', scanned: 2, scanBudget: 10, ranked: false, truncated: false })
    expect(out.count).toBe(1)
  })

  it('diagnoses the within-session scan path', async () => {
    const engine = makeEngine({}, { items: [], session: { createdAt: 5, cwd: '/proj' } } as unknown as SessionEventSearchPage)
    engine.filterResults.set('session-zh', [doc('session-zh', '深度学习框架')])
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '深度学习', session_id: 'session-zh' }, '/proj')
    expect(out.diagnostics).toEqual({ source: 'session-scan', scanned: 1, scanBudget: 50, ranked: false })
  })

  it('diagnostics is null when the call fails before searching', async () => {
    const engine = makeEngine()
    ;(engine as { searchSessions: unknown }).searchSessions = async () => {
      throw Object.assign(new Error('off'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
    }
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: 'x' }, '/proj')
    expect(out.diagnostics).toBeNull()
  })
})

describe('recall execute — failures degrade to hint text', () => {
  async function failureHint(error: unknown, args: Record<string, unknown> = { query: 'x' }): Promise<string> {
    const engine = makeEngine()
    ;(engine as { searchSessions: unknown }).searchSessions = async () => {
      throw error
    }
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), args, '/proj')
    return out.hint ?? ''
  }

  it('explains a disabled index', async () => {
    const hint = await failureHint(Object.assign(new Error('off'), { code: 'SESSION_QUERY_SEARCH_DISABLED' }))
    expect(hint).toContain('full-text search is disabled')
  })

  it('explains stale cursors', async () => {
    const hint = await failureHint(Object.assign(new Error('stale'), { code: 'SESSION_QUERY_STALE_CURSOR' }))
    expect(hint).toContain('cursor is stale')
  })

  it('explains unknown sessions', async () => {
    const engine = makeEngine()
    ;(engine as { searchEvents: unknown }).searchEvents = async () => {
      throw Object.assign(new Error('missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    }
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: 'x', session_id: 'nope' }, '/proj')
    expect(out.hint).toContain('no session with that session_id')
  })

  it('surfaces unexpected errors with their message', async () => {
    const hint = await failureHint(new Error('backend exploded'))
    expect(hint).toContain('backend exploded')
  })

  it('rejects an empty query before touching the engine', async () => {
    const engine = makeEngine()
    const out = await run(createRecallTool({ callerTreeOnly: false }, engine), { query: '   ' }, '/proj')
    expect(out.hint).toContain('non-empty')
    expect(engine.sessionsRequests).toHaveLength(0)
  })
})

describe('caller authorization', () => {
  it('filters cross-session results to the caller lineage', async () => {
    const engine = makeEngine({ items: [
      hit('caller-session-1', '/proj', 'my own session'),
      hit('session-outside', '/proj', 'sibling agent session'),
    ] })
    // Set lineage: only caller + its descendants
    engine.lineageTraceResult = {
      target: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
      ancestors: [],
      descendants: [],
      complete: true,
      root: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
    } as unknown as SessionLineageTrace

    const tool = createRecallTool(undefined, engine)
    const result = await tool.execute({ query: 'session' }, makeExec('/proj', 'caller-session-1')) as RecallResult
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.sessionId).toBe('caller-session-1')
  })

  it('blocks a session_id outside the caller lineage', async () => {
    const engine = makeEngine()
    engine.lineageTraceResult = {
      target: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
      ancestors: [],
      descendants: [],
      complete: true,
      root: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
    } as unknown as SessionLineageTrace

    const tool = createRecallTool(undefined, engine)
    const result = await tool.execute({ query: 'x', session_id: 'session-outside' }, makeExec('/proj', 'caller-session-1')) as RecallResult
    expect(result.items).toHaveLength(0)
    expect(result.hint).toContain('outside your conversation lineage')
  })

  it('allows cross-tree access when callerTreeOnly is false', async () => {
    const engine = makeEngine({ items: [
      hit('session-caller', '/proj', 'A'),
      hit('session-outside', '/proj', 'B'),
    ] })
    engine.lineageTraceResult = {
      target: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
      ancestors: [],
      descendants: [],
      complete: true,
      root: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
    } as unknown as SessionLineageTrace

    const tool = createRecallTool({ callerTreeOnly: false }, engine)
    const result = await tool.execute({ query: 'session' }, makeExec('/proj', 'caller-session-1')) as RecallResult
    expect(result.items).toHaveLength(2)
  })
})

describe('lineageFailurePolicy (v0.8.3)', () => {
  function brokenTraceEngine(): FakeEngine {
    const engine = makeEngine({ items: [hit('session-any', '/proj', 'found it')] })
    engine.traceSession = async () => {
      throw new Error('lineage backend down')
    }
    return engine
  }

  it("refuses cross-session results when 'closed' and lineage tracing fails", async () => {
    const engine = brokenTraceEngine()
    const tool = createRecallTool({ lineageFailurePolicy: 'closed' }, engine)
    const out = await tool.execute({ query: 'found' }, makeExec('/proj', 'caller-session-1')) as RecallResult
    expect(out.items).toEqual([])
    expect(out.count).toBe(0)
    expect(out.hint).toContain("lineageFailurePolicy: 'closed'")
    expect(out.hint).toContain('fail-closed')
    expect(out.diagnostics).toBeNull()
    expect(engine.sessionsRequests).toHaveLength(0) // refused before searching
  })

  it("refuses a session_id read when 'closed' and lineage tracing fails", async () => {
    const engine = brokenTraceEngine()
    const tool = createRecallTool({ lineageFailurePolicy: 'closed' }, engine)
    const out = await tool.execute({ query: 'found', session_id: 'session-any' }, makeExec('/proj', 'caller-session-1')) as RecallResult
    expect(out.items).toEqual([])
    expect(out.hint).toContain("lineageFailurePolicy: 'closed'")
    expect(engine.eventsRequests).toHaveLength(0)
  })

  it("keeps the pre-0.8.3 fail-open behavior when 'open' and lineage tracing fails", async () => {
    const engine = brokenTraceEngine()
    const tool = createRecallTool({ lineageFailurePolicy: 'open' }, engine)
    const out = await tool.execute({ query: 'found' }, makeExec('/proj', 'caller-session-1')) as RecallResult
    expect(out.items).toHaveLength(1) // degraded to allow-everything, no refusal
    expect(out.hint).toBeNull()
  })

  it("searches normally when 'closed' but lineage tracing succeeds", async () => {
    const engine = makeEngine({ items: [hit('caller-session-1', '/proj', 'found it')] })
    engine.lineageTraceResult = {
      target: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
      ancestors: [],
      descendants: [],
      complete: true,
      root: { header: { id: 'caller-session-1', createdAt: 0, version: 0 } },
    } as unknown as SessionLineageTrace
    const tool = createRecallTool({ lineageFailurePolicy: 'closed' }, engine)
    const out = await tool.execute({ query: 'found' }, makeExec('/proj', 'caller-session-1')) as RecallResult
    expect(out.items).toHaveLength(1)
    expect(out.hint).toBeNull()
  })
})

describe('dimension filters (v0.7)', () => {
  const NOW = new Date('2026-09-15T00:00:00Z').getTime()

  function dimHit(id: string, over: Partial<{ type: string; snippet: string; time: number; createdAt: number }>) {
    const time = over.time ?? NOW - 86_400_000
    return hit(id, '/proj', over.snippet ?? 'text', 1) && undefined
  }

  it('since_days drops older sessions', async () => {
    // Real clock: the runtime cutoff is Date.now()-based, so a fixed base date
    // would cross the window boundary once real time advances past it.
    const now = Date.now()
    const oldTime = now - 30 * 86_400_000
    const freshTime = now - 1 * 86_400_000
    const mk = (id: string, time: number) => ({
      sessionId: id, id8: id, title: null, createdAt: time, cwd: '/proj', live: true, persisted: true,
      bestMatch: { seq: 1, type: 'user/message', time, snippet: 'found the resume' },
    })
    const tool = createRecallTool({ callerTreeOnly: false }, makeEngine({ items: [
      { header: { version: 1, id: 'session-old', createdAt: oldTime }, live: true, persisted: true,
        bestMatch: { sessionId: 'session-old', seq: 1, type: 'user/message', time: oldTime, surface: 'current', snippet: 'found the resume' } } as never,
      { header: { version: 1, id: 'session-new', createdAt: freshTime }, live: true, persisted: true,
        bestMatch: { sessionId: 'session-new', seq: 1, type: 'user/message', time: freshTime, surface: 'current', snippet: 'found the resume' } } as never,
    ] }))
    const result = await tool.execute({ query: 'resume', since_days: 7 }, makeExec('/proj')) as RecallResult
    expect(result.items.map((i) => i.sessionId)).toEqual(['session-new'])
    expect(mk('x', 1)).toBeDefined() // silence unused
  })

  it('tools filter keeps only tool events matching the needle', async () => {
    const tool = createRecallTool({ callerTreeOnly: false }, makeEngine({ items: [
      { header: { version: 1, id: 's-tool', createdAt: NOW }, live: true, persisted: true,
        bestMatch: { sessionId: 's-tool', seq: 2, type: 'tool/result', time: NOW, surface: 'current', snippet: 'bash: ls -la done' } } as never,
      { header: { version: 1, id: 's-chat', createdAt: NOW }, live: true, persisted: true,
        bestMatch: { sessionId: 's-chat', seq: 3, type: 'user/message', time: NOW, surface: 'current', snippet: 'run bash please' } } as never,
    ] }))
    const result = await tool.execute({ query: 'bash', tools: ['bash'] }, makeExec('/proj')) as RecallResult
    expect(result.items.map((i) => i.sessionId)).toEqual(['s-tool'])
  })

  it('errors_only keeps only failed tool results', async () => {
    const tool = createRecallTool({ callerTreeOnly: false }, makeEngine({ items: [
      { header: { version: 1, id: 's-err', createdAt: NOW }, live: true, persisted: true,
        bestMatch: { sessionId: 's-err', seq: 2, type: 'tool/result', time: NOW, surface: 'current', snippet: 'bash: [error] exit 1' } } as never,
      { header: { version: 1, id: 's-ok', createdAt: NOW }, live: true, persisted: true,
        bestMatch: { sessionId: 's-ok', seq: 3, type: 'tool/result', time: NOW, surface: 'current', snippet: 'bash: all good' } } as never,
    ] }))
    const result = await tool.execute({ query: 'bash', errors_only: true }, makeExec('/proj')) as RecallResult
    expect(result.items.map((i) => i.sessionId)).toEqual(['s-err'])
  })

  it('no filters set returns everything', async () => {
    const tool = createRecallTool({ callerTreeOnly: false }, makeEngine({ items: [
      { header: { version: 1, id: 's-a', createdAt: NOW - 400 * 86_400_000 }, live: true, persisted: true,
        bestMatch: { sessionId: 's-a', seq: 1, type: 'user/message', time: NOW - 400 * 86_400_000, surface: 'current', snippet: 'old' } } as never,
    ] }))
    const result = await tool.execute({ query: 'old' }, makeExec('/proj')) as RecallResult
    expect(result.items).toHaveLength(1)
  })
})
