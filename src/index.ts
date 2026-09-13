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
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { RecallConfig } from './config.ts'
import { createRecallTool, type RecallApprovalVerdict, type RecallApprover } from './tool.ts'

export const name = 'session-recall'
export const inject = ['tools', 'sessionQuery']

export type { RecallArgs, RecallBestMatch, RecallItem, RecallResult, RecallScope } from './types.ts'
export type { RecallConfig, NormalizedRecallConfig, AllProjectsPolicy } from './config.ts'
export { normalizeRecallConfig, cwdAllowed, ALL_PROJECTS_POLICIES } from './config.ts'
export { createRecallTool, RECALL_TOOL_DESCRIPTION } from './tool.ts'
export type { RecallQueryEngine, RecallApprovalVerdict, RecallApprover } from './tool.ts'
export { renderRecallText, recallContentBlocks, recallPresentationMeta, cjkZeroHitHint, cjkFallbackHint } from './render.ts'
export { clamp, id8, formatDate, hasCJK, normalizeQuery, firstLineClipped, snippetAround } from './util.ts'
export { redactText, normalizeRedactionMode, REDACTION_MODES } from './redact.ts'
export type { RedactionMode } from './redact.ts'

/** The slice of `@deepseek-ai/dsh-user-approval` the plugin consumes, structural for wiring. */
interface ApprovalLike {
  request(req: { agent: unknown; toolName: string; reason?: string }): Promise<RecallApprovalVerdict>
}

/**
 * Build the optional approval seam for `allProjectsPolicy: 'confirm'`: ask
 * `ctx.approval` when the service is composed and the call carries an agent;
 * fail closed (`'unavailable'`) otherwise. Never throws.
 */
function makeApprover(ctx: Context): RecallApprover | undefined {
  const approval = (ctx as { approval?: ApprovalLike }).approval
  if (approval == null || typeof approval.request !== 'function') return undefined
  return async (exec: ToolRunContext, reason: string): Promise<RecallApprovalVerdict> => {
    const agent = exec.agent
    if (agent == null) return 'unavailable'
    try {
      return await approval.request({ agent, toolName: 'recall', reason })
    } catch {
      return 'unavailable'
    }
  }
}

/** Plugin entry: mount the `recall` tool on the global tool registry. */
export function apply(ctx: Context, config?: RecallConfig): void {
  ctx.effect(
    function* () {
      yield ctx.tools.register(createRecallTool(config, ctx.sessionQuery, makeApprover(ctx)))
    },
    'session-recall lifecycle',
  )
}
