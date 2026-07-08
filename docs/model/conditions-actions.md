# 条件与动作

条件读取当前数据字段并判断。动作修改指定数据作用域中的字段。

## 条件类型

| type | 读取对象 |
| --- | --- |
| `attribute` | 角色属性 |
| `effect` | 效果字段 |
| `event` | 事件字段 |
| `turn` | 当前回合 |
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
| `value` | any | 比较值 |

## effect 条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `effect` |
| `effectId` | string | 效果 ID |
| `field` | string | 效果字段路径 |
| `operator` | string | 比较操作符 |
| `value` | any | 比较值 |

## event 条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `event` |
| `eventId` | string | 事件 ID |
| `field` | string | 事件字段路径，可读取 `data` 下的事件局部状态 |
| `operator` | string | 比较操作符 |
| `value` | any | 比较值 |

## turn 条件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 固定为 `turn` |
| `operator` | string | 比较操作符 |
| `value` | number | 比较回合 |

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
| `choose_effect` | 从效果列表中随机生成候选并选择 |

## modify_attribute 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scope` | string | 数据作用域 |
| `type` | string | 固定为 `modify_attribute` |
| `attribute` | string | 属性 ID |
| `mode` | string | 修改模式 |
| `value` | any | 修改值 |

## modify_effect 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scope` | string | 数据作用域 |
| `type` | string | 固定为 `modify_effect` |
| `effectId` | string | 效果 ID |
| `field` | string | 字段路径 |
| `mode` | string | 修改模式 |
| `value` | any | 修改值 |

## modify_event 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scope` | string | 数据作用域 |
| `type` | string | 固定为 `modify_event` |
| `eventId` | string | 事件 ID |
| `field` | string | 字段路径，可修改 `data` 下的事件局部状态 |
| `mode` | string | 修改模式 |
| `value` | any | 修改值 |

## choose_effect 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scope` | string | 数据作用域 |
| `type` | string | 固定为 `choose_effect` |
| `count` | number | 候选数量 |
| `pick` | number | 选择数量 |
| `filter` | object | 效果筛选条件 |

## 修改模式

| mode | 说明 |
| --- | --- |
| `set` | 设置为指定值 |
| `add` | 加上指定值 |
| `multiply` | 乘以指定值 |
| `min` | 不高于指定值 |
| `max` | 不低于指定值 |
