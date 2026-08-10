/** 从当前 TurnState 读取属性值，供纯 Rule 复用。 */
function attribute(context, characterId, attributeId) {
  return context.turnState.characters[characterId].attributes[attributeId].value
}

/** 读取 Config 字面基础值对应的当前 State 值。 */
function stateValue(context, ...path) {
  let cursor = context.turnState
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

/** 读取事件历史实例；不存在时由 State 视图提供空集合语义。 */
function instances(context, eventId) {
  return Object.values(context.runState.events[eventId].instances)
}

/** 判断指定 Effect 是否已获得。 */
function hasEffect(context, effectId) {
  return context.turnState.effects[effectId].acquired
}

/** 汇总当前多选节点已选数量。 */
function selectionTotal(context, eventId, nodeId) {
  const instanceId = context.runState.events[eventId].activeInstanceId
  if (!instanceId) return 0
  const selection = context.turnState.events[eventId].nodes[nodeId].selections?.[instanceId]
  return selection
    ? Object.values(selection.choices).reduce((sum, item) => sum + item.count, 0)
    : 0
}

/** Frostbound 的纯 Rule registry；不写 State、不推进随机游标。 */
export const rules = {
  'state.value': {
    key: 'state.value',
    calc: (context, ...path) => stateValue(context, ...path),
  },
  'turn.is-start': {
    key: 'turn.is-start',
    calc: (context) => context.turnState.phase === 'turn_start',
  },
  'status.at-most': {
    key: 'status.at-most',
    calc: (context, characterId, attributeId, maximum) =>
      attribute(context, characterId, attributeId) <= maximum,
  },
  'status.at-least': {
    key: 'status.at-least',
    calc: (context, characterId, attributeId, minimum) =>
      attribute(context, characterId, attributeId) >= minimum,
  },
  'resource.at-least': {
    key: 'resource.at-least',
    calc: (context, characterId, attributeId, minimum) =>
      attribute(context, characterId, attributeId) >= minimum,
  },
  'effect.acquired': {
    key: 'effect.acquired',
    calc: (context, effectId) => hasEffect(context, effectId),
  },
  'event.completed-count': {
    key: 'event.completed-count',
    calc: (context, eventId) =>
      instances(context, eventId).filter((instance) => instance.status === 'completed').length,
  },
  'event.unlocked': {
    key: 'event.unlocked',
    calc: (context, _eventId, minimumTurn, requiredEffect) =>
      context.turnState.turnNumber >= minimumTurn &&
      (requiredEffect === null || hasEffect(context, requiredEffect)),
  },
  'event.enabled': {
    key: 'event.enabled',
    calc: (context, eventId) => {
      const event = context.runState.events[eventId]
      if (context.turnState.phase !== 'event_handle' || event.activeInstanceId) return false
      const history = instances(context, eventId)
      if (eventId === 'shelter-maintenance') {
        return !history.some((instance) => instance.startedTurn === context.turnState.turnNumber)
      }
      return history.length === 0
    },
  },
  'selection.total-at-least': {
    key: 'selection.total-at-least',
    calc: (context, eventId, nodeId, minimum) =>
      selectionTotal(context, eventId, nodeId) >= minimum,
  },
  'ending.available': {
    key: 'ending.available',
    calc: (context, endingId) => {
      if (context.turnState.turnNumber < 10) return false
      if (endingId === 'train') {
        return hasEffect(context, 'hand-crank-radio') &&
          hasEffect(context, 'solar-battery') &&
          attribute(context, 'survivor', 'signal') >= 4 &&
          attribute(context, 'survivor', 'parts') >= 3
      }
      if (endingId === 'underground') {
        return hasEffect(context, 'geothermal-map') &&
          attribute(context, 'survivor', 'route') === 1 &&
          attribute(context, 'survivor', 'fuel') >= 3
      }
      if (endingId === 'community') {
        return hasEffect(context, 'community') &&
          attribute(context, 'survivor', 'survivors') >= 4 &&
          attribute(context, 'survivor', 'morale') >= 6
      }
      return endingId === 'alone'
    },
  },
}
