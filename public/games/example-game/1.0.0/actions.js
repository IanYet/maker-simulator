/** 读取当前事件实例，供示例 Action 修改生命周期。 */
function activeInstance(context, eventId) {
  const event = context.runState.events[eventId]
  const instanceId = event.activeInstanceId
  if (!instanceId) throw new Error(`Event ${eventId} has no active instance`)
  return event.instances[instanceId]
}

/** 最小示例包的 Action registry，用于验证运行时基本流程。 */
export const actions = {
  'player.change-health': {
    key: 'player.change-health',
    exec: (context, amount) => {
      context.runState.characters.player.attributes.health.value += amount
    },
  },
  'event.goto': {
    key: 'event.goto',
    exec: (context, eventId, nodeId) => {
      activeInstance(context, eventId).currentNodeId = nodeId
    },
  },
  'event.random-path': {
    key: 'event.random-path',
    exec: (context, eventId, successNodeId, failureNodeId) => {
      activeInstance(context, eventId).currentNodeId = context.random() < 0.58
        ? successNodeId
        : failureNodeId
    },
  },
  'event.take-token': {
    key: 'event.take-token',
    exec: (context, eventId) => {
      context.runState.effects['lucky-token'].acquired = true
      context.runState.effects['lucky-token'].actived = true
      activeInstance(context, eventId).status = 'completed'
    },
  },
  'event.hurt-and-return': {
    key: 'event.hurt-and-return',
    exec: (context, eventId, nodeId) => {
      context.action['player.change-health'](-1)
      context.action['event.goto'](eventId, nodeId)
    },
  },
  'event.collect-and-complete': {
    key: 'event.collect-and-complete',
    exec: (context, eventId, nodeId) => {
      const instanceId = context.runState.events[eventId].activeInstanceId
      if (!instanceId) throw new Error('Missing active instance')
      const selection = context.turnState.events[eventId].nodes[nodeId].selections?.[instanceId]
      const total = selection
        ? Object.values(selection.choices).reduce((sum, choice) => sum + choice.count, 0)
        : 0
      context.runState.characters.player.attributes.supplies.value += total
      activeInstance(context, eventId).status = 'completed'
    },
  },
  'event.complete': {
    key: 'event.complete',
    exec: (context, eventId) => {
      activeInstance(context, eventId).status = 'completed'
    },
  },
  'run.finish': {
    key: 'run.finish',
    exec: (context, eventId) => {
      context.runState.characters.player.attributes.ending.value = 1
      activeInstance(context, eventId).status = 'completed'
      context.endRun()
    },
  },
}
