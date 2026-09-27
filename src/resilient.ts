/**
 * Resilient raw-log scan: the recall tool's degraded mode.
 *
 * When the session index itself is unavailable — most notably
 * `SESSION_QUERY_PERSISTENCE_FAILED`, where one un-migratable session
 * artifact fails every indexed search (see deepseek-harness discussion
 * #7995: the v0→v1 migration gate rejects `subagent/descriptor` version 2,
 * the only version the writer emits) — recall degrades to scanning the
 * persisted session logs directly instead of failing the whole call.
 *
 * Design rules, in order:
 * 1. Never throw on a bad session: a session that cannot be decompressed or
 *    parsed is counted as unreadable and skipped. The whole point of this
 *    module is that no single artifact can take the search down.
 * 2. Scope first, scan second: the header line (cwd, createdAt) is read
 *    before the event scan, so cwd/time/session_id filters cost one line.
 * 3. Same match semantics as the indexed path: whitespace-separated terms,
 *    all must match; ASCII terms match on word boundaries, CJK terms match
 *    as substrings.
 *
 * @module dsh-session-recall/resilient
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RecallItem } from './types.ts'
import { id8, snippetAround, splitTerms } from './util.ts'

/** The bundled pure-JS zstd decompressor, loaded once on first use. */
type Fzstd = { decompress: (input: Uint8Array) => Uint8Array, Decompress: new (cb: (chunk: Uint8Array) => void) => { push: (data: Uint8Array) => void } }
let fzstdModule: Fzstd | null = null
async function getFzstd(): Promise<Fzstd> {
  if (fzstdModule == null) fzstdModule = (await import('fzstd')) as unknown as Fzstd
  return fzstdModule
}

/** Default scan budget (sessions visited per degraded call). */
export const RAW_SCAN_DEFAULT_MAX_SESSIONS = 300
/** Hard ceiling for the scan budget. */
export const RAW_SCAN_MAX_SESSIONS_MAX = 2000
/** Characters of context around the first matched term. */
const SNIPPET_CHARS = 200

/** Where the harness persists sessions: `$DSH_HOME/sessions` (default `~/.dsh/sessions`). */
export function discoverSessionsRoot(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'sessions')
}

/** True when an error means "the index is unavailable", not "the query was bad". */
export function isIndexOutage(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code: unknown }).code) === 'SESSION_QUERY_PERSISTENCE_FAILED'
  )
}

export interface RawScanOptions {
  /** Sessions root (workspace directories below this). */
  root: string
  /** Normalized search query; whitespace-separated terms, all must match. */
  query: string
  /** Restrict to sessions started in this cwd (unless `allProjects`). */
  cwd: string | null
  /** Ignore the cwd scope. */
  allProjects: boolean
  /** Restrict to one session id (the `session_id` argument), or null. */
  sessionId: string | null
  /** Only sessions newer than this many days (0 = no time filter). */
  sinceDays: number
  /** Only tool events whose tool name contains one of these substrings. */
  tools: readonly string[] | null
  /** Only failed tool calls (tool results carrying an error flag). */
  errorsOnly: boolean
  /** Max sessions to return. */
  limit: number
  /** Scan budget: max sessions visited. */
  maxSessions: number
  /** Wall-clock ceiling in ms for the whole pass (0 = no ceiling). */
  maxDurationMs: number
  /** Compressed-size ceiling per session log; larger logs are skipped (pure-JS zstd is slow). */
  maxSessionBytes: number
}

export interface RawScanResult {
  items: RecallItem[]
  /** Sessions whose events were actually scanned. */
  scanned: number
  /** The scan budget that applied. */
  budget: number
  /** Sessions skipped because their log could not be decompressed or parsed. */
  unreadable: number
  /** False when the scan stopped early (budget/ceiling): results cover the newest sessions only. */
  coveredAll: boolean
  /** In-scope sessions skipped because their log exceeded `maxSessionBytes`. */
  skippedOversized: number
  /** Session directories that existed under the root when the scan started. */
  totalCandidates: number
}

/** Tolerant single-line JSON parse: garbage lines yield null, never throw. */
function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

interface EventFacts {
  text: string
  tool: string | null
  isError: boolean
}

/** Pull the searchable text, tool name, and error flag out of one event. */
function eventFacts(event: Record<string, unknown>): EventFacts | null {
  const data = event['data']
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const type = typeof event['type'] === 'string' ? event['type'] : ''

  const texts: string[] = []
  const pushBlocks = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (typeof block === 'string') {
        texts.push(block)
      } else if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>
        if (typeof b['text'] === 'string') texts.push(b['text'])
        // tool-result blocks nest their payload one level deeper
        if (Array.isArray(b['content'])) pushBlocks(b['content'])
      }
    }
  }

  let tool: string | null = null
  if (type === 'tool/call' && typeof record['name'] === 'string') {
    tool = record['name']
    if (typeof record['arguments'] === 'string') texts.push(record['arguments'])
  }
  const message = record['message']
  if (typeof message === 'object' && message !== null) {
    const m = message as Record<string, unknown>
    if (Array.isArray(m['content'])) pushBlocks(m['content'])
  }
  if (Array.isArray(record['content'])) pushBlocks(record['content'])
  // Session-level labels (e.g. subagent/descriptor `label`) are high-value
  // recall targets even when the event carries no message content.
  if (texts.length === 0 && typeof record['label'] === 'string') texts.push(record['label'])

  const isError =
    (typeof message === 'object' && message !== null
      && ((message as Record<string, unknown>)['isError'] === true
        || (message as Record<string, unknown>)['is_error'] === true))
    || record['isError'] === true
    || record['is_error'] === true

  const text = texts.join('\n')
  if (text === '' && tool == null) return null
  return { text, tool, isError }
}

