import type { PackageLoadError, PackageLoadStage } from '../types'

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

export function packageError(
	stage: PackageLoadStage,
	error: unknown,
	options: ConstructorParameters<typeof GamePackageLoadError>[2] = {},
): GamePackageLoadError {
	if (error instanceof GamePackageLoadError) return error
	const message = error instanceof Error ? error.message : String(error)
	return new GamePackageLoadError(stage, message, { ...options, cause: error })
}
