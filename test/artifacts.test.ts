import { describe, expect, it } from 'vitest'
import {
  EXPORTED_ARTIFACTS_DIR,
  latestExportedArtifact,
  latestExportedArtifactInfo,
  parseSlugTimestamp,
  reportFreshnessField,
  type ExportedArtifact,
  type ListDir,
  type StatFile,
} from '../src/artifacts.ts'

function fakeDir(mapping: Record<string, string[]>): ListDir {
  return (dir) => {
    const found = mapping[dir]
    if (found != null) return found
    const err = new Error(`ENOENT: ${dir}`) as NodeJS.ErrnoException
    err.code = 'ENOENT'
    throw err
  }
}

describe('latestExportedArtifact (#8)', () => {
  const dir = `/proj/${EXPORTED_ARTIFACTS_DIR}`

  it('returns the newest transcript artifact for the session id', () => {
    const listDir = fakeDir({
      [dir]: [
        'transcript-ca62e005-20260901-120000.md',
        'transcript-ca62e005-20261001-090000.html',
        'transcript-other99-20261001-090000.md',
      ],
    })
    expect(latestExportedArtifact('/proj', 'ca62e005', listDir)).toBe(
      `/proj/${EXPORTED_ARTIFACTS_DIR}/transcript-ca62e005-20261001-090000.html`,
    )
  })

  it('considers bundle artifacts and picks the overall newest', () => {
    const listDir = fakeDir({
      [dir]: ['transcript-ca62e005-20261001-090000.md', 'bundle-ca62e005-20261002-130000.zip'],
    })
    expect(latestExportedArtifact('/proj', 'ca62e005', listDir)).toBe(
      `/proj/${EXPORTED_ARTIFACTS_DIR}/bundle-ca62e005-20261002-130000.zip`,
    )
  })

  it('returns null when the directory exists but has no artifact for the id', () => {
    const listDir = fakeDir({ [dir]: ['transcript-other99-20261001-090000.md'] })
    expect(latestExportedArtifact('/proj', 'ca62e005', listDir)).toBeNull()
  })

  it('returns null, not a fake path, when dsh-transcripts does not exist', () => {
    expect(latestExportedArtifact('/proj', 'ca62e005', fakeDir({}))).toBeNull()
  })

  it('returns null for a missing cwd or id', () => {
    const listDir = fakeDir({ [dir]: [] })
    expect(latestExportedArtifact(null, 'ca62e005', listDir)).toBeNull()
    expect(latestExportedArtifact('/proj', '', listDir)).toBeNull()
  })
})

describe('parseSlugTimestamp (P1 freshness)', () => {
  it('parses the yyyymmdd-hhmmss slug in the local timezone', () => {
    expect(parseSlugTimestamp('transcript-ca62e005-20261001-090000.md')).toBe(new Date(2026, 9, 1, 9, 0, 0).getTime())
    expect(parseSlugTimestamp('bundle-ca62e005-20261125-163000.zip')).toBe(new Date(2026, 10, 25, 16, 30, 0).getTime())
  })

  it('returns null when the name carries no timestamp slug', () => {
    expect(parseSlugTimestamp('transcript-ca62e005.md')).toBeNull()
    expect(parseSlugTimestamp('bundle-ca62e005-20261001.zip')).toBeNull()
  })

  it('rejects impossible calendar values instead of letting Date roll them over', () => {
    expect(parseSlugTimestamp('transcript-ca62e005-20261301-090000.md')).toBeNull() // month 13
    expect(parseSlugTimestamp('transcript-ca62e005-20260231-090000.md')).toBeNull() // Feb 31
    expect(parseSlugTimestamp('transcript-ca62e005-20261001-250000.md')).toBeNull() // hour 25
  })
})

