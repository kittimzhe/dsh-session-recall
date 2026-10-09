# dsh-session-recall

English | [中文](https://github.com/kittimzhe/dsh-session-recall/blob/main/README.zh.md)

[![CI](https://github.com/kittimzhe/dsh-session-recall/actions/workflows/test.yml/badge.svg)](https://github.com/kittimzhe/dsh-session-recall/actions/workflows/test.yml) [![npm version](https://img.shields.io/npm/v/dsh-session-recall)](https://www.npmjs.com/package/dsh-session-recall) [![npm downloads](https://img.shields.io/npm/dm/dsh-session-recall)](https://www.npmjs.com/package/dsh-session-recall) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/kittimzhe/dsh-session-recall/blob/main/LICENSE)

Deterministic cross-session full-text retrieval for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the model-facing `recall` tool lets the agent **search its own past session transcripts** — "that bug we fixed last week", "the font we chose for my resume" — through the trusted `ctx.sessionQuery` seam.

## Install

**Requirements**: Node.js 20 or 22 · a DeepSeek Harness profile that mounts the `tools` and `sessionQuery` services (the shipped `web` / `agent` profiles qualify).

```sh
dsh plugin --profile web add dsh-session-recall
```

## Try it once

The first search builds a persistent FTS5 index automatically — no extra setup. In a session, just ask naturally:

```text
recall: which font did we pick for the resume last week?
```

The tool surfaces the best-matching event per session — each hit carries the session id, a best-effort title, the date, and a match snippet, rendered as a native search card in the Web UI.

## The session toolchain

| Plugin | Layer | Answers |
|---|---|---|
| [`dsh-session-export`](https://www.npmjs.com/package/dsh-session-export) | Evidence | "What exactly happened in this session?" |
| **`dsh-session-recall`** | **Memory** | **"What did I do before, and where is it?"** |
| [`dsh-session-eval`](https://www.npmjs.com/package/dsh-session-eval) | Measurement | "Was that session good? Is the trend improving?" |

All three read through the same trusted `ctx.sessionQuery` seam.

## Contributing

- **Local dev**: `npm ci && npm run typecheck && npm test && npm run bundle` (Node 20 or 22).
- **Start in the source**: [`src/tool.ts`](src/tool.ts) (tool contract), [`src/rank.ts`](src/rank.ts) (recency re-ranking, pinned cwds), [`src/redact.ts`](src/redact.ts) (redaction patterns), [`src/resilient.ts`](src/resilient.ts) (degraded raw-scan). The full source map is in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Open gaps**: [#6](https://github.com/kittimzhe/dsh-session-recall/issues/6) (redaction patterns), [#7](https://github.com/kittimzhe/dsh-session-recall/issues/7) (tie-break order) — or browse [issues labeled `good first issue`](https://github.com/kittimzhe/dsh-session-recall/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
- **Roadmap**: [P2: evidence handoff — expose `sessionId` + transcript path from recall hits (#8)](https://github.com/kittimzhe/dsh-session-recall/issues/8), acceptance criteria in the issue; post a comment before starting so effort is not duplicated.
- **Rules**: behavior changes need tests; doc changes must update `README.md` and `README.zh.md` in sync; releases belong to the maintainer. Details: [CONTRIBUTING.md](CONTRIBUTING.md).

## What the model gets

```
recall({ query })                        → best-matching event per session, current project only
recall({ query, all_projects: true })    → search every session on the machine
recall({ query, session_id })            → search the events of one session
recall({ query, limit, cursor })         → page through results
```

Each hit carries the session id, title (best-effort), date, and a match snippet; the result renders as a native search card in the Web UI (`SearchMatchesResultView`). Because the FTS `unicode61` tokenizer indexes an uninterrupted CJK run as a single token, a short Chinese phrase inside a longer sentence would otherwise never match the index — so a zero-hit CJK query automatically falls back to a substring scan over session text (the `sessionQuery.filterEvents` literal text clause). Every whitespace-separated term must match, so `简历 模板` still recovers `简历模板`; the hint reports when that path matched.

## Scoping (the authorization gap)

`sessionQuery` is trusted infrastructure — it can read every session. This tool therefore constrains each call itself:

- by default, `sessionFilters: [{ kind: 'cwd', values: [<calling agent's cwd>] }]` — only sessions started in the same project directory;
- `all_projects: true` widens the scope, and only if the deployment allows it (`allowAllProjects: false` disables the argument).

## Positioning

`dsh-session-recall` is a **transcript retrieval layer** focused on correctness and control.

- It returns evidence from original session logs, not synthesized summaries.
- It enforces explicit retrieval scope (cwd by default, opt-in widening).
- It favors deterministic behavior over "smart" but lossy memory extraction.

If you need agent memory orchestration, use a memory framework; if you need bounded, auditable lookup over historical transcripts, use this plugin.

## Why

The official `@deepseek-ai/dsh-session-query` README lists exactly what is missing:

> **No registries or model-facing tool** — … a model-facing tool is absent.
> **No caller authorization** — … a model tool or UI must constrain which sessions its caller may inspect.

And the shipped web profile mounts its SQLite FTS5 backend with `openAt: never` and an in-memory database — so cross-session full-text search is off by default, and even when enabled the index dies with the process.

| | shipped web profile | + this plugin |
|---|---|---|
| Model-facing search tool | absent | **`recall`** |
| FTS index | `openAt: never` (off) | **on, lazy (`first-search`)** |
| Index storage | `:memory:` (lost on restart) | **persistent `<DSH_HOME>/session-recall/index.db`** |
| Caller authorization | caller's responsibility | **cwd-scoped by default, explicit opt-out** |

Memory plugins extract structured notes with an LLM (lossy, costs tokens); `recall` searches the **original transcripts** — zero extraction, zero loss, works retroactively on day one.

## Competitive context

| Capability focus | Memory frameworks | Generic transcript search | `dsh-session-recall` |
|---|---|---|---|
| Retrieval target | Derived memory objects | Varies by implementation | **Original session transcript events** |
| Scope control | Framework-specific | Often coarse | **cwd-scoped default + explicit `all_projects`, `since_days`, `tools`, `errors_only` gate** |
| CJK behavior | Framework-specific | Often tokenizer-limited | **FTS + CJK zero-hit substring fallback** |
| Output contract | Usually framework-native | Varies | **Typed `recall` result with stable fields/hints** |

Name & scope notes (2026-09):

- This plugin is **unrelated to `dsh-recall-plugin`** — that plugin is message undo/rewind (restoring workspace and conversation to before a message was sent).
- It **succeeds `dsh-recall`** — an earlier transcript-search plugin (last release 2026-08-21) with a similar goal; this plugin continues the line with persistent FTS5 indexing, CJK fallback, approval gates, and lineage-scoped authorization.
- It **complements memory frameworks** such as `dsh-mnemon` (write-side memory orchestration): this plugin stays a read-only retrieval layer over original session logs and makes no writes to any memory store.

## Install (out-of-tree plugin)

From npm:

```sh
dsh plugin --profile web add dsh-session-recall
```

Or from GitHub:

```sh
dsh plugin --profile web add github:kittimzhe/dsh-session-recall
```

Then add to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: session-recall
      name: 'dsh-session-recall'
```

The bundle's own patch layer turns the persistent index on (`session-query-sqlite` → `openAt: first-search`, `path: <DSH_HOME>/session-recall/index.db`); if you maintain your own override of that row, keep those two values.

## Configuration

Plugin row config (all optional):

```yaml
- id: session-recall
  name: 'dsh-session-recall'
  config:
    allowAllProjects: true  # honor the tool's all_projects argument
    defaultLimit: 5         # page size when the model omits limit (1..10)
    maxLimit: 10            # largest accepted page size (1..25)
    cjkHint: true           # explain CJK zero-hit results
    cjkFallback: true       # CJK zero-hit → exact substring scan over session text
    cjkFallbackScanMax: 50  # max sessions scanned per cross-session fallback (1..500)
    rawScanFallback: true     # degraded mode: when the index itself fails, scan logs directly
    rawScanMaxSessions: 200   # degraded scan budget: sessions visited (1..2000)
    rawScanMaxDurationMs: 20000  # degraded scan wall-clock ceiling (1000..120000)
    rawScanMaxSessionBytes: 8388608  # per-log compressed-size cap in the degraded scan
```

## Degraded mode (v0.7.5)

When the session index itself fails — most notably `SESSION_QUERY_PERSISTENCE_FAILED`, where a single un-migratable session artifact fails *every* indexed search (the v0→v1 migration gate rejecting `subagent/descriptor` version 2, [deepseek-harness discussion #7995](https://github.com/deepseek-ai/deepseek-harness/discussions/7995)) — the `recall` tool degrades to scanning the persisted session logs directly (`$DSH_HOME/sessions`) instead of failing the call:

- **Tolerant by construction**: each log is decompressed with a bundled pure-JS zstd decoder and parsed line by line; a corrupt line or unreadable log is skipped and counted, never fatal. The exact session shape that bricks the upstream migration is searchable here.
- **Affordable**: session headers are read through a streaming decompressor (milliseconds each) so cwd/time/session_id scope filters run before any full decompression; a byte-level term prefilter avoids line parsing for non-matching logs; a wall-clock budget (default 20s) and a per-log size cap (default 8 MiB compressed — pure-JS zstd decompresses ~2 MB/s) keep the tool responsive. Sessions are visited newest-first, and when the budget trips, the result says which portion of the store was covered.
- **Honest**: results carry `diagnostics.source: "raw-scan"` and a hint explaining the degraded provenance, unreadable/oversized skips, and partial coverage. Live (not yet persisted) sessions are not included.

Disable with `rawScanFallback: false` to restore the pre-v0.7.5 fail-fast behavior.

## Failure behavior

Every failure returns a friendly `hint` instead of a raw exception: a disabled index explains the two config keys needed, a stale cursor tells the model to restart without one, an unknown `session_id` suggests discovering sessions first. Title enrichment is best-effort — a failed title batch degrades to untitled rows, never a failed search.

## Scope policy & redaction (v0.4)

Deployment-level controls for what the model may read back:

| Option | Values | Default | Effect |
|---|---|---|---|
| `redactionMode` | `off` / `mask` / `hash` | `off` | Redact secret-looking text (bearer headers, prefixed API keys, private-key blocks, emails) in snippets and titles. `hash` keeps secrets comparable (`#xxxxxxxx`, same secret → same marker) without being readable. Results carry a `redacted` count. |
| `cwdAllowlist` | list of paths | (none) | Only sessions started in these directories are searchable; the calling cwd itself must be listed. |
| `cwdDenylist` | list of paths | (none) | These directories are never searchable. Deny wins over allow. |
| `recencyHalfLifeDays` | days (e.g. `30`) | (off) | Re-rank cross-session hits: backend rank × exponential recency decay over the match time. Unset or `<= 0` keeps backend order. Per result page. |
| `pinnedCwds` | list of paths | (none) | Sessions from these project directories rank first, as a group. |
| `allProjectsPolicy` | `allow` / `deny` / `confirm` | `allow` | `deny` ignores `all_projects` with a model-facing hint; `confirm` asks the user through the official `@deepseek-ai/dsh-user-approval` seam — fail-closed when no answerer is composed. |

All three gates apply uniformly to cross-session hits, the CJK fallback scan, and `session_id` reads — no bypass route.

Every result also carries a `diagnostics` object (v0.5): which engine produced the matches (`fts` / `cjk-fallback` / `session-scan`), how many sessions a fallback scan visited against its budget, and whether re-ranking was applied — so callers can tell *why* they got what they got.

With ranking active, pinned projects come first, then decayed relevance. Equal scores sort by session creation time (newest first), then session ID in lexical order. Ranking remains per page; with controls disabled the backend order is preserved. Items without IDs retain input order when their score and creation time also match.

## Known limitations

- First search after startup walks the durable logs to build the index (the tool description warns the model); subsequent searches are incremental.
- `unicode61` matches whole tokens/phrases, not substrings — `AI` does not match `BRAID`. CJK queries that get zero full-text hits fall back to a substring scan (`filterEvents`) whose whitespace-separated terms are ANDed, so `简历 模板` also recovers `简历模板`; the hint reports when that path matched.
- One process must own the index file (single-writer SQLite, per the official backend).
- By default matches return transcript text verbatim — redaction is opt-in since v0.4 (`redactionMode: 'mask' | 'hash'`; see "Scope policy & redaction"). With `redactionMode: 'off'` (the default), a token or sensitive path pasted into an earlier session can still be surfaced by a matching search; default cwd scoping and `allowAllProjects: false` remain the containment baseline.

## Benchmark

Measured on a real headless profile on the machine at hand (Node 25, Apple Silicon, warm filesystem cache) — indicative numbers, not a CI gate. Supported and CI-tested Node versions remain 20 and 22.

| Corpus | |
|---|---|
| Sessions | 31 |
| Events in the durable logs | 187,706 (~104 MB uncompressed, 49.7 MB zstd) |
| Indexed text events | 8,187 |
| FTS index on disk | 15 MB |

| Query | Hits | Warm latency (FTS5 `MATCH`) |
|---|---|---|
| EN `font` | 100 (capped) | 1.1 ms |
| EN `resume template` | 46 | 0.6 ms |
| CN `字体` | 29 | 0.3 ms |
| CN `简历 模板` | 10 | 0.1 ms |

Warm searches run sub-millisecond to ~1.5 ms against the on-disk index. Cold start: scanning the 49.7 MB of session logs takes ~4.7 s (decompress + line scan) and inserting the 8,187 text events into a fresh FTS5 table takes ~190 ms; the first `recall` in a fresh profile completes within the tool's 10 s timeout. After that, restarts reuse the persisted index with incremental reconciliation.

## Development

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run bundle      # tsdown → lib/
```

## License

[MIT](https://github.com/kittimzhe/dsh-session-recall/blob/main/LICENSE)

## Community

- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
