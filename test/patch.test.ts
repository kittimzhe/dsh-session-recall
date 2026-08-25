import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'

const patchPath = new URL('../cordis.patch.yml', import.meta.url)

/** The dsh loader evaluates `!!js` expressions; tests only need structure, so
 *  the tag parses to a marker string carrying the raw expression. */
const dshSchema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    construct: (data) => `«js» ${String(data)}`,
    represent: undefined,
  }),
])

describe('cordis.patch.yml', () => {
  const entries = yaml.load(readFileSync(fileURLToPath(patchPath), 'utf8'), { schema: dshSchema }) as Array<Record<string, unknown>>

  it('parses to a top-level array of two entries', () => {
    expect(Array.isArray(entries)).toBe(true)
    expect(entries).toHaveLength(2)
  })

  it('overrides the shipped session-query-sqlite row onto a persistent first-search index', () => {
    const sqlite = entries.find((e) => e.id === 'session-query-sqlite')
    expect(sqlite).toBeDefined()
    const config = sqlite?.config as { openAt?: string; path?: string }
    expect(config.openAt).toBe('first-search')
    expect(config.path).toContain('«js» dshHomePath')
    expect(config.path).toContain("('session-recall', 'index.db')")
  })

  it('inserts the plugin row requiring the tools and sessionQuery services', () => {
    const insert = entries.find((e) => 'insert' in e) as { insert: Array<{ id: string; name: string }> }
    expect(insert.insert).toEqual([{ id: 'session-recall', name: 'dsh-session-recall' }])
  })
})
