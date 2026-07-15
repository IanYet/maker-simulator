/** 空白状态实验场的通用状态读取 Rule。 */
export const rules = {
  'state.value': {
    key: 'state.value',
    calc: (context, ...path) => {
    console.log({
    path,
    phase: context.turnState.phase,
    turn: context.turnState.turnNumber,
  })
      let cursor = context.turnState
      for (const segment of path) {
        if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) return undefined
        cursor = cursor[segment]
      }
      return cursor
    },
  },
}
