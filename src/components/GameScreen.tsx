import type { GameSession, ChoiceSelection } from '../game/engine'
import { CharacterPanel } from './CharacterPanel'
import { EffectPanel } from './EffectPanel'
import { EventPanel } from './EventPanel'

/** 游戏主界面组件参数。 */
interface GameScreenProps {
  /** 当前游戏会话。 */
  session: GameSession
  /** 当前玩家存档名称。 */
  saveName: string
  /** 是否正在执行异步命令。 */
  busy: boolean
  /** 最近一次命令错误信息。 */
  error: string | null
  /** 开始新局回调。 */
  onStartRun: () => void
  /** 手动启动事件回调。 */
  onStartEvent: (eventId: string) => void
  /** 继续当前事件节点回调。 */
  onContinueEvent: (eventId: string) => void
  /** 提交选择节点回调。 */
  onSubmitChoice: (eventId: string, nodeId: string, selections: ChoiceSelection[]) => void
  /** 进入下一回合回调。 */
  onNextTurn: () => void
  /** 放弃当前局回调。 */
  onAbandon: () => void
  /** 返回存档列表回调。 */
  onBack: () => void
}

/**
 * 组装游戏进行中界面。
 *
 * @param props - 游戏主界面组件参数。
 * @returns 游戏主界面。
 */
export function GameScreen({
  session,
  saveName,
  busy,
  error,
  onStartRun,
  onStartEvent,
  onContinueEvent,
  onSubmitChoice,
  onNextTurn,
  onAbandon,
  onBack,
}: GameScreenProps) {
  const run = session.runStore?.currentRun

  return (
    <main className="page game-page">
      <header className="game-header">
        <div>
          <p className="eyebrow">{saveName}</p>
          <h1>Maker Simulator</h1>
        </div>
        <div className="header-actions">
          {run && (
            <>
              <span className="turn-badge">第 {run.meta.turn} 回合</span>
              <span className="step-badge">{run.meta.step}</span>
            </>
          )}
          <button disabled={busy} onClick={onBack}>存档列表</button>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {!run ? (
        <section className="panel start-run-panel">
          <p className="eyebrow">玩家存档已就绪</p>
          <h2>开始一局</h2>
          <p>将从玩家存档深拷贝局内状态，并用新的确定性随机种子开始第 1 回合。</p>
          <button className="primary" disabled={busy} onClick={onStartRun}>开始新局</button>
        </section>
      ) : (
        <>
          <CharacterPanel character={run.character} />
          <EventPanel
            session={session}
            busy={busy}
            onStart={onStartEvent}
            onContinue={onContinueEvent}
            onSubmit={onSubmitChoice}
          />
          <EffectPanel effects={run.effects} effectKinds={run.effectKinds} />
          <section className="panel footer-actions">
            <div>
              <p className="eyebrow">当前阶段</p>
              <strong>{run.meta.step}</strong>
              <p className="muted">
                已保存 {session.runStore?.turnSnapshots.length ?? 0} 个完整回合快照
              </p>
            </div>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || run.meta.step !== 'next_turn'}
                onClick={onNextTurn}
              >
                下一回合
              </button>
              <button className="danger-quiet" disabled={busy} onClick={onAbandon}>放弃本局</button>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
