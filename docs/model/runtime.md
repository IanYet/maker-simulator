# 运行流程与存档

## 单回合流程

| 顺序 | step | 说明 |
| --- | --- | --- |
| 1 | `turn_start` | 回合开始，结算已获取效果的回合开始触发 |
| 2 | `combo_check` | 检查当前时机满足条件的效果组合 |
| 3 | `event_appear` | 结算事件出现时机的效果与 `draw_pool` 动作 |
| 4 | `event_start` | `appeared=true` 且 `startMode=auto` 的事件自动开始；手动事件等待玩家选择 |
| 5 | `player_event` | 玩家处理事件节点 |
| 6 | `event_node` | 结算当前事件节点的文本、选择、判定、动作、等待或结果 |
| 7 | `turn_end` | 结算持续时间、过期效果、等待节点、事件超时 |
| 8 | `snapshot` | 保存完整局内动态数据快照 |
| 9 | `next_turn` | 等待玩家进入下一回合 |

## 事件处理流程

1. 事件候选池抽中事件并将其 `appeared` 设置为 `true`。
2. 已出现事件根据 `startMode` 自动开始或进入待处理列表。
3. `visibility=foreground` 的事件进入玩家可见流程。
4. `visibility=background` 的事件自动运行，不进入玩家可见流程。
5. 事件开始时，将 `currentNode` 设置为 `entryNode`。
6. 系统根据当前节点 `type` 执行对应逻辑。
7. 节点跳转时更新 `currentNode`。
8. `visibility=foreground` 的节点进入玩家可见流程。
9. `visibility=background` 的节点自动运行。
10. `choice` 节点根据 `mode` 处理单选、多选或数量选择。
11. 进入 `result` 节点且 `completeEvent=true` 时，写入事件结果并结束事件。
12. 事件处理结束后更新 `occurrences` 和 `completed`，并将 `appeared` 恢复为 `false`。

## 条件与动作执行

1. 条件判断前，先解析条件右侧的值表达式。
2. 动作执行前，先解析动作 `value` 中的值表达式。
3. `aggregate` 条件与 `aggregate_value` 值表达式先用 `selector` 选择集合，再计算聚合值。
4. choice 选项动作执行时，可以读取本次选择的临时字段。
5. `draw_pool` 先执行候选池抽取，再为每个结果建立 `$drewId` 上下文并依次执行 `onDraw`。
6. 没有抽中候选时执行一次 `onEmpty`，且不建立 `$drewId` 上下文。
7. 候选池的权重表达式在 `$candidate.*` 上下文中求值。

## 每回合保存

每回合结束保存完整局内动态数据快照。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `saveId` | string | 玩家存档 ID |
| `currentRun` | object | 当前局内动态数据 |
| `turnSnapshots` | array | 回合快照列表 |

## TurnSnapshot 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `turn` | number | 快照回合 |
| `data` | object | 该回合结束时的完整局内动态数据 |

## 快照用途

| 用途 | 说明 |
| --- | --- |
| 存档 | 恢复当前局 |
| 崩溃恢复 | 回到上一回合结束状态 |
| 调试 | 查看每回合完整状态 |
| 日志 | 记录粗粒度运行过程 |

## 最小实现范围

1. 三层数据复制：默认数据到玩家存档，玩家存档到局内动态数据。
2. 角色属性读取与修改。
3. 效果字段读取与修改。
4. 效果组合检查与动作执行。
5. 事件字段读取与修改。
6. 事件出现判定。
7. 事件节点图执行。
8. 条件判断。
9. 动作执行。
10. 值表达式解析。
11. 集合选择与聚合判断。
12. 候选池抽取和 `draw_pool` 动作。
13. 每回合保存完整局内动态数据快照。
