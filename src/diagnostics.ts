/** UI 可安全展示的一次失败摘要与可复制诊断编号。 */
export interface PublicDiagnostic {
	readonly errorId: string
	readonly message: string
}

function existingErrorId(error: unknown): string | undefined {
	if (error === null || typeof error !== 'object' || !('errorId' in error)) return undefined
	return typeof error.errorId === 'string' ? error.errorId : undefined
}

/** 将未知边界错误转换为不含堆栈的公开摘要，并复用已有错误编号。 */
export function publicDiagnostic(error: unknown, prefix = 'error'): PublicDiagnostic {
	const errorId = existingErrorId(error) ?? `${prefix}-${crypto.randomUUID()}`
	const summary = error instanceof Error ? error.message : String(error)
	return {
		errorId,
		message: summary.includes(`[${errorId}]`) ? summary : `${summary} [${errorId}]`,
	}
}
