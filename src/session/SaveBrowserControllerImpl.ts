import type {
	DeepReadonly,
	GameConfig,
	SaveBrowserController,
	SaveCommand,
	SessionCommandResult,
} from '../types'
import { publicDiagnostic } from '../diagnostics'
import {
	continueCheckpoint,
	createBranch,
	setCheckpointPinned,
	truncateAndContinue,
	validateProfileAgainstConfig,
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
	private readonly config: DeepReadonly<GameConfig>

	constructor(
		profileId: string,
		saves: SaveRepository,
		metadata: AppMetadataRepository,
		config: DeepReadonly<GameConfig>,
	) {
		this.profileId = profileId
		this.saves = saves
		this.metadata = metadata
		this.config = config
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
			const validated = validateProfileAgainstConfig(profile, this.config)
			const next = command.type === 'continue-checkpoint'
				? continueCheckpoint(validated, command.source)
				: command.type === 'create-branch'
					? createBranch(validated, command.source)
					: command.type === 'truncate-and-continue'
						? truncateAndContinue(validated, command.source)
						: setCheckpointPinned(validated, command.source, command.pinned)
			const stored = await this.saves.put(validateProfileAgainstConfig(next, this.config))
			if (command.type !== 'set-checkpoint-pinned') {
				void this.metadata.setRecentProfile(stored.configId, stored.profileId).catch(() => undefined)
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
