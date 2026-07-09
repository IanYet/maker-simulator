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

/** 规则执行过程中携带模型路径的业务错误。 */
export class RuleError extends Error {
  /** 出错的模型路径或命令路径。 */
  readonly path: string

  /**
   * 创建规则错误。
   *
   * @param path - 出错的模型路径或命令路径。
   * @param message - 面向用户或内容作者的错误信息。
   */
  constructor(path: string, message: string) {
    super(`${path}：${message}`)
    this.name = 'RuleError'
    this.path = path
  }
}

/** 玩家选择动作执行时可读取的临时上下文。 */
export interface SelectionContext {
  /** 当前被提交的选项 ID。 */
  choiceId: string
  /** 数量选择模式下当前选项的提交数量。 */
  quantity?: number
}

/** 单次规则求值或动作执行使用的上下文。 */
export interface RuleContext {
  /** 只读默认内容数据。 */
  defaultData: GameModelData
  /** 可跨局持久化的玩家存档数据。 */
  saveData: GameModelData
  /** 当前局内数据。 */
  runData: GameModelData
  /** 当前正在处理的事件 ID。 */
  currentEventId?: string
  /** 候选池筛选或权重计算时的当前候选实体。 */
  candidate?: Effect | GameEvent
  /** 候选池抽中实体后绑定的实体 ID。 */
  drewId?: string
  /** 玩家选择动作执行时绑定的选择上下文。 */
  selection?: SelectionContext
}

/** Selector 能返回的模型实体。 */
type SelectedEntity = Effect | GameEvent

/** 在字段路径中支持按 ID 寻址的集合字段。 */
const collectionNames = new Set(['effectKinds', 'effects', 'effectCombos', 'pools', 'events'])

/** 运行时支持解析的值表达式类型。 */
const expressionTypes = new Set(['field', 'calculate', 'random', 'aggregate_value'])

/**
 * 按作用域选择规则应读写的模型数据。
 *
 * @param context - 当前规则执行上下文。
 * @param scope - 目标数据作用域，未传入时默认使用 run。
 * @returns 作用域对应的模型数据。
 */
function modelForScope(context: RuleContext, scope: ActionScope = 'run'): GameModelData {
  if (scope === 'default') return context.defaultData
  if (scope === 'save') return context.saveData
  return context.runData
}

/**
 * 判断值是否为普通对象。
 *
 * @param value - 待判断的值。
 * @returns 值为非 null 对象时返回 true。
 */
function objectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 从对象或数组中按点分路径读取字段。
 *
 * 集合字段支持使用实体 ID 寻址，例如 `events.some_event.appeared`。
 *
 * @param root - 读取起点。
 * @param path - 点分字段路径。
 * @param location - 报错时使用的模型路径。
 * @returns 路径对应的值。
 * @throws {RuleError} 当字段路径为空或无法解析时抛出。
 */
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

/**
 * 解析 `$candidate`、`$drewId` 和 `$selection` 等临时字段路径。
 *
 * @param context - 当前规则执行上下文。
 * @param path - 临时字段路径。
 * @param location - 报错时使用的模型路径。
 * @returns 临时值；路径不属于临时字段时返回 undefined。
 * @throws {RuleError} 当临时上下文不可用时抛出。
 */
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

/**
 * 将未知值校验并收窄为有限数值。
 *
 * @param value - 待校验的值。
 * @param path - 错误定位路径。
 * @returns 有限数值。
 * @throws {RuleError} 当值不是有限数值时抛出。
 */
function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RuleError(path, '需要有限数值')
  }
  return value
}

/**
 * 对 JSON 类值执行深度相等比较。
 *
 * @param left - 左侧值。
 * @param right - 右侧值。
 * @returns 两个值结构和值都相同时返回 true。
 */
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

/**
 * 按模型比较操作符比较两个值。
 *
 * @param left - 左侧值。
 * @param operator - 比较操作符。
 * @param right - 右侧值。
 * @param path - 错误定位路径。
 * @returns 比较成立时返回 true。
 * @throws {RuleError} 当操作符对应的数据类型不合法时抛出。
 */
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

/**
 * 推进局内随机种子并返回本次随机值。
 *
 * @param context - 当前规则执行上下文。
 * @param path - 错误定位路径。
 * @returns [0, 1) 区间内的随机值。
 * @throws {RuleError} 当局内随机种子缺失时抛出。
 */
