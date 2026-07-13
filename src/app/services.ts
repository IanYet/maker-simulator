import type {
	CheckpointKind,
	GameSession,
	LoadedGamePackage,
	LocatedGameCatalog,
	SaveCommand,
	SessionCommandResult,
	StoredProfile,
	TurnPhase,
	TurnRef,
} from '../types'
import { FetchGamePackageSource, GamePackageLoader } from '../package-loader'
import { AppMetadataRepository, IndexedDbSaveRepository } from '../persistence'
import { GameplayRuntimeImpl, addRestartRun, createMonitorFactory, createProfile } from '../runtime'
import { GameSessionImpl, SaveBrowserControllerImpl } from '../session'

type Navigate = (path: string, options?: { replace?: boolean }) => void

/** 游戏列表页使用的最小只读模型。 */
export interface GameListItem {
	readonly gameId: string
	readonly version: string
	readonly name: string
	readonly background?: string
	readonly coverLocation?: string
	readonly saveCount: number
	readonly error?: string
}

/** 游戏菜单页使用的包信息和最近存档入口。 */
export interface GameMenuView {
	readonly gameId: string
	readonly version: string
	readonly name: string
	readonly background: string
	readonly saveCount: number
	readonly recentLocation?: string
	readonly recentLabel?: string
}

/** 新建游戏完成后交给路由的结果。 */
export interface CreatedGameView {
	readonly profileId: string
}

/** 存档页中的单个稳定检查点。 */
export interface SaveCheckpointView {
	readonly source: TurnRef
	readonly kind: CheckpointKind
	readonly turnNumber: number
	readonly createdAt: string
	readonly pinned: boolean
	readonly current: boolean
	readonly canContinue: boolean
	readonly canBranch: boolean
	readonly canTruncate: boolean
	readonly resultLocation?: string
	readonly truncateRemovedCount: number
	readonly truncatePinnedCount: number
}

/** 存档页中的一条 Run 时间线。 */
export interface SaveRunView {
	readonly runId: string
	readonly originKind?: 'branch' | 'restart'
	readonly originSummary?: string
	readonly checkpoints: readonly SaveCheckpointView[]
}

/** 存档页中的一个 Profile 卡片及其全部时间线。 */
export interface SaveProfileView {
	readonly profileId: string
	readonly label?: string
	readonly createdAt: string
	readonly updatedAt: string
	readonly configVersion: string
	readonly currentTurnNumber: number
	readonly currentRunStatus: 'active' | 'ended' | 'abandoned'
	readonly available: boolean
	readonly unavailableReason?: string
	readonly runs: readonly SaveRunView[]
}

/** 存档浏览器的一次应用层查询结果。 */
export interface SaveBrowserView {
	readonly profiles: readonly SaveProfileView[]
	readonly invalidSaveCount: number
}

/** 结果页专用的只读检查点投影。 */
export interface ResultView {
	readonly gameId: string
	readonly gameName: string
	readonly abandoned: boolean
	readonly title: string
	readonly content: string
	readonly turnNumber: number
	readonly phase: TurnPhase
	readonly endedAt?: string
}

function playLocation(profileId: string): string {
	return `/play/${encodeURIComponent(profileId)}`
}

function resultLocation(profileId: string, source: TurnRef): string {
	return `/result/${encodeURIComponent(profileId)}/${encodeURIComponent(source.runId)}/${encodeURIComponent(source.turnId)}`
}

function currentTurn(profile: StoredProfile) {
	return profile.runDatas[profile.current.runId]?.turnDatas[profile.current.turnId]
}

/**
 * 应用层组合根：隐藏包加载、持久化和 Runtime 具体实现，只向页面返回 read model、
 * GameSession 接口和应用命令结果。
 */
export class AppServices {
	readonly #saves = new IndexedDbSaveRepository()
	readonly #metadata = new AppMetadataRepository()
	readonly #packages = new GamePackageLoader(new FetchGamePackageSource())
	readonly #monitorFactory = createMonitorFactory()
	#catalog?: Promise<LocatedGameCatalog>

