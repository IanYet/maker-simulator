import type {
  Action,
  Choice,
  Condition,
  EventNode,
  GameEvent,
  GameModelData,
  Selector,
  ValueExpression,
} from '../types'

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationWarning = ValidationIssue

export type ValidationResult =
  | {
      success: true
      data: GameModelData
      errors: []
      warnings: ValidationWarning[]
    }
  | {
      success: false
      errors: ValidationIssue[]
      warnings: ValidationWarning[]
    }

const conditionTypes = new Set([
  'attribute',
  'effect',
  'event',
  'turn',
  'aggregate',
  'and',
  'or',
  'not',
])
const actionTypes = new Set([
  'modify_attribute',
  'modify_effect',
  'modify_event',
  'draw_pool',
  'create_choice',
])
const expressionTypes = new Set(['field', 'calculate', 'random', 'aggregate_value'])
const nodeTypes = new Set(['text', 'choice', 'check', 'action', 'wait', 'result'])
const comparisonOperators = new Set([
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
  'not_contains',
])
const actionModes = new Set(['set', 'add', 'multiply', 'min', 'max'])
const scopes = new Set(['run', 'save', 'default'])
const timings = new Set([
  'turn_start',
  'event_appear',
  'event_start',
  'event_node',
  'event_result',
  'turn_end',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function hasStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function validateGameModelData(raw: unknown): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationWarning[] = []
  const fail = (path: string, message: string) => errors.push({ path, message })
  const warn = (path: string, message: string) => warnings.push({ path, message })

  if (!isRecord(raw)) {
    return {
      success: false,
      errors: [{ path: '$', message: '顶层必须是对象' }],
      warnings,
    }
  }

  for (const key of ['meta', 'character']) {
    if (!isRecord(raw[key])) fail(key, '必须是对象')
  }
  for (const key of ['effectKinds', 'effects', 'effectCombos', 'pools', 'events']) {
    if (!Array.isArray(raw[key])) fail(key, '必须是数组')
  }
  if (errors.length > 0) return { success: false, errors, warnings }

  const data = raw as unknown as GameModelData
  validateMeta(data)
  validateCharacter(data)
  const attributeIds = isRecord(data.character.attributes)
    ? new Set(Object.keys(data.character.attributes))
    : new Set<string>()
  const effectKindIds = uniqueIds(data.effectKinds, 'effectKinds')
  const effectIds = uniqueIds(data.effects, 'effects')
  const comboIds = uniqueIds(data.effectCombos, 'effectCombos')
  const poolIds = uniqueIds(data.pools, 'pools')
  const eventIds = uniqueIds(data.events, 'events')

  data.effectKinds.forEach((kind, index) => {
    const path = `effectKinds[${index}]`
    if (!isRecord(kind)) {
      fail(path, '必须是对象')
      return
    }
    requiredString(kind.id, `${path}.id`)
    requiredString(kind.displayName, `${path}.displayName`)
  })

  data.effects.forEach((effect, index) => {
    const path = `effects[${index}]`
    if (!isRecord(effect)) {
      fail(path, '必须是对象')
      return
    }
    requiredString(effect.id, `${path}.id`)
    requiredString(effect.name, `${path}.name`)
    requiredString(effect.description, `${path}.description`)
    requiredString(effect.kind, `${path}.kind`)
    if (typeof effect.kind === 'string' && !effectKindIds.has(effect.kind)) {
      fail(`${path}.kind`, '引用了未声明的效果类型')
    }
    for (const key of ['unlocked', 'appeared', 'acquired'] as const) {
      if (typeof effect[key] !== 'boolean') fail(`${path}.${key}`, '必须是布尔值')
    }
    for (const key of ['level', 'stacks'] as const) {
      if (!isNonNegativeInteger(effect[key])) fail(`${path}.${key}`, '必须是非负整数')
    }
    if (!isFiniteNumber(effect.value)) fail(`${path}.value`, '必须是有限数值')
    if (!hasStrings(effect.tags)) fail(`${path}.tags`, '必须是字符串数组')
    validateAppear(effect.appear, `${path}.appear`)
    if (effect.acquired && !effect.unlocked) warn(path, '已获取效果尚未解锁')
    if (effect.duration != null) {
      if (!isRecord(effect.duration)) {
        fail(`${path}.duration`, '必须是对象或 null')
      } else {
        if (!new Set(['instant', 'turns', 'permanent']).has(effect.duration.type)) {
          fail(`${path}.duration.type`, '未知的持续时间类型')
        }
        if (effect.duration.remaining !== null && !isNonNegativeInteger(effect.duration.remaining)) {
          fail(`${path}.duration.remaining`, '必须是非负整数或 null')
        }
        if (effect.duration.type === 'turns' && effect.duration.remaining === null) {
          warn(`${path}.duration.remaining`, '回合持续效果没有剩余回合')
        }
      }
    }
    if (effect.triggers !== undefined && !Array.isArray(effect.triggers)) {
      fail(`${path}.triggers`, '必须是数组')
    } else {
      effect.triggers?.forEach((trigger, triggerIndex) => {
        const triggerPath = `${path}.triggers[${triggerIndex}]`
        if (!timings.has(trigger.timing)) fail(`${triggerPath}.timing`, '未知的触发时机')
        validateConditions(trigger.conditions, `${triggerPath}.conditions`)
        validateActions(trigger.actions, `${triggerPath}.actions`)
      })
    }
  })

  data.effectCombos.forEach((combo, index) => {
    const path = `effectCombos[${index}]`
    if (!isRecord(combo)) {
      fail(path, '必须是对象')
      return
    }
    requiredString(combo.id, `${path}.id`)
    requiredString(combo.name, `${path}.name`)
    if (typeof combo.appeared !== 'boolean') fail(`${path}.appeared`, '必须是布尔值')
    if (!timings.has(combo.timing)) fail(`${path}.timing`, '未知的触发时机')
    validateConditions(combo.conditions, `${path}.conditions`)
    validateActions(combo.actions, `${path}.actions`)
  })

  data.pools.forEach((pool, index) => {
    const path = `pools[${index}]`
    if (!isRecord(pool)) {
      fail(path, '必须是对象')
      return
    }
    requiredString(pool.id, `${path}.id`)
    validateSelector(pool.selector, `${path}.selector`)
    validateExpression(pool.count, `${path}.count`)
    if (typeof pool.unique !== 'boolean') fail(`${path}.unique`, '必须是布尔值')
    if (pool.weight !== undefined) validateExpression(pool.weight, `${path}.weight`)
  })

  data.events.forEach((event, index) => validateEvent(event, index))
  validateStaticReferences()

  return errors.length > 0
    ? { success: false, errors, warnings }
    : { success: true, data, errors: [], warnings }

  function validateMeta(model: GameModelData) {
    requiredString(model.meta.id, 'meta.id')
    requiredString(model.meta.version, 'meta.version')
    if (!isNonNegativeInteger(model.meta.turn)) fail('meta.turn', '必须是非负整数')
    if (model.meta.seed !== null && typeof model.meta.seed !== 'string') {
      fail('meta.seed', '必须是字符串或 null')
    }
    if (model.meta.runs !== undefined && !isNonNegativeInteger(model.meta.runs)) {
      fail('meta.runs', '必须是非负整数')
    }
  }

  function validateCharacter(model: GameModelData) {
    requiredString(model.character.id, 'character.id')
    if (!isRecord(model.character.attributes)) {
      fail('character.attributes', '必须是对象')
      return
    }
    Object.entries(model.character.attributes).forEach(([id, attribute]) => {
      const path = `character.attributes.${id}`
      if (id.includes('.')) fail(path, '属性 ID 不得包含点号')
      if (!isRecord(attribute)) {
        fail(path, '必须是对象')
        return
      }
      requiredString(attribute.displayName, `${path}.displayName`)
      if (typeof attribute.enabled !== 'boolean') fail(`${path}.enabled`, '必须是布尔值')
      if (!isJsonPrimitive(attribute.value)) fail(`${path}.value`, '必须是 JSON 基础值')
      if (attribute.min !== undefined && !isFiniteNumber(attribute.min)) {
        fail(`${path}.min`, '必须是有限数值')
      }
      if (attribute.max !== undefined && !isFiniteNumber(attribute.max)) {
        fail(`${path}.max`, '必须是有限数值')
      }
      if (
        (attribute.min !== undefined || attribute.max !== undefined)
        && typeof attribute.value !== 'number'
      ) {
        fail(path, '非数值属性不能声明 min 或 max')
      } else if (
        typeof attribute.value === 'number'
        && (
          (attribute.min !== undefined && attribute.max !== undefined && attribute.min > attribute.max)
          || (attribute.min !== undefined && attribute.value < attribute.min)
          || (attribute.max !== undefined && attribute.value > attribute.max)
        )
      ) {
        fail(path, '属性值或边界无效')
      }
    })
  }

  function uniqueIds(items: unknown[], path: string): Set<string> {
    const ids = new Set<string>()
    items.forEach((item, index) => {
      if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) {
        fail(`${path}[${index}].id`, '必须是非空字符串')
      } else if (ids.has(item.id)) {
        fail(`${path}[${index}].id`, `ID ${item.id} 重复`)
      } else {
        if (item.id.includes('.')) fail(`${path}[${index}].id`, 'ID 不得包含点号')
        ids.add(item.id)
      }
    })
    return ids
  }

  function requiredString(value: unknown, path: string) {
    if (typeof value !== 'string' || value.length === 0) fail(path, '必须是非空字符串')
  }

  function validateAppear(value: unknown, path: string) {
    if (!isRecord(value)) {
      fail(path, '必须是对象')
      return
    }
    validateConditions(value.conditions, `${path}.conditions`)
    if (!isFiniteNumber(value.chance) || value.chance < 0 || value.chance > 1) {
      fail(`${path}.chance`, '必须是 0 到 1 之间的数值')
    }
  }

  function validateConditions(value: unknown, path: string) {
    if (!Array.isArray(value)) {
      fail(path, '必须是数组')
      return
    }
    value.forEach((condition, index) => validateCondition(condition, `${path}[${index}]`))
  }

  function validateCondition(value: unknown, path: string) {
    if (!isRecord(value) || typeof value.type !== 'string' || !conditionTypes.has(value.type)) {
      fail(`${path}.type`, '未知的条件类型')
      return
    }
    const condition = value as unknown as Condition
    if (condition.type === 'and' || condition.type === 'or' || condition.type === 'not') {
      validateConditions(condition.conditions, `${path}.conditions`)
      return
    }
    if (!comparisonOperators.has(condition.operator)) fail(`${path}.operator`, '未知的比较操作符')
    validateExpression(condition.value, `${path}.value`)
    if (condition.type === 'attribute') requiredString(condition.attribute, `${path}.attribute`)
    if (condition.type === 'effect') {
      requiredString(condition.effectId, `${path}.effectId`)
      requiredString(condition.field, `${path}.field`)
    }
    if (condition.type === 'event') {
      requiredString(condition.eventId, `${path}.eventId`)
      requiredString(condition.field, `${path}.field`)
    }
    if (condition.type === 'aggregate') {
      validateSelector(condition.selector, `${path}.selector`)
      if (!new Set(['count', 'sum', 'min', 'max', 'average']).has(condition.aggregate)) {
        fail(`${path}.aggregate`, '未知的聚合方式')
      }
      if (condition.aggregate !== 'count' && !condition.field) {
        fail(`${path}.field`, '非 count 聚合必须提供字段')
      }
    }
  }

  function validateSelector(value: unknown, path: string) {
    if (!isRecord(value) || !new Set(['effect', 'event']).has(String(value.target))) {
      fail(`${path}.target`, '选择器目标必须是 effect 或 event')
      return
    }
    const selector = value as unknown as Selector
    if (selector.ids !== undefined && !hasStrings(selector.ids)) fail(`${path}.ids`, '必须是字符串数组')
    if (selector.tags !== undefined && !hasStrings(selector.tags)) fail(`${path}.tags`, '必须是字符串数组')
    if (selector.kinds !== undefined) {
      if (!hasStrings(selector.kinds)) {
        fail(`${path}.kinds`, '必须是字符串数组')
      } else {
        selector.kinds.forEach((kind, index) => {
          if (!effectKindIds.has(kind)) fail(`${path}.kinds[${index}]`, '引用了未声明的效果类型')
        })
      }
    }
    if (selector.target === 'event' && (selector.tags || selector.kinds)) {
      warn(path, '事件选择器声明了仅效果可用的 tags 或 kinds')
    }
    if (selector.fields !== undefined && !Array.isArray(selector.fields)) {
      fail(`${path}.fields`, '必须是数组')
    } else {
      selector.fields?.forEach((field, index) => {
        const fieldPath = `${path}.fields[${index}]`
        requiredString(field.field, `${fieldPath}.field`)
        if (!comparisonOperators.has(field.operator)) fail(`${fieldPath}.operator`, '未知的比较操作符')
        validateExpression(field.value, `${fieldPath}.value`)
      })
    }
  }

  function validateExpression(value: unknown, path: string) {
    if (!isRecord(value) || typeof value.type !== 'string' || !expressionTypes.has(value.type)) return
    const expression = value as unknown as ValueExpression
    if (!isRecord(expression) || typeof expression.type !== 'string') return
    switch (expression.type) {
      case 'field':
        requiredString(expression.path, `${path}.path`)
        if (expression.scope !== undefined && !scopes.has(String(expression.scope))) {
          fail(`${path}.scope`, '未知的数据作用域')
        }
        break
      case 'calculate':
        if (!new Set(['add', 'subtract', 'multiply', 'divide', 'min', 'max']).has(String(expression.operator))) {
          fail(`${path}.operator`, '未知的算术操作符')
        }
        if (!Array.isArray(expression.values) || expression.values.length === 0) {
          fail(`${path}.values`, '必须是非空数组')
        } else {
          expression.values.forEach((item, index) => validateExpression(item, `${path}.values[${index}]`))
        }
        break
      case 'random':
        if (!isFiniteNumber(expression.min) || !isFiniteNumber(expression.max) || expression.min > expression.max) {
          fail(path, '随机数上下界无效')
        }
        break
      case 'aggregate_value':
        validateSelector(expression.selector, `${path}.selector`)
        if (expression.aggregate !== 'count' && !expression.field) {
          fail(`${path}.field`, '非 count 聚合必须提供字段')
        }
        break
    }
  }

  function validateActions(value: unknown, path: string) {
    if (!Array.isArray(value)) {
      fail(path, '必须是数组')
      return
    }
    value.forEach((action, index) => validateAction(action, `${path}[${index}]`))
  }

  function validateAction(value: unknown, path: string) {
    if (!isRecord(value) || typeof value.type !== 'string' || !actionTypes.has(value.type)) {
      fail(`${path}.type`, '未知的动作类型')
      return
    }
    const action = value as unknown as Action
    if ('scope' in action && action.scope !== undefined && !scopes.has(action.scope)) {
      fail(`${path}.scope`, '未知的数据作用域')
    }
    if (action.type === 'modify_attribute' || action.type === 'modify_effect' || action.type === 'modify_event') {
      if (!actionModes.has(action.mode)) fail(`${path}.mode`, '未知的修改模式')
      validateExpression(action.value, `${path}.value`)
    }
    if (action.type === 'modify_attribute') {
      requiredString(action.attribute, `${path}.attribute`)
      if (action.field !== undefined && !new Set(['value', 'enabled']).has(action.field)) {
        fail(`${path}.field`, '只能是 value 或 enabled')
      }
      if (action.field === 'enabled' && action.mode !== 'set') {
        fail(`${path}.mode`, 'enabled 只能使用 set 修改')
      }
    }
    if (action.type === 'draw_pool') {
      requiredString(action.poolId, `${path}.poolId`)
      if (action.count !== undefined) validateExpression(action.count, `${path}.count`)
      validateActions(action.onDraw, `${path}.onDraw`)
      if (action.onEmpty !== undefined) validateActions(action.onEmpty, `${path}.onEmpty`)
    }
    if (action.type === 'create_choice') {
      requiredString(action.nodeId, `${path}.nodeId`)
      requiredString(action.effectId, `${path}.effectId`)
      if (!isRecord(action.choice)) fail(`${path}.choice`, '必须是对象')
    }
  }

  function validateEvent(event: GameEvent, index: number) {
    const path = `events[${index}]`
    if (!isRecord(event)) {
      fail(path, '必须是对象')
      return
    }
    requiredString(event.id, `${path}.id`)
    requiredString(event.name, `${path}.name`)
    if (!new Set(['foreground', 'background']).has(event.visibility)) fail(`${path}.visibility`, '未知展示层级')
    if (!new Set(['auto', 'manual']).has(event.startMode)) fail(`${path}.startMode`, '未知启动方式')
    for (const key of ['unlocked', 'appeared', 'repeatable', 'completed'] as const) {
      if (typeof event[key] !== 'boolean') fail(`${path}.${key}`, '必须是布尔值')
    }
    if (!isNonNegativeInteger(event.occurrences)) fail(`${path}.occurrences`, '必须是非负整数')
    if (!isNonNegativeInteger(event.remainingTurns)) fail(`${path}.remainingTurns`, '必须是非负整数')
    validateConditions(event.endConditions, `${path}.endConditions`)
    validateAppear(event.appear, `${path}.appear`)
    if (!isRecord(event.data)) fail(`${path}.data`, '必须是对象')
    if (!Array.isArray(event.nodes)) {
      fail(`${path}.nodes`, '必须是数组')
      return
    }
    const nodeIds = uniqueIds(event.nodes, `${path}.nodes`)
    if (!nodeIds.has(event.entryNode)) fail(`${path}.entryNode`, '引用了不存在的节点')
    if (event.currentNode !== null && !nodeIds.has(event.currentNode)) fail(`${path}.currentNode`, '引用了不存在的节点')
    if (event.timeoutNode !== null && !nodeIds.has(event.timeoutNode)) fail(`${path}.timeoutNode`, '引用了不存在的节点')

    event.nodes.forEach((node, nodeIndex) => validateNode(node, `${path}.nodes[${nodeIndex}]`, nodeIds))
    warnUnreachableNodes(event, path, nodeIds)
  }

  function validateNode(node: EventNode, path: string, nodeIds: Set<string>) {
    if (!isRecord(node) || typeof node.type !== 'string' || !nodeTypes.has(node.type)) {
      fail(`${path}.type`, '未知的节点类型')
      return
    }
    if (!new Set(['foreground', 'background']).has(node.visibility)) fail(`${path}.visibility`, '未知展示层级')
    const refs: Array<[string, unknown]> = []
    if (node.type === 'check') {
      for (const key of ['text', 'conditions', 'actions', 'next', 'chance', 'success', 'failure'] as const) {
        if (key in node) fail(`${path}.${key}`, 'check 节点不能声明该字段')
      }
      if (!Array.isArray(node.nexts)) {
        fail(`${path}.nexts`, '必须是节点 ID 数组')
      } else if (node.nexts.length === 0) {
        fail(`${path}.nexts`, '至少需要一个候选节点')
      } else {
        const seen = new Set<string>()
        node.nexts.forEach((nextId, index) => {
          refs.push([`nexts[${index}]`, nextId])
          if (typeof nextId === 'string') {
            if (seen.has(nextId)) fail(`${path}.nexts[${index}]`, '候选节点重复')
            seen.add(nextId)
          }
        })
      }
    } else {
      if (node.conditions !== undefined) validateConditions(node.conditions, `${path}.conditions`)
      if (node.actions !== undefined) validateActions(node.actions, `${path}.actions`)
      if ('next' in node && node.next != null) refs.push(['next', node.next])
      if (node.chance !== undefined && (!isFiniteNumber(node.chance) || node.chance < 0 || node.chance > 1)) {
        fail(`${path}.chance`, '必须是 0 到 1 之间的数值')
      }
    }
    if (node.type === 'wait') refs.push(['timeoutNode', node.timeoutNode])
    refs.forEach(([key, value]) => {
      if (typeof value !== 'string' || !nodeIds.has(value)) fail(`${path}.${key}`, '引用了不存在的节点')
    })
    if (node.type === 'choice') {
      if (!new Set(['single', 'multiple', 'quantity']).has(node.mode)) fail(`${path}.mode`, '未知选择模式')
      const choiceIds = uniqueIds(node.choices, `${path}.choices`)
      node.choices.forEach((choice, index) => validateChoice(choice, `${path}.choices[${index}]`, nodeIds))
      if (choiceIds.size !== node.choices.length) return
    }
  }

  function validateChoice(choice: Choice, path: string, nodeIds: Set<string>) {
    requiredString(choice.text, `${path}.text`)
    if (choice.conditions !== undefined) validateConditions(choice.conditions, `${path}.conditions`)
    if (choice.actions !== undefined) validateActions(choice.actions, `${path}.actions`)
    if (choice.next != null && !nodeIds.has(choice.next)) fail(`${path}.next`, '引用了不存在的节点')
    if (choice.quantity) {
      validateExpression(choice.quantity.min, `${path}.quantity.min`)
      validateExpression(choice.quantity.max, `${path}.quantity.max`)
      if (choice.quantity.step !== undefined) validateExpression(choice.quantity.step, `${path}.quantity.step`)
    }
  }

  function warnUnreachableNodes(event: GameEvent, path: string, nodeIds: Set<string>) {
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      const node = event.nodes.find((item) => item.id === id)
      if (!node) return
      if (node.next) visit(node.next)
      if (node.type === 'check' && Array.isArray(node.nexts)) {
        node.nexts.forEach((nextId) => visit(nextId))
      }
      if (node.type === 'wait') visit(node.timeoutNode)
      if (node.type === 'choice') node.choices.forEach((choice) => choice.next && visit(choice.next))
    }
    visit(event.entryNode)
    nodeIds.forEach((id) => {
      if (!visited.has(id)) warn(`${path}.nodes.${id}`, '节点无法从入口到达')
    })
  }

  function validateStaticReferences() {
    const walkCondition = (condition: Condition, path: string) => {
      if (condition.type === 'and' || condition.type === 'or' || condition.type === 'not') {
        condition.conditions.forEach((item, index) => walkCondition(item, `${path}.conditions[${index}]`))
      } else if (condition.type === 'attribute' && !attributeIds.has(condition.attribute)) {
        fail(`${path}.attribute`, '引用了不存在的属性')
      } else if (condition.type === 'effect' && !effectIds.has(condition.effectId)) {
        fail(`${path}.effectId`, '引用了不存在的效果')
      } else if (condition.type === 'event' && !eventIds.has(condition.eventId)) {
        fail(`${path}.eventId`, '引用了不存在的事件')
      }
    }
    const walkAction = (action: Action, path: string) => {
      if (action.type === 'modify_attribute' && !attributeIds.has(action.attribute)) {
        fail(`${path}.attribute`, '引用了不存在的属性')
      }
      if (action.type === 'modify_effect' && action.effectId !== '$drewId' && !effectIds.has(action.effectId)) {
        fail(`${path}.effectId`, '引用了不存在的效果')
      }
      if (action.type === 'modify_event' && action.eventId !== '$drewId' && !eventIds.has(action.eventId)) {
        fail(`${path}.eventId`, '引用了不存在的事件')
      }
      if (action.type === 'draw_pool') {
        if (!poolIds.has(action.poolId)) fail(`${path}.poolId`, '引用了不存在的候选池')
        action.onDraw.forEach((item, index) => walkAction(item, `${path}.onDraw[${index}]`))
        action.onEmpty?.forEach((item, index) => walkAction(item, `${path}.onEmpty[${index}]`))
      }
      if (action.type === 'create_choice' && action.effectId !== '$drewId' && !effectIds.has(action.effectId)) {
        fail(`${path}.effectId`, '引用了不存在的效果')
      }
    }
    const inspect = (conditions: Condition[] | undefined, actions: Action[] | undefined, path: string) => {
      conditions?.forEach((item, index) => walkCondition(item, `${path}.conditions[${index}]`))
      actions?.forEach((item, index) => walkAction(item, `${path}.actions[${index}]`))
    }
    data.effects.forEach((effect, index) => effect.triggers?.forEach((trigger, triggerIndex) => {
      inspect(trigger.conditions, trigger.actions, `effects[${index}].triggers[${triggerIndex}]`)
    }))
    data.effectCombos.forEach((combo, index) => inspect(combo.conditions, combo.actions, `effectCombos[${index}]`))
    data.events.forEach((event, eventIndex) => {
      inspect(event.endConditions, undefined, `events[${eventIndex}]`)
      event.nodes.forEach((node, nodeIndex) => {
        const path = `events[${eventIndex}].nodes[${nodeIndex}]`
        inspect(node.conditions, node.actions, path)
        if (node.type === 'choice') {
          node.choices.forEach((choice, choiceIndex) => {
            inspect(choice.conditions, choice.actions, `${path}.choices[${choiceIndex}]`)
          })
        }
      })
    })
    void comboIds
  }
}
