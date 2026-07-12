/** 最小示例包的纯 Rule registry。 */
export const rules = {
  'state.value': {
    key: 'state.value',
    calc: (context, ...path) => {
      let cursor = context.turnState
      for (const segment of path) {
        if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) return undefined
        cursor = cursor[segment]
      }
      return cursor
    },
  },
  'turn.is-start': {
    key: 'turn.is-start',
    calc: (context) => context.turnState.phase === 'turn_start',
  },
  'player.is-weak': {
    key: 'player.is-weak',
    calc: (context) => context.runState.characters.player.attributes.health.value <= 3,
  },
  'event.completed-count': {
    key: 'event.completed-count',
    calc: (context, eventId) => Object.values(context.runState.events[eventId].instances)
      .filter((instance) => instance.status === 'completed').length,
  },
}
