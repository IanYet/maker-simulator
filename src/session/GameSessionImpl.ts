import type {
	GameSession,
	SessionCommandErrorCode,
	SessionCommandResult,
	SessionView,
	TurnRef,
} from '../types'
import { publicDiagnostic } from '../diagnostics'
import {
	validateProfileAgainstConfig,
	type AppMetadataRepository,
	type SaveRepository,
} from '../persistence'
import { addRestartRun, type GameplayRuntimeImpl } from '../runtime'

type Navigate = (path: string, options?: { replace?: boolean }) => void

function resultLocation(profileId: string, source: TurnRef): string {
	return `/result/${encodeURIComponent(profileId)}/${encodeURIComponent(source.runId)}/${encodeURIComponent(source.turnId)}`
}

function sessionFailure(
	code: SessionCommandErrorCode,
	error: unknown,
	revision: number,
): SessionCommandResult {
	const diagnostic = publicDiagnostic(error, 'session')
	return {
		ok: false,
		errorId: diagnostic.errorId,
		code,
		message: diagnostic.message,
		revision,
		committed: false,
	}
}

/**
 * UI 与 GameplayRuntime 之间的会话门面。
 *
 * 负责 busy 锁、当前事件焦点、应用级导航和 RuntimeSnapshot 的订阅；
 * 游戏规则仍由 Runtime 执行，Session 不直接修改 State。
 */
export class GameSessionImpl implements GameSession {
	readonly #listeners = new Set<() => void>()
	#view: SessionView
	#disposed = false
	readonly #unsubscribeRuntime: () => void
	private readonly runtime: GameplayRuntimeImpl
	private readonly saves: SaveRepository
	private readonly metadata: AppMetadataRepository
	private readonly navigate: Navigate

