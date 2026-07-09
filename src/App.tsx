import { useEffect, useState } from 'react'
import { GameScreen } from './components/GameScreen'
import { SaveScreen } from './components/SaveScreen'
import { loadContent } from './game/content'
import {
  abandonRun,
  continueEvent,
  createSaveData,
  createSession,
  nextTurn,
  startEvent,
  startRun,
  submitChoice,
  type ChoiceSelection,
  type GameSession,
} from './game/engine'
import {
  deleteSave,
  listSaves,
  loadRunStore,
  persistSession,
  type SaveRecord,
} from './game/persistence'
import type { ValidationWarning } from './game/validation'
import type { GameModelData } from './types'

/** 默认加载的示例内容地址。 */
const contentUrl = new URL('../docs/example/demo2/demo2.json', import.meta.url).href

/** 应用顶层视图状态。 */
type AppView =
  /** 正在加载内容。 */
  | { type: 'loading' }
  /** 内容加载或校验失败。 */
  | { type: 'error'; message: string }
  /** 展示本机存档列表。 */
  | {
      type: 'saves'
      /** 默认内容数据。 */
      defaultData: GameModelData
      /** 内容校验警告。 */
      warnings: ValidationWarning[]
      /** 本机存档列表。 */
      saves: SaveRecord[]
    }
  /** 展示进行中游戏界面。 */
  | {
      type: 'game'
      /** 当前游戏会话。 */
      session: GameSession
      /** 当前存档名称。 */
      saveName: string
      /** 内容校验警告。 */
      warnings: ValidationWarning[]
    }

/**
 * 将未知异常转换为可展示的错误文本。
 *
 * @param error - 捕获到的未知异常。
 * @returns 面向用户展示的错误信息。
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误'
}

/**
 * 应用根组件，负责加载内容、切换存档页和游戏页，并串联持久化。
 *
 * @returns 应用根界面。
 */
function App() {
  const [view, setView] = useState<AppView>({ type: 'loading' })
  const [busy, setBusy] = useState(false)
  const [commandError, setCommandError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    /**
     * 加载内容 JSON，并读取当前内容对应的本机存档。
     */
    const initialize = async () => {
      try {
        const content = await loadContent(contentUrl)
        const saves = await listSaves(content.data.meta.id)
        if (active) setView({ type: 'saves', defaultData: content.data, warnings: content.warnings, saves })
      } catch (error) {
        if (active) setView({ type: 'error', message: errorMessage(error) })
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [])

  /**
   * 基于默认内容创建新的玩家存档并进入游戏页。
   *
   * @param name - 玩家输入或自动生成的存档名称。
   */
  const createSave = async (name: string) => {
    if (view.type !== 'saves') return
    setBusy(true)
    setCommandError(null)
    try {
      const session = createSession(
        crypto.randomUUID(),
        view.defaultData,
        createSaveData(view.defaultData),
        null,
      )
      await persistSession(session, name)
      setView({ type: 'game', session, saveName: name, warnings: view.warnings })
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 打开已有玩家存档，并尽量恢复进行中的局。
   *
   * @param record - 要打开的存档记录。
   */
  const openSave = async (record: SaveRecord) => {
    if (view.type !== 'saves') return
    setBusy(true)
    setCommandError(null)
    try {
      const runStore = await loadRunStore(record.saveId)
      const session = createSession(record.saveId, view.defaultData, record.saveData, runStore)
      setView({ type: 'game', session, saveName: record.name, warnings: view.warnings })
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 删除指定玩家存档。
   *
   * @param record - 要删除的存档记录。
   */
  const removeSave = async (record: SaveRecord) => {
    if (view.type !== 'saves' || !window.confirm(`确认删除存档“${record.name}”？`)) return
    setBusy(true)
    setCommandError(null)
    try {
      await deleteSave(record.saveId)
      setView({ ...view, saves: view.saves.filter((save) => save.saveId !== record.saveId) })
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 执行一个游戏引擎命令，并在成功后持久化完整会话。
   *
   * @param command - 接收当前会话并返回新会话的引擎命令。
   */
  const execute = async (command: (session: GameSession) => GameSession) => {
    if (view.type !== 'game') return
    setBusy(true)
    setCommandError(null)
    try {
      const session = command(view.session)
      await persistSession(session, view.saveName)
      setView({ ...view, session })
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 从游戏页返回存档列表，并刷新 IndexedDB 中的存档记录。
   */
  const backToSaves = async () => {
    if (view.type !== 'game') return
    setBusy(true)
    try {
      const saves = await listSaves(view.session.defaultData.meta.id)
      setCommandError(null)
      setView({
        type: 'saves',
        defaultData: view.session.defaultData,
        warnings: view.warnings,
        saves,
      })
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (view.type === 'loading') {
    return <main className="center-state"><div className="spinner" /><p>正在加载并校验游戏内容…</p></main>
  }

  if (view.type === 'error') {
    return (
      <main className="center-state error-state">
        <h1>内容加载失败</h1>
        <pre>{view.message}</pre>
      </main>
    )
  }

  if (view.type === 'saves') {
    return (
      <>
        {commandError && <div className="floating-error">{commandError}</div>}
        <SaveScreen
          contentId={view.defaultData.meta.id}
          contentVersion={view.defaultData.meta.version}
          saves={view.saves}
          warnings={view.warnings}
          busy={busy}
          onCreate={(name) => void createSave(name)}
          onOpen={(record) => void openSave(record)}
          onDelete={(record) => void removeSave(record)}
        />
      </>
    )
  }

  return (
    <GameScreen
      session={view.session}
      saveName={view.saveName}
      busy={busy}
      error={commandError}
      onStartRun={() => void execute(startRun)}
      onStartEvent={(eventId) => void execute((session) => startEvent(session, eventId))}
      onContinueEvent={(eventId) => void execute((session) => continueEvent(session, eventId))}
      onSubmitChoice={(eventId: string, nodeId: string, selections: ChoiceSelection[]) =>
        void execute((session) => submitChoice(session, eventId, nodeId, selections))}
      onNextTurn={() => void execute(nextTurn)}
      onAbandon={() => {
        if (window.confirm('确认放弃当前局？局内状态和快照会被删除。')) void execute(abandonRun)
      }}
      onBack={() => void backToSaves()}
    />
  )
}

export default App
