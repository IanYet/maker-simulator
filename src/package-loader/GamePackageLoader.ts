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

function zodJsonPointer(error: unknown): string | undefined {
	if (!(error instanceof z.ZodError)) return undefined
	const issue = error.issues[0]
	if (!issue) return ''
	return issue.path.reduce<string>(
		(path, segment) => `${path}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`,
		'',
	)
}

/**
 * 负责发现、校验、链接并缓存外部游戏包。
 *
 * 缓存键使用 `id@version`，失败的加载不会留在缓存中，便于开发时修复包后重试。
 */
export class GamePackageLoader {
	readonly #cache = new Map<string, Promise<LoadedGamePackage>>()
	private readonly source: GamePackageSource

	constructor(source: GamePackageSource) {
		this.source = source
	}

	/** 返回当前 catalog 解析后的包位置和默认版本映射。 */
	list(): Promise<LocatedGameCatalog> {
		return this.source.list()
	}

	/**
	 * 加载一个 catalog 已定位的包，并复用同一版本的并发加载请求。
	 *
	 * @param location 包的 manifest、资源位置和 catalog 描述。
	 * @returns 通过 schema/linking 校验并深度冻结的游戏包。
	 */
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

	/**
	 * 按稳定的包 id 与版本加载精确内容。
	 *
	 * @param id catalog 中的游戏包 id。
	 * @param version 存档或调用方要求的精确版本。
	 * @throws {GamePackageLoadError} catalog 中没有对应版本时抛出。
	 */
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

	/** 执行一次不读缓存的 manifest、资源、schema 和 registry 校验流程。 */
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
			throw packageError(stage, error, {
				...details,
				resourceLocation: location.manifestLocation,
				jsonPointer: zodJsonPointer(error),
			})
		}

		if (
			manifest.id !== location.descriptor.id ||
			manifest.version !== location.descriptor.version ||
			manifest.name !== location.descriptor.name
		) {
			throw new GamePackageLoadError(
				'linking',
				'Descriptor and manifest identity mismatch',
				details,
			)
		}

		const configLocation = this.source.resolve(location.manifestLocation, manifest.entries.config)
		const rulesLocation = this.source.resolve(location.manifestLocation, manifest.entries.rules)
		const actionsLocation = this.source.resolve(location.manifestLocation, manifest.entries.actions)
		const [configInput, ruleModule, actionModule] = await Promise.all([
			this.source.readJson(configLocation).catch((error: unknown) => {
				throw packageError('config', error, { ...details, resourceLocation: configLocation })
			}),
			this.source.importTrustedModule(rulesLocation).catch((error: unknown) => {
				throw packageError('module-import', error, { ...details, resourceLocation: rulesLocation })
			}),
			this.source.importTrustedModule(actionsLocation).catch((error: unknown) => {
				throw packageError('module-import', error, {
					...details,
					resourceLocation: actionsLocation,
				})
			}),
		])

		let config
		try {
			config = parseConfig(configInput)
		} catch (error) {
			throw packageError('schema-validation', error, {
				...details,
				resourceLocation: configLocation,
				jsonPointer: zodJsonPointer(error),
			})
		}
		let registries
		try {
			registries = validateRegistries(ruleModule, actionModule)
			linkConfig(location.descriptor, manifest, config, registries.rules, registries.actions)
		} catch (error) {
			throw packageError(
				error instanceof GamePackageLoadError ? error.stage : 'linking',
				error,
				details,
			)
		}
		const { rules, actions } = registries

		return deepFreeze({
			location,
			manifest,
			config,
			rules,
			actions,
			assetsBaseLocation: this.source.resolve(location.manifestLocation, manifest.assets ?? './'),
		})
	}
}
