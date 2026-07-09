import type {
  Choice,
  ChoiceNode,
  EventNode,
  GameEvent,
  GameModelData,
  RunSnapshotStore,
  TurnSnapshot,
} from '../types'
import { createSeed } from './rng'
import {
  evaluateConditions,
  executeActions,
  resolveValue,
  RuleError,
  runCombos,
  runTiming,
  testChance,
  type RuleContext,
  type SelectionContext,
} from './rules'

export interface GameSession {
  saveId: string
  defaultData: GameModelData
  saveData: GameModelData
  runStore: RunSnapshotStore | null
}

export interface ChoiceSelection {
  choiceId: string
  quantity?: number
}

export interface QuantityBounds {
  min: number
  max: number
  step: number
  defaultValue: number
}

const automaticNodeLimit = 1000

export function createSaveData(defaultData: GameModelData): GameModelData {
  const saveData = structuredClone(defaultData)
  saveData.meta.kind = 'save'
  saveData.meta.turn = 0
  saveData.meta.seed = null
  saveData.meta.runs = 0
  delete saveData.meta.step
  return saveData
}

export function createSession(
  saveId: string,
  defaultData: GameModelData,
  saveData: GameModelData,
  runStore: RunSnapshotStore | null,
): GameSession {
  return {
    saveId,
    defaultData: structuredClone(defaultData),
    saveData: structuredClone(saveData),
    runStore: runStore ? structuredClone(runStore) : null,
  }
}

function cloneSession(session: GameSession): GameSession {
  return {
    saveId: session.saveId,
    defaultData: session.defaultData,
    saveData: structuredClone(session.saveData),
    runStore: session.runStore ? structuredClone(session.runStore) : null,
  }
}

function contextFor(session: GameSession, currentEventId?: string): RuleContext {
  if (!session.runStore) throw new RuleError('run', '当前没有进行中的局')
  return {
    defaultData: session.defaultData,
    saveData: session.saveData,
    runData: session.runStore.currentRun,
    currentEventId,
  }
}

export function startRun(session: GameSession, seed = createSeed()): GameSession {
  if (session.runStore) throw new RuleError('startRun', '已有进行中的局')
  const next = cloneSession(session)
  const runData = structuredClone(next.saveData)
  runData.meta.kind = 'run'
  runData.meta.turn = 1
  runData.meta.step = 'turn_start'
  runData.meta.seed = seed
  delete runData.meta.runs
  next.saveData.meta.runs = (next.saveData.meta.runs ?? 0) + 1
  next.runStore = {
    saveId: next.saveId,
    currentRun: runData,
    turnSnapshots: [],
  }
  advanceRun(next)
  return next
}

export function startEvent(session: GameSession, eventId: string): GameSession {
  const next = cloneSession(session)
  const context = contextFor(next, eventId)
  const event = findEvent(context.runData, eventId, 'startEvent')
  if (!event.unlocked || !event.appeared || event.currentNode !== null) {
    throw new RuleError(`events.${eventId}`, '事件当前不能启动')
  }
  if (!event.repeatable && event.completed) throw new RuleError(`events.${eventId}`, '不可重复事件已经完成')
  beginEvent(context, event)
  advanceRun(next)
  return next
}

export function continueEvent(session: GameSession, eventId: string): GameSession {
  const next = cloneSession(session)
  const context = contextFor(next, eventId)
  const event = findEvent(context.runData, eventId, 'continueEvent')
  const node = currentNode(event)

  if (node.type === 'result') {
    if (!node.completeEvent) throw new RuleError(`events.${eventId}.nodes.${node.id}`, '该结果节点不能确认完成')
    completeEvent(event)
  } else if (node.type === 'text' || (node.type === 'action' && Boolean(node.text))) {
    if (!node.next) throw new RuleError(`events.${eventId}.nodes.${node.id}.next`, '缺少后续节点')
    enterNode(context, event, node.next)
  } else {
    throw new RuleError(`events.${eventId}.nodes.${node.id}`, '当前节点不能通过继续操作处理')
  }

  advanceRun(next)
  return next
}