	constructor(
		runtime: GameplayRuntimeImpl,
		saves: SaveRepository,
		metadata: AppMetadataRepository,
		navigate: Navigate,
	) {
		this.runtime = runtime
		this.saves = saves
		this.metadata = metadata
		this.navigate = navigate
		const profile = runtime.getStoredProfile()
		const runtimeSnapshot = runtime.getSnapshot()
		this.#view = {
			gameId: runtime.game.config.meta.id,
			gameVersion: runtime.game.config.meta.version,
			gameName: runtime.game.config.meta.name,
			profileId: profile.profileId,
			...(profile.label ? { profileLabel: profile.label } : {}),
			runtime: runtimeSnapshot,
			busy: false,
			focusedEventInstanceId: runtimeSnapshot.activeEvents[0]?.eventInstanceId,
			...(runtimeSnapshot.runStatus !== 'active'
				? { resultLocation: resultLocation(profile.profileId, runtime.getCurrentCheckpoint()) }
				: {}),
		}
		this.#unsubscribeRuntime = runtime.subscribe(() => this.refreshRuntime())
	}

	/** 订阅 SessionView 变化；返回取消订阅函数。 */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	/** 返回当前合并了 Runtime 和 UI 瞬时状态的视图。 */
	getView(): SessionView {
		return this.#view
	}

	/** 聚焦某个 active EventInstance，供事件入口和节点区域同步。 */
	focusEvent(eventInstanceId?: string): void {
		if (eventInstanceId && !this.#view.runtime.activeEvents.some((event) => event.eventInstanceId === eventInstanceId)) return
		this.#view = {
			...this.#view,
			focusedEventInstanceId: eventInstanceId,
		}
		this.notify()
	}

	/** 启动一张事件卡。 */
	startEvent(eventId: string): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({ type: 'start-event', eventId }))
	}

	/** 手动激活一个已获得的 Effect。 */
	activateEffect(effectId: string): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({ type: 'activate-effect', effectId }))
	}

	/** 提交当前单选节点的 Choice。 */
	chooseSingle(eventInstanceId: string, nodeId: string, choiceId: string): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({ type: 'choose-single', eventInstanceId, nodeId, choiceId }))
	}

	/** 更新多选节点中某个 Choice 的数量。 */
	updateSelection(
		eventInstanceId: string,
		nodeId: string,
		choiceId: string,
		count: number,
	): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({
			type: 'set-multiple-choice',
			eventInstanceId,
			nodeId,
			choiceId,
			count,
		}))
	}

	/** 执行多选节点的 NodeCommand。 */
	executeNodeCommand(
		eventInstanceId: string,
		nodeId: string,
		commandId: string,
	): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({
			type: 'execute-node-command',
			eventInstanceId,
			nodeId,
			commandId,
		}))
	}

	/** 通过 required 门禁并进入下一回合。 */
	advanceTurn(): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({ type: 'advance-turn' }))
	}

	/** 保存当前应用级游标并返回游戏菜单；未提交的回合状态会被丢弃。 */
	async exitAndSave(): Promise<SessionCommandResult> {
		const revision = this.#view.runtime.revision
		this.dispose()
		this.navigate(`/games/${encodeURIComponent(this.#view.gameId)}`)
		return { ok: true, revision }
	}

	/** 放弃当前时间线并离开游玩页。 */
	async abandonAndExit(): Promise<SessionCommandResult> {
		return this.appCommand(async () => {
			const result = await this.runtime.abandon()
			if (!result.ok) return result
			this.rememberRecent(this.#view.gameId, this.#view.profileId)
			this.dispose()
			this.navigate(`/games/${encodeURIComponent(this.#view.gameId)}`)
			return result
		})
	}

	/** 离开游玩页并打开存档浏览器。 */
	async openSaveBrowser(): Promise<SessionCommandResult> {
		const revision = this.#view.runtime.revision
		this.dispose()
		this.navigate(`/games/${encodeURIComponent(this.#view.gameId)}/saves`)
		return { ok: true, revision }
	}

	/** 从终局或放弃检查点创建 restart Run，并导航回游玩页。 */
	async restartRun(): Promise<SessionCommandResult> {
		if (this.#view.runtime.runStatus === 'active') {
			return sessionFailure(
				'not-active',
				'The current run is still active',
				this.#view.runtime.revision,
			)
		}
		return this.appCommand(async () => {
			const profile = this.runtime.getStoredProfile()
			const next = validateProfileAgainstConfig(
				addRestartRun(profile, this.runtime.game, profile.current),
				this.runtime.game.config,
			)
			const stored = await this.saves.put(next)
			this.rememberRecent(stored.configId, stored.profileId)
			this.dispose()
			this.navigate(`/play/${encodeURIComponent(next.profileId)}`)
			return { ok: true, revision: this.#view.runtime.revision }
		})
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		this.#unsubscribeRuntime()
		this.runtime.dispose()
		this.#listeners.clear()
	}

	private async command(
		execute: () => Promise<SessionCommandResult>,
	): Promise<SessionCommandResult> {
		if (this.#view.busy) {
			return sessionFailure(
				'busy',
				'Another command is still running',
				this.#view.runtime.revision,
			)
		}
		this.setBusy(true)
		try {
			return await execute()
		} finally {
			this.refreshRuntime()
			this.setBusy(false)
		}
	}

	private async appCommand(
		execute: () => Promise<SessionCommandResult>,
	): Promise<SessionCommandResult> {
		try {
			return await this.command(execute)
		} catch (error) {
			return sessionFailure('persistence-error', error, this.#view.runtime.revision)
		}
	}

	private setBusy(busy: boolean): void {
		if (this.#disposed) return
		this.#view = { ...this.#view, busy }
		this.notify()
	}

	private refreshRuntime(): void {
		if (this.#disposed) return
		const runtime = this.runtime.getSnapshot()
		const currentFocus = this.#view.focusedEventInstanceId
		const focusedEventInstanceId = currentFocus && runtime.activeEvents.some((event) => event.eventInstanceId === currentFocus)
			? currentFocus
			: runtime.activeEvents[0]?.eventInstanceId
		this.#view = {
			...this.#view,
			runtime,
			focusedEventInstanceId,
			...(runtime.runStatus !== 'active'
				? { resultLocation: resultLocation(this.#view.profileId, this.runtime.getCurrentCheckpoint()) }
				: { resultLocation: undefined }),
		}
		this.notify()
	}

	/** 最近访问记录是便利元数据，失败不能推翻已经成功的领域命令。 */
	private rememberRecent(configId: string, profileId: string): void {
		void this.metadata.setRecentProfile(configId, profileId).catch(() => undefined)
	}

	private notify(): void {
		for (const listener of this.#listeners) {
			try {
				listener()
			} catch {
				// UI 订阅者异常不能改变命令结果或 Session 状态。
			}
		}
	}
}
