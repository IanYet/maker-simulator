import type { Profile } from '../types'
import { getDatabase } from './database'
import { validateProfile } from './validation'

/** Profile 持久化边界；实现可以是 IndexedDB、测试内存或其他存储。 */
export interface SaveRepository {
	listByConfigId(configId: string): Promise<readonly Profile[]>
	get(profileId: string): Promise<Profile | undefined>
	put(profile: Profile): Promise<void>
}

/** 使用浏览器 IndexedDB 保存经过 schema 校验的完整 Profile。 */
export class IndexedDbSaveRepository implements SaveRepository {
	/** 按 Config id 查询并按更新时间倒序返回存档。 */
	async listByConfigId(configId: string): Promise<readonly Profile[]> {
		const database = await getDatabase()
		const records = await database.getAllFromIndex('profiles', 'by-config-id', configId)
		return records
			.map((record) => validateProfile(record))
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
	}

	/** 读取单个 Profile；找不到时返回 undefined。 */
	async get(profileId: string): Promise<Profile | undefined> {
		const record = await (await getDatabase()).get('profiles', profileId)
		return record === undefined ? undefined : validateProfile(record)
	}

	/** 克隆、校验并原子写入 Profile。 */
	async put(profile: Profile): Promise<void> {
		const copy = structuredClone(profile)
		validateProfile(copy)
		const database = await getDatabase()
		const transaction = database.transaction('profiles', 'readwrite')
		await transaction.store.put(copy)
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
