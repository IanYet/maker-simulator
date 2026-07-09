import type { GameModelData, RunSnapshotStore, TurnSnapshot } from '../types'
import type { GameSession } from './engine'

export interface SaveRecord {
  saveId: string
  name: string
  contentId: string
  contentVersion: string
  updatedAt: string
  saveData: GameModelData
}

interface StoredSnapshot extends TurnSnapshot {
  saveId: string
}

const databaseName = 'maker-simulator'
const databaseVersion = 1

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('saves')) {
        database.createObjectStore('saves', { keyPath: 'saveId' })
      }
      if (!database.objectStoreNames.contains('runs')) {
        database.createObjectStore('runs')
      }
      if (!database.objectStoreNames.contains('snapshots')) {
        const snapshots = database.createObjectStore('snapshots', { keyPath: ['saveId', 'turn'] })
        snapshots.createIndex('saveId', 'saveId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'))
  })
}

export async function listSaves(contentId?: string): Promise<SaveRecord[]> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction('saves', 'readonly')
    const records = await requestResult(transaction.objectStore('saves').getAll() as IDBRequest<SaveRecord[]>)
    await transactionDone(transaction)
    return records
      .filter((record) => !contentId || record.contentId === contentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } finally {
    database.close()
  }
}

export async function loadSave(saveId: string): Promise<SaveRecord | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction('saves', 'readonly')
    const record = await requestResult(
      transaction.objectStore('saves').get(saveId) as IDBRequest<SaveRecord | undefined>,
    )
    await transactionDone(transaction)
    return record ?? null
  } finally {
    database.close()
  }
}

export async function loadRunStore(saveId: string): Promise<RunSnapshotStore | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(['runs', 'snapshots'], 'readonly')
    const currentRun = await requestResult(
      transaction.objectStore('runs').get(saveId) as IDBRequest<GameModelData | undefined>,
    )
    if (!currentRun) {
      await transactionDone(transaction)
      return null
    }
    const stored = await requestResult(
      transaction.objectStore('snapshots').index('saveId').getAll(saveId) as IDBRequest<StoredSnapshot[]>,
    )
    await transactionDone(transaction)
    return {
      saveId,
      currentRun,
      turnSnapshots: stored
        .sort((left, right) => left.turn - right.turn)
        .map(({ turn, data }) => ({ turn, data })),
    }
  } finally {
    database.close()
  }
}

export async function persistSession(
  session: GameSession,
  name: string,
): Promise<SaveRecord> {
  const database = await openDatabase()
  const record: SaveRecord = {
    saveId: session.saveId,
    name,
    contentId: session.saveData.meta.id,
    contentVersion: session.saveData.meta.version,
    updatedAt: new Date().toISOString(),
    saveData: structuredClone(session.saveData),
  }

  try {
    const transaction = database.transaction(['saves', 'runs', 'snapshots'], 'readwrite')
    transaction.objectStore('saves').put(record)
    const runs = transaction.objectStore('runs')
    const snapshots = transaction.objectStore('snapshots')

    if (session.runStore) {
      runs.put(structuredClone(session.runStore.currentRun), session.saveId)
      session.runStore.turnSnapshots.forEach((snapshot) => {
        const stored: StoredSnapshot = {
          saveId: session.saveId,
          turn: snapshot.turn,
          data: structuredClone(snapshot.data),
        }
        snapshots.put(stored)
      })
    } else {
      runs.delete(session.saveId)
      const keys = await requestResult(
        snapshots.index('saveId').getAllKeys(session.saveId),
      )
      keys.forEach((key) => snapshots.delete(key))
    }
    await transactionDone(transaction)
    return record
  } finally {
    database.close()
  }
}

export async function deleteSave(saveId: string): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(['saves', 'runs', 'snapshots'], 'readwrite')
    transaction.objectStore('saves').delete(saveId)
    transaction.objectStore('runs').delete(saveId)
    const snapshots = transaction.objectStore('snapshots')
    const keys = await requestResult(snapshots.index('saveId').getAllKeys(saveId))
    keys.forEach((key) => snapshots.delete(key))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}
