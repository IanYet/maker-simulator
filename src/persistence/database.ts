import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Profile } from '../types'

interface AppMetadataRecord {
	key: string
	value: string
}

interface MakerSimulatorDatabase extends DBSchema {
	profiles: {
		key: string
		value: Profile
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
const DATABASE_VERSION = 2

export function getDatabase(): Promise<IDBPDatabase<MakerSimulatorDatabase>> {
	databasePromise ??= openDB<MakerSimulatorDatabase>('maker-simulator', DATABASE_VERSION, {
		upgrade(database, _oldVersion, _newVersion, transaction) {
			const profiles = database.objectStoreNames.contains('profiles')
				? transaction.objectStore('profiles')
				: database.createObjectStore('profiles', { keyPath: 'profileId' })

			if (!profiles.indexNames.contains('by-config-id')) {
				profiles.createIndex('by-config-id', 'configId')
			}
			if (!profiles.indexNames.contains('by-updated-at')) {
				profiles.createIndex('by-updated-at', 'updatedAt')
			}
			if (!database.objectStoreNames.contains('app-metadata')) {
				database.createObjectStore('app-metadata', { keyPath: 'key' })
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
