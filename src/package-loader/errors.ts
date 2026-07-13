import type { PackageLoadError, PackageLoadStage } from '../types'

/**
 * 游戏包在发现、解析、导入或 linking 阶段失败时使用的结构化异常。
 * `stage`、资源位置与 JSON Pointer 供 UI 和控制台定位外部资源问题。
 */
export class GamePackageLoadError extends Error implements PackageLoadError {
	readonly errorId: string
	readonly summary: string
	readonly stage: PackageLoadStage
	readonly packageId?: string
	readonly packageVersion?: string
	readonly resourceLocation?: string
	readonly jsonPointer?: string
	override readonly cause?: unknown

	constructor(
		stage: PackageLoadStage,
		message: string,
		options: {
			errorId?: string
			packageId?: string
			packageVersion?: string
			resourceLocation?: string
			jsonPointer?: string
			cause?: unknown
		} = {},
	) {
		const errorId = options.errorId ?? `package-${crypto.randomUUID()}`
		super(`${message} [${errorId}]`)
		this.name = 'GamePackageLoadError'
		this.errorId = errorId
		this.summary = message
		this.stage = stage
		this.packageId = options.packageId
		this.packageVersion = options.packageVersion
		this.resourceLocation = options.resourceLocation
		this.jsonPointer = options.jsonPointer
		this.cause = options.cause
	}
}

/**
 * 将未知异常包装为 GamePackageLoadError，并保留原始 cause。
 * 已经是 GamePackageLoadError 的异常会补齐调用边界尚未提供的包与资源信息。
 */
export function packageError(
	stage: PackageLoadStage,
	error: unknown,
	options: ConstructorParameters<typeof GamePackageLoadError>[2] = {},
): GamePackageLoadError {
	if (error instanceof GamePackageLoadError) {
		return new GamePackageLoadError(error.stage, error.summary, {
			errorId: error.errorId,
			packageId: error.packageId ?? options.packageId,
			packageVersion: error.packageVersion ?? options.packageVersion,
			resourceLocation: error.resourceLocation ?? options.resourceLocation,
			jsonPointer: error.jsonPointer ?? options.jsonPointer,
			cause: error,
		})
	}
	const message = error instanceof Error ? error.message : String(error)
	return new GamePackageLoadError(stage, message, { ...options, cause: error })
}
