import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StoredProfile } from '../types'

interface AppMetadataRecord {
	key: string
	value: string
}

interface MakerSimulatorDatabase extends DBSchema {
	profiles: {
		key: string
		value: StoredProfile
		indexes: {
			'by-config-id': string
			'by-updated-at': string
		}
	}
	'app-metadata': {
		key: string
		value: AppMetadataRecord
	}
}

let databasePromise: Promise<IDBPDatabase<MakerSimulatorDatabase>> | undefined
const DATABASE_VERSION = 3

/**
 * 打开并缓存 Maker Simulator 的 IndexedDB 连接。
 *
 * 当前仍处于开发期，不维护旧存档迁移；结构升级时清空旧 Profile 和应用元数据。
 */
export function getDatabase(): Promise<IDBPDatabase<MakerSimulatorDatabase>> {
	databasePromise ??= openDB<MakerSimulatorDatabase>('maker-simulator', DATABASE_VERSION, {
		upgrade(database, oldVersion, _newVersion, transaction) {
			const profiles = database.objectStoreNames.contains('profiles')
				? transaction.objectStore('profiles')
				: database.createObjectStore('profiles', { keyPath: 'profileId' })

			if (!profiles.indexNames.contains('by-config-id')) {
				profiles.createIndex('by-config-id', 'configId')
			}
			if (!profiles.indexNames.contains('by-updated-at')) {
				profiles.createIndex('by-updated-at', 'updatedAt')
			}
			const metadata = database.objectStoreNames.contains('app-metadata')
				? transaction.objectStore('app-metadata')
				: database.createObjectStore('app-metadata', { keyPath: 'key' })

			if (oldVersion > 0 && oldVersion < DATABASE_VERSION) {
				void profiles.clear()
				void metadata.clear()
			}
		},
		blocking() {
			databasePromise?.then((database) => database.close()).catch(() => undefined)
		},
	}).catch((error: unknown) => {
		databasePromise = undefined
		throw error
	})
	return databasePromise
}
