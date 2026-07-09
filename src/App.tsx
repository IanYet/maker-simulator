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

const contentUrl = new URL('../docs/example/demo2/demo2.json', import.meta.url).href

type AppView =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | {
      type: 'saves'
      defaultData: GameModelData
      warnings: ValidationWarning[]
      saves: SaveRecord[]
    }
  | {
      type: 'game'
      session: GameSession
      saveName: string
      warnings: ValidationWarning[]
    }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误'
}

function App() {
  const [view, setView] = useState<AppView>({ type: 'loading' })
  const [busy, setBusy] = useState(false)
  const [commandError, setCommandError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
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