function randomValue(context: RuleContext, path: string): number {
  const seed = context.runData.meta.seed
  if (!seed) throw new RuleError(path, '局内随机种子不存在')
  const result = nextRandom(seed)
  context.runData.meta.seed = result.seed
  return result.value
}

/**
 * 使用确定性随机数测试概率是否命中。
 *
 * @param context - 当前规则执行上下文。
 * @param chance - 0 到 1 之间的命中概率。
 * @param path - 错误定位路径。
 * @returns 概率命中时返回 true。
 * @throws {RuleError} 当概率不在合法范围内时抛出。
 */
export function testChance(context: RuleContext, chance: number, path: string): boolean {
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new RuleError(path, '概率必须在 0 到 1 之间')
  }
  if (chance <= 0) return false
  if (chance >= 1) return true
  return randomValue(context, path) < chance
}

/**
 * 解析静态值或运行时值表达式。
 *
 * @param context - 当前规则执行上下文。
 * @param expression - 待解析的值表达式或静态 JSON 值。
 * @param path - 错误定位路径。
 * @returns 表达式解析后的运行时值。
 * @throws {RuleError} 当表达式配置或求值非法时抛出。
 */
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

/**
 * 按 Selector 从当前局内数据中筛选效果或事件。
 *
 * @param context - 当前规则执行上下文。
 * @param selector - 选择器配置。
 * @param path - 错误定位路径。
 * @returns 符合选择器条件的实体列表。
 * @throws {RuleError} 当事件选择器使用仅效果可用字段时抛出。
 */
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

/**
 * 对选中的实体集合执行聚合计算。
 *
 * @param values - 已选中的实体列表。
 * @param operation - 聚合操作。
 * @param field - 非 count 聚合读取的字段路径。
 * @param path - 错误定位路径。
 * @returns 聚合结果；空集合执行非 sum 聚合时返回 null。
 * @throws {RuleError} 当非 count 聚合缺少字段或字段不是数值时抛出。
 */
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

/**
 * 计算单个条件是否成立。
 *
 * @param context - 当前规则执行上下文。
 * @param condition - 待计算的条件。
 * @param path - 错误定位路径。
 * @returns 条件成立时返回 true。
 * @throws {RuleError} 当条件引用不存在实体或比较非法时抛出。
 */
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

/**
 * 计算条件数组是否全部成立。
 *
 * @param context - 当前规则执行上下文。
 * @param conditions - 待计算的条件数组。
 * @param path - 错误定位路径。
 * @returns 所有条件都成立时返回 true。
 */
export function evaluateConditions(context: RuleContext, conditions: Condition[], path: string): boolean {
  return conditions.every((condition, index) =>
    evaluateCondition(context, condition, `${path}[${index}]`),
  )
}

/**
 * 按动作写入模式合成字段新值。
 *
 * @param current - 当前字段值。
 * @param value - 动作提供的写入值。
 * @param mode - 修改模式。
 * @param path - 错误定位路径。
 * @returns 合成后的字段值。
 * @throws {RuleError} 当非 set 模式遇到非数值时抛出。
 */
function applyMode(current: unknown, value: unknown, mode: ActionMode, path: string): unknown {
  if (mode === 'set') return structuredClone(value)
  const left = finiteNumber(current, path)
  const right = finiteNumber(value, `${path}.value`)
  if (mode === 'add') return left + right
  if (mode === 'multiply') return left * right
  if (mode === 'min') return Math.min(left, right)
  return Math.max(left, right)
}

/**
 * 在目标对象内部按相对路径写入字段。
 *
 * @param target - 写入目标对象。
 * @param field - 相对字段路径。
 * @param value - 待写入值。
 * @param mode - 修改模式。
 * @param path - 错误定位路径。
 * @param allowCreateInData - 是否允许在 data 字段下创建新字段。
 * @throws {RuleError} 当路径不存在或创建字段不被允许时抛出。
 */
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

/**
 * 解析动作目标 ID，支持候选池上下文中的 `$drewId`。
 *
 * @param id - 原始目标 ID。
 * @param context - 当前规则执行上下文。
 * @param path - 错误定位路径。
 * @returns 实际目标 ID。
 * @throws {RuleError} 当 `$drewId` 不可用时抛出。
 */
