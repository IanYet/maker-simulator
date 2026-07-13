import type {
	DeepReadonly,
	GameConfig,
	SaveBrowserController,
	SaveCommand,
	SessionCommandResult,
	StoredProfile,
} from '../types'
import { publicDiagnostic } from '../diagnostics'
import {
	continueCheckpoint,
	createBranch,
	deleteCheckpoint,
	deleteRun,
	setCheckpointPinned,
	truncateAndContinue,
	validateStoredProfile,
	validateProfileAgainstConfig,
	type AppMetadataRepository,
	type SaveRepository,
} from '../persistence'

/**
 * 存档浏览器的命令门面。
 * 先在内存副本上执行存档命令，再通过 SaveRepository 原子保存或删除。
 */
export class SaveBrowserControllerImpl implements SaveBrowserController {
	private readonly profileId: string
	private readonly saves: SaveRepository
	private readonly metadata: AppMetadataRepository
	private readonly config?: DeepReadonly<GameConfig>

	constructor(
		profileId: string,
		saves: SaveRepository,
		metadata: AppMetadataRepository,
		config?: DeepReadonly<GameConfig>,
	) {
		this.profileId = profileId
		this.saves = saves
		this.metadata = metadata
		this.config = config
	}

	private requireConfig(): DeepReadonly<GameConfig> {
		if (!this.config) throw new Error('The game package is required for this save operation')
		return this.config
	}

	/** 执行一个存档操作，并把失败转换为 SessionCommandResult。 */
	async dispatch(command: SaveCommand): Promise<SessionCommandResult> {
		try {
			const profile = await this.saves.get(this.profileId)
			if (!profile) {
				const diagnostic = publicDiagnostic('The save no longer exists', 'save')
				return {
					ok: false,
					errorId: diagnostic.errorId,
					code: 'not-found',
					message: diagnostic.message,
					revision: 0,
					committed: false,
				}
			}
			if (command.type === 'delete-profile') {
				await this.saves.delete(profile.profileId, profile.storageRevision)
				return { ok: true, revision: 0 }
			}

			const deleting = command.type === 'delete-checkpoint' || command.type === 'delete-run'
			const config = deleting ? undefined : this.requireConfig()
			const validated = config ? validateProfileAgainstConfig(profile, config) : profile
			let next: StoredProfile | undefined
			switch (command.type) {
				case 'continue-checkpoint':
					next = continueCheckpoint(validated, command.source)
					break
				case 'create-branch':
					next = createBranch(validated, command.source)
					break
				case 'truncate-and-continue':
					next = truncateAndContinue(validated, command.source)
					break
				case 'set-checkpoint-pinned':
					next = setCheckpointPinned(validated, command.source, command.pinned)
					break
				case 'delete-checkpoint':
					next = deleteCheckpoint(validated, command.source)
					break
				case 'delete-run':
					next = deleteRun(validated, command.runId)
					break
			}
			if (!next) {
				await this.saves.delete(profile.profileId, profile.storageRevision)
				return { ok: true, revision: 0 }
			}
			const stored = await this.saves.put(
				config ? validateProfileAgainstConfig(next, config) : validateStoredProfile(next),
			)
			if (
				command.type === 'continue-checkpoint' ||
				command.type === 'create-branch' ||
				command.type === 'truncate-and-continue'
			) {
				void this.metadata
					.setRecentProfile(stored.configId, stored.profileId)
					.catch(() => undefined)
			}
			return { ok: true, revision: 0 }
		} catch (error) {
			const diagnostic = publicDiagnostic(error, 'save')
			return {
				ok: false,
				errorId: diagnostic.errorId,
				code: 'persistence-error',
				message: diagnostic.message,
				revision: 0,
				committed: false,
			}
		}
	}
}
