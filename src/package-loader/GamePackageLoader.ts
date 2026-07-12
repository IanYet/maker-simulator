import { z } from 'zod'
import type {
	GamePackageSource,
	LoadedGamePackage,
	LocatedGameCatalog,
	LocatedGamePackage,
} from '../types'
import { GamePackageLoadError, packageError } from './errors'
import { deepFreeze, linkConfig, validateRegistries } from './linker'
import { parseConfig, parseManifest } from './schemas'

export class GamePackageLoader {
	readonly #cache = new Map<string, Promise<LoadedGamePackage>>()
	private readonly source: GamePackageSource

	constructor(source: GamePackageSource) {
		this.source = source
	}

	list(): Promise<LocatedGameCatalog> {
		return this.source.list()
	}

	load(location: LocatedGamePackage): Promise<LoadedGamePackage> {
		const key = `${location.descriptor.id}@${location.descriptor.version}`
		const cached = this.#cache.get(key)
		if (cached) return cached
		const loading = this.loadUncached(location).catch((error: unknown) => {
			this.#cache.delete(key)
			throw error
		})
		this.#cache.set(key, loading)
		return loading
	}

	async loadExact(id: string, version: string): Promise<LoadedGamePackage> {
		const catalog = await this.list()
		const location = catalog.packages.find(
			(item) => item.descriptor.id === id && item.descriptor.version === version,
		)
		if (!location) {
			throw new GamePackageLoadError('catalog', `Package ${id}@${version} is not available`, {
				packageId: id,
				packageVersion: version,
			})
		}
		return this.load(location)
	}

	private async loadUncached(location: LocatedGamePackage): Promise<LoadedGamePackage> {
		const details = {
			packageId: location.descriptor.id,
			packageVersion: location.descriptor.version,
		}
		let manifest
		try {
			manifest = parseManifest(await this.source.readJson(location.manifestLocation))
		} catch (error) {
			const stage = error instanceof z.ZodError ? 'schema-validation' : 'manifest'
			throw packageError(stage, error, { ...details, path: location.manifestLocation })
		}

		if (
			manifest.id !== location.descriptor.id ||
			manifest.version !== location.descriptor.version ||
			manifest.name !== location.descriptor.name
		) {
			throw new GamePackageLoadError('linking', 'Descriptor and manifest identity mismatch', details)
		}

		const configLocation = this.source.resolve(location.manifestLocation, manifest.entries.config)
		const rulesLocation = this.source.resolve(location.manifestLocation, manifest.entries.rules)
		const actionsLocation = this.source.resolve(location.manifestLocation, manifest.entries.actions)
		const [configInput, ruleModule, actionModule] = await Promise.all([
			this.source.readJson(configLocation).catch((error: unknown) => {
				throw packageError('config', error, { ...details, path: configLocation })
			}),
			this.source.importTrustedModule(rulesLocation).catch((error: unknown) => {
				throw packageError('module-import', error, { ...details, path: rulesLocation })
			}),
			this.source.importTrustedModule(actionsLocation).catch((error: unknown) => {
				throw packageError('module-import', error, { ...details, path: actionsLocation })
			}),
		])

		let config
		try {
			config = parseConfig(configInput)
		} catch (error) {
			throw packageError('schema-validation', error, { ...details, path: configLocation })
		}
		const { rules, actions } = validateRegistries(ruleModule, actionModule)
		linkConfig(location.descriptor, manifest, config, rules, actions)

		return deepFreeze({
			location,
			manifest,
			config,
			rules,
			actions,
			assetsBaseLocation: this.source.resolve(
				location.manifestLocation,
				manifest.assets ?? './',
			),
		})
	}
}
