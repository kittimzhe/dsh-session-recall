import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRecallTool, type RecallQueryEngine } from '../src/tool.ts'
import { discoverSessionsRoot, isIndexOutage, rawScanSessions } from '../src/resilient.ts'
import type { RecallArgs, RecallResult } from '../src/types.ts'

/** Minimal fake engine: every search throws the #7995 outage. */
function outageEngine(): RecallQueryEngine {
  const outage = Object.assign(
    new Error('session-search persistence observation failed: subagent/descriptor 6 uses unsupported descriptor version 2; source v0 artifact remains unchanged'),
    { code: 'SESSION_QUERY_PERSISTENCE_FAILED' },
  )
  const rejecting = () => Promise.reject(outage)
  return {
    searchSessions: rejecting,
    searchEvents: rejecting,
    readTitleSnapshots: () => Promise.resolve([]),
    listSessions: () => Promise.resolve([]),
    filterEvents: rejecting,
    traceSession: () => Promise.reject(new Error('unavailable')),
  }
}

async function runRecall(args: Partial<RecallArgs>): Promise<RecallResult> {
  const tool = createRecallTool({ callerTreeOnly: false }, outageEngine())
  const def = tool as unknown as { execute: (a: RecallArgs, e: unknown) => Promise<RecallResult> }
  return def.execute({ query: 'needle', ...args } as RecallArgs, {
    agent: { session: { id: 'session-live', header: { cwd: '/tmp/proj-a' } } },
  } as never)
}

const CWD_A = '/tmp/proj-a'
const CWD_B = '/tmp/proj-b'
let root: string