function resolveTargetId(id: string, context: RuleContext, path: string): string {
  if (id !== '$drewId') return id
  if (!context.drewId) throw new RuleError(path, '$drewId 当前不可用')
  return context.drewId
}

/**
 * 按权重从候选集合中抽取实体。
 *
 * @param context - 当前规则执行上下文。
 * @param candidates - 已计算权重的候选实体。
 * @param count - 需要抽取的数量。
 * @param unique - 同一次抽取中是否去重。
 * @param path - 错误定位路径。
 * @returns 抽中的实体列表。
 */
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

/**
 * 递归替换模板中的 `$drewId` 占位符。
 *
 * @param value - 模板值。
 * @param drewId - 抽中实体 ID。
 * @returns 替换后的新值。
 */
function replaceDrewId(value: unknown, drewId: string): unknown {
  if (typeof value === 'string') return value.replaceAll('$drewId', drewId)
  if (Array.isArray(value)) return value.map((item) => replaceDrewId(item, drewId))
  if (objectValue(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDrewId(item, drewId)]))
  }
  return value
}

/**
 * 执行单个动作。
 *
 * @param context - 当前规则执行上下文。
 * @param action - 待执行动作。
 * @param path - 错误定位路径。
 * @throws {RuleError} 当动作引用、写入模式或生成结果非法时抛出。
 */
export function executeAction(context: RuleContext, action: Action, path: string): void {
  switch (action.type) {
    case 'modify_attribute': {
      const scope = action.scope ?? 'run'
      if (scope === 'default') throw new RuleError(path, '局内动作不能修改默认数据')
      const model = modelForScope(context, scope)
      const attribute = model.character.attributes[action.attribute]
      if (!attribute) throw new RuleError(path, `属性 ${action.attribute} 不存在`)
      const value = resolveValue(context, action.value, `${path}.value`)
      const field = action.field ?? 'value'
      if (field === 'enabled') {
        if (action.mode !== 'set' || typeof value !== 'boolean') {
          throw new RuleError(path, 'enabled 只能使用 set 写入布尔值')
        }
        attribute.enabled = value
        break
      }
      const result = applyMode(attribute.value, value, action.mode, path)
      if (
        typeof result !== 'string'
        && typeof result !== 'number'
        && typeof result !== 'boolean'
        && result !== null
      ) {
        throw new RuleError(path, '属性值必须是 JSON 基础值')
      }
      if (typeof result === 'number') {
        if (!Number.isFinite(result)) throw new RuleError(path, '属性值必须是有限数值')
        attribute.value = Math.max(
          attribute.min ?? -Infinity,
          Math.min(attribute.max ?? Infinity, result),
        )
      } else {
        if (attribute.min !== undefined || attribute.max !== undefined) {
          throw new RuleError(path, '带数值边界的属性不能写入非数值')
        }
        attribute.value = result
      }
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

/**
 * 顺序执行动作数组。
 *
 * @param context - 当前规则执行上下文。
 * @param actions - 待执行的动作列表。
 * @param path - 错误定位路径。
 */
export function executeActions(context: RuleContext, actions: Action[], path: string): void {
  actions.forEach((action, index) => executeAction(context, action, `${path}[${index}]`))
}

/**
 * 执行所有已获得效果在指定时机上的触发器。
 *
 * @param context - 当前规则执行上下文。
 * @param timing - 当前触发时机。
 */
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

/**
 * 检查并执行指定时机上的效果组合规则。
 *
 * @param context - 当前规则执行上下文。
 * @param timing - 当前触发时机。
 */
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

/**
 * 穷尽性检查辅助函数。
 *
 * @param value - TypeScript 推断出的未处理分支。
 * @returns 永不返回。
 * @throws {Error} 始终抛出未处理判别值错误。
 */
function assertNever(value: never): never {
  throw new Error(`未处理的判别值：${JSON.stringify(value)}`)
}

/**
 * 将未知值转换为可写入模型的 JSON 值。
 *
 * @param value - 待转换的值。
 * @param path - 错误定位路径。
 * @returns 可 JSON 序列化的深拷贝值。
 * @throws {RuleError} 当值无法结构化克隆为 JSON 数据时抛出。
 */
export function asJsonValue(value: unknown, path: string): JsonValue {
  try {
    return structuredClone(value) as JsonValue
  } catch {
    throw new RuleError(path, '值无法写入 JSON 数据')
  }
}