	private getCatalog(): Promise<LocatedGameCatalog> {
		this.#catalog ??= this.#packages.list()
		return this.#catalog
	}

	private async getDefaultPackage(gameId: string): Promise<LoadedGamePackage> {
		const catalog = await this.getCatalog()
		const version = catalog.defaultVersions[gameId]
		if (!version) throw new Error(`Game “${gameId}” is not in the catalog`)
		const location = catalog.packages.find(
			(item) => item.descriptor.id === gameId && item.descriptor.version === version,
		)
		if (!location) throw new Error(`Default package ${gameId}@${version} is unavailable`)
		return this.#packages.load(location)
	}

	private rememberRecent(configId: string, profileId: string): void {
		void this.#metadata.setRecentProfile(configId, profileId).catch(() => undefined)
	}

	/** 加载默认包并返回游戏列表页可展示的只读状态。 */
	async listGames(): Promise<readonly GameListItem[]> {
		const catalog = await this.getCatalog()
		const ids = [...new Set(catalog.packages.map((item) => item.descriptor.id))].sort()
		return Promise.all(ids.map(async (gameId) => {
			const version = catalog.defaultVersions[gameId]
			const location = catalog.packages.find(
				(item) => item.descriptor.id === gameId && item.descriptor.version === version,
			)
			if (!location) throw new Error(`Default package ${gameId}@${version} is unavailable`)
			const saves = await this.#saves.listByConfigId(gameId)
			const base = {
				gameId,
				version: location.descriptor.version,
				name: location.descriptor.name,
				...(location.descriptor.background
					? { background: location.descriptor.background }
					: {}),
				...(location.coverLocation ? { coverLocation: location.coverLocation } : {}),
				saveCount: saves.profiles.length + saves.invalid.length,
			}
			try {
				await this.#packages.load(location)
				return base
			} catch (error) {
				return { ...base, error: error instanceof Error ? error.message : String(error) }
			}
		}))
	}

	/** 返回游戏菜单页所需信息，不向页面暴露游戏包或存档对象。 */
	async getGameMenu(gameId: string): Promise<GameMenuView> {
		const [game, catalog, saves, recentId] = await Promise.all([
			this.getDefaultPackage(gameId),
			this.getCatalog(),
			this.#saves.listByConfigId(gameId),
			this.#metadata.getRecentProfile(gameId).catch(() => undefined),
		])
		const available = saves.profiles.filter((profile) => catalog.packages.some(
			(item) => item.descriptor.id === profile.configId
				&& item.descriptor.version === profile.configVersion,
		))
		const recent = available.find((profile) => profile.profileId === recentId) ?? available[0]
		const turn = recent ? currentTurn(recent) : undefined
		return {
			gameId,
			version: game.config.meta.version,
			name: game.config.meta.name,
			background: game.config.meta.background,
			saveCount: saves.profiles.length + saves.invalid.length,
			...(recent && turn
				? {
					recentLocation: turn.kind === 'terminal' || turn.kind === 'abandoned'
						? resultLocation(recent.profileId, recent.current)
						: playLocation(recent.profileId),
					recentLabel: turn.kind === 'terminal'
						? '查看上次结局'
						: turn.kind === 'abandoned'
							? '查看上次记录'
							: '继续游戏',
				}
				: {}),
		}
	}

	/** 创建并保存 initial 检查点；首回合由随后打开的 Session 启动。 */
	async createNewGame(gameId: string): Promise<CreatedGameView> {
		const game = await this.getDefaultPackage(gameId)
		const stored = await this.#saves.put(createProfile(game))
		this.rememberRecent(stored.configId, stored.profileId)
		return { profileId: stored.profileId }
	}

