import type {
	GameSession,
	SessionCommandResult,
	SessionView,
} from '../types'
import type { AppMetadataRepository, SaveRepository } from '../persistence'
import { addRestartRun, type GameplayRuntimeImpl } from '../runtime'

type Navigate = (path: string, options?: { replace?: boolean }) => void

export class GameSessionImpl implements GameSession {
	readonly #listeners = new Set<() => void>()
	#view: SessionView
	#disposed = false
	readonly #unsubscribeRuntime: () => void
	readonly runtime: GameplayRuntimeImpl
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
		const profile = runtime.getProfile()
		this.#view = {
			gameId: runtime.game.config.meta.id,
			gameVersion: runtime.game.config.meta.version,
			gameName: runtime.game.config.meta.name,
			profileId: profile.profileId,
			...(profile.label ? { profileLabel: profile.label } : {}),
			runtime: runtime.getSnapshot(),
			busy: false,
			focusedEventInstanceId: runtime.getSnapshot().activeEvents[0]?.eventInstanceId,
		}
		this.#unsubscribeRuntime = runtime.subscribe(() => this.refreshRuntime())
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	getView(): SessionView {
		return this.#view
	}

	focusEvent(eventInstanceId?: string): void {
		if (eventInstanceId && !this.#view.runtime.activeEvents.some((event) => event.eventInstanceId === eventInstanceId)) return
		this.#view = {
			...this.#view,
			focusedEventInstanceId: eventInstanceId,
		}
		this.notify()
	}

	startEvent(eventId: string): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({ type: 'start-event', eventId }))
	}

	chooseSingle(eventInstanceId: string, nodeId: string, choiceId: string): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({ type: 'choose-single', eventInstanceId, nodeId, choiceId }))
	}

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

	advanceTurn(): Promise<SessionCommandResult> {
		return this.command(() => this.runtime.dispatch({ type: 'advance-turn' }))
	}

	async exitAndSave(): Promise<SessionCommandResult> {
		const revision = this.#view.runtime.revision
		this.dispose()
		this.navigate(`/games/${encodeURIComponent(this.#view.gameId)}`)
		return { ok: true, revision }
	}

	async abandonAndExit(): Promise<SessionCommandResult> {
		return this.appCommand(async () => {
			const result = await this.runtime.abandon()
			if (!result.ok) return result
			await this.metadata.setRecentProfile(this.#view.gameId, this.#view.profileId)
			this.dispose()
			this.navigate(`/games/${encodeURIComponent(this.#view.gameId)}`)
			return result
		})
	}

	async openSaveBrowser(): Promise<SessionCommandResult> {
		const revision = this.#view.runtime.revision
		this.dispose()
		this.navigate(`/games/${encodeURIComponent(this.#view.gameId)}/saves`)
		return { ok: true, revision }
	}

	async restartRun(): Promise<SessionCommandResult> {
		if (this.#view.runtime.runStatus === 'active') {
			return {
				ok: false,
				code: 'not-active',
				message: 'The current run is still active',
				revision: this.#view.runtime.revision,
			}
		}
		return this.appCommand(async () => {
			const profile = this.runtime.getProfile()
			const next = addRestartRun(profile, this.runtime.game, profile.current)
			await this.saves.put(next)
			await this.metadata.setRecentProfile(next.configId, next.profileId)
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
			return { ok: false, code: 'busy', message: 'Another command is still running', revision: this.#view.runtime.revision }
		}
		this.setBusy(true)
		try {
			return await execute()
		} finally {
			this.setBusy(false)
		}
	}

	private async appCommand(
		execute: () => Promise<SessionCommandResult>,
	): Promise<SessionCommandResult> {
		try {
			return await this.command(execute)
		} catch (error) {
			return {
				ok: false,
				code: 'persistence-error',
				message: error instanceof Error ? error.message : String(error),
				revision: this.#view.runtime.revision,
			}
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
		this.#view = { ...this.#view, runtime, focusedEventInstanceId }
		this.notify()
	}

	private notify(): void {
		for (const listener of this.#listeners) listener()
	}
}
