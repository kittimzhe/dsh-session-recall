# dsh-session-recall

English | [中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/dsh-session-recall)](https://www.npmjs.com/package/dsh-session-recall) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Cross-session full-text recall for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the model-facing `recall` tool lets the agent **search its own past session transcripts** — "that bug we fixed last week", "the font we chose for my resume" — through the trusted `ctx.sessionQuery` seam.

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
```

## Failure behavior

Every failure returns a friendly `hint` instead of a raw exception: a disabled index explains the two config keys needed, a stale cursor tells the model to restart without one, an unknown `session_id` suggests discovering sessions first. Title enrichment is best-effort — a failed title batch degrades to untitled rows, never a failed search.

## Known limitations

- First search after startup walks the durable logs to build the index (the tool description warns the model); subsequent searches are incremental.
- `unicode61` matches whole tokens/phrases, not substrings — `AI` does not match `BRAID`. CJK queries that get zero full-text hits fall back to a substring scan (`filterEvents`) whose whitespace-separated terms are ANDed, so `简历 模板` also recovers `简历模板`; the hint reports when that path matched.
- One process must own the index file (single-writer SQLite, per the official backend).
- Matches return transcript text verbatim — there is no credential or local-path redaction. A token or sensitive path pasted into an earlier session can be surfaced by a matching search. Default cwd scoping and `allowAllProjects: false` are the only containment; fingerprinting or redaction is future work.

## Benchmark

Measured on a real headless profile (Node 25, Apple Silicon, warm filesystem cache).

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
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run bundle      # tsdown → lib/
```

## License

[MIT](LICENSE)
