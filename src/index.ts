/**
 * dsh-session-recall — model-facing cross-session full-text recall for
 * DeepSeek Harness.
 *
 * Registers the `recall` tool through `ctx.tools` and searches every session
 * the trusted `ctx.sessionQuery` seam can see — past and current, any
 * persistence backend. The bundle patch also turns the shipped opt-in FTS
 * index on and points it at a persistent on-disk database.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RecallConfig } from './config.ts'
import { createRecallTool } from './tool.ts'

export const name = 'session-recall'
export const inject = ['tools', 'sessionQuery']

export type { RecallArgs, RecallBestMatch, RecallItem, RecallResult, RecallScope } from './types.ts'
export type { RecallConfig, NormalizedRecallConfig } from './config.ts'
export { normalizeRecallConfig } from './config.ts'
export { createRecallTool, RECALL_TOOL_DESCRIPTION } from './tool.ts'
export type { RecallQueryEngine } from './tool.ts'
export { renderRecallText, recallContentBlocks, recallPresentationMeta, cjkZeroHitHint, cjkFallbackHint } from './render.ts'
export { clamp, id8, formatDate, hasCJK, normalizeQuery, firstLineClipped, snippetAround } from './util.ts'

/** Plugin entry: mount the `recall` tool on the global tool registry. */
export function apply(ctx: Context, config?: RecallConfig): void {
  ctx.effect(
    function* () {
      yield ctx.tools.register(createRecallTool(config, ctx.sessionQuery))
    },
    'session-recall lifecycle',
  )
}
