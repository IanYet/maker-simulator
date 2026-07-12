const deltaAttributes = [
  'health',
  'warmth',
  'food',
  'fuel',
  'medicine',
  'parts',
  'morale',
  'survivors',
  'knowledge',
  'signal',
]

/** 读取当前事件实例；Action 不直接访问 RunData 容器。 */
function activeInstance(context, eventId) {
  const event = context.runState.events[eventId]
  const instanceId = event.activeInstanceId
  if (!instanceId) throw new Error(`Event ${eventId} has no active instance`)
  return event.instances[instanceId]
}

/** 读取当前多选节点的选择结果。 */
function selection(context, eventId, nodeId) {
  const instanceId = context.runState.events[eventId].activeInstanceId
  if (!instanceId) throw new Error(`Event ${eventId} has no active instance`)
  return context.turnState.events[eventId].nodes[nodeId].selections?.[instanceId]
}

/** 判断一个 Effect 是否已获得。 */
function acquired(context, effectId) {
  return context.runState.effects[effectId].acquired
}

/** Frostbound 的 Action registry；所有 State 写入均通过 ActionContext 完成。 */
export const actions = {
  'state.change': {
    key: 'state.change',
    exec: (context, characterId, attributeId, amount) => {
      context.runState.characters[characterId].attributes[attributeId].value += amount
    },
  },
  'state.set': {
    key: 'state.set',
    exec: (context, characterId, attributeId, value) => {
      context.runState.characters[characterId].attributes[attributeId].value = value
    },
  },
  'effect.acquire': {
    key: 'effect.acquire',
    exec: (context, effectId) => {
      context.runState.effects[effectId].acquired = true
      context.runState.effects[effectId].actived = true
    },
  },
  'event.goto': {
    key: 'event.goto',
    exec: (context, eventId, nodeId) => {
      activeInstance(context, eventId).currentNodeId = nodeId
    },
  },
  'event.complete': {
    key: 'event.complete',
    exec: (context, eventId) => {
      activeInstance(context, eventId).status = 'completed'
    },
  },
  'event.random-goto': {
    key: 'event.random-goto',
    exec: (context, eventId, successNodeId, failureNodeId, chance) => {
      let adjustedChance = chance
      if (acquired(context, 'loyal-dog')) adjustedChance += 0.08
      if (acquired(context, 'storm-warning')) adjustedChance += 0.05
      activeInstance(context, eventId).currentNodeId = context.random() < adjustedChance
        ? successNodeId
        : failureNodeId
    },
  },
  'event.resolve': {
    key: 'event.resolve',
    exec: (context, eventId, effectId, ...deltas) => {
      deltaAttributes.forEach((attributeId, index) => {
        const amount = deltas[index]
        if (amount !== 0) context.action['state.change']('survivor', attributeId, amount)
      })
      if (typeof effectId === 'string') context.action['effect.acquire'](effectId)
      context.action['event.complete'](eventId)
    },
  },
  'event.resolve-route': {
    key: 'event.resolve-route',
    exec: (context, eventId, routeValue, effectId, ...deltas) => {
      context.action['state.set']('survivor', 'route', routeValue)
      context.action['event.resolve'](eventId, effectId, ...deltas)
    },
  },
  'event.selection-resolve': {
    key: 'event.selection-resolve',
    exec: (context, eventId, nodeId, attributeId, multiplier, effectId) => {
      const selected = selection(context, eventId, nodeId)
      const total = selected
        ? Object.values(selected.choices).reduce((sum, item) => sum + item.count, 0)
        : 0
      if (total > 0) context.action['state.change']('survivor', attributeId, total * multiplier)
      if (typeof effectId === 'string') context.action['effect.acquire'](effectId)
      context.action['event.complete'](eventId)
    },
  },
  'event.fish': {
    key: 'event.fish',
    exec: (context, eventId, nodeId) => {
      const selected = selection(context, eventId, nodeId)
      let food = 0
      if (selected) {
        for (const item of Object.values(selected.choices)) {
          const chance = item.value === 'deep' ? 0.78 : 0.55
          const reward = item.value === 'deep' ? 2 : 1
          for (let count = 0; count < item.count; count += 1) {
            if (context.random() < chance) food += reward
          }
        }
      }
      context.action['state.change']('survivor', 'food', food)
      context.action['state.change']('survivor', 'warmth', -1)
      context.action['state.change']('survivor', 'knowledge', 1)
      context.action['event.complete'](eventId)
    },
  },
  'event.recruit': {
    key: 'event.recruit',
    exec: (context, eventId, nodeId) => {
      const selected = selection(context, eventId, nodeId)
      let food = 0
      let medicine = 0
      if (selected) {
        for (const item of Object.values(selected.choices)) {
          if (item.value === 'food') food += item.count
          if (item.value === 'medicine') medicine += item.count
        }
      }
      if (context.runState.characters.survivor.attributes.food.value < food) {
        throw new Error('食物不足，救援方案已回滚')
      }
      if (context.runState.characters.survivor.attributes.medicine.value < medicine) {
        throw new Error('药品不足，救援方案已回滚')
      }
      const rescued = food + medicine
      context.action['state.change']('survivor', 'food', -food)
      context.action['state.change']('survivor', 'medicine', -medicine)
      context.action['state.change']('survivor', 'survivors', rescued)
      context.action['state.change']('survivor', 'morale', Math.min(3, rescued))
      context.action['event.complete'](eventId)
    },
  },
  'radio.listen': {
    key: 'radio.listen',
    exec: (context) => {
      if (!acquired(context, 'hand-crank-radio')) return
      context.action['state.change']('survivor', 'signal', acquired(context, 'solar-battery') ? 2 : 1)
      context.action['state.change']('survivor', 'morale', 1)
    },
  },
  'effect.turn-bonus': {
    key: 'effect.turn-bonus',
    exec: (context, effectId, attributeId, amount) => {
      if (acquired(context, effectId)) {
        context.action['state.change']('survivor', attributeId, amount)
      }
    },
  },
  /** 每回合开始推进气温、风暴、食物、温暖和健康消耗。 */
  'world.turn-start': {
    key: 'world.turn-start',
    exec: (context) => {
      const turn = context.turnState.turnNumber
      const survivor = context.runState.characters.survivor.attributes
      const storm = turn >= 10 ? 3 : turn >= 7 ? 2 : turn >= 4 ? 1 : 0
      context.action['state.set']('world', 'storm', storm)
      context.action['state.change']('world', 'temperature', turn >= 7 ? -4 : -2)

      const mouths = Math.max(1, Math.ceil(survivor.survivors.value / 3))
      context.action['state.change']('survivor', 'food', -mouths)

      let warmthLoss = 2 + (storm >= 2 ? 1 : 0)
      if (acquired(context, 'insulated-coat')) warmthLoss -= 1
      if (acquired(context, 'coal-stove') && survivor.fuel.value > 0) {
        context.action['state.change']('survivor', 'fuel', -1)
        warmthLoss -= 2
      }
      if (warmthLoss > 0) context.action['state.change']('survivor', 'warmth', -warmthLoss)
      if (survivor.food.value <= 0) context.action['state.change']('survivor', 'health', -1)
      if (survivor.warmth.value <= 0) context.action['state.change']('survivor', 'health', -1)
      if (storm >= 2 && !acquired(context, 'community')) context.action['state.change']('survivor', 'morale', -1)
    },
  },
  'ending.prepare': {
    key: 'ending.prepare',
    exec: (context, eventId, nodeId, endingValue) => {
      context.action['state.set']('survivor', 'ending', endingValue)
      context.action['event.goto'](eventId, nodeId)
    },
  },
  'ending.commit': {
    key: 'ending.commit',
    exec: (context, eventId) => {
      activeInstance(context, eventId).status = 'completed'
      context.endRun()
    },
  },
}