export function submitChoice(
  session: GameSession,
  eventId: string,
  nodeId: string,
  selections: ChoiceSelection[],
): GameSession {
  const next = cloneSession(session)
  const context = contextFor(next, eventId)
  const event = findEvent(context.runData, eventId, 'submitChoice')
  const node = currentNode(event)
  if (node.id !== nodeId || node.type !== 'choice') {
    throw new RuleError(`events.${eventId}.nodes.${nodeId}`, '当前节点不是目标选择节点')
  }
  const duplicated = new Set<string>()
  selections.forEach((selection) => {
    if (duplicated.has(selection.choiceId)) throw new RuleError(`events.${eventId}.nodes.${nodeId}`, '不能重复提交选项')
    duplicated.add(selection.choiceId)
  })

  const available = availableChoices(context, node, `events.${eventId}.nodes.${node.id}`)
  const selectedChoices = selections.map((selection) => {
    const choice = available.find((item) => item.id === selection.choiceId)
    if (!choice) throw new RuleError(`events.${eventId}.nodes.${node.id}`, `选项 ${selection.choiceId} 当前不可用`)
    return { choice, selection }
  })

  if (node.mode === 'single') {
    if (selectedChoices.length !== 1) throw new RuleError(`events.${eventId}.nodes.${node.id}`, '单选节点必须选择一项')
    const { choice, selection } = selectedChoices[0]
    runChoiceActions(context, choice, selection, `events.${eventId}.nodes.${node.id}.choices.${choice.id}`)
    if (!choice.next) throw new RuleError(`events.${eventId}.nodes.${node.id}.choices.${choice.id}.next`, '单选项缺少后续节点')
    enterNode(context, event, choice.next)
  } else {
    validateSelectionCount(node, selectedChoices.length, available.length, event.id)
    const byId = new Map(selectedChoices.map((item) => [item.choice.id, item]))
    node.choices.forEach((choice) => {
      const selected = byId.get(choice.id)
      if (!selected) return
      if (node.mode === 'quantity') {
        validateQuantity(context, choice, selected.selection, `events.${event.id}.nodes.${node.id}.choices.${choice.id}`)
      }
      runChoiceActions(
        context,
        choice,
        selected.selection,
        `events.${event.id}.nodes.${node.id}.choices.${choice.id}`,
      )
    })
    if (node.next) enterNode(context, event, node.next)
  }

  advanceRun(next)
  return next
}

export function nextTurn(session: GameSession): GameSession {
  const next = cloneSession(session)
  const context = contextFor(next)
  if (context.runData.meta.step !== 'next_turn') throw new RuleError('nextTurn', '当前不能进入下一回合')
  if (hasRequiredInteraction(context.runData) || pendingManualEvents(context.runData).length > 0) {
    throw new RuleError('nextTurn', '仍有事件需要处理')
  }
  context.runData.meta.turn += 1
  context.runData.meta.step = 'turn_start'
  advanceRun(next)
  return next
}

export function abandonRun(session: GameSession): GameSession {
  const next = cloneSession(session)
  next.runStore = null
  return next
}

function beginEvent(context: RuleContext, event: GameEvent) {
  context.currentEventId = event.id
  runTiming(context, 'event_start')
  runCombos(context, 'event_start')
  enterNode(context, event, event.entryNode)
}

function enterNode(context: RuleContext, event: GameEvent, nodeId: string) {
  let targetId: string | null = nodeId
  let transitions = 0

  while (targetId !== null) {
    transitions += 1
    if (transitions > automaticNodeLimit) {
      throw new RuleError(`events.${event.id}`, '自动节点跳转超过 1000 次')
    }
    const node = event.nodes.find((item) => item.id === targetId)
    if (!node) throw new RuleError(`events.${event.id}.nodes.${targetId}`, '节点不存在')
    event.currentNode = node.id
    context.currentEventId = event.id
    runTiming(context, 'event_node')
    runCombos(context, 'event_node')
    const nodePath = `events.${event.id}.nodes.${node.id}`
    const conditionsPass = evaluateConditions(context, node.conditions ?? [], `${nodePath}.conditions`)

    if (!conditionsPass) {
      if (node.type === 'check') {
        targetId = node.failure
      } else if (node.next) {
        targetId = node.next
      } else {
        throw new RuleError(nodePath, '节点条件不满足且没有后续节点')
      }
      continue
    }

    executeActions(context, node.actions ?? [], `${nodePath}.actions`)
    switch (node.type) {
      case 'text':
      case 'choice':
      case 'wait':
        return
      case 'check':
        targetId = testChance(context, node.chance, `${nodePath}.chance`) ? node.success : node.failure
        break
      case 'action':
        if (node.text) return
        targetId = node.next
        break
      case 'result':
        event.result = node.result
        runTiming(context, 'event_result')
        runCombos(context, 'event_result')
        return
      default:
        assertNever(node)
    }
  }
}

