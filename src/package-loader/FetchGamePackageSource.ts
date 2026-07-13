import type {
	GamePackageSource,
	LocatedGameCatalog,
	LocatedGamePackage,
} from '../types'
import { packageError } from './errors'
import { parseCatalog } from './schemas'

function catalogUrl(): string {
	const base = new URL(import.meta.env.BASE_URL, window.location.origin)
	return new URL('games/catalog.json', base).href
}

/**
 * 通过同源 HTTP 资源读取游戏包。
 *
 * JavaScript registry 以 Blob URL 导入，既保持包的 ESM 形式，也避免把外部包
 * 直接纳入应用构建图；包脚本仍然必须来自当前 origin 并被视为可信代码。
 */
export class FetchGamePackageSource implements GamePackageSource {
	/** 读取并校验 catalog，同时检查包身份和默认版本引用。 */
	async list(): Promise<LocatedGameCatalog> {
		const location = catalogUrl()
		try {
			const catalog = parseCatalog(await this.readJson(location))
			const identities = new Set<string>()
			const packages: LocatedGamePackage[] = catalog.games.map((descriptor) => {
				const identity = `${descriptor.id}\u0000${descriptor.version}`
				if (identities.has(identity)) {
					throw new Error(`Duplicate catalog package ${descriptor.id}@${descriptor.version}`)
				}
				identities.add(identity)
				return {
					descriptor,
					manifestLocation: this.resolve(location, descriptor.manifest),
					coverLocation: descriptor.cover
						? this.resolve(location, descriptor.cover)
						: undefined,
				}
			})

			for (const [id, version] of Object.entries(catalog.defaultVersions)) {
				if (!identities.has(`${id}\u0000${version}`)) {
					throw new Error(`Default version ${id}@${version} is missing from catalog`)
				}
			}
			for (const id of new Set(packages.map((item) => item.descriptor.id))) {
				if (!catalog.defaultVersions[id]) {
					throw new Error(`Game ${id} has no default version`)
				}
			}

			return { packages, defaultVersions: catalog.defaultVersions }
		} catch (error) {
			throw packageError('catalog', error, { resourceLocation: location })
		}
	}

	/** 读取 JSON 文本并把网络、HTTP、解析错误转换为带位置的异常。 */
	async readJson<T>(location: string): Promise<T> {
		let response: Response
		try {
			response = await fetch(location, {
				cache: import.meta.env.DEV ? 'no-cache' : 'default',
			})
		} catch (error) {
			throw new Error(`Unable to fetch ${location}`, { cause: error })
		}
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} while fetching ${location}`)
		}
		const source = await response.text()
		try {
			return JSON.parse(source) as T
		} catch (error) {
			throw new Error(
				`Invalid JSON at ${location}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			)
		}
	}

	/**
	 * 读取可信 JavaScript registry，并以 ESM 模块对象返回。
	 *
	 * @param location 必须是同源且 JavaScript MIME 类型正确的 URL。
	 */
	async importTrustedModule(location: string): Promise<unknown> {
		const response = await fetch(location, {
			cache: import.meta.env.DEV ? 'no-cache' : 'default',
		})
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} while fetching ${location}`)
		}
		const mime = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
		if (!['text/javascript', 'application/javascript', 'text/ecmascript'].includes(mime)) {
			throw new Error(`Unexpected JavaScript MIME type “${mime || 'missing'}” at ${location}`)
		}
		const blobUrl = URL.createObjectURL(
			new Blob([await response.text()], { type: 'text/javascript' }),
		)
		try {
			return await import(/* @vite-ignore */ blobUrl)
		} finally {
			URL.revokeObjectURL(blobUrl)
		}
	}

	/** 将 manifest 相对路径解析为同源绝对 URL。 */
	resolve(base: string, reference: string): string {
		const resolved = new URL(reference, base)
		if (!['http:', 'https:'].includes(resolved.protocol)) {
			throw new Error(`Unsupported package protocol ${resolved.protocol}`)
		}
		if (resolved.origin !== window.location.origin) {
			throw new Error(`Cross-origin package resource is not allowed: ${resolved.href}`)
		}
		return resolved.href
	}
}