describe('latestExportedArtifactInfo (P1 freshness)', () => {
  const dir = `/proj/${EXPORTED_ARTIFACTS_DIR}`

  it('carries exportedAt parsed from the newest artifact\'s slug (selection order unchanged)', () => {
    const listDir = fakeDir({
      [dir]: ['transcript-ca62e005-20260901-120000.md', 'bundle-ca62e005-20261001-090000.zip'],
    })
    expect(latestExportedArtifactInfo('/proj', 'ca62e005', listDir)).toEqual({
      path: `${dir}/bundle-ca62e005-20261001-090000.zip`,
      exportedAt: new Date(2026, 9, 1, 9, 0, 0).getTime(),
    })
  })

  it('falls back to the file mtime when the filename has no slug', () => {
    const listDir = fakeDir({ [dir]: ['transcript-ca62e005-final.md'] })
    const statFile: StatFile = (path) => (path === `${dir}/transcript-ca62e005-final.md` ? { mtimeMs: 1234 } : null)
    expect(latestExportedArtifactInfo('/proj', 'ca62e005', listDir, statFile)).toEqual({
      path: `${dir}/transcript-ca62e005-final.md`,
      exportedAt: 1234,
    })
  })

  it('falls back to mtime when the slug exists but is impossible', () => {
    const listDir = fakeDir({ [dir]: ['transcript-ca62e005-20261301-090000.md'] })
    const statFile: StatFile = () => ({ mtimeMs: 4321 })
    expect(latestExportedArtifactInfo('/proj', 'ca62e005', listDir, statFile)).toEqual({
      path: `${dir}/transcript-ca62e005-20261301-090000.md`,
      exportedAt: 4321,
    })
  })

  it('yields null exportedAt when neither the slug nor the mtime is available', () => {
    const listDir = fakeDir({ [dir]: ['transcript-ca62e005-final.md'] })
    expect(latestExportedArtifactInfo('/proj', 'ca62e005', listDir, () => null)).toEqual({
      path: `${dir}/transcript-ca62e005-final.md`,
      exportedAt: null,
    })
  })

  it('returns nulls — never fabricated values — when no artifact exists', () => {
    expect(latestExportedArtifactInfo('/proj', 'ca62e005', fakeDir({}))).toEqual({ path: null, exportedAt: null })
    expect(latestExportedArtifactInfo(null, 'ca62e005', fakeDir({}))).toEqual({ path: null, exportedAt: null })
  })

  it('keeps the path-only compat wrapper in sync with info.path', () => {
    const listDir = fakeDir({ [dir]: ['transcript-ca62e005-20261001-090000.md'] })
    expect(latestExportedArtifact('/proj', 'ca62e005', listDir)).toBe(latestExportedArtifactInfo('/proj', 'ca62e005', listDir).path)
  })
})

describe('reportFreshnessField (P1 freshness)', () => {
  const artifact: ExportedArtifact = { path: '/proj/dsh-transcripts/transcript-ca62e005-20260701-000000.md', exportedAt: 1_000 }

  it('classifies stale when the export predates the session activity', () => {
    expect(reportFreshnessField(artifact, 2_000)).toEqual({ exportedAt: 1_000, stale: true })
  })

  it('classifies fresh when the export is at least as new as the session activity', () => {
    expect(reportFreshnessField(artifact, 1_000)).toEqual({ exportedAt: 1_000, stale: false })
    expect(reportFreshnessField(artifact, 999)).toEqual({ exportedAt: 1_000, stale: false })
  })

  it('omits stale when the activity source is missing (0) or not a finite time', () => {
    expect(reportFreshnessField(artifact, 0)).toEqual({ exportedAt: 1_000 })
    expect(reportFreshnessField(artifact, Number.NaN)).toEqual({ exportedAt: 1_000 })
  })

  it('omits stale when exportedAt is unknown (no slug, no mtime)', () => {
    expect(reportFreshnessField({ path: '/p/x.md', exportedAt: null }, 2_000)).toBeUndefined()
  })

  it('is absent entirely without an artifact', () => {
    expect(reportFreshnessField({ path: null, exportedAt: null }, 2_000)).toBeUndefined()
  })
})
