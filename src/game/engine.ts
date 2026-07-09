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

/** 单个玩家存档下的完整游戏会话。 */
export interface GameSession {
  /** 玩家存档唯一标识。 */
  saveId: string
  /** 只读默认内容数据。 */
  defaultData: GameModelData
  /** 可跨局保留的玩家存档数据。 */
  saveData: GameModelData
  /** 当前进行中的局内数据和快照；没有进行中局时为 null。 */
  runStore: RunSnapshotStore | null
}

/** 玩家向选择节点提交的单个选项。 */
export interface ChoiceSelection {
  /** 被提交的选项 ID。 */
  choiceId: string
  /** 数量选择模式下提交的数量。 */
  quantity?: number
}

/** 数量选择项在当前上下文中的可选边界。 */
export interface QuantityBounds {
  /** 可提交的最小数量。 */
  min: number
  /** 可提交的最大数量。 */
  max: number
  /** 可提交数量的步长。 */
  step: number
  /** UI 初始展示的默认数量。 */
  defaultValue: number
}

/** 单次进入事件时允许自动连续跳转的节点上限。 */
const automaticNodeLimit = 1000

/**
 * 根据默认内容创建新的玩家存档数据。
 *
 * @param defaultData - 校验通过的默认内容数据。
 * @returns 可持久化的玩家存档数据副本。
 */
export function createSaveData(defaultData: GameModelData): GameModelData {
  const saveData = structuredClone(defaultData)
  saveData.meta.kind = 'save'
  saveData.meta.turn = 0
  saveData.meta.seed = null
  saveData.meta.runs = 0
  delete saveData.meta.step
  return saveData
}

/**
 * 创建一个隔离的数据会话，避免 UI 直接持有外部可变引用。
 *
 * @param saveId - 玩家存档唯一标识。
 * @param defaultData - 默认内容数据。
 * @param saveData - 玩家存档数据。
 * @param runStore - 可选的局内数据和快照容器。
 * @returns 可供 UI 和引擎命令使用的会话对象。
 */
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

/**
 * 深拷贝会话中的可变数据。
 *
 * @param session - 原始会话。
 * @returns 复制后的会话。
 */
function cloneSession(session: GameSession): GameSession {
  return {
    saveId: session.saveId,
    defaultData: session.defaultData,
    saveData: structuredClone(session.saveData),
    runStore: session.runStore ? structuredClone(session.runStore) : null,
  }
}

/**
 * 为规则执行创建上下文。
 *
 * @param session - 当前游戏会话。
 * @param currentEventId - 可选的当前事件 ID。
 * @returns 包含默认、存档和局内数据的规则上下文。
 * @throws {RuleError} 当当前没有进行中局时抛出。
 */
function contextFor(session: GameSession, currentEventId?: string): RuleContext {
  if (!session.runStore) throw new RuleError('run', '当前没有进行中的局')
  return {
    defaultData: session.defaultData,
    saveData: session.saveData,
    runData: session.runStore.currentRun,
    currentEventId,
  }
}

/**
 * 开始一局新游戏，并自动推进到需要玩家输入或下一回合阶段。
 *
 * @param session - 当前游戏会话。
 * @param seed - 可选的固定随机种子，主要用于可复现调试。
 * @returns 启动新局后的会话副本。
 * @throws {RuleError} 当已有进行中局时抛出。
 */
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

/**
 * 启动一个已出现且需要手动处理的事件。
 *
 * @param session - 当前游戏会话。
 * @param eventId - 要启动的事件 ID。
 * @returns 处理事件启动后的会话副本。
 * @throws {RuleError} 当事件不存在或当前不能启动时抛出。
 */
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

/**
 * 继续处理当前处于文本、动作文本或可确认结果节点的事件。
 *
 * @param session - 当前游戏会话。
 * @param eventId - 要继续处理的事件 ID。
 * @returns 继续事件后的会话副本。
 * @throws {RuleError} 当当前节点不能继续或缺少后续节点时抛出。
 */
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