function advanceRun(session: GameSession) {
  const context = contextFor(session)
  let phases = 0

  while (phases < 100) {
    phases += 1
    switch (context.runData.meta.step) {
      case 'turn_start':
        runTiming(context, 'turn_start')
        context.runData.meta.step = 'combo_check'
        break
      case 'combo_check':
        runCombos(context, 'turn_start')
        context.runData.meta.step = 'event_appear'
        break
      case 'event_appear':
        runTiming(context, 'event_appear')
        runCombos(context, 'event_appear')
        context.runData.meta.step = 'event_start'
        break
      case 'event_start':
        context.runData.events.forEach((event) => {
          if (
            event.appeared
            && event.startMode === 'auto'
            && event.currentNode === null
            && (event.repeatable || !event.completed)
          ) {
            beginEvent({ ...context, currentEventId: event.id }, event)
          }
        })
        context.runData.meta.step = 'player_event'
        break
      case 'player_event':
      case 'event_node':
        if (hasRequiredInteraction(context.runData) || pendingManualEvents(context.runData).length > 0) return
        context.runData.meta.step = 'turn_end'
        break
      case 'turn_end':
        runTiming(context, 'turn_end')
        runCombos(context, 'turn_end')
        settleDurations(context.runData)
        settleWaitingEvents(context)
        context.runData.meta.step = 'snapshot'
        break
      case 'snapshot':
        appendSnapshot(session)
        context.runData.meta.step = (
          hasRequiredInteraction(context.runData) || pendingManualEvents(context.runData).length > 0
        )
          ? 'player_event'
          : 'next_turn'
        return
      case 'next_turn':
        return
      default:
        throw new RuleError('meta.step', '局内阶段不存在')
    }
  }
  throw new RuleError('meta.step', '回合阶段自动推进超过限制')
}

function appendSnapshot(session: GameSession) {
  if (!session.runStore) return
  const snapshot: TurnSnapshot = {
    turn: session.runStore.currentRun.meta.turn,
    data: structuredClone(session.runStore.currentRun),
  }
  const existing = session.runStore.turnSnapshots.findIndex((item) => item.turn === snapshot.turn)
  if (existing >= 0) session.runStore.turnSnapshots[existing] = snapshot
  else session.runStore.turnSnapshots.push(snapshot)
}

function settleDurations(runData: GameModelData) {
  runData.effects.forEach((effect) => {
    if (!effect.acquired || !effect.duration) return
    if (effect.duration.type === 'instant') {
      effect.acquired = false
      effect.appeared = false
    }
    if (effect.duration.type === 'turns') {
      if (effect.duration.remaining === null) throw new RuleError(`effects.${effect.id}.duration`, '缺少剩余回合')
      effect.duration.remaining = Math.max(0, effect.duration.remaining - 1)
      if (effect.duration.remaining === 0) {
        effect.acquired = false
        effect.appeared = false
      }
    }
  })
}

function settleWaitingEvents(context: RuleContext) {
  context.runData.events.forEach((event) => {
    if (!event.currentNode) return
    const node = currentNode(event)
    if (node.type === 'wait') {
      if (evaluateConditions(context, node.endConditions, `events.${event.id}.nodes.${node.id}.endConditions`)) {
        enterNode({ ...context, currentEventId: event.id }, event, node.next)
      } else {
        node.remainingTurns = Math.max(0, node.remainingTurns - 1)
        if (node.remainingTurns === 0) {
          enterNode({ ...context, currentEventId: event.id }, event, node.timeoutNode)
        }
      }
    }
    if (!event.currentNode) return
    if (evaluateConditions(context, event.endConditions, `events.${event.id}.endConditions`)) {
      if (!event.timeoutNode) throw new RuleError(`events.${event.id}.timeoutNode`, '事件结束时缺少超时节点')
      enterNode({ ...context, currentEventId: event.id }, event, event.timeoutNode)
      return
    }
    event.remainingTurns = Math.max(0, event.remainingTurns - 1)
    if (event.remainingTurns === 0) {
      if (!event.timeoutNode) throw new RuleError(`events.${event.id}.timeoutNode`, '事件超时但没有超时节点')
      enterNode({ ...context, currentEventId: event.id }, event, event.timeoutNode)
    }
  })
}

function completeEvent(event: GameEvent) {
  event.occurrences += 1
  event.completed = true
  event.appeared = false
  event.currentNode = null
}

function findEvent(runData: GameModelData, eventId: string, path: string): GameEvent {
  const event = runData.events.find((item) => item.id === eventId)
  if (!event) throw new RuleError(path, `事件 ${eventId} 不存在`)
  return event
}

function currentNode(event: GameEvent): EventNode {
  if (!event.currentNode) throw new RuleError(`events.${event.id}`, '事件尚未激活')
  const node = event.nodes.find((item) => item.id === event.currentNode)
  if (!node) throw new RuleError(`events.${event.id}.currentNode`, '当前节点不存在')
  return node
}

