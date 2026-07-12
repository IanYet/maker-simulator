import type {
	SaveBrowserController,
	SaveCommand,
	SessionCommandResult,
} from '../types'
import {
	continueCheckpoint,
	createBranch,
	setCheckpointPinned,
	truncateAndContinue,
	type AppMetadataRepository,
	type SaveRepository,
} from '../persistence'

/**
 * 存档浏览器的命令门面。
 * 先在内存副本上执行分支/截断/pin，再通过 SaveRepository 原子保存。
 */
export class SaveBrowserControllerImpl implements SaveBrowserController {
	private readonly profileId: string
	private readonly saves: SaveRepository
	private readonly metadata: AppMetadataRepository

	constructor(
		profileId: string,
		saves: SaveRepository,
		metadata: AppMetadataRepository,
	) {
		this.profileId = profileId
		this.saves = saves
		this.metadata = metadata
	}

	/** 执行一个存档操作，并把失败转换为 SessionCommandResult。 */
	async dispatch(command: SaveCommand): Promise<SessionCommandResult> {
		try {
			const profile = await this.saves.get(this.profileId)
			if (!profile) return { ok: false, code: 'not-found', message: 'The save no longer exists', revision: 0 }
			const next = command.type === 'continue-checkpoint'
				? continueCheckpoint(profile, command.source)
				: command.type === 'create-branch'
					? createBranch(profile, command.source)
					: command.type === 'truncate-and-continue'
						? truncateAndContinue(profile, command.source)
						: setCheckpointPinned(profile, command.source, command.pinned)
			await this.saves.put(next)
			if (command.type !== 'set-checkpoint-pinned') {
				await this.metadata.setRecentProfile(next.configId, next.profileId)
			}
			return { ok: true, revision: 0 }
		} catch (error) {
			return {
				ok: false,
				code: 'persistence-error',
				message: error instanceof Error ? error.message : String(error),
				revision: 0,
			}
		}
	}
}