/**
 * 向当前选择节点提交玩家选择。
 *
 * @param session - 当前游戏会话。
 * @param eventId - 选择节点所属事件 ID。
 * @param nodeId - 目标选择节点 ID。
 * @param selections - 玩家提交的选项列表。
 * @returns 执行选择动作后的会话副本。
 * @throws {RuleError} 当选择不可用、数量非法或节点配置不完整时抛出。
 */
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

/**
 * 在所有必要事件处理完成后进入下一回合。
 *
 * @param session - 当前游戏会话。
 * @returns 进入下一回合并自动推进后的会话副本。
 * @throws {RuleError} 当当前阶段不允许进入下一回合或仍有待处理事件时抛出。
 */
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

/**
 * 放弃当前进行中的局，保留玩家存档数据。
 *
 * @param session - 当前游戏会话。
 * @returns 清空局内数据后的会话副本。
 */
export function abandonRun(session: GameSession): GameSession {
  const next = cloneSession(session)
  next.runStore = null
  return next
}

/**
 * 执行事件启动时机规则并进入入口节点。
 *
 * @param context - 当前规则执行上下文。
 * @param event - 要启动的事件。
 */
function beginEvent(context: RuleContext, event: GameEvent) {
  context.currentEventId = event.id
  runTiming(context, 'event_start')
  runCombos(context, 'event_start')
  enterNode(context, event, event.entryNode)
}

/**
 * 进入指定事件节点，并自动推进所有不需要玩家输入的后续节点。
 *
 * 该函数会在每次进入节点时写入 `currentNode`，触发 `event_node` 时机规则，
 * 然后根据节点类型决定暂停等待玩家输入或继续自动跳转。
 *
 * @param context - 当前规则执行上下文。
 * @param event - 正在处理的事件。
 * @param nodeId - 要进入的起始节点 ID。
 * @throws {RuleError} 当节点不存在、自动跳转超限或节点配置无法继续时抛出。
 */
