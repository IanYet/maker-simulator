import { SaveValidationError } from '../persistence'
import type { RuntimeCommandErrorCode, RuntimeCommandResult } from '../types'

/** 将未知异常转换为无堆栈的单行消息。 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** Runtime 对命令边界保留的结构化失败。 */
export class RuntimeFailure extends Error {
	readonly errorId: string
	readonly summary: string
	readonly code: RuntimeCommandErrorCode
	readonly committed: boolean
	readonly callChain: readonly string[]
	readonly jsonPointer?: string

	constructor(
		code: RuntimeCommandErrorCode,
		summary: string,
		committed = false,
		options: {
			errorId?: string
			callChain?: readonly string[]
			jsonPointer?: string
			cause?: unknown
		} = {},
	) {
		const errorId = options.errorId ?? `runtime-${crypto.randomUUID()}`
		super(`${summary} [${errorId}]`, { cause: options.cause })
		this.name = 'RuntimeFailure'
		this.errorId = errorId
		this.summary = summary
		this.code = code
		this.committed = committed
		this.callChain = options.callChain ?? []
		this.jsonPointer = options.jsonPointer
	}
}

/** 为嵌套 Reaction、Action 与 Rule 异常追加稳定调用帧。 */
export class ScriptExecutionError extends Error {
	readonly errorId: string
	readonly summary: string
	readonly callChain: readonly string[]
	readonly jsonPointer?: string

	constructor(error: unknown, frame: string) {
		const nested = error instanceof ScriptExecutionError ? error : undefined
		const errorId = nested?.errorId ?? `runtime-${crypto.randomUUID()}`
		const summary = nested?.summary ?? errorMessage(error)
		const callChain = [frame, ...(nested?.callChain ?? [])]
		super(`${callChain.join(' → ')} failed: ${summary} [${errorId}]`, { cause: error })
		this.name = 'ScriptExecutionError'
		this.errorId = errorId
		this.summary = summary
		this.callChain = callChain
		this.jsonPointer =
			nested?.jsonPointer ?? (error instanceof SaveValidationError ? error.path : undefined)
	}
}

/** 在命令边界把任意执行异常归一为 RuntimeFailure，并保留已有诊断编号。 */
export function asRuntimeFailure(error: unknown, committed = false): RuntimeFailure {
	if (error instanceof RuntimeFailure) {
		if (error.committed === committed || (!committed && error.committed)) return error
		return new RuntimeFailure(error.code, error.summary, committed, {
			errorId: error.errorId,
			callChain: error.callChain,
			jsonPointer: error.jsonPointer,
			cause: error,
		})
	}
	if (error instanceof ScriptExecutionError) {
		return new RuntimeFailure('script-error', error.summary, committed, {
			errorId: error.errorId,
			callChain: error.callChain,
			jsonPointer: error.jsonPointer,
			cause: error,
		})
	}
	return new RuntimeFailure('script-error', errorMessage(error), committed, {
		jsonPointer: error instanceof SaveValidationError ? error.path : undefined,
		cause: error,
	})
}

/** 把内部 RuntimeFailure 映射为 UI 可消费的命令失败结果。 */
export function runtimeFailureResult(
	failure: RuntimeFailure,
	revision: number,
): RuntimeCommandResult {
	return {
		ok: false,
		errorId: failure.errorId,
		code: failure.code,
		message: failure.message,
		revision,
		committed: failure.committed,
	}
}
