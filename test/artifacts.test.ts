import { describe, expect, it } from 'vitest'
import { EXPORTED_ARTIFACTS_DIR, latestExportedArtifact, type ListDir } from '../src/artifacts.ts'

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
