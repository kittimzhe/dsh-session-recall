import { describe, expect, it } from 'vitest'
import { normalizeRedactionMode, redactText } from '../src/redact.ts'

describe('redactText', () => {
  it('is a no-op in off mode', () => {
    const secret = 'Bearer abc123def456ghi789jkl'
    expect(redactText(secret, 'off')).toEqual({ text: secret, count: 0 })
  })

  it('masks bearer headers, prefixed keys, and emails', () => {
    const text = [
      'auth: Bearer abc123def456ghi789jkl',
      'key sk-abcdefghijklmnopqrstuvwxyz123456',
      'pat ghp_' + 'a'.repeat(36),
      'aws AKIAIOSFODNN7EXAMPLE',
      'mail me@example.com wrote',
    ].join(' | ')
    const out = redactText(text, 'mask')
    expect(out.count).toBeGreaterThanOrEqual(5)
    expect(out.text).toContain('Bearer [REDACTED]')
    expect(out.text).toContain('[REDACTED]') // sk- and ghp_ and AKIA
    expect(out.text).toContain('[EMAIL]')
    expect(out.text).not.toContain('abc123def456ghi789jkl')
    expect(out.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
    expect(out.text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(out.text).not.toContain('me@example.com')
  })

  it('masks private key blocks as one unit', () => {
    const text = 'sign with -----BEGIN RSA PRIVATE KEY-----\nMIIEow\nmore\n-----END RSA PRIVATE KEY----- now'
    const out = redactText(text, 'mask')
    expect(out.text).toBe('sign with [PRIVATE KEY REDACTED] now')
    expect(out.count).toBe(1)
  })

  it('hashes deterministically: same secret, same marker; different, different', () => {
    const a = redactText('Bearer abc123def456ghi789jkl twice', 'hash')
    const b = redactText('Bearer abc123def456ghi789jkl twice', 'hash')
    const c = redactText('Bearer zzz999zzz888zzz777yyy twice', 'hash')
    expect(a.text).toBe(b.text)
    expect(a.text).not.toBe(c.text)
    expect(a.text).toMatch(/#[0-9a-f]{8}/)
    expect(a.text).not.toContain('abc123def456ghi789jkl')
    expect(a.count).toBe(1)
  })

  it('leaves plain text untouched', () => {
    const text = 'we fixed the resume template font in /src/resume.css'
    const out = redactText(text, 'mask')
    expect(out).toEqual({ text, count: 0 })
  })
})

describe('normalizeRedactionMode', () => {
  it('passes valid modes through', () => {
    for (const mode of ['off', 'mask', 'hash'] as const) expect(normalizeRedactionMode(mode)).toBe(mode)
  })

  it('falls back to off on anything else', () => {
    expect(normalizeRedactionMode(undefined)).toBe('off')
    expect(normalizeRedactionMode('loud')).toBe('off')
    expect(normalizeRedactionMode(42)).toBe('off')
    expect(normalizeRedactionMode(null)).toBe('off')
  })
})

describe('AWS key ids and Slack tokens (#6)', () => {
  const slackBot = 'xoxb-' + '1234567890-'.repeat(3) + 'abcdef'
  const slackApp = 'xoxa-' + '2345678901-'.repeat(3) + 'bcdefg'
  const slackLegacy = 'xoxp-' + '3456789012-'.repeat(3) + 'cdefgh'
  const awsKey = 'AKIA' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 16)

  it('masks AWS access key ids and every Slack token family', () => {
    const text = `bot ${slackBot} app ${slackApp} legacy ${slackLegacy} aws ${awsKey}`
    const out = redactText(text, 'mask')
    expect(out.count).toBeGreaterThanOrEqual(4)
    expect(out.text).not.toContain(slackBot)
    expect(out.text).not.toContain(slackApp)
    expect(out.text).not.toContain(slackLegacy)
    expect(out.text).not.toContain(awsKey)
  })

  it('hashes the same shapes deterministically without leaking them', () => {
    const out = redactText(`bot ${slackBot} aws ${awsKey}`, 'hash')
    expect(out.text).toMatch(/#[0-9a-f]{8}/)
    expect(out.text).not.toContain(slackBot)
    expect(out.text).not.toContain(awsKey)
    expect(redactText(`bot ${slackBot}`, 'hash').text).toBe(redactText(`bot ${slackBot}`, 'hash').text)
  })
})
