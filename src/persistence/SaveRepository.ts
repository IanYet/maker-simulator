import type { StoredProfile } from '../types'
import { getDatabase } from './database'
import { validateStoredProfile } from './validation'

/** 无法解析的单条存档记录；列表查询保留错误但不影响其它存档。 */
export interface InvalidSaveRecord {
	readonly profileId?: string
	readonly message: string
}

/** 按游戏读取存档时返回的逐条校验结果。 */
export interface SaveListResult {
	readonly profiles: readonly StoredProfile[]
	readonly invalid: readonly InvalidSaveRecord[]
}

/** 存档已被另一个页面更新时抛出的并发冲突。 */
export class SaveConflictError extends Error {
	constructor(message = 'The save was updated elsewhere; reload it before trying again') {
		super(message)
		this.name = 'SaveConflictError'
	}
}

/** 稳定存档持久化边界；实现可以是 IndexedDB、测试内存或其他存储。 */
export interface SaveRepository {
	listByConfigId(configId: string): Promise<SaveListResult>
	get(profileId: string): Promise<StoredProfile | undefined>
	put(profile: StoredProfile): Promise<StoredProfile>
	delete(profileId: string, expectedStorageRevision: number): Promise<void>
}

function invalidRecord(record: unknown, error: unknown): InvalidSaveRecord {
	const profileId =
		record !== null &&
		typeof record === 'object' &&
		'profileId' in record &&
		typeof record.profileId === 'string'
			? record.profileId
			: undefined
	return {
		...(profileId ? { profileId } : {}),
		message: error instanceof Error ? error.message : String(error),
	}
}

/** 使用浏览器 IndexedDB 保存经过 schema 校验的稳定存档。 */
export class IndexedDbSaveRepository implements SaveRepository {
	/** 按 Config id 查询；单条坏档单独返回，不中断其余记录。 */
	async listByConfigId(configId: string): Promise<SaveListResult> {
		const database = await getDatabase()
		const records = await database.getAllFromIndex('profiles', 'by-config-id', configId)
		const profiles: StoredProfile[] = []
		const invalid: InvalidSaveRecord[] = []
		for (const record of records) {
			try {
				profiles.push(validateStoredProfile(record))
			} catch (error) {
				invalid.push(invalidRecord(record, error))
			}
		}
		profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		return { profiles, invalid }
	}

	/** 读取单个稳定存档；找不到时返回 undefined。 */
	async get(profileId: string): Promise<StoredProfile | undefined> {
		const record = await (await getDatabase()).get('profiles', profileId)
		return record === undefined ? undefined : validateStoredProfile(record)
	}

	/**
	 * 克隆并校验存档，在同一事务中比较 storageRevision 后写入下一版本。
	 *
	 * @throws {SaveConflictError} 调用方使用的存档不是数据库中的最新版本。
	 */
	async put(profile: StoredProfile): Promise<StoredProfile> {
		const candidate = validateStoredProfile(structuredClone(profile))
		const database = await getDatabase()
		const transaction = database.transaction('profiles', 'readwrite')
		const existingRecord = await transaction.store.get(candidate.profileId)
		if (existingRecord === undefined) {
			if (candidate.storageRevision !== 0) throw new SaveConflictError()
		} else {
			const existing = validateStoredProfile(existingRecord)
			if (existing.storageRevision !== candidate.storageRevision) throw new SaveConflictError()
		}
		const stored = validateStoredProfile({
			...candidate,
			storageRevision: candidate.storageRevision + 1,
		})
		await transaction.store.put(stored)
		await transaction.done
		return structuredClone(stored)
	}

	/**
	 * 在同一事务中比较 storageRevision 后删除存档。
	 *
	 * @throws {SaveConflictError} 存档已经被删除或调用方持有旧版本。
	 */
	async delete(profileId: string, expectedStorageRevision: number): Promise<void> {
		const database = await getDatabase()
		const transaction = database.transaction('profiles', 'readwrite')
		const existingRecord = await transaction.store.get(profileId)
		if (existingRecord === undefined) throw new SaveConflictError()
		const existing = validateStoredProfile(existingRecord)
		if (existing.storageRevision !== expectedStorageRevision) throw new SaveConflictError()
		await transaction.store.delete(profileId)
		await transaction.done
	}
}

/** 保存每个游戏最近访问的 Profile id 等应用级元数据。 */
export class AppMetadataRepository {
	/** 读取某个游戏最近访问的 Profile。 */
	async getRecentProfile(configId: string): Promise<string | undefined> {
		return (await (await getDatabase()).get('app-metadata', `recent-profile:${configId}`))?.value
	}

	/** 更新某个游戏最近访问的 Profile。 */
	async setRecentProfile(configId: string, profileId: string): Promise<void> {
		const database = await getDatabase()
		const transaction = database.transaction('app-metadata', 'readwrite')
		await transaction.store.put({ key: `recent-profile:${configId}`, value: profileId })
		await transaction.done
	}
}