function writeSession(ws: string, id: string, lines: string[]): void {
  const dir = join(root, ws, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.jsonl'), lines.join('\n') + '\n')
}

const now = Date.now()
const header = (id: string, cwd: string, createdAt: number): string =>
  JSON.stringify({ type: 'session', version: 0, id, createdAt, cwd })
const event = (seq: number, data: Record<string, unknown>, type = 'user/message'): string =>
  JSON.stringify({ type, seq, time: now + seq, data })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'recall-raw-'))
  // discoverSessionsRoot() resolves to $DSH_HOME/sessions — fixtures live there.
  process.env.DSH_HOME = root
  root = join(root, 'sessions')
  mkdirSync(root, { recursive: true })
  writeSession('ws-a', 'session-aaa11111-aaaa', [
    header('session-aaa11111-aaaa', CWD_A, now - 1000),
    event(1, { content: [{ type: 'text', text: 'we found the needle in the haystack' }] }),
  ])
  // The #7995 poison: a v2 subagent descriptor plus a match later in the log.
  writeSession('ws-a', 'session-bbb22222-bbbb', [
    header('session-bbb22222-bbbb', CWD_A, now - 2000),
    event(6, { version: 2, mode: 'one-shot', provider: 'spawn', label: '扫描Python仓库文档机会' }, 'subagent/descriptor'),
    event(9, { content: [{ type: 'text', text: 'another needle here' }] }),
  ])
  // Different project: must be excluded without all_projects.
  writeSession('ws-b', 'session-ccc33333-cccc', [
    header('session-ccc33333-cccc', CWD_B, now - 3000),
    event(1, { content: [{ type: 'text', text: 'needle in another project' }] }),
  ])
  // Too old for since_days=1.
  writeSession('ws-a', 'session-ddd44444-dddd', [
    header('session-ddd44444-dddd', CWD_A, now - 40 * 24 * 60 * 60 * 1000),
    event(1, { content: [{ type: 'text', text: 'stale needle' }] }),
  ])
  // Garbage line in the middle must not kill the scan.
  writeSession('ws-a', 'session-eee55555-eeee', [
    header('session-eee55555-eeee', CWD_A, now - 4000),
    '{this is not json',
    event(2, { content: [{ type: 'text', text: 'needle after garbage' }] }),
  ])
  // A failed bash call for errors_only / tools filters.
  writeSession('ws-a', 'session-fff66666-ffff', [
    header('session-fff66666-ffff', CWD_A, now - 5000),
    JSON.stringify({ type: 'tool/call', seq: 1, time: now, data: { callId: 'call_1', name: 'bash', arguments: '{"command":"grep needle /x"}' } }),
    JSON.stringify({ type: 'tool/result', seq: 2, time: now, data: { message: { isError: true, source: { kind: 'tool', callId: 'call_1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'Error: grep: /x: needle not found' }] }] } } }),
  ])
  // Unreadable: corrupt zstd bytes.
  const poisonDir = join(root, 'ws-a', 'session-ggg77777-gggg')
  mkdirSync(poisonDir, { recursive: true })
  writeFileSync(join(poisonDir, 'session.jsonl.zstd'), Buffer.from([0xde, 0xad, 0xbe, 0xef]))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isIndexOutage', () => {
  it('recognizes the persistence-failure code and rejects others', () => {
    expect(isIndexOutage(Object.assign(new Error('x'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' }))).toBe(true)
    expect(isIndexOutage(Object.assign(new Error('x'), { code: 'SESSION_QUERY_SEARCH_DISABLED' }))).toBe(false)
    expect(isIndexOutage(new Error('plain'))).toBe(false)
  })
})

describe('rawScanSessions', () => {
  it('finds matches across sessions, skipping poison lines and unreadable logs', async () => {
    const result = await rawScanSessions({
      root, query: 'needle', cwd: CWD_A, allProjects: false, sessionId: null,
      sinceDays: 0, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024,
    })
    const ids = result.items.map((item) => item.sessionId).sort()
    expect(ids).toEqual(['session-aaa11111-aaaa', 'session-bbb22222-bbbb', 'session-ddd44444-dddd', 'session-eee55555-eeee', 'session-fff66666-ffff'])
    expect(result.unreadable).toBe(1)
    expect(result.scanned).toBeGreaterThanOrEqual(4)
    // The #7995 session matched on the event AFTER the v2 descriptor.
    const poison = result.items.find((item) => item.sessionId === 'session-bbb22222-bbbb')
    expect(poison?.bestMatch.seq).toBe(9)
  })

  it('excludes other projects unless allProjects', async () => {
    const scoped = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: false, sessionId: null, sinceDays: 0, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(scoped.items.some((item) => item.sessionId === 'session-ccc33333-cccc')).toBe(false)
    const wide = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: true, sessionId: null, sinceDays: 0, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(wide.items.some((item) => item.sessionId === 'session-ccc33333-cccc')).toBe(true)
  })

  it('honors sinceDays and sessionId', async () => {
    const fresh = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: true, sessionId: null, sinceDays: 1, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(fresh.items.some((item) => item.sessionId === 'session-ddd44444-dddd')).toBe(false)
    const one = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: true, sessionId: 'session-eee55555-eeee', sinceDays: 0, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(one.items.map((item) => item.sessionId)).toEqual(['session-eee55555-eeee'])
  })

  it('supports tools and errors_only filters', async () => {
    const byTool = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: true, sessionId: null, sinceDays: 0, tools: ['bash'], errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(byTool.items.map((item) => item.sessionId)).toEqual(['session-fff66666-ffff'])
    const errorsOnly = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: true, sessionId: null, sinceDays: 0, tools: null, errorsOnly: true, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(errorsOnly.items.map((item) => item.sessionId)).toEqual(['session-fff66666-ffff'])
    expect(errorsOnly.items[0]?.bestMatch.seq).toBe(2)
  })

  it('matches CJK terms as substrings', async () => {
    const result = await rawScanSessions({ root, query: '扫描', cwd: CWD_A, allProjects: true, sessionId: null, sinceDays: 0, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(result.items.map((item) => item.sessionId)).toEqual(['session-bbb22222-bbbb'])
  })

  it('skips oversized logs and reports them', async () => {
    // A session whose log exceeds a tiny byte cap.
    writeSession('ws-a', 'session-hhh88888-hhhh', [
      header('session-hhh88888-hhhh', CWD_A, now - 6000),
      event(1, { content: [{ type: 'text', text: 'needle inside an oversized log ' + 'x'.repeat(4096) }] }),
    ])
    const result = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: true, sessionId: null, sinceDays: 0, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 1024 })
    expect(result.skippedOversized).toBe(1)
    expect(result.items.some((item) => item.sessionId === 'session-hhh88888-hhhh')).toBe(false)
    // The same session is found once the cap allows it.
    const relaxed = await rawScanSessions({ root, query: 'needle', cwd: CWD_A, allProjects: true, sessionId: null, sinceDays: 0, tools: null, errorsOnly: false, limit: 10, maxSessions: 50, maxDurationMs: 30_000, maxSessionBytes: 8 * 1024 * 1024 })
    expect(relaxed.items.some((item) => item.sessionId === 'session-hhh88888-hhhh')).toBe(true)
    expect(relaxed.skippedOversized).toBe(0)
  })
})

describe('recall tool degraded mode', () => {
  it('returns raw-scan results instead of failing when the index is down', async () => {
    const result = await runRecall({})
    expect(result.diagnostics?.source).toBe('raw-scan')
    expect(result.count).toBeGreaterThan(0)
    expect(result.items.every((item) => item.cwd === CWD_A)).toBe(true)
    expect(result.hint).toContain('degraded mode')
  })

  it('still reports the error when the degraded scan is disabled', async () => {
    const tool = createRecallTool({ callerTreeOnly: false, rawScanFallback: false }, outageEngine())
    const def = tool as unknown as { execute: (a: RecallArgs, e: unknown) => Promise<RecallResult> }
    const result = await def.execute({ query: 'needle' } as RecallArgs, {
      agent: { session: { id: 'session-live', header: { cwd: CWD_A } } },
    } as never)
    expect(result.diagnostics).toBeNull()
    expect(result.hint).toContain('SESSION_QUERY_PERSISTENCE_FAILED')
  })

  it('honors all_projects=false scoping in degraded mode', async () => {
    const result = await runRecall({ all_projects: false })
    expect(result.items.some((item) => item.sessionId === 'session-ccc33333-cccc')).toBe(false)
  })
})
