# 条件与动作

条件读取当前数据字段并判断。动作修改指定数据作用域中的字段。

## 条件类型

| type | 读取对象 |
| --- | --- |
| `attribute` | 角色属性 |
| `effect` | 效果字段 |
| `event` | 事件字段 |
| `turn` | 当前回合 |
| `aggregate` | 效果或事件集合的聚合结果 |
| `and` | 条件与 |
| `or` | 条件或 |
| `not` | 条件非 |

## 通用比较操作符

| 操作符 | 说明 |
| --- | --- |
| `==` | 等于 |
| `!=` | 不等于 |
| `>` | 大于 |
| `>=` | 大于等于 |
| `<` | 小于 |
| `<=` | 小于等于 |
| `contains` | 包含 |
| `not_contains` | 不包含 |

## attribute 条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `attribute` |
| `attribute` | string | 属性 ID |
| `operator` | string | 比较操作符 |
| `value` | any | 比较值，支持值表达式 |

## effect 条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `effect` |
| `effectId` | string | 效果 ID |
| `field` | string | 效果字段路径 |
| `operator` | string | 比较操作符 |
| `value` | any | 比较值，支持值表达式 |

## event 条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `event` |
| `eventId` | string | 事件 ID |
| `field` | string | 事件字段路径，可读取 `data` 下的事件局部状态 |
| `operator` | string | 比较操作符 |
| `value` | any | 比较值，支持值表达式 |

## turn 条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `turn` |
| `operator` | string | 比较操作符 |
| `value` | number | 比较回合，支持值表达式 |

## aggregate 条件字段

`aggregate` 条件用于对一组效果或事件做集合查询，再把聚合结果与目标值比较。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `aggregate` |
| `selector` | object | 集合选择器 |
| `aggregate` | string | 聚合方式 |
| `field` | string | 被聚合的字段路径；`count` 不需要 |
| `operator` | string | 比较操作符 |
| `value` | any | 比较值，支持值表达式 |

## selector 字段

`selector` 只选择对象，不修改对象。它用于聚合条件、值表达式或后续候选生成规则。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `target` | string | `effect` 或 `event` |
| `ids` | array | 限定 ID 列表 |
| `tags` | array | 限定必须包含的标签；仅对 effect 有效 |
| `kinds` | array | 限定 effect 类型；仅对 effect 有效 |
| `fields` | array | 字段匹配规则 |

## selector.fields 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `field` | string | 字段路径 |
| `operator` | string | 比较操作符 |
| `value` | any | 比较值，支持值表达式 |

## 聚合方式

| aggregate | 说明 |
| --- | --- |
| `count` | 匹配对象数量 |
| `sum` | 匹配对象指定字段求和 |
| `min` | 匹配对象指定字段最小值 |
| `max` | 匹配对象指定字段最大值 |
| `average` | 匹配对象指定字段平均值 |

## 逻辑条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | `and`、`or`、`not` |
| `conditions` | array | 子条件列表 |

## 动作作用域

| scope | 修改目标 |
| --- | --- |
| `run` | 局内动态数据 |
| `save` | 玩家存档 |
| `default` | 默认数据 |

未声明 `scope` 时，默认使用 `run`。

## 动作类型

| type | 说明 |
| --- | --- |
| `modify_attribute` | 修改角色属性 |
| `modify_effect` | 修改效果字段 |
| `modify_event` | 修改事件字段 |

## modify_attribute 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scope` | string | 数据作用域 |
| `type` | string | 固定为 `modify_attribute` |
| `attribute` | string | 属性 ID |
| `mode` | string | 修改模式 |
| `value` | any | 修改值，支持值表达式 |

## modify_effect 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scope` | string | 数据作用域 |
| `type` | string | 固定为 `modify_effect` |
| `effectId` | string | 效果 ID |
| `field` | string | 字段路径 |
| `mode` | string | 修改模式 |
| `value` | any | 修改值，支持值表达式 |

## modify_event 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scope` | string | 数据作用域 |
| `type` | string | 固定为 `modify_event` |
| `eventId` | string | 事件 ID |
| `field` | string | 字段路径，可修改 `data` 下的事件局部状态 |
| `mode` | string | 修改模式 |
| `value` | any | 修改值，支持值表达式 |

## 值表达式

动作的 `value` 与条件右侧的 `value` 可以是普通 JSON 值，也可以是值表达式。值表达式在执行时根据当前数据求值。

## 值表达式类型

| type | 说明 |
| --- | --- |
| `field` | 读取指定字段 |
| `calculate` | 对多个值做简单计算 |
| `random` | 生成随机数 |
| `aggregate_value` | 对集合做聚合并返回结果 |

## field 值表达式字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `field` |
| `scope` | string | 读取的数据作用域；未声明时默认读取局内动态数据 |
| `path` | string | 字段路径 |

在 choice 选项的动作中，`path` 可以读取本次选择的临时字段，如 `selection.choiceId`、`selection.quantity`。

## calculate 值表达式字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `calculate` |
| `operator` | string | `add`、`subtract`、`multiply`、`divide`、`min`、`max` |
| `values` | array | 参与计算的值列表，每一项都支持值表达式 |

## random 值表达式字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `random` |
| `min` | number | 最小值 |
| `max` | number | 最大值 |
| `integer` | boolean | 是否取整数 |

## aggregate_value 值表达式字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `aggregate_value` |
| `selector` | object | 集合选择器 |
| `aggregate` | string | 聚合方式 |
| `field` | string | 被聚合的字段路径；`count` 不需要 |

## 修改模式

| mode | 说明 |
| --- | --- |
| `set` | 设置为指定值 |
| `add` | 加上指定值 |
| `multiply` | 乘以指定值 |
| `min` | 不高于指定值 |
| `max` | 不低于指定值 |
