import type {
  Action,
  ActionMode,
  ActionScope,
  Choice,
  ComparisonOperator,
  Condition,
  Effect,
  GameEvent,
  GameModelData,
  JsonValue,
  Selector,
  TriggerTiming,
  ValueExpression,
} from '../types'
import { nextRandom } from './rng'

export class RuleError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}：${message}`)
    this.name = 'RuleError'
    this.path = path
  }
}

export interface SelectionContext {
  choiceId: string
  quantity?: number
}

export interface RuleContext {
  defaultData: GameModelData
  saveData: GameModelData
  runData: GameModelData
  currentEventId?: string
  candidate?: Effect | GameEvent
  drewId?: string
  selection?: SelectionContext
}

type SelectedEntity = Effect | GameEvent

const collectionNames = new Set(['effects', 'effectCombos', 'pools', 'events'])
const expressionTypes = new Set(['field', 'calculate', 'random', 'aggregate_value'])

function modelForScope(context: RuleContext, scope: ActionScope = 'run'): GameModelData {
  if (scope === 'default') return context.defaultData
  if (scope === 'save') return context.saveData
  return context.runData
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readPath(root: unknown, path: string, location = path): unknown {
  if (!path) throw new RuleError(location, '字段路径不能为空')
  const parts = path.split('.')
  let current = root

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (Array.isArray(current)) {
      const previous = parts[index - 1]
      if (collectionNames.has(previous)) {
        const item = current.find((candidate) => objectValue(candidate) && candidate.id === part)
        if (item === undefined) throw new RuleError(location, `找不到 ID 为 ${part} 的实体`)
        current = item
      } else {
        const arrayIndex = Number(part)
        if (!Number.isInteger(arrayIndex) || !(arrayIndex in current)) {
          throw new RuleError(location, `数组下标 ${part} 无效`)
        }
        current = current[arrayIndex]
      }
    } else if (objectValue(current) && part in current) {
      current = current[part]
    } else {
      throw new RuleError(location, `字段 ${parts.slice(0, index + 1).join('.')} 不存在`)
    }
  }

  return current
}

function resolveTemporaryPath(context: RuleContext, path: string, location: string): unknown {
  if (path === '$drewId') {
    if (context.drewId === undefined) throw new RuleError(location, '$drewId 当前不可用')
    return context.drewId
  }
  if (path === '$candidate') {
    if (!context.candidate) throw new RuleError(location, '$candidate 当前不可用')
    return context.candidate
  }
  if (path.startsWith('$candidate.')) {
    if (!context.candidate) throw new RuleError(location, '$candidate 当前不可用')
    return readPath(context.candidate, path.slice('$candidate.'.length), location)
  }
  if (path === '$selection.choiceId') {
    if (!context.selection) throw new RuleError(location, '$selection 当前不可用')
    return context.selection.choiceId
  }
  if (path === '$selection.quantity') {
    if (context.selection?.quantity === undefined) throw new RuleError(location, '当前选择没有数量')
    return context.selection.quantity
  }
  return undefined
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RuleError(path, '需要有限数值')
  }
  return value
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
  }
  if (objectValue(left) && objectValue(right) && !Array.isArray(left) && !Array.isArray(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => key in right && deepEqual(left[key], right[key]))
  }
  return false
}

export function compareValues(
  left: unknown,
  operator: ComparisonOperator,
  right: unknown,
  path: string,
): boolean {
  if (operator === '==' || operator === '!=') {
    const equal = deepEqual(left, right)
    return operator === '==' ? equal : !equal
  }

  if (operator === 'contains' || operator === 'not_contains') {
    let contains: boolean
    if (typeof left === 'string' && typeof right === 'string') {
      contains = left.includes(right)
    } else if (Array.isArray(left)) {
      contains = left.some((item) => deepEqual(item, right))
    } else {
      throw new RuleError(path, 'contains 左侧必须是字符串或数组')
    }
    return operator === 'contains' ? contains : !contains
  }

  const bothNumbers = typeof left === 'number' && Number.isFinite(left)
    && typeof right === 'number' && Number.isFinite(right)
  const bothStrings = typeof left === 'string' && typeof right === 'string'
  if (!bothNumbers && !bothStrings) throw new RuleError(path, '有序比较的两侧类型不匹配')

  if (operator === '>') return left > right
  if (operator === '>=') return left >= right
  if (operator === '<') return left < right
  return left <= right
}

function randomValue(context: RuleContext, path: string): number {
  const seed = context.runData.meta.seed
  if (!seed) throw new RuleError(path, '局内随机种子不存在')
  const result = nextRandom(seed)
  context.runData.meta.seed = result.seed
  return result.value
}

export function testChance(context: RuleContext, chance: number, path: string): boolean {
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new RuleError(path, '概率必须在 0 到 1 之间')
  }
  if (chance <= 0) return false
  if (chance >= 1) return true
  return randomValue(context, path) < chance
}

export function resolveValue(context: RuleContext, expression: ValueExpression, path: string): unknown {
  if (!objectValue(expression) || Array.isArray(expression)) return expression
  const type = expression.type
  if (typeof type !== 'string' || !expressionTypes.has(type)) return expression

  switch (type) {
    case 'field': {
      const valueExpression = expression as unknown as Extract<ValueExpression, { type: 'field' }>
      const temporary = resolveTemporaryPath(context, valueExpression.path, path)
      if (temporary !== undefined) return temporary
      return readPath(modelForScope(context, valueExpression.scope), valueExpression.path, path)
    }
    case 'calculate': {
      const valueExpression = expression as unknown as Extract<ValueExpression, { type: 'calculate' }>
      const values = valueExpression.values.map((item, index) =>
        finiteNumber(resolveValue(context, item, `${path}.values[${index}]`), `${path}.values[${index}]`),
      )
      if (values.length === 0) throw new RuleError(path, '算术表达式不能为空')
      switch (valueExpression.operator) {
        case 'add':
          return values.reduce((total, value) => total + value, 0)
        case 'subtract':
          return values.slice(1).reduce((total, value) => total - value, values[0])
        case 'multiply':
          return values.reduce((total, value) => total * value, 1)
        case 'divide':
          return values.slice(1).reduce((total, value) => {
            if (value === 0) throw new RuleError(path, '不能除以 0')
            return total / value
          }, values[0])
        case 'min':
          return Math.min(...values)
        case 'max':
          return Math.max(...values)
        default:
          return assertNever(valueExpression.operator)
      }
    }
    case 'random': {
      const valueExpression = expression as unknown as Extract<ValueExpression, { type: 'random' }>
      const min = finiteNumber(valueExpression.min, `${path}.min`)
      const max = finiteNumber(valueExpression.max, `${path}.max`)
      if (min > max) throw new RuleError(path, '随机数最小值不能大于最大值')
      const random = randomValue(context, path)
      return valueExpression.integer
        ? Math.floor(random * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min)
        : min + random * (max - min)
    }
    case 'aggregate_value': {
      const valueExpression = expression as unknown as Extract<ValueExpression, { type: 'aggregate_value' }>
      return aggregate(
        selectEntities(context, valueExpression.selector, `${path}.selector`),
        valueExpression.aggregate,
        valueExpression.field,
        path,
      )
    }
    default:
      throw new RuleError(path, `未知的值表达式 ${String(type)}`)
  }
}

export function selectEntities(context: RuleContext, selector: Selector, path: string): SelectedEntity[] {
  const source: SelectedEntity[] = selector.target === 'effect'
    ? context.runData.effects
    : context.runData.events

  return source.filter((candidate) => {
    if (selector.ids && !selector.ids.includes(candidate.id)) return false
    if (selector.target === 'effect') {
      const effect = candidate as Effect
      if (selector.tags && !selector.tags.every((tag) => effect.tags.includes(tag))) return false
      if (selector.kinds && !selector.kinds.includes(effect.kind)) return false
    } else if (selector.tags || selector.kinds) {
      throw new RuleError(path, '事件选择器不能使用 tags 或 kinds')
    }
    return (selector.fields ?? []).every((matcher, index) => {
      const left = readPath(candidate, matcher.field, `${path}.fields[${index}].field`)
      const right = resolveValue(context, matcher.value, `${path}.fields[${index}].value`)
      return compareValues(left, matcher.operator, right, `${path}.fields[${index}]`)
    })
  })
}

function aggregate(
  values: SelectedEntity[],
  operation: 'count' | 'sum' | 'min' | 'max' | 'average',
  field: string | undefined,
  path: string,
): number | null {
  if (operation === 'count') return values.length
  if (!field) throw new RuleError(path, '非 count 聚合必须提供字段')
  const numbers = values.map((item, index) =>
    finiteNumber(readPath(item, field, `${path}.selected[${index}].${field}`), path),
  )
  if (operation === 'sum') return numbers.reduce((total, value) => total + value, 0)
  if (numbers.length === 0) return null
  if (operation === 'min') return Math.min(...numbers)
  if (operation === 'max') return Math.max(...numbers)
  return numbers.reduce((total, value) => total + value, 0) / numbers.length
}

export function evaluateCondition(context: RuleContext, condition: Condition, path: string): boolean {
  switch (condition.type) {
    case 'attribute': {
      const attribute = context.runData.character.attributes[condition.attribute]
      if (!attribute) throw new RuleError(path, `属性 ${condition.attribute} 不存在`)
      return compareValues(
        attribute.value,
        condition.operator,
        resolveValue(context, condition.value, `${path}.value`),
        path,
      )
    }
    case 'effect': {
      const effect = context.runData.effects.find((item) => item.id === condition.effectId)
      if (!effect) throw new RuleError(path, `效果 ${condition.effectId} 不存在`)
      return compareValues(
        readPath(effect, condition.field, `${path}.field`),
        condition.operator,
        resolveValue(context, condition.value, `${path}.value`),
        path,
      )
    }
    case 'event': {
      const event = context.runData.events.find((item) => item.id === condition.eventId)
      if (!event) throw new RuleError(path, `事件 ${condition.eventId} 不存在`)
      return compareValues(
        readPath(event, condition.field, `${path}.field`),
        condition.operator,
        resolveValue(context, condition.value, `${path}.value`),
        path,
      )
    }
    case 'turn':
      return compareValues(
        context.runData.meta.turn,
        condition.operator,
        resolveValue(context, condition.value, `${path}.value`),
        path,
      )
    case 'aggregate':
      return compareValues(
        aggregate(
          selectEntities(context, condition.selector, `${path}.selector`),
          condition.aggregate,
          condition.field,
          path,
        ),
        condition.operator,
        resolveValue(context, condition.value, `${path}.value`),
        path,
      )
    case 'and':
      return condition.conditions.every((item, index) =>
        evaluateCondition(context, item, `${path}.conditions[${index}]`),
      )
    case 'or':
      return condition.conditions.some((item, index) =>
        evaluateCondition(context, item, `${path}.conditions[${index}]`),
      )
    case 'not':
      return condition.conditions.length > 0
        && !condition.conditions.every((item, index) =>
          evaluateCondition(context, item, `${path}.conditions[${index}]`),
        )
    default:
      return assertNever(condition)
  }
}

export function evaluateConditions(context: RuleContext, conditions: Condition[], path: string): boolean {
  return conditions.every((condition, index) =>
    evaluateCondition(context, condition, `${path}[${index}]`),
  )
}

function applyMode(current: unknown, value: unknown, mode: ActionMode, path: string): unknown {
  if (mode === 'set') return structuredClone(value)
  const left = finiteNumber(current, path)
  const right = finiteNumber(value, `${path}.value`)
  if (mode === 'add') return left + right
  if (mode === 'multiply') return left * right
  if (mode === 'min') return Math.min(left, right)
  return Math.max(left, right)
}

function setRelativePath(
  target: Record<string, unknown>,
  field: string,
  value: unknown,
  mode: ActionMode,
  path: string,
  allowCreateInData: boolean,
) {
  const parts = field.split('.')
  let parent: unknown = target
  for (const part of parts.slice(0, -1)) {
    if (!objectValue(parent) || !(part in parent)) throw new RuleError(path, `父字段 ${part} 不存在`)
    parent = parent[part]
  }
  const key = parts.at(-1)
  if (!key || !objectValue(parent)) throw new RuleError(path, '字段路径无效')
  const exists = key in parent
  const canCreate = allowCreateInData && mode === 'set' && parts[0] === 'data'
  if (!exists && !canCreate) throw new RuleError(path, `字段 ${field} 不存在`)
  parent[key] = applyMode(exists ? parent[key] : undefined, value, mode, path)
}

function resolveTargetId(id: string, context: RuleContext, path: string): string {
  if (id !== '$drewId') return id
  if (!context.drewId) throw new RuleError(path, '$drewId 当前不可用')
  return context.drewId
}

function weightedDraw(
  context: RuleContext,
  candidates: Array<{ entity: SelectedEntity; weight: number }>,
  count: number,
  unique: boolean,
  path: string,
): SelectedEntity[] {
  const available = [...candidates]
  const results: SelectedEntity[] = []

  for (let drawIndex = 0; drawIndex < count && available.length > 0; drawIndex += 1) {
    const total = available.reduce((sum, item) => sum + item.weight, 0)
    let target = randomValue(context, `${path}.draw[${drawIndex}]`) * total
    let selectedIndex = available.length - 1
    for (let index = 0; index < available.length; index += 1) {
      target -= available[index].weight
      if (target < 0) {
        selectedIndex = index
        break
      }
    }
    results.push(available[selectedIndex].entity)
    if (unique) available.splice(selectedIndex, 1)
  }
  return results
}

function replaceDrewId(value: unknown, drewId: string): unknown {
  if (typeof value === 'string') return value.replaceAll('$drewId', drewId)
  if (Array.isArray(value)) return value.map((item) => replaceDrewId(item, drewId))
  if (objectValue(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDrewId(item, drewId)]))
  }
  return value
}

export function executeAction(context: RuleContext, action: Action, path: string): void {
  switch (action.type) {
    case 'modify_attribute': {
      const scope = action.scope ?? 'run'
      if (scope === 'default') throw new RuleError(path, '局内动作不能修改默认数据')
      const model = modelForScope(context, scope)
      const attribute = model.character.attributes[action.attribute]
      if (!attribute) throw new RuleError(path, `属性 ${action.attribute} 不存在`)
      const value = resolveValue(context, action.value, `${path}.value`)
      const result = finiteNumber(applyMode(attribute.value, value, action.mode, path), path)
      attribute.value = Math.max(attribute.min, Math.min(attribute.max, result))
      break
    }
    case 'modify_effect': {
      const scope = action.scope ?? 'run'
      if (scope === 'default') throw new RuleError(path, '局内动作不能修改默认数据')
      const id = resolveTargetId(action.effectId, context, `${path}.effectId`)
      const effect = modelForScope(context, scope).effects.find((item) => item.id === id)
      if (!effect) throw new RuleError(path, `效果 ${id} 不存在`)
      setRelativePath(
        effect as unknown as Record<string, unknown>,
        action.field,
        resolveValue(context, action.value, `${path}.value`),
        action.mode,
        path,
        false,
      )
      break
    }
    case 'modify_event': {
      const scope = action.scope ?? 'run'
      if (scope === 'default') throw new RuleError(path, '局内动作不能修改默认数据')
      const id = resolveTargetId(action.eventId, context, `${path}.eventId`)
      const event = modelForScope(context, scope).events.find((item) => item.id === id)
      if (!event) throw new RuleError(path, `事件 ${id} 不存在`)
      setRelativePath(
        event as unknown as Record<string, unknown>,
        action.field,
        resolveValue(context, action.value, `${path}.value`),
        action.mode,
        path,
        true,
      )
      break
    }
    case 'draw_pool': {
      const pool = context.runData.pools.find((item) => item.id === action.poolId)
      if (!pool) throw new RuleError(path, `候选池 ${action.poolId} 不存在`)
      const count = resolveValue(context, action.count ?? pool.count, `${path}.count`)
      if (!Number.isInteger(count) || (count as number) < 0) throw new RuleError(path, '抽取数量必须是非负整数')
      const selected = selectEntities(context, pool.selector, `${path}.selector`)
      const candidates = selected.flatMap((entity, index) => {
        if (!entity.unlocked || entity.appeared) return []
        if ('repeatable' in entity && !entity.repeatable && entity.completed) return []
        if (!evaluateConditions(context, entity.appear.conditions, `${path}.candidates[${index}].appear.conditions`)) return []
        if (!testChance(context, entity.appear.chance, `${path}.candidates[${index}].appear.chance`)) return []
        const nested = { ...context, candidate: entity }
        const weight = finiteNumber(
          resolveValue(nested, pool.weight ?? 1, `${path}.candidates[${index}].weight`),
          `${path}.candidates[${index}].weight`,
        )
        return weight > 0 ? [{ entity, weight }] : []
      })
      const results = weightedDraw(context, candidates, count as number, pool.unique, path)
      if (results.length === 0) {
        executeActions(context, action.onEmpty ?? [], `${path}.onEmpty`)
      } else {
        results.forEach((entity, index) => {
          executeActions({ ...context, drewId: entity.id }, action.onDraw, `${path}.onDraw(${index}:${entity.id})`)
        })
      }
      break
    }
    case 'create_choice': {
      if (!context.drewId && action.effectId.includes('$drewId')) {
        throw new RuleError(path, '$drewId 当前不可用')
      }
      const eventId = action.eventId ?? context.currentEventId
      if (!eventId) throw new RuleError(path, '缺少目标事件上下文')
      const event = context.runData.events.find((item) => item.id === eventId)
      if (!event) throw new RuleError(path, `事件 ${eventId} 不存在`)
      const node = event.nodes.find((item) => item.id === action.nodeId)
      if (!node || node.type !== 'choice') throw new RuleError(path, `节点 ${action.nodeId} 不是选择节点`)
      const effectId = action.effectId === '$drewId'
        ? resolveTargetId(action.effectId, context, path)
        : action.effectId
      const effect = context.runData.effects.find((item) => item.id === effectId)
      if (!effect) throw new RuleError(path, `效果 ${effectId} 不存在`)
      const template = replaceDrewId(action.choice, context.drewId ?? effectId) as Partial<Choice>
      const choice: Choice = {
        ...template,
        id: template.id ?? effect.id,
        text: template.text ?? effect.name,
      }
      if (JSON.stringify(choice).includes('$drewId')) throw new RuleError(path, '生成选项仍包含 $drewId')
      if (node.choices.some((item) => item.id === choice.id)) throw new RuleError(path, `选项 ID ${choice.id} 重复`)
      node.choices.push(choice)
      break
    }
    default:
      assertNever(action)
  }
}

export function executeActions(context: RuleContext, actions: Action[], path: string): void {
  actions.forEach((action, index) => executeAction(context, action, `${path}[${index}]`))
}

export function runTiming(context: RuleContext, timing: TriggerTiming): void {
  const acquiredIds = new Set(context.runData.effects.filter((effect) => effect.acquired).map((effect) => effect.id))
  context.runData.effects.forEach((effect, effectIndex) => {
    if (!acquiredIds.has(effect.id)) return
    effect.triggers?.forEach((trigger, triggerIndex) => {
      if (trigger.timing !== timing) return
      const path = `effects[${effectIndex}].triggers[${triggerIndex}]`
      if (evaluateConditions(context, trigger.conditions, `${path}.conditions`)) {
        executeActions(context, trigger.actions, `${path}.actions`)
      }
    })
  })
}

export function runCombos(context: RuleContext, timing: TriggerTiming): void {
  context.runData.effectCombos.forEach((combo, index) => {
    if (combo.timing !== timing || combo.appeared) return
    const path = `effectCombos[${index}]`
    if (evaluateConditions(context, combo.conditions, `${path}.conditions`)) {
      executeActions(context, combo.actions, `${path}.actions`)
      combo.appeared = true
    }
  })
}

function assertNever(value: never): never {
  throw new Error(`未处理的判别值：${JSON.stringify(value)}`)
}

export function asJsonValue(value: unknown, path: string): JsonValue {
  try {
    return structuredClone(value) as JsonValue
  } catch {
    throw new RuleError(path, '值无法写入 JSON 数据')
  }
}
