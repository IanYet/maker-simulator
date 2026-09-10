import type {
	CheckpointRef,
	GameInfo,
	OperationFailure,
	OperationResult,
	RunRef,
	SaveCheckpoint,
	SaveCollection,
	SaveProfile,
	SaveRun,
} from './types/saves'
import type { Game, GameSnapshot } from './types/game'
import type { LoadedGamePackage } from './types/package'
import type { StoredProfile } from './types/model'
import { publicDiagnostic } from './diagnostics'
import { PackageLoader } from './package-loader/PackageLoader'
import { HttpPackageSource } from './package-loader/HttpPackageSource'
import {
	AppMetadataRepository,
	IndexedDbSaveRepository,
	type SaveRepository,
} from './persistence/SaveRepository'
import { validateProfileAgainstConfig } from './persistence/validation'
import {
	continueCheckpoint,
	createBranch,
	deleteCheckpoint,
	deleteRun,
	setCheckpointPinned,
	truncateAndContinue,
} from './persistence/profile-operations'
import { Runtime } from './runtime/Runtime'
import { createProfile, addRestartRun } from './runtime/profile-factory'
import { projectCheckpoint } from './runtime/snapshot'
import { createMonitorFactory, type RuntimeMonitorFactory } from './runtime/monitor'

function assertOpen(signal?: AbortSignal): void {
	if (!signal?.aborted) return
	const error = new Error('Opening the game was cancelled')
	error.name = 'AbortError'
	throw error
}

/** 公共身份只在边界转换；StoredProfile 内部引用不携带 profileId 或展示字段。 */
function turnRef(source: CheckpointRef) {
	return { runId: source.runId, turnId: source.turnId }
}

function currentTurn(profile: StoredProfile) {
	return profile.runDatas[profile.current.runId]?.turnDatas[profile.current.turnId]
}

function failure(code: OperationFailure['code'], error: unknown): OperationFailure {
	return { ok: false, code, ...publicDiagnostic(error, 'gameplay') }
}

/** UI 启动代码传入的环境选项。 */
export interface GameplayOptions {
	readonly baseUrl: string
	readonly cache?: RequestCache
	readonly monitor?: 'off' | 'basic' | 'verbose'
}

/** 创建默认 HTTP/IndexedDB Gameplay；环境读取留在 UI 启动代码。 */
export function createGameplay(options: GameplayOptions): Gameplay {
	return new Gameplay(
		new PackageLoader(new HttpPackageSource(options.baseUrl, options.cache)),
		new IndexedDbSaveRepository(),
		new AppMetadataRepository(),
		createMonitorFactory(options.monitor),
	)
}

/** 跨局用例入口，只返回领域数据、身份引用和操作结果。 */
export class Gameplay {
	readonly #packages: PackageLoader
	readonly #saves: SaveRepository
	readonly #metadata: Pick<AppMetadataRepository, 'getRecentProfile' | 'setRecentProfile'>
	readonly #monitorFactory: RuntimeMonitorFactory

	/** 内部组合入口；I/O 协议支持内存回归，不向 UI 暴露具体依赖。 */
	constructor(
		packages: PackageLoader,
		saves: SaveRepository,
		metadata: Pick<AppMetadataRepository, 'getRecentProfile' | 'setRecentProfile'>,
		monitorFactory: RuntimeMonitorFactory = createMonitorFactory(),
	) {
		this.#packages = packages
		this.#saves = saves
		this.#metadata = metadata
		this.#monitorFactory = monitorFactory
	}

	private rememberRecent(profile: StoredProfile): void {
		void this.#metadata.setRecentProfile(profile.configId, profile.profileId).catch(() => undefined)
	}

	private async requireProfile(profileId: string): Promise<StoredProfile> {
		const profile = await this.#saves.get(profileId)
		if (!profile) throw new Error('The requested save does not exist')
		return profile
	}

	private async getProfileUnavailableReason(profile: StoredProfile): Promise<string | undefined> {
		try {
			const game = await this.#packages.loadExact(profile.configId, profile.configVersion)
			validateProfileAgainstConfig(profile, game.config)
			return undefined
		} catch (error) {
			return publicDiagnostic(error, 'save').message
		}
	}

	/** 列出默认包信息；单个失败包保留描述与诊断，不阻止其他游戏。 */
	async listGames(): Promise<readonly GameInfo[]> {
		const catalog = await this.#packages.list()
		const ids = [...new Set(catalog.packages.map((item) => item.descriptor.id))].sort()
		return Promise.all(
			ids.map(async (gameId) => {
				const version = catalog.defaultVersions[gameId]
				const location = catalog.packages.find(
					(item) => item.descriptor.id === gameId && item.descriptor.version === version,
				)
				if (!location) throw new Error(`Default package ${gameId}@${version} is unavailable`)
				const saves = await this.#saves.listByConfigId(gameId)
				const base = {
					gameId,
					version,
					name: location.descriptor.name,
					background: location.descriptor.background,
					coverLocation: location.coverLocation,
					saveCount: saves.profiles.length + saves.invalid.length,
				}
				try {
					await this.#packages.load(location)
					return base
				} catch (error) {
					return { ...base, error: publicDiagnostic(error, 'package').message }
				}
			}),
		)
	}

