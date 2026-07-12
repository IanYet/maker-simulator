# 终局与结局

本文定义一条 RunData 如何结束，以及游戏内容如何记录具体结局。脚本编写方式见[游戏脚本编写指南](./script-authoring.md)，事务、快照与恢复机制见[运行时系统设计](./runtime-system.md)。

## 概念边界

终局是引擎生命周期事件：当前 RunData 停止接受新的玩家操作和阶段推进，并创建不可继续游玩的 `terminal` 检查点。

结局是游戏包定义的内容状态。它可以是任意数量的结局 id、枚举值或其他统计组合，不限定为成功或失败。游戏脚本将结局写入普通 RunState 字段，也就是 Action 中 `context.runState` 暴露的解析后 State 视图；引擎只按普通 State 对其进行校验、保存、快照和恢复，不解释字段名称与取值。

`RunData.status` 只表示引擎生命周期：

```ts
type RunStatus = 'active' | 'ended' | 'abandoned';
```

- `active` 表示当前时间线仍可继续游玩。
- `ended` 表示游戏脚本已经通过 Action 请求终局。
- `abandoned` 表示玩家放弃本局或主动重开。废弃不要求游戏脚本写入结局。

## 由 Action 请求终局

只有 Action 可以通过 `ActionContext.endRun()` 请求结束当前 RunData：

```ts
interface ActionContext {
    // 省略其他字段
    readonly endRun: () => void;
}
```

`endRun()` 不接收结局参数。Action 应在同一处理单元中先把具体结局及所需统计写入 `context.runState`，再调用 `context.endRun()`。`runState` 是当前 RunState 的解析后视图，不包含 RunData 的时间线、快照和恢复元数据。将内容写入与生命周期请求分开，可以让引擎结束 RunData，而不需要认识游戏包的结局模型。

例如，游戏包可以在一个代表“本局”的抽象 Character 上定义枚举 Attribute `ending`，再由 Action 写入它：

```js
function reachEnding(context, endingValue) {
    context.runState.characters.run.attributes.ending.value = endingValue;
    context.endRun();
}
```

这里的 `run`、`ending` 和枚举值都只是该游戏包的 Config 内容，并非引擎保留名称。游戏包也可以使用其他普通 RunState 字段或多个字段描述结局。

当前 RunState 只包含 Config 已定义的 Character/Attribute、Effect 与 Event 状态，因此“结局 id”必须由这些字段编码，例如枚举 Attribute 的数字下标；脚本不能凭空添加 `context.runState.endingId`。未来若引入通用变量容器，也仍按普通 RunState 处理，不改变终局协议。

Rule 不能直接调用 `endRun()`。Reaction、玩家选择、节点检查或阶段变化可以执行一个 Action，再由该 Action 请求终局。终局请求可以发生在 `turn_start`、`event_handle` 或 `turn_end` 等任意阶段。

## 事务与提交顺序

`endRun()` 只在当前运行时处理单元中记录一个待处理的终局请求，不会在调用位置立即中断 JavaScript：

1. RuntimeCommand/internal transition 的引擎写入、root/嵌套/Reaction Action、PRNG 推进和终局请求使用同一 draft；终局标记仍只能由其中的 Action 发出。
2. 任一 Action 抛出异常、校验失败或超过执行上限时，引擎丢弃整个处理单元。
3. 每批引擎或 Action 写入后，引擎在 draft 上重算受影响的 Rule，并按正常顺序执行匹配的 Reaction Action。
4. Reaction 队列稳定前，终局请求保持待处理状态；同一处理单元中的重复请求是幂等的。
5. 队列稳定后，引擎不再接受新的玩家操作或推进 phase，随后原子提交终局。

Action 在请求终局的同时还可以直接改写 `context.runState.events[eventId].instances[instanceId]` 的 `currentNodeId` 或 `status`。引擎先校验并应用 EventInstance State 写入，再补全 `nodePath`、`activeInstanceId`、`endedTurn` 和节点 Reaction 因果链，最后提交终局。`endRun()` 不会截断同一处理单元；非法的 EventInstance 赋值会使 State、PRNG 与终局标记一起回滚。

终局提交执行以下操作：

1. 使用已经稳定的 ProfileState、RunState、TurnState 与 RandomState 创建 `terminal` TurnData；
2. 将 `RunData.status` 从 `active` 改为 `ended`，并写入 `endedAt`；
3. 更新 `RunData.currentTurnId`、`Profile.current`、各级工作状态和更新时间；
4. 注销当前 RunData 的所有 Reaction 和其他可重建运行时资源。

`terminal` snapshot 保留请求终局时的 `turnNumber` 与 `phase`。引擎不会为了结束 RunData 而强制进入 `turn_end`。终局 snapshot、RunData 元数据与恢复游标必须原子提交，失败时不能留下只有部分终局数据的存档。

## 恢复、分支与重开

`terminal` TurnData 保存游戏脚本写入的全部结局字段，用于恢复终局结果和查看历史，但不能进入下一回合，也不能直接作为 branch 或截断恢复的起点。

玩家可以从同一 RunData 更早的 `initial` 或 `turn_end` 检查点继续。保留后续数据时，引擎从所选 snapshot 创建 branch RunData；删除后续数据时，引擎以所选 snapshot 截断原 RunData，并把生命周期恢复为 `active`。结局字段属于 RunState，因此会自然恢复为所选 snapshot 中的值，不需要引擎按字段名清理。

从 `terminal` 或 `abandoned` 记录主动重开时，引擎创建新的 RunData。来源检查点只用于历史追溯，不把上一局的 RunState、TurnState 或结局字段复制到新局。