/** All terms must match: ASCII on word boundaries, CJK as substrings. */
function textMatches(text: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false
  const haystack = text.toLowerCase()
  for (const term of terms) {
    const needle = term.toLowerCase()
    if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/.test(term)) {
      if (!haystack.includes(needle)) return false
    } else {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'u').test(haystack)) return false
    }
  }
  return true
}

interface SessionCandidate {
  dir: string
  mtimeMs: number
}

/** List session directories under the root, newest first. */
function listSessionDirs(root: string): SessionCandidate[] {
  const out: SessionCandidate[] = []
  let workspaces: string[] = []
  try {
    workspaces = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return out
  }
  for (const ws of workspaces) {
    const wsDir = join(root, ws)
    let sessions: string[] = []
    try {
      sessions = readdirSync(wsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      continue
    }
    for (const id of sessions) {
      const dir = join(wsDir, id)
      try {
        out.push({ dir, mtimeMs: statSync(dir).mtimeMs })
      } catch {
        // unreadable metadata: skip silently
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/** Decompress one session log fully. Plain `.jsonl` is read as-is; `.zstd` via fzstd. */
async function readSessionLog(dir: string): Promise<Buffer | null> {
  for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
    let bytes: Buffer
    try {
      bytes = readFileSync(join(dir, name))
    } catch {
      continue
    }
    if (name.endsWith('.zstd')) {
      try {
        const fzstd = await getFzstd()
        return Buffer.from(fzstd.decompress(new Uint8Array(bytes)))
      } catch {
        return null
      }
    }
    return bytes
  }
  return null
}

/**
 * Read just the session header line without decompressing the whole log:
 * zstd input is pushed through the streaming decompressor in small chunks
 * and stops at the first newline. Costs milliseconds per session, which is
 * what makes scanning a whole store affordable.
 */
async function readSessionHeaderStreaming(dir: string): Promise<SessionHeader | null> {
  const fromLine = (line: string): SessionHeader | null => {
    const header = parseLine(line)
    if (header == null) return null
    const id = typeof header['id'] === 'string' ? header['id'] : null
    if (id == null) return null
    return {
      id,
      createdAt: typeof header['createdAt'] === 'number' ? header['createdAt'] : Number.NaN,
      cwd: typeof header['cwd'] === 'string' ? header['cwd'] : null,
    }
  }
  for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
    const path = join(dir, name)
    let fd: number
    try {
      fd = openSync(path, 'r')
    } catch {
      continue
    }
    try {
      const chunks: Buffer[] = []
      const input = Buffer.alloc(16 * 1024)
      let fzstd: Fzstd | null = null
      for (;;) {
        let bytes: number
        try {
          bytes = readSync(fd, input, 0, input.length, null)
        } catch {
          return null
        }
        if (bytes <= 0) break
        if (name.endsWith('.zstd')) {
          if (fzstd == null) {
            try {
              fzstd = await getFzstd()
            } catch {
              return null
            }
          }
          try {
            const d = new fzstd.Decompress((chunk) => { chunks.push(Buffer.from(chunk)) })
            d.push(input.subarray(0, bytes))
          } catch {
            return null // corrupt stream: unreadable
          }
        } else {
          chunks.push(Buffer.from(input.subarray(0, bytes)))
        }
        const soFar = Buffer.concat(chunks)
        const nl = soFar.indexOf(10)
        if (nl >= 0) return fromLine(soFar.subarray(0, nl).toString('utf-8'))
        if (soFar.length > 1024 * 1024) return null // no header line in 1MB: not ours
      }
      return fromLine(Buffer.concat(chunks).toString('utf-8'))
    } finally {
      closeSync(fd)
    }
  }
  return null
}

/** The persisted log file of a session dir: path + compressed size, or null when none exists. */
function sessionLogPath(dir: string): { path: string, size: number } | null {
  for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
    try {
      const path = join(dir, name)
      return { path, size: statSync(path).size }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Cheap superset gate: every term must appear in the decompressed bytes
 * (exact or lowercase form) before the expensive line-by-line parse runs.
 * Word-boundary semantics are still enforced by `textMatches` later.
 */
function bytesMentionAllTerms(buf: Buffer, terms: readonly string[]): boolean {
  for (const term of terms) {
    if (buf.indexOf(term, 0, 'utf-8') < 0 && buf.indexOf(term.toLowerCase(), 0, 'utf-8') < 0) return false
  }
  return true
}

interface SessionHeader {
  id: string
  createdAt: number
  cwd: string | null
}

/**
 * Scan persisted session logs directly, honoring the same scope filters as
 * the indexed path. Never throws for per-session problems; returns what it
 * found plus scan counters.
 *
 * Cost model (newest-first): the header line of every session is read
 * through the streaming decompressor (milliseconds each); only sessions
 * passing the scope filters are decompressed fully, and only sessions whose
 * bytes mention every term are parsed line by line. `maxDurationMs` puts a
 * wall-clock ceiling on the pass — when it trips, `coveredAll` is false and
 * the caller should say so (results cover the newest sessions only).
 */
export async function rawScanSessions(options: RawScanOptions): Promise<RawScanResult> {
  const terms = splitTerms(options.query)
  const sinceMs =
    options.sinceDays > 0 ? Date.now() - options.sinceDays * 24 * 60 * 60 * 1000 : 0
  const toolsFilter =
    options.tools != null && options.tools.length > 0
      ? options.tools.map((t) => t.toLowerCase())
      : null
  const deadline = options.maxDurationMs > 0 ? Date.now() + options.maxDurationMs : 0

  const candidates = listSessionDirs(options.root)
  const items: RecallItem[] = []
  let scanned = 0
  let unreadable = 0
  let skippedOversized = 0
  let coveredAll = true

  for (const candidate of candidates) {
    if (items.length >= options.limit) break
    if (scanned >= options.maxSessions || (deadline > 0 && Date.now() > deadline)) {
      coveredAll = false
      break
    }

    const logInfo = sessionLogPath(candidate.dir)
    if (logInfo == null) continue // no persisted log yet (e.g. live session): neither hit nor unreadable
    const header = await readSessionHeaderStreaming(candidate.dir)
    if (header == null) {
      unreadable += 1
      continue
    }
    if (options.sessionId != null && header.id !== options.sessionId) continue
    if (!options.allProjects && options.cwd != null && header.cwd !== options.cwd) continue
    if (sinceMs > 0 && !(header.createdAt >= sinceMs)) continue
    if (logInfo.size > options.maxSessionBytes) {
      skippedOversized += 1
      continue
    }

    const log = await readSessionLog(candidate.dir)
    if (log == null) {
      unreadable += 1
      continue
    }
    scanned += 1
    if (!bytesMentionAllTerms(log, terms)) continue

    // tool-name map for tool/result events (their name lives on the call)
    const callTools = new Map<string, string>()
    let best: { seq: number; type: string; time: number; text: string } | null = null

    for (const line of log.toString('utf-8').split('\n')) {
      if (line === '') continue
      const event = parseLine(line)
      if (event == null) continue // THE resilient rule: bad lines are skipped, not fatal
      const type = typeof event['type'] === 'string' ? event['type'] : ''
      const facts = eventFacts(event)
      if (facts == null) continue

      let tool = facts.tool
      if (tool == null && type === 'tool/result') {
        const source = (event['data'] as Record<string, unknown> | null)?.['message']
        const callId =
          typeof source === 'object' && source !== null
            ? ((source as Record<string, unknown>)['source'] as Record<string, unknown> | undefined)?.['callId']
            : undefined
        if (typeof callId === 'string') tool = callTools.get(callId) ?? null
      } else if (tool != null) {
        const data = event['data'] as Record<string, unknown> | null
        const callId = typeof data?.['callId'] === 'string' ? (data['callId'] as string) : null
        if (callId != null) callTools.set(callId, tool)
      }

      if (toolsFilter != null || options.errorsOnly) {
        const isToolEvent = type === 'tool/call' || type === 'tool/result'
        if (!isToolEvent) continue
        if (toolsFilter != null && (tool == null || !toolsFilter.some((t) => tool!.toLowerCase().includes(t)))) continue
        if (options.errorsOnly && !(type === 'tool/result' && facts.isError)) continue
      }
      if (!textMatches(facts.text, terms)) continue

      const seq = typeof event['seq'] === 'number' ? event['seq'] : 0
      const time = typeof event['time'] === 'number' ? event['time'] : 0
      if (best == null || seq < best.seq) best = { seq, type, time, text: facts.text }
    }

    if (best != null) {
      items.push({
        sessionId: header.id,
        id8: id8(header.id),
        title: null,
        createdAt: Number.isFinite(header.createdAt) ? header.createdAt : 0,
        cwd: header.cwd,
        live: false,
        persisted: true,
        bestMatch: {
          seq: best.seq,
          type: best.type,
          time: best.time,
          snippet: snippetAround(best.text, terms[0] ?? '', SNIPPET_CHARS),
        },
      })
    }
  }

  return { items, scanned, budget: options.maxSessions, unreadable, skippedOversized, coveredAll, totalCandidates: candidates.length }
}
