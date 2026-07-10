打开开始页面，以卡片形式陈列所有的游戏，每个public/story 目录的json，都是一个游戏。
用户点击游戏，进入pre-play页面，在这里，写游戏介绍（暂无相关字段，留作todo），存档列表，创建新游戏。
用户选择某个存档或者点击创建新游戏，如果点击创建新游戏，会有难度选项（暂无相关字段，只有一个默认难度即可）
如果点击创建新游戏，则默认配置创建一份游戏存档。
从游戏存档创建一份运行时数据。
运行时数据相比存档数据，需要额外维护一些状态用于快速查找：
1. aquiredEffectStack，用于存放上个回合结束时已经获得的effect
2. appearedEventStack，用于存档上个回合结束时已经appeared的event

如果时第一个回合，则遍历运行时数据，aquiredEffectStack存放所有acquired为true的effect，appearedEventStack存放所有appeared的event

回合开始。

 `effect_check`: 这里与原本设计不太一样，删除原来设计的EffectCombo，给effect添加一个acquire字段，作为获取该effect的条件。在这个阶段，过滤掉aquiredEffectStack中所有不满足自己acquire的effect，将他们acquired设为false并移除队列.进入下个阶段
 `apply_effect`：这个阶段触发所有还在栈里的effect的trigger
 `event_appear` | 结算事件出现时机的效果与 `draw_pool` 动作 |
 `event_start` | `appeared=true` 且 `startMode=auto` 的事件自动开始；手动事件择 |
 `player_event` | 玩家处理事件节点 |
 `event_node` | 结算当前事件节点的文本、选择、判定、动作、等待或结果 |
 `turn_end` | 结算持续时间、过期效果、等待节点、事件超时 |
 `snapshot` | 保存完整局内动态数据快照 |
 `next_turn` | 等待玩家进入下一回合 |