/** Native/model-facing text and UI-card projections of a validated RecallResult. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { RecallResult } from './types.ts'
import { formatDate, firstLineClipped, hasCJK } from './util.ts'

const SNIPPET_CHARS = 120

function sessionLabel(result: RecallResult, index: number): string {
  const item = result.items[index]
  if (!item) return String(index + 1)
  const title = item.title ? firstLineClipped(item.title, 48) : `untitled ${item.id8}`
  return `${title} (${item.id8}, ${formatDate(item.createdAt)}${item.live ? ', live' : ''})`
}

/**
 * Render the compact Markdown the model reads: one header line, one line per
 * session hit with its best-match event, and a continuation pointer.
 */
export function renderRecallText(result: RecallResult): string {
  const scopeParts: string[] = []
  if (result.scope.sessionId != null) scopeParts.push(`session ${result.scope.sessionId}`)
  else if (result.scope.allProjects) scopeParts.push('all projects')
  else if (result.scope.cwd != null) scopeParts.push(`cwd ${result.scope.cwd}`)

  const lines: string[] = []
  const noun = result.scope.sessionId != null ? 'events' : 'sessions'
  lines.push(`Recall "${result.query}" — ${result.count} ${noun}${scopeParts.length > 0 ? ` (${scopeParts.join(', ')})` : ''}`)

  if (result.items.length === 0) {
    lines.push('No matches.')
  } else {
    result.items.forEach((item, i) => {
      lines.push(`${i + 1}. ${sessionLabel(result, i)}`)
      lines.push(`   ${item.bestMatch.type} #${item.bestMatch.seq}: ${firstLineClipped(item.bestMatch.snippet, SNIPPET_CHARS)}`)
    })
  }

  if (result.hasMore && result.nextCursor != null) lines.push(`More: re-call with cursor="${result.nextCursor}"`)
  if (result.hint != null) lines.push(`Hint: ${result.hint}`)
  return lines.join('\n')
}

/** Content-block projection required by the tool's output declaration. */
export function recallContentBlocks(result: RecallResult): ContentBlock[] {
  return [{ type: 'text', text: renderRecallText(result) }]
}

/** Replayable presentation payload consumed by `presentResult` on the UI plane. */
export function recallPresentationMeta(result: RecallResult): JsonValue {
  return {
    query: result.query,
    count: result.count,
    hasMore: result.hasMore,
    items: result.items.map((item) => ({
      sessionId: item.sessionId,
      id8: item.id8,
      label: item.title ?? `untitled ${item.id8}`,
      createdAt: item.createdAt,
      seq: item.bestMatch.seq,
      snippet: firstLineClipped(item.bestMatch.snippet, SNIPPET_CHARS),
    })),
  } as JsonValue
}

/**
 * Hint shown when the CJK substring fallback succeeded — explains why the
 * full-text index missed the query and reports how many sessions matched.
 */
export function cjkFallbackHint(matched: number, enabled: boolean): string | null {
  if (!enabled || matched <= 0) return null
  return (
    `full-text search returned no CJK hits (SQLite FTS5 tokenizer "unicode61" does not segment CJK), ` +
    `so an exact substring scan over session text was used instead and matched ${matched} session(s).`
  )
}

/** The zero-hit hint, shown only when both the full-text and substring paths miss. */
export function cjkZeroHitHint(query: string, zeroHits: boolean, enabled: boolean): string | null {
  if (!enabled || !zeroHits || !hasCJK(query)) return null
  return `no matches for this CJK query. Try a shorter phrase, or an English/code term.`
}
