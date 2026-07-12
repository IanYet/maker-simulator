/** 最小示例包的纯 Rule registry。 */
export const rules = {
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
