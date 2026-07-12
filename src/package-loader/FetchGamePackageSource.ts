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

export class FetchGamePackageSource implements GamePackageSource {
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
			throw packageError('catalog', error, { path: location })
		}
	}

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