	/** 返回游戏信息与最近的可用检查点身份，按钮和路由由 UI 生成。 */
	async getGameInfo(gameId: string): Promise<GameInfo> {
		const [game, saves, recentId] = await Promise.all([
			this.#packages.loadDefault(gameId),
			this.#saves.listByConfigId(gameId),
			this.#metadata.getRecentProfile(gameId).catch(() => undefined),
		])
		const candidates = await Promise.all(
			saves.profiles.map(async (profile) => ({
				profile,
				unavailable: await this.getProfileUnavailableReason(profile),
			})),
		)
		const available = candidates.filter((item) => !item.unavailable).map((item) => item.profile)
		const recent = available.find((profile) => profile.profileId === recentId) ?? available[0]
		const turn = recent ? currentTurn(recent) : undefined
		return {
			gameId,
			version: game.config.meta.version,
			name: game.config.meta.name,
			background: game.config.meta.background,
			coverLocation: game.location.coverLocation,
			saveCount: saves.profiles.length + saves.invalid.length,
			...(recent && turn
				? {
						recent: {
							source: { profileId: recent.profileId, ...recent.current },
							kind: turn.kind,
							turnNumber: turn.snapshot.turnState.turnNumber,
						},
					}
				: {}),
		}
	}

	/** 保存 initial 检查点；调用方随后 openGame 启动首回合。 */
	async createGame(gameId: string): Promise<OperationResult<CheckpointRef>> {
		let game: LoadedGamePackage
		try {
			game = await this.#packages.loadDefault(gameId)
		} catch (error) {
			return failure('package-error', error)
		}
		try {
			const stored = await this.#saves.put(
				validateProfileAgainstConfig(createProfile(game), game.config),
			)
			this.rememberRecent(stored)
			return { ok: true, value: { profileId: stored.profileId, ...stored.current } }
		} catch (error) {
			return failure('persistence-error', error)
		}
	}

	/** 按精确包恢复 Game；取消请求会回收已创建的 Runtime。 */
	async openGame(profileId: string, signal?: AbortSignal): Promise<Game> {
		assertOpen(signal)
		const profile = await this.requireProfile(profileId)
		assertOpen(signal)
		const game = await this.#packages.loadExact(profile.configId, profile.configVersion)
		assertOpen(signal)
		const runtime = await Runtime.open(game, profile, this.#saves, this.#monitorFactory)
		if (signal?.aborted) {
			runtime.close()
			assertOpen(signal)
		}
		this.rememberRecent(profile)
		return runtime
	}

	/** 只读查询稳定检查点；不创建 Game，不修改恢复位置或最近访问记录。 */
	async getCheckpoint(source: CheckpointRef): Promise<GameSnapshot> {
		const profile = await this.requireProfile(source.profileId)
		const game = await this.#packages.loadExact(profile.configId, profile.configVersion)
		return projectCheckpoint(game, profile, turnRef(source))
	}

	/** 构造存档浏览器 read model，并标记当前 catalog 中不可用的精确版本。 */
	async listSaves(gameId: string): Promise<SaveCollection> {
		const saves = await this.#saves.listByConfigId(gameId)
		const profiles = await Promise.all(
			saves.profiles.map(async (profile): Promise<SaveProfile> => {
				const unavailableReason = await this.getProfileUnavailableReason(profile)
				const available = unavailableReason === undefined
				const currentRun = profile.runDatas[profile.current.runId]
				const turn = currentTurn(profile)
				if (!currentRun || !turn) throw new Error('The save cursor is invalid')
				const runs = Object.values(profile.runDatas)
					.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
					.map((run): SaveRun => ({
						runId: run.runId,
						...(run.origin
							? {
									origin: (() => {
										const sourceTurn =
											profile.runDatas[run.origin.source.runId]?.turnDatas[run.origin.source.turnId]
										return {
											kind: run.origin.kind,
											source: { profileId: profile.profileId, ...run.origin.source },
											resolved: Boolean(sourceTurn),
											...(sourceTurn
												? {
														sourceTurnNumber: sourceTurn.snapshot.turnState.turnNumber,
														sourceKind: sourceTurn.kind,
													}
												: {}),
										}
									})(),
								}
							: {}),
						checkpoints: run.turnOrder.map((turnId, index): SaveCheckpoint => {
							const checkpoint = run.turnDatas[turnId]
							const source = { profileId: profile.profileId, runId: run.runId, turnId }
							const playable = checkpoint.kind === 'initial' || checkpoint.kind === 'turn_end'
							const latest = run.currentTurnId === turnId
							const removed = run.turnOrder.slice(index + 1)
							return {
								source,
								kind: checkpoint.kind,
								turnNumber: checkpoint.snapshot.turnState.turnNumber,
								createdAt: checkpoint.createdAt,
								pinned: checkpoint.pinned,
								current: profile.current.runId === run.runId && profile.current.turnId === turnId,
								canContinue: available && playable && latest,
								canBranch: available && playable && !latest,
								canTruncate: available && playable && !latest,
								canViewResult:
									available && (checkpoint.kind === 'terminal' || checkpoint.kind === 'abandoned'),
								truncateRemovedCount: removed.length,
								truncatePinnedCount: removed.filter((id) => run.turnDatas[id]?.pinned).length,
							}
						}),
					}))
				return {
					profileId: profile.profileId,
					...(profile.label ? { label: profile.label } : {}),
					createdAt: profile.createdAt,
					updatedAt: profile.updatedAt,
					configVersion: profile.configVersion,
					currentTurnNumber: turn.snapshot.turnState.turnNumber,
					currentRunStatus: currentRun.status,
					available,
					...(unavailableReason ? { unavailableReason } : {}),
					runs,
				}
			}),
		)
		return { profiles, invalidSaveCount: saves.invalid.length }
	}

	/** 恢复时间线最新可玩检查点。 */
	continueGame(source: CheckpointRef): Promise<OperationResult<CheckpointRef>> {
		return this.changeCheckpoint(source, (profile) => continueCheckpoint(profile, turnRef(source)))
	}
	/** 从历史检查点创建独立时间线。 */
	branchGame(source: CheckpointRef): Promise<OperationResult<CheckpointRef>> {
		return this.changeCheckpoint(source, (profile) => createBranch(profile, turnRef(source)))
	}
	/** 截断同一时间线并恢复目标检查点。 */
	truncateGame(source: CheckpointRef): Promise<OperationResult<CheckpointRef>> {
		return this.changeCheckpoint(source, (profile) => truncateAndContinue(profile, turnRef(source)))
	}
	/** 从 terminal/abandoned 创建新 Run，保留原时间线。 */
	restartGame(source: CheckpointRef): Promise<OperationResult<CheckpointRef>> {
		return this.changeCheckpoint(source, (profile, game) =>
			addRestartRun(profile, game, turnRef(source)),
		)
	}
	/** pin 影响自动保留策略。 */
	setPinned(source: CheckpointRef, pinned: boolean): Promise<OperationResult> {
		return this.editProfile(source.profileId, async (profile) => {
			const game = await this.loadProfilePackage(profile)
			return validateProfileAgainstConfig(
				setCheckpointPinned(profile, turnRef(source), pinned),
				game.config,
			)
		})
	}
	/** 删除检查点；不要求精确包可用，空时间线按领域规则级联删除。 */
	deleteCheckpoint(source: CheckpointRef): Promise<OperationResult> {
		return this.editProfile(source.profileId, (profile) =>
			deleteCheckpoint(profile, turnRef(source)),
		)
	}
	/** 删除时间线并修复剩余存档游标。 */
	deleteRun(source: RunRef): Promise<OperationResult> {
		return this.editProfile(source.profileId, (profile) => deleteRun(profile, source.runId))
	}
	/** 删除完整存档，不要求游戏包可用。 */
	deleteProfile(profileId: string): Promise<OperationResult> {
		return this.editProfile(profileId, () => undefined)
	}

	private async loadProfilePackage(profile: StoredProfile): Promise<LoadedGamePackage> {
		const game = await this.#packages.loadExact(profile.configId, profile.configVersion)
		validateProfileAgainstConfig(profile, game.config)
		return game
	}

	private async changeCheckpoint(
		source: CheckpointRef,
		operation: (profile: StoredProfile, game: LoadedGamePackage) => StoredProfile,
	): Promise<OperationResult<CheckpointRef>> {
		let next: StoredProfile | undefined
		const result = await this.editProfile(source.profileId, async (profile) => {
			const game = await this.loadProfilePackage(profile)
			next = validateProfileAgainstConfig(operation(profile, game), game.config)
			return next
		})
		if (!result.ok) return result
		if (!next) throw new Error('Checkpoint operation did not produce a save')
		this.rememberRecent(next)
		return { ok: true, value: { profileId: next.profileId, ...next.current } }
	}

	/** 读取一次，在内存完成领域变换后提交一次；按失败阶段保留错误分类。 */
	private async editProfile(
		profileId: string,
		operation: (
			profile: StoredProfile,
		) => StoredProfile | undefined | Promise<StoredProfile | undefined>,
	): Promise<OperationResult> {
		let profile: StoredProfile | undefined
		try {
			profile = await this.#saves.get(profileId)
		} catch (error) {
			return failure('incompatible-save', error)
		}
		if (!profile) return failure('not-found', 'The requested save does not exist')
		let next: StoredProfile | undefined
		try {
			next = await operation(profile)
		} catch (error) {
			return failure('incompatible-save', error)
		}
		try {
			if (next) await this.#saves.put(next)
			else await this.#saves.delete(profileId)
			return { ok: true, value: undefined }
		} catch (error) {
			return failure('persistence-error', error)
		}
	}
}
