import type { Profile } from '../types'
import { getDatabase } from './database'
import { validateProfile } from './validation'

export interface SaveRepository {
	listByConfigId(configId: string): Promise<readonly Profile[]>
	get(profileId: string): Promise<Profile | undefined>
	put(profile: Profile): Promise<void>
}

export class IndexedDbSaveRepository implements SaveRepository {
	async listByConfigId(configId: string): Promise<readonly Profile[]> {
		const database = await getDatabase()
		const records = await database.getAllFromIndex('profiles', 'by-config-id', configId)
		return records
			.map((record) => validateProfile(record))
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
	}

	async get(profileId: string): Promise<Profile | undefined> {
		const record = await (await getDatabase()).get('profiles', profileId)
		return record === undefined ? undefined : validateProfile(record)
	}

	async put(profile: Profile): Promise<void> {
		const copy = structuredClone(profile)
		validateProfile(copy)
		const database = await getDatabase()
		const transaction = database.transaction('profiles', 'readwrite')
		await transaction.store.put(copy)
		await transaction.done
	}
}

export class AppMetadataRepository {
	async getRecentProfile(configId: string): Promise<string | undefined> {
		return (await (await getDatabase()).get('app-metadata', `recent-profile:${configId}`))?.value
	}

	async setRecentProfile(configId: string, profileId: string): Promise<void> {
		const database = await getDatabase()
		const transaction = database.transaction('app-metadata', 'readwrite')
		await transaction.store.put({ key: `recent-profile:${configId}`, value: profileId })
		await transaction.done
	}
}
