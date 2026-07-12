import type { PackageLoadError, PackageLoadStage } from '../types'

/**
 * 游戏包在发现、解析、导入或 linking 阶段失败时使用的结构化异常。
 * `stage` 和 `path` 供 UI 与控制台快速定位外部资源问题。
 */
export class GamePackageLoadError extends Error implements PackageLoadError {
	readonly stage: PackageLoadStage
	readonly packageId?: string
	readonly packageVersion?: string
	readonly path?: string
	override readonly cause?: unknown

	constructor(
		stage: PackageLoadStage,
		message: string,
		options: {
			packageId?: string
			packageVersion?: string
			path?: string
			cause?: unknown
		} = {},
	) {
		super(message)
		this.name = 'GamePackageLoadError'
		this.stage = stage
		this.packageId = options.packageId
		this.packageVersion = options.packageVersion
		this.path = options.path
		this.cause = options.cause
	}
}

/**
 * 将未知异常包装为 GamePackageLoadError，并保留原始 cause。
 * 已经是 GamePackageLoadError 的异常会原样返回。
 */
export function packageError(
	stage: PackageLoadStage,
	error: unknown,
	options: ConstructorParameters<typeof GamePackageLoadError>[2] = {},
): GamePackageLoadError {
	if (error instanceof GamePackageLoadError) return error
	const message = error instanceof Error ? error.message : String(error)
	return new GamePackageLoadError(stage, message, { ...options, cause: error })
}
