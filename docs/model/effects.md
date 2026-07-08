# 效果与效果组合

效果表示不包含叙事文本、但会影响状态、标签、条件或构筑的内容。标签、装备、建筑、植物、宠物、buff、debuff、科技、解锁、计数器都归入效果。

## Effect 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 效果 ID |
| `name` | string | 展示名称 |
| `description` | string | 效果内容说明 |
| `kind` | string | 效果类型 |
| `unlocked` | boolean | 是否已解锁；影响效果是否能作为奖励或候选出现 |
| `available` | boolean | 当前是否允许参与系统 |
| `acquired` | boolean | 当前是否已获取 |
| `level` | number | 等级 |
| `stacks` | number | 层数 |
| `value` | number | 通用数值；适合计数器、进度、强度 |
| `tags` | array | 标签列表 |
| `appear` | object | 作为候选、奖励、商品等内容出现的条件与概率 |
| `duration` | object/null | 持续时间 |
| `triggers` | array | 触发器 |

## Effect.kind

| 值 | 说明 |
| --- | --- |
| `tag` | 标签效果 |
| `counter` | 计数器效果 |
| `buff` | 正面临时效果 |
| `debuff` | 负面临时效果 |
| `equipment` | 装备 |
| `building` | 建筑或区域建设 |
| `plant` | 植物 |
| `pet` | 宠物或随从 |
| `tech` | 科技或研究 |
| `passive` | 被动规则 |

## Duration 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | `instant`、`turns`、`permanent` |
| `remaining` | number/null | 剩余回合 |

## appear 字段

Effect 的 `appear` 字段与 Event 的 `appear` 字段结构一致。它用于判断效果是否可以进入候选池、奖励池、商店商品或其他可获得集合。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `conditions` | array | 出现条件 |
| `chance` | number | 出现概率，范围 0 到 1 |

## Trigger 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `timing` | string | 触发时机 |
| `conditions` | array | 触发条件 |
| `actions` | array | 触发动作 |

## Trigger.timing

| 值 | 说明 |
| --- | --- |
| `turn_start` | 回合开始 |
| `event_appear` | 事件出现判定前后 |
| `event_start` | 事件开始 |
| `event_node` | 事件节点处理 |
| `event_result` | 事件结果 |
| `turn_end` | 回合结束 |

## 效果组合

效果组合是一组独立规则，用于描述多个效果同时满足条件时产生的额外结果。组合规则本身不保存复杂运行状态，实际状态写回效果或事件字段。

## EffectCombo 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 组合规则 ID |
| `name` | string | 展示名称 |
| `available` | boolean | 是否允许参与系统 |
| `conditions` | array | 组合条件 |
| `timing` | string | 检查时机 |
| `actions` | array | 条件满足后执行的动作 |

## 组合用途

| 用途 | 说明 |
| --- | --- |
| 生成额外被动 | 多个效果同时可用并满足条件后，获得或启用另一个效果 |
| 修改属性 | 满足组合条件后改变角色属性 |
| 解锁事件 | 满足组合条件后修改事件的 `unlocked` |
| 增加副作用 | 特定正负效果并存时触发额外代价 |
