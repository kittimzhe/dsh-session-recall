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

Each hit carries the session id, title (best-effort), date, and a match snippet; the result renders as a native search card in the Web UI (`SearchMatchesResultView`). Zero-hit CJK queries get a tokenizer hint: the FTS `unicode61` tokenizer indexes uninterrupted CJK runs as single tokens, so the tool teaches the model to retry with short space-separated keywords.

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
    cjkHint: true           # zero-hit CJK tokenizer workaround hint
```

## Failure behavior

Every failure returns a friendly `hint` instead of a raw exception: a disabled index explains the two config keys needed, a stale cursor tells the model to restart without one, an unknown `session_id` suggests discovering sessions first. Title enrichment is best-effort — a failed title batch degrades to untitled rows, never a failed search.

## Known limitations

- First search after startup walks the durable logs to build the index (the tool description warns the model); subsequent searches are incremental.
- `unicode61` matches whole tokens/phrases, not substrings — `AI` does not match `BRAID`. The zero-hit CJK hint mitigates the worst case; a substring fallback via `filterEvents()` is a possible v2.
- One process must own the index file (single-writer SQLite, per the official backend).

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run bundle      # tsdown → lib/
```

## License

[MIT](LICENSE)
