import { describe, expect, it } from 'vitest'
import { clamp, firstLineClipped, formatDate, hasCJK, id8, normalizeQuery, snippetAround, splitTerms } from '../src/util.ts'

describe('id8', () => {
  it('strips the web-profile session- prefix before slicing', () => {
    expect(id8('session-ca62e005-4274-477b-bd56-9d9508edb040')).toBe('ca62e005')
  })

  it('slices ids without the prefix as-is', () => {
    expect(id8('abcdef1234')).toBe('abcdef12')
    expect(id8('short')).toBe('short')
  })
})

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(0, 1, 10)).toBe(1)
    expect(clamp(5, 1, 10)).toBe(5)
    expect(clamp(99, 1, 10)).toBe(10)
  })
})

describe('hasCJK', () => {
  it('detects CJK ideographs, kana, and hangul', () => {
    expect(hasCJK('修复简历模板')).toBe(true)
    expect(hasCJK('フィックス')).toBe(true)
    expect(hasCJK('이력서')).toBe(true)
  })

  it('passes plain ASCII and code identifiers through', () => {
    expect(hasCJK('fix the resume template')).toBe(false)
    expect(hasCJK('sessionQuery_42')).toBe(false)
  })
})

describe('normalizeQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeQuery('  the   font \n we chose ')).toBe('the font we chose')
  })

  it('leaves clean queries untouched', () => {
    expect(normalizeQuery('resume template')).toBe('resume template')
  })
})

describe('splitTerms', () => {
  it('splits on whitespace and drops empty pieces', () => {
    expect(splitTerms('简历 模板')).toEqual(['简历', '模板'])
    expect(splitTerms('  a  b   c ')).toEqual(['a', 'b', 'c'])
  })

  it('returns a single term for unspaced input', () => {
    expect(splitTerms('简历模板')).toEqual(['简历模板'])
  })

  it('returns an empty list for whitespace-only input', () => {
    expect(splitTerms('   \n ')).toEqual([])
  })
})

describe('formatDate', () => {
  it('formats local YYYY-MM-DD with padding', () => {
    const d = new Date(2026, 7, 5)
    expect(formatDate(d.getTime())).toBe('2026-08-05')
  })
})

describe('firstLineClipped', () => {
  it('keeps only the first line', () => {
    expect(firstLineClipped('line one\nline two', 40)).toBe('line one')
  })

  it('strips control characters', () => {
    expect(firstLineClipped('a\tb', 40)).toBe('ab')
  })

  it('clips to the limit in code points', () => {
    expect(firstLineClipped('简历模板字体调整记录', 4)).toBe('简历模板')
  })

  it('returns empty for empty input', () => {
    expect(firstLineClipped('', 10)).toBe('')
  })
})

describe('snippetAround', () => {
  it('clips a window around the first CJK match and marks the cut with an ellipsis', () => {
    const s = snippetAround('宋体字体很好看，就用它了', '字体', 8)
    expect(s).toContain('字体')
    expect(s.endsWith('…')).toBe(true)
  })

  it('adds a leading ellipsis when the match is deep into the text', () => {
    const s = snippetAround('一二三四五六七八九十字体很好', '字体', 8)
    expect(s.startsWith('…')).toBe(true)
    expect(s).toContain('字体')
  })

  it('is case-insensitive and flattens whitespace', () => {
    expect(snippetAround('abc\nDEF ghi', 'def', 20)).toBe('abc DEF ghi')
  })

  it('falls back to a head clip when the query is absent', () => {
    expect(snippetAround('long text with no match', 'zzz', 8)).toBe('long tex')
    expect(snippetAround('abc', '', 8)).toBe('abc')
  })
})
