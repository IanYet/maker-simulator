import { useMemo, useState } from 'react'
import type { ChoiceNode, GameEvent } from '../types'
import {
  activeInteractiveEvents,
  getAvailableChoices,
  getQuantityBounds,
  pendingManualEvents,
  type ChoiceSelection,
  type GameSession,
} from '../game/engine'

interface EventPanelProps {
  session: GameSession
  busy: boolean
  onStart: (eventId: string) => void
  onContinue: (eventId: string) => void
  onSubmit: (eventId: string, nodeId: string, selections: ChoiceSelection[]) => void
}

export function EventPanel({ session, busy, onStart, onContinue, onSubmit }: EventPanelProps) {
  const run = session.runStore?.currentRun
  if (!run) return null
  const active = activeInteractiveEvents(run)
  const manual = pendingManualEvents(run)
  const focus = active[0]

  return (
    <section className="panel event-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">有向事件图</p>
          <h2>事件</h2>
        </div>
        <span className="count">{run.events.filter((event) => event.appeared || event.currentNode).length}</span>
      </div>

      {focus ? (
        <ActiveEvent
          key={`${focus.id}:${focus.currentNode}`}
          event={focus}
          session={session}
          busy={busy}
          onContinue={onContinue}
          onSubmit={onSubmit}
        />
      ) : (
        <div className="empty-state">
          {manual.length > 0 ? '请选择一个已出现的事件。' : '当前没有需要输入的事件。'}
        </div>
      )}

      {manual.length > 0 && (
        <div className="manual-events">
          <h3>待启动事件</h3>
          {manual.map((event) => (
            <article className={`manual-card visibility-${event.visibility}`} key={event.id}>
              <div>
                <span className="visibility-label">{event.visibility === 'foreground' ? '前台' : '后台'}</span>
                <h4>{event.name}</h4>
                <p className="muted">剩余 {event.remainingTurns} 回合 · {event.id}</p>
              </div>
              <button className="primary" disabled={busy} onClick={() => onStart(event.id)}>开始处理</button>
            </article>
          ))}
        </div>
      )}

      <details className="event-overview">
        <summary>全部事件状态（{run.events.length}）</summary>
        <div className="event-list">
          {run.events.map((event) => (
            <article className={`event-row visibility-${event.visibility}`} key={event.id}>
              <div>
                <strong>{event.name}</strong>
                <span className="id-text">{event.id}</span>
              </div>
              <div className="event-state">
                <span>{event.startMode === 'auto' ? '自动' : '手动'}</span>
                <span>{event.currentNode ? `节点 ${event.currentNode}` : event.appeared ? '已出现' : '未出现'}</span>
                <span>{event.completed ? `已完成 · ${event.result ?? '无结果'}` : `发生 ${event.occurrences} 次`}</span>
              </div>
            </article>
          ))}
        </div>
      </details>
    </section>
  )
}

interface ActiveEventProps {
  event: GameEvent
  session: GameSession
  busy: boolean
  onContinue: (eventId: string) => void
  onSubmit: (eventId: string, nodeId: string, selections: ChoiceSelection[]) => void
}

function ActiveEvent({ event, session, busy, onContinue, onSubmit }: ActiveEventProps) {
  const node = event.nodes.find((item) => item.id === event.currentNode)
  if (!node) return null
  const canContinue = node.type === 'text'
    || (node.type === 'result' && node.completeEvent)
    || (node.type === 'action' && Boolean(node.text))

  return (
    <article className={`active-event visibility-${event.visibility}`}>
      <div className="active-event-heading">
        <div>
          <span className="visibility-label">{event.visibility === 'foreground' ? '前台事件' : '后台事件'}</span>
          <h3>{event.name}</h3>
        </div>
        <span className="node-label">{node.type} · {node.id}</span>
      </div>
      {node.text && <p className="event-text">{node.text}</p>}
      {node.type === 'choice' && (
        <ChoiceForm
          node={node}
          event={event}
          session={session}
          busy={busy}
          onSubmit={onSubmit}
        />
      )}
      {canContinue && (
        <button className="primary wide" disabled={busy} onClick={() => onContinue(event.id)}>
          {node.type === 'result' ? '确认结果' : '继续'}
        </button>
      )}
    </article>
  )
}

interface ChoiceFormProps {
  node: ChoiceNode
  event: GameEvent
  session: GameSession
  busy: boolean
  onSubmit: (eventId: string, nodeId: string, selections: ChoiceSelection[]) => void
}

function ChoiceForm({ node, event, session, busy, onSubmit }: ChoiceFormProps) {
  const choices = useMemo(() => getAvailableChoices(session, event.id), [session, event.id])
  const bounds = useMemo(() => new Map(choices.flatMap((choice) => {
    if (node.mode !== 'quantity' || !choice.quantity) return []
    return [[choice.id, getQuantityBounds(session, event.id, choice.id)]]
  })), [choices, event.id, node.mode, session])
  const [selected, setSelected] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(Array.from(bounds, ([id, value]) => [id, value.defaultValue])),
  )

  const toggle = (choiceId: string) => {
    if (node.mode === 'single') {
      setSelected([choiceId])
      return
    }
    setSelected((current) =>
      current.includes(choiceId)
        ? current.filter((id) => id !== choiceId)
        : [...current, choiceId],
    )
  }

  const submit = () => {
    const selections = selected.map((choiceId) => ({
      choiceId,
      quantity: node.mode === 'quantity' ? quantities[choiceId] : undefined,
    }))
    onSubmit(event.id, node.id, selections)
  }
  const minSelections = node.mode === 'single' ? 1 : node.minSelections ?? 0
  const maxSelections = node.mode === 'single' ? 1 : node.maxSelections ?? choices.length
  const selectionCountValid = selected.length >= minSelections && selected.length <= maxSelections

  return (
    <div className="choice-form">
      {choices.map((choice) => {
        const checked = selected.includes(choice.id)
        const quantity = bounds.get(choice.id)
        return (
          <label className={`choice-card ${checked ? 'is-selected' : ''}`} key={choice.id}>
            <input
              type={node.mode === 'single' ? 'radio' : 'checkbox'}
              name="event-choice"
              checked={checked}
              disabled={busy}
              onChange={() => toggle(choice.id)}
            />
            <span className="choice-text">{choice.text}</span>
            {quantity && (
              <input
                className="quantity-input"
                type="number"
                min={quantity.min}
                max={quantity.max}
                step={quantity.step}
                value={quantities[choice.id]}
                disabled={busy || !checked}
                onChange={(inputEvent) => setQuantities((current) => ({
                  ...current,
                  [choice.id]: inputEvent.target.valueAsNumber,
                }))}
              />
            )}
          </label>
        )
      })}
      {choices.length === 0 && <p className="warning-text">当前没有可用选项。</p>}
      <button className="primary wide" disabled={busy || !selectionCountValid} onClick={submit}>
        提交选择
      </button>
    </div>
  )
}
