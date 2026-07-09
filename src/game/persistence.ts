import type { GameModelData, RunSnapshotStore, TurnSnapshot } from '../types'
import type { GameSession } from './engine'

/** IndexedDB 中保存的玩家存档记录。 */
export interface SaveRecord {
  /** 玩家存档唯一标识。 */
  saveId: string
  /** 玩家可见的存档名称。 */
  name: string
  /** 该存档所属的内容 ID。 */
  contentId: string
  /** 该存档创建或更新时对应的内容版本。 */
  contentVersion: string
  /** 最后更新时间的 ISO 字符串。 */
  updatedAt: string
  /** 完整玩家存档数据。 */
  saveData: GameModelData
}

/** IndexedDB 中按存档和回合索引的局内快照。 */
interface StoredSnapshot extends TurnSnapshot {
  /** 快照所属的玩家存档标识。 */
  saveId: string
}

/** IndexedDB 数据库名称。 */
const databaseName = 'maker-simulator'

/** IndexedDB 结构版本。 */
const databaseVersion = 1

/**
 * 将 IDBRequest 包装为 Promise，便于在持久化流程中串联使用。
 *
 * @param request - 原生 IndexedDB 请求对象。
 * @returns 请求成功后的结果。
 * @throws {Error} 当 IndexedDB 请求失败时抛出。
 */
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

/**
 * 等待 IndexedDB 事务完成。
 *
 * @param transaction - 需要等待的事务对象。
 * @returns 事务成功完成时 resolved 的 Promise。
 * @throws {Error} 当事务失败或中止时抛出。
 */
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'))
  })
}

/**
 * 打开项目使用的 IndexedDB，并在首次打开时创建对象仓库。
 *
 * @returns 已打开的 IndexedDB 数据库连接。
 * @throws {Error} 当浏览器无法打开数据库时抛出。
 */
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

/**
 * 读取当前浏览器中的玩家存档列表。
 *
 * @param contentId - 可选的内容 ID 过滤条件。
 * @returns 按更新时间倒序排列的存档记录。
 */
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

/**
 * 按存档 ID 读取单个玩家存档。
 *
 * @param saveId - 玩家存档标识。
 * @returns 找到的存档记录；不存在时返回 null。
 */
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

/**
 * 读取指定存档的当前局内数据和历史回合快照。
 *
 * @param saveId - 玩家存档标识。
 * @returns 局内快照容器；没有进行中局时返回 null。
 */
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

/**
 * 将完整会话写入 IndexedDB。
 *
 * @param session - 游戏会话，包含玩家存档与可选局内数据。
 * @param name - 玩家可见的存档名称。
 * @returns 写入后的存档记录。
 */
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

/**
 * 删除玩家存档及其关联的局内数据和快照。
 *
 * @param saveId - 要删除的玩家存档标识。
 * @returns 删除完成后的空 Promise。
 */
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
