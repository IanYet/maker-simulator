# 运行流程与存档

## 单回合流程

| 顺序 | step | 说明 |
| --- | --- | --- |
| 1 | `turn_start` | 回合开始，结算已获取且可用效果的回合开始触发 |
| 2 | `combo_check` | 检查当前时机满足条件的效果组合 |
| 3 | `event_appear` | 遍历事件，筛选已解锁、可用、满足出现条件的事件，再进行概率判定 |
| 4 | `event_start` | `startMode=auto` 的事件自动开始，`startMode=manual` 的事件等待玩家选择 |
| 5 | `player_event` | 玩家处理事件节点 |
| 6 | `event_node` | 结算当前事件节点的文本、选择、判定、动作、等待或结果 |
| 7 | `turn_end` | 结算持续时间、过期效果、等待节点、事件超时 |
| 8 | `snapshot` | 保存完整局内动态数据快照 |
| 9 | `next_turn` | 等待玩家进入下一回合 |

## 事件处理流程

1. 事件通过出现判定后，根据 `startMode` 自动开始或进入待处理列表。
2. `visibility=foreground` 的事件进入玩家可见流程。
3. `visibility=background` 的事件自动运行，不进入玩家可见流程。
4. 事件开始时，将 `currentNode` 设置为 `entryNode`。
5. 系统根据当前节点 `type` 执行对应逻辑。
6. 节点跳转时更新 `currentNode`。
7. `visibility=foreground` 的节点进入玩家可见流程。
8. `visibility=background` 的节点自动运行。
9. 进入 `result` 节点且 `completeEvent=true` 时，写入事件结果并结束事件。
10. 事件完成后更新 `occurrences` 和 `completed`。

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
10. 每回合保存完整局内动态数据快照。