function enterNode(context: RuleContext, event: GameEvent, nodeId: string) {
  let targetId: string | null = nodeId
  let routedTargetId: string | null = null
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
    const skipConditions = routedTargetId === node.id
    if (skipConditions) routedTargetId = null

    if (node.type === 'check') {
      targetId = resolveCheckNext(context, event, node, nodePath)
      routedTargetId = targetId
      continue
    }

    const conditionsPass = skipConditions
      || evaluateConditions(context, node.conditions ?? [], `${nodePath}.conditions`)

    if (!conditionsPass) {
      if (node.next) {
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

/**
 * 根据 `check` 节点的候选列表解析实际后续节点。
 *
 * 解析过程按 `nexts` 声明顺序执行：先检查候选节点的 `conditions`，再执行候选
 * 节点的 `chance` 判定。第一个同时通过条件与概率的候选节点会被选中。
 *
 * @param context - 当前规则执行上下文。
 * @param event - `check` 节点所属事件。
 * @param node - 正在解析的 `check` 节点。
 * @param path - 用于错误定位的模型路径。
 * @returns 通过判定的候选节点 ID。
 * @throws {RuleError} 当候选节点不存在或没有候选节点通过判定时抛出。
 */
function resolveCheckNext(
  context: RuleContext,
  event: GameEvent,
  node: Extract<EventNode, { type: 'check' }>,
  path: string,
): string {
  for (const [index, nextId] of node.nexts.entries()) {
    const candidate = event.nodes.find((item) => item.id === nextId)
    if (!candidate) throw new RuleError(`${path}.nexts[${index}]`, '候选节点不存在')
    const candidatePath = `events.${event.id}.nodes.${candidate.id}`
    const conditionsPass = evaluateConditions(
      context,
      candidate.conditions ?? [],
      `${candidatePath}.conditions`,
    )
    if (!conditionsPass) continue
    if (!testChance(context, candidate.chance ?? 1, `${candidatePath}.chance`)) continue
    return candidate.id
  }

  throw new RuleError(`${path}.nexts`, '没有候选节点通过条件与概率判定')
}

/**
 * 自动推进局内阶段，直到需要玩家输入或达到下一回合入口。
 *
 * @param session - 当前游戏会话。
 * @throws {RuleError} 当阶段不存在或自动推进超过限制时抛出。
 */
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

/**
 * 在回合结束阶段记录完整局内快照。
 *
 * @param session - 当前游戏会话。
 */
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

/**
 * 结算已获得效果的持续时间。
 *
 * @param runData - 当前局内数据。
 * @throws {RuleError} 当回合持续效果缺少剩余回合数时抛出。
 */
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

/**
 * 结算等待中的事件和事件级超时。
 *
 * @param context - 当前规则执行上下文。
 * @throws {RuleError} 当事件超时但缺少超时节点时抛出。
 */
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

/**
 * 将事件标记为完成并移出当前事件流。
 *
 * @param event - 要完成的事件。
 */
function completeEvent(event: GameEvent) {
  event.occurrences += 1
  event.completed = true
  event.appeared = false
  event.currentNode = null
}

/**
 * 按 ID 查找局内事件。
 *
 * @param runData - 当前局内数据。
 * @param eventId - 要查找的事件 ID。
 * @param path - 错误定位路径。
 * @returns 找到的事件。
 * @throws {RuleError} 当事件不存在时抛出。
 */
function findEvent(runData: GameModelData, eventId: string, path: string): GameEvent {
  const event = runData.events.find((item) => item.id === eventId)
  if (!event) throw new RuleError(path, `事件 ${eventId} 不存在`)
  return event
}

/**
 * 读取事件当前激活的节点。
 *
 * @param event - 要读取的事件。
 * @returns 当前节点。
 * @throws {RuleError} 当事件未激活或节点不存在时抛出。
 */
function currentNode(event: GameEvent): EventNode {
  if (!event.currentNode) throw new RuleError(`events.${event.id}`, '事件尚未激活')
  const node = event.nodes.find((item) => item.id === event.currentNode)
  if (!node) throw new RuleError(`events.${event.id}.currentNode`, '当前节点不存在')
  return node
}

/**
 * 判断事件节点是否需要玩家输入才能继续。
 *
 * @param node - 要判断的事件节点。
 * @returns 需要玩家操作时返回 true。
 */
function nodeNeedsInput(node: EventNode): boolean {
  return node.type === 'text'
    || node.type === 'choice'
    || (node.type === 'result' && node.completeEvent)
    || (node.type === 'action' && Boolean(node.text))
}

/**
 * 返回当前所有正在等待玩家输入的事件。
 *
 * @param runData - 当前局内数据。
 * @returns 需要玩家交互的事件列表。
 */
export function activeInteractiveEvents(runData: GameModelData): GameEvent[] {
  return runData.events.filter((event) => {
    if (!event.currentNode) return false
    const node = event.nodes.find((item) => item.id === event.currentNode)
    return node ? nodeNeedsInput(node) : false
  })
}

/**
 * 判断当前局内是否存在必须先处理的玩家交互。
 *
 * @param runData - 当前局内数据。
 * @returns 存在必需交互时返回 true。
 */
function hasRequiredInteraction(runData: GameModelData): boolean {
  return activeInteractiveEvents(runData).length > 0
}

/**
 * 返回已经出现但尚未手动启动的事件。
 *
 * @param runData - 当前局内数据。
 * @returns 待玩家启动的手动事件列表。
 */
export function pendingManualEvents(runData: GameModelData): GameEvent[] {
  return runData.events.filter((event) =>
    event.appeared
    && event.startMode === 'manual'
    && event.currentNode === null
    && (event.repeatable || !event.completed),
  )
}

/**
 * 根据选择条件过滤当前可用选项。
 *
 * @param context - 当前规则执行上下文。
 * @param node - 选择节点。
 * @param path - 错误定位路径。
 * @returns 当前可提交的选项列表。
 */
function availableChoices(context: RuleContext, node: ChoiceNode, path: string): Choice[] {
  return node.choices.filter((choice, index) =>
    evaluateConditions(context, choice.conditions ?? [], `${path}.choices[${index}].conditions`),
  )
}

/**
 * 获取指定事件当前选择节点的可用选项。
 *
 * @param session - 当前游戏会话。
 * @param eventId - 目标事件 ID。
 * @returns 当前可用选项列表；当前节点不是选择节点时返回空数组。
 */
export function getAvailableChoices(session: GameSession, eventId: string): Choice[] {
  const copy = cloneSession(session)
  const context = contextFor(copy, eventId)
  const event = findEvent(context.runData, eventId, 'getAvailableChoices')
  const node = currentNode(event)
  if (node.type !== 'choice') return []
  return availableChoices(context, node, `events.${eventId}.nodes.${node.id}`)
}

/**
 * 解析数量选项在当前上下文中的上下界。
 *
 * @param session - 当前游戏会话。
 * @param eventId - 目标事件 ID。
 * @param choiceId - 数量选项 ID。
 * @returns 可提交数量的上下界、步长和默认值。
 * @throws {RuleError} 当当前节点不是数量选择节点或选项缺少配置时抛出。
 */
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

/**
 * 计算单个数量选项的上下界。
 *
 * @param context - 当前规则执行上下文。
 * @param choice - 需要解析的选项。
 * @param path - 错误定位路径。
 * @returns 解析后的数量边界。
 * @throws {RuleError} 当边界表达式不是有限数值或配置非法时抛出。
 */
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

/**
 * 校验玩家提交的数量是否符合选项边界。
 *
 * @param context - 当前规则执行上下文。
 * @param choice - 被提交的选项。
 * @param selection - 玩家提交的数据。
 * @param path - 错误定位路径。
 * @throws {RuleError} 当数量缺失、越界或不符合步长时抛出。
 */
function validateQuantity(context: RuleContext, choice: Choice, selection: ChoiceSelection, path: string) {
  const quantity = selection.quantity
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) throw new RuleError(path, '提交数量无效')
  const bounds = resolveQuantityBounds(context, choice, path)
  const steps = (quantity - bounds.min) / bounds.step
  if (quantity < bounds.min || quantity > bounds.max || Math.abs(steps - Math.round(steps)) > 1e-9) {
    throw new RuleError(path, '提交数量不符合上下界或步长')
  }
}

/**
 * 校验选择节点提交的选项数量。
 *
 * @param node - 当前选择节点。
 * @param count - 玩家提交的选项数量。
 * @param availableCount - 当前可用选项数量。
 * @param eventId - 选择节点所属事件 ID。
 * @throws {RuleError} 当提交数量不在允许范围内时抛出。
 */
function validateSelectionCount(node: ChoiceNode, count: number, availableCount: number, eventId: string) {
  const min = node.minSelections ?? 0
  const max = node.maxSelections ?? availableCount
  if (count < min || count > max) {
    throw new RuleError(`events.${eventId}.nodes.${node.id}`, `选择数量必须在 ${min} 到 ${max} 之间`)
  }
}

/**
 * 在选择上下文中执行选项动作。
 *
 * @param context - 当前规则执行上下文。
 * @param choice - 被执行动作的选项。
 * @param selection - 玩家提交的数据。
 * @param path - 错误定位路径。
 */
function runChoiceActions(context: RuleContext, choice: Choice, selection: ChoiceSelection, path: string) {
  const selectionContext: SelectionContext = {
    choiceId: choice.id,
    quantity: selection.quantity,
  }
  executeActions({ ...context, selection: selectionContext }, choice.actions ?? [], `${path}.actions`)
}

/**
 * 穷尽性检查辅助函数。
 *
 * @param value - TypeScript 推断出的未处理分支。
 * @returns 永不返回。
 * @throws {Error} 始终抛出未处理节点错误。
 */
function assertNever(value: never): never {
  throw new Error(`未处理的节点：${JSON.stringify(value)}`)
}
