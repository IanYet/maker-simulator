import type {
	GamePackageDescriptor,
	LoadedGamePackage,
	LocatedGameCatalog,
	LocatedGamePackage,
	Profile,
	TurnRef,
} from '../types'
import { FetchGamePackageSource, GamePackageLoader } from '../package-loader'
import { AppMetadataRepository, IndexedDbSaveRepository } from '../persistence'
import { GameplayRuntimeImpl, addRestartRun, createMonitorFactory, createProfile } from '../runtime'
import { GameSessionImpl, SaveBrowserControllerImpl } from '../session'

type Navigate = (path: string, options?: { replace?: boolean }) => void

export interface GameListItem {
	readonly descriptor: GamePackageDescriptor
	readonly location: LocatedGamePackage
	readonly package?: LoadedGamePackage
	readonly error?: string
	readonly saveCount: number
}

export class AppServices {
	readonly saves = new IndexedDbSaveRepository()
	readonly metadata = new AppMetadataRepository()
	readonly packages = new GamePackageLoader(new FetchGamePackageSource())
	readonly monitorFactory = createMonitorFactory()
	#catalog?: Promise<LocatedGameCatalog>

	getCatalog(): Promise<LocatedGameCatalog> {
		this.#catalog ??= this.packages.list()
		return this.#catalog
	}

	async listGames(): Promise<readonly GameListItem[]> {
		const catalog = await this.getCatalog()
		const ids = [...new Set(catalog.packages.map((item) => item.descriptor.id))].sort()
		return Promise.all(ids.map(async (id) => {
			const version = catalog.defaultVersions[id]
			const location = catalog.packages.find(
				(item) => item.descriptor.id === id && item.descriptor.version === version,
			)
			if (!location) throw new Error(`Default package ${id}@${version} is unavailable`)
			const saveCount = (await this.saves.listByConfigId(id)).length
			try {
				return {
					descriptor: location.descriptor as GamePackageDescriptor,
					location,
					package: await this.packages.load(location),
					saveCount,
				}
			} catch (error) {
				return {
					descriptor: location.descriptor as GamePackageDescriptor,
					location,
					error: error instanceof Error ? error.message : String(error),
					saveCount,
				}
			}
		}))
	}

	async getDefaultPackage(gameId: string): Promise<LoadedGamePackage> {
		const catalog = await this.getCatalog()
		const version = catalog.defaultVersions[gameId]
		if (!version) throw new Error(`Game “${gameId}” is not in the catalog`)
		const location = catalog.packages.find(
			(item) => item.descriptor.id === gameId && item.descriptor.version === version,
		)
		if (!location) throw new Error(`Default package ${gameId}@${version} is unavailable`)
		return this.packages.load(location)
	}

	async createNewGame(gameId: string): Promise<Profile> {
		const game = await this.getDefaultPackage(gameId)
		const profile = createProfile(game)
		const runtime = await GameplayRuntimeImpl.create(game, profile, this.saves, this.monitorFactory)
		const saved = runtime.getProfile()
		runtime.dispose()
		await this.metadata.setRecentProfile(gameId, profile.profileId)
		return saved
	}

	async openSession(profileId: string, navigate: Navigate): Promise<GameSessionImpl> {
		const profile = await this.saves.get(profileId)
		if (!profile) throw new Error('The requested save does not exist')
		const game = await this.packages.loadExact(profile.configId, profile.configVersion)
		const runtime = await GameplayRuntimeImpl.open(game, profile, this.saves, this.monitorFactory)
		await this.metadata.setRecentProfile(profile.configId, profile.profileId)
		return new GameSessionImpl(runtime, this.saves, this.metadata, navigate)
	}

	async openResult(profileId: string, source: TurnRef): Promise<GameplayRuntimeImpl> {
		const stored = await this.saves.get(profileId)
		if (!stored) throw new Error('The requested save does not exist')
		const profile = structuredClone(stored)
		const run = profile.runDatas[source.runId]
		const turn = run?.turnDatas[source.turnId]
		if (!run || !turn || (turn.kind !== 'terminal' && turn.kind !== 'abandoned')) {
			throw new Error('The requested result checkpoint does not exist')
		}
		profile.current = { ...source }
		profile.state = structuredClone(turn.snapshot.profileState)
		run.state = structuredClone(turn.snapshot.runState)
		run.turnState = structuredClone(turn.snapshot.turnState)
		run.randomState = structuredClone(turn.snapshot.randomState)
		const game = await this.packages.loadExact(profile.configId, profile.configVersion)
		return GameplayRuntimeImpl.open(game, profile, this.saves, this.monitorFactory)
	}

	async restart(profileId: string, source: TurnRef): Promise<void> {
		const profile = await this.saves.get(profileId)
		if (!profile) throw new Error('The requested save does not exist')
		const game = await this.packages.loadExact(profile.configId, profile.configVersion)
		const next = addRestartRun(profile, game, source)
		await this.saves.put(next)
		await this.metadata.setRecentProfile(next.configId, next.profileId)
	}

	createSaveController(profileId: string): SaveBrowserControllerImpl {
		return new SaveBrowserControllerImpl(profileId, this.saves, this.metadata)
	}
}