	/** 按存档的精确游戏包版本恢复可交互 Session。 */
	async openSession(profileId: string, navigate: Navigate): Promise<GameSession> {
		const profile = await this.#saves.get(profileId)
		if (!profile) throw new Error('The requested save does not exist')
		const game = await this.#packages.loadExact(profile.configId, profile.configVersion)
		const runtime = await GameplayRuntimeImpl.open(
			game,
			profile,
			this.#saves,
			this.#monitorFactory,
		)
		this.rememberRecent(profile.configId, profile.profileId)
		return new GameSessionImpl(runtime, this.#saves, this.#metadata, navigate)
	}

	/** 构造存档浏览器 read model，并标记当前 catalog 中不可用的精确版本。 */
	async getSaveBrowser(gameId: string): Promise<SaveBrowserView> {
		const [catalog, saves] = await Promise.all([
			this.getCatalog(),
			this.#saves.listByConfigId(gameId),
		])
		const profiles = saves.profiles.map((profile): SaveProfileView => {
			const available = catalog.packages.some(
				(item) => item.descriptor.id === profile.configId
					&& item.descriptor.version === profile.configVersion,
			)
			const currentRun = profile.runDatas[profile.current.runId]
			const turn = currentTurn(profile)
			if (!currentRun || !turn) throw new Error('The save cursor is invalid')
			const runs = Object.values(profile.runDatas)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map((run): SaveRunView => ({
					runId: run.runId,
					...(run.origin
						? {
							originKind: run.origin.kind,
							originSummary: `${run.origin.source.runId.slice(0, 18)} / ${run.origin.source.turnId.slice(0, 18)}`,
						}
						: {}),
					checkpoints: run.turnOrder.map((turnId, index): SaveCheckpointView => {
						const checkpoint = run.turnDatas[turnId]
						const source = { runId: run.runId, turnId }
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
							...(available && (checkpoint.kind === 'terminal' || checkpoint.kind === 'abandoned')
								? { resultLocation: resultLocation(profile.profileId, source) }
								: {}),
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
				...(!available ? { unavailableReason: `游戏包 ${profile.configId}@${profile.configVersion} 当前不可用` } : {}),
				runs,
			}
		})
		return { profiles, invalidSaveCount: saves.invalid.length }
	}

	/** 执行一条存档命令；页面不接触 Profile 或 Repository。 */
	executeSaveCommand(profileId: string, command: SaveCommand): Promise<SessionCommandResult> {
		return new SaveBrowserControllerImpl(
			profileId,
			this.#saves,
			this.#metadata,
		).dispatch(command)
	}

	/** 从 terminal/abandoned 检查点构造严格只读的结果页模型。 */
	async getResult(profileId: string, source: TurnRef): Promise<ResultView> {
		const profile = await this.#saves.get(profileId)
		if (!profile) throw new Error('The requested save does not exist')
		const turn = profile.runDatas[source.runId]?.turnDatas[source.turnId]
		if (!turn || (turn.kind !== 'terminal' && turn.kind !== 'abandoned')) {
			throw new Error('The requested result checkpoint does not exist')
		}
		const game = await this.#packages.loadExact(profile.configId, profile.configVersion)
		const snapshot = GameplayRuntimeImpl.projectCheckpoint(game, profile, source)
		const abandoned = turn.kind === 'abandoned'
		return {
			gameId: game.config.meta.id,
			gameName: game.config.meta.name,
			abandoned,
			title: abandoned
				? '这条时间线已被放弃。'
				: snapshot.endingEvent?.currentNode.displayName ?? '本局已经抵达终点。',
			content: abandoned
				? '这是一条只读的放弃记录。它不是游戏脚本定义的结局，但仍保留放弃时的状态与随机游标。'
				: snapshot.endingEvent?.currentNode.content
					?? '终局由游戏脚本触发；本次调用链没有关联可展示的叙事节点。完整状态已经保存在 terminal 检查点中。',
			turnNumber: snapshot.turnNumber,
			phase: snapshot.phase,
			...(snapshot.endedAt ? { endedAt: snapshot.endedAt } : {}),
		}
	}

	/** 从终局或放弃记录创建 restart 时间线。 */
	async restart(profileId: string, source: TurnRef): Promise<void> {
		const profile = await this.#saves.get(profileId)
		if (!profile) throw new Error('The requested save does not exist')
		const game = await this.#packages.loadExact(profile.configId, profile.configVersion)
		const stored = await this.#saves.put(addRestartRun(profile, game, source))
		this.rememberRecent(stored.configId, stored.profileId)
	}
}
