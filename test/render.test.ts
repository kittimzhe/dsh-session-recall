import { describe, expect, it } from 'vitest'
import { cjkFallbackHint, cjkZeroHitHint, recallContentBlocks, recallPresentationMeta, renderRecallText } from '../src/render.ts'
import type { RecallResult } from '../src/types.ts'

function result(overwrites: Partial<RecallResult> = {}): RecallResult {
  return {
    query: 'resume template',
    scope: { cwd: '/Users/me/resume', allProjects: false, sessionId: null },
    count: 2,
    hasMore: false,
    redacted: 0,
    items: [
      {
        sessionId: 'session-ca62e005-4274-477b-bd56-9d9508edb040',
        id8: 'ca62e005',
        title: '修复简历模板字体',
        createdAt: new Date(2026, 7, 20).getTime(),
        cwd: '/Users/me/resume',
        live: true,
        persisted: true,
        bestMatch: { seq: 42, type: 'user/message', time: new Date(2026, 7, 20).getTime(), snippet: 'please fix the resume template font' },
      },
      {
        sessionId: 'session-e5f60712-0000-0000-0000-000000000000',
        id8: 'e5f60712',
        title: null,
        createdAt: new Date(2026, 7, 18).getTime(),
        cwd: '/Users/me/resume',
        live: false,
        persisted: true,
        bestMatch: { seq: 7, type: 'assistant/message', time: new Date(2026, 7, 18).getTime(), snippet: 'the template now uses serif headings' },
      },
    ],
    nextCursor: null,
    hint: null,
    ...overwrites,
  }
}

describe('renderRecallText', () => {
  it('renders a header, per-session lines, and snippets', () => {
    const text = renderRecallText(result())
    expect(text).toContain('Recall "resume template" — 2 sessions (cwd /Users/me/resume)')
    expect(text).toContain('1. 修复简历模板字体 (ca62e005, 2026-08-20, live)')
    expect(text).toContain('   user/message #42: please fix the resume template font')
    expect(text).toContain('2. untitled e5f60712 (e5f60712, 2026-08-18)')
  })

  it('labels all-projects scope', () => {
    const text = renderRecallText(result({ scope: { cwd: null, allProjects: true, sessionId: null } }))
    expect(text).toContain('(all projects)')
  })

  it('labels within-session scope with the events noun', () => {
    const text = renderRecallText(result({ scope: { cwd: '/x', allProjects: false, sessionId: 'abc' } }))
    expect(text).toContain('— 2 events (session abc)')
  })

  it('reports no matches and omits a continuation without hasMore', () => {
    const text = renderRecallText(result({ count: 0, items: [], hasMore: false, nextCursor: null }))
    expect(text).toContain('— 0 sessions')
    expect(text).toContain('No matches.')
    expect(text).not.toContain('More:')
  })

  it('prints the continuation pointer only with both hasMore and a cursor', () => {
    expect(renderRecallText(result({ hasMore: true, nextCursor: 'cur-1' }))).toContain('More: re-call with cursor="cur-1"')
    expect(renderRecallText(result({ hasMore: true, nextCursor: null }))).not.toContain('More:')
  })

  it('appends the hint line when present', () => {
    const text = renderRecallText(result({ hint: 'try shorter keywords' }))
    expect(text).toContain('Hint: try shorter keywords')
  })
})

describe('recallContentBlocks', () => {
  it('wraps the rendered text in one text block', () => {
    const blocks = recallContentBlocks(result())
    expect(blocks).toEqual([{ type: 'text', text: renderRecallText(result()) }])
  })
})

describe('recallPresentationMeta', () => {
  it('carries per-item display fields for the UI card', () => {
    const meta = recallPresentationMeta(result()) as { query: string; items: Array<{ label: string; sessionId: string; seq: number; snippet: string }> }
    expect(meta.query).toBe('resume template')
    expect(meta.items).toHaveLength(2)
    expect(meta.items[0]?.label).toBe('修复简历模板字体')
    expect(meta.items[1]?.label).toBe('untitled e5f60712')
    expect(meta.items[1]?.seq).toBe(7)
  })
})

describe('cjkZeroHitHint', () => {
  it('fires only on zero hits with CJK present and enabled', () => {
    expect(cjkZeroHitHint('简历模板', true, true)).toContain('no matches')
    expect(cjkZeroHitHint('简历模板', false, true)).toBeNull()
    expect(cjkZeroHitHint('简历模板', true, false)).toBeNull()
    expect(cjkZeroHitHint('resume', true, true)).toBeNull()
  })
})

describe('cjkFallbackHint', () => {
  it('fires only when the substring fallback actually matched sessions', () => {
    expect(cjkFallbackHint(3, true)).toContain('substring scan')
    expect(cjkFallbackHint(3, true)).toContain('3 session')
    expect(cjkFallbackHint(0, true)).toBeNull()
    expect(cjkFallbackHint(3, false)).toBeNull()
  })
})