function nodeNeedsInput(node: EventNode): boolean {
  return node.type === 'text'
    || node.type === 'choice'
    || (node.type === 'result' && node.completeEvent)
    || (node.type === 'action' && Boolean(node.text))
}

export function activeInteractiveEvents(runData: GameModelData): GameEvent[] {
  return runData.events.filter((event) => {
    if (!event.currentNode) return false
    const node = event.nodes.find((item) => item.id === event.currentNode)
    return node ? nodeNeedsInput(node) : false
  })
}

function hasRequiredInteraction(runData: GameModelData): boolean {
  return activeInteractiveEvents(runData).length > 0
}

export function pendingManualEvents(runData: GameModelData): GameEvent[] {
  return runData.events.filter((event) =>
    event.appeared
    && event.startMode === 'manual'
    && event.currentNode === null
    && (event.repeatable || !event.completed),
  )
}

function availableChoices(context: RuleContext, node: ChoiceNode, path: string): Choice[] {
  return node.choices.filter((choice, index) =>
    evaluateConditions(context, choice.conditions ?? [], `${path}.choices[${index}].conditions`),
  )
}

export function getAvailableChoices(session: GameSession, eventId: string): Choice[] {
  const copy = cloneSession(session)
  const context = contextFor(copy, eventId)
  const event = findEvent(context.runData, eventId, 'getAvailableChoices')
  const node = currentNode(event)
  if (node.type !== 'choice') return []
  return availableChoices(context, node, `events.${eventId}.nodes.${node.id}`)
}

export function getQuantityBounds(session: GameSession, eventId: string, choiceId: string): QuantityBounds {
  const copy = cloneSession(session)
  const context = contextFor(copy, eventId)
  const event = findEvent(context.runData, eventId, 'getQuantityBounds')
  const node = currentNode(event)
  if (node.type !== 'choice' || node.mode !== 'quantity') throw new RuleError('quantity', '当前不是数量选择节点')
  const choice = node.choices.find((item) => item.id === choiceId)
  if (!choice?.quantity) throw new RuleError('quantity', '选项缺少数量配置')
  return resolveQuantityBounds(context, choice, `events.${eventId}.nodes.${node.id}.choices.${choice.id}`)
}

function resolveQuantityBounds(context: RuleContext, choice: Choice, path: string): QuantityBounds {
  if (!choice.quantity) throw new RuleError(path, '选项缺少数量配置')
  const min = resolveValue(context, choice.quantity.min, `${path}.quantity.min`)
  const max = resolveValue(context, choice.quantity.max, `${path}.quantity.max`)
  const step = resolveValue(context, choice.quantity.step ?? 1, `${path}.quantity.step`)
  const defaultValue = resolveValue(context, choice.quantity.defaultValue ?? choice.quantity.min, `${path}.quantity.defaultValue`)
  if (![min, max, step, defaultValue].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new RuleError(path, '数量边界必须是有限数值')
  }
  if ((min as number) > (max as number) || (step as number) <= 0) throw new RuleError(path, '数量边界或步长无效')
  return {
    min: min as number,
    max: max as number,
    step: step as number,
    defaultValue: defaultValue as number,
  }
}

function validateQuantity(context: RuleContext, choice: Choice, selection: ChoiceSelection, path: string) {
  const quantity = selection.quantity
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) throw new RuleError(path, '提交数量无效')
  const bounds = resolveQuantityBounds(context, choice, path)
  const steps = (quantity - bounds.min) / bounds.step
  if (quantity < bounds.min || quantity > bounds.max || Math.abs(steps - Math.round(steps)) > 1e-9) {
    throw new RuleError(path, '提交数量不符合上下界或步长')
  }
}

function validateSelectionCount(node: ChoiceNode, count: number, availableCount: number, eventId: string) {
  const min = node.minSelections ?? 0
  const max = node.maxSelections ?? availableCount
  if (count < min || count > max) {
    throw new RuleError(`events.${eventId}.nodes.${node.id}`, `选择数量必须在 ${min} 到 ${max} 之间`)
  }
}

function runChoiceActions(context: RuleContext, choice: Choice, selection: ChoiceSelection, path: string) {
  const selectionContext: SelectionContext = {
    choiceId: choice.id,
    quantity: selection.quantity,
  }
  executeActions({ ...context, selection: selectionContext }, choice.actions ?? [], `${path}.actions`)
}

function assertNever(value: never): never {
  throw new Error(`未处理的节点：${JSON.stringify(value)}`)
}
