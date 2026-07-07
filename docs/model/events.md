# 事件有向图

事件保存叙事内容与叙事状态。事件内部是有向图，由节点和节点跳转组成。叙事文本、选择、判定、动作、等待、结果都是节点。

## Event 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 事件 ID |
| `name` | string | 展示名称 |
| `unlocked` | boolean | 是否已解锁 |
| `enabled` | boolean | 当前是否允许出现 |
| `startMode` | string | `auto` 或 `manual` |
| `repeatable` | boolean | 是否可重复发生 |
| `occurrences` | number | 已发生次数 |
| `completed` | boolean | 是否完成 |
| `result` | string/null | 最近一次或最终结果 |
| `entryNode` | string | 事件开始节点 ID |
| `currentNode` | string/null | 当前节点 ID |
| `remainingTurns` | number | 事件剩余回合 |
| `endConditions` | array | 事件自动结束条件 |
| `timeoutNode` | string/null | 事件超时后跳转节点 |
| `appear` | object | 出现条件与概率 |
| `nodes` | array | 节点列表 |

## startMode

| 值 | 说明 |
| --- | --- |
| `auto` | 事件通过出现判定后自动开始 |
| `manual` | 事件通过出现判定后进入可处理列表，由玩家选择开始 |

## appear 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `conditions` | array | 出现条件 |
| `chance` | number | 出现概率，范围 0 到 1 |

## Node 通用字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 节点 ID |
| `type` | string | 节点类型 |
| `text` | string | 展示文本 |
| `conditions` | array | 节点条件 |
| `actions` | array | 节点动作 |
| `next` | string/null | 后续节点 ID |

## Node.type

| 值 | 说明 |
| --- | --- |
| `text` | 展示叙事文本，然后进入 `next` |
| `choice` | 展示多个选项，玩家选择后进入对应节点 |
| `check` | 执行条件概率判定，根据成功或失败进入不同节点 |
| `action` | 执行动作，然后进入 `next` |
| `wait` | 跨回合等待节点 |
| `result` | 事件结果节点 |

## choice 节点字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `choices` | array | 选项列表 |

## Choice 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 选项 ID |
| `text` | string | 选项文本 |
| `conditions` | array | 可选条件 |
| `actions` | array | 选择后立即执行的动作 |
| `next` | string | 选择后进入的节点 |

## check 节点字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `chance` | number | 判定概率，范围 0 到 1 |
| `success` | string | 成功后进入的节点 |
| `failure` | string | 失败后进入的节点 |

## wait 节点字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `remainingTurns` | number | 等待剩余回合 |
| `endConditions` | array | 提前结束条件 |
| `timeoutNode` | string | 等待超时后进入的节点 |

## result 节点字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `result` | string | 写入事件 `result` 的值 |
| `actions` | array | 结果动作 |
| `completeEvent` | boolean | 是否完成事件 |

## 节点跳转规则

1. `text` 节点处理后进入 `next`。
2. `choice` 节点由玩家选择选项，进入选项的 `next`。
3. `check` 节点先检查 `conditions`，再按 `chance` 判定，进入 `success` 或 `failure`。
4. `action` 节点执行 `actions` 后进入 `next`。
5. `wait` 节点跨回合停留，满足 `endConditions` 后进入 `next`，回合耗尽后进入 `timeoutNode`。
6. `result` 节点写入结果；`completeEvent=true` 时结束事件。

