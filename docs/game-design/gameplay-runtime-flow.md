# 游戏主线运行时流程

本文假设游戏脚本（Config、Rule、Action 与 Reaction）已经编写并通过校验，描述玩家从选择“新游戏”到正常通关时的运行时主线。读档、时间线分支、放弃、主动重开和失败终局不在本流程内。

```mermaid
graph TD
    A[玩家选择新游戏] --> B[根据 Config 默认值创建 Profile]
    B --> C[创建首个 active RunData<br/>初始化 ProfileState、RunState 与 RandomState]
    C --> D[创建 initial TurnData<br/>保存 seed 与 cursor<br/>turnNumber = 0<br/>phase = initializing]
    D --> E[注册 Event / Effect 的配置级 Reaction<br/>计算初始基准，不执行 Action]
    E --> F[开始第一个回合：turnNumber + 1<br/>phase → turn_start]

    F --> G[执行 turn_start 引发的 Action / Reaction]
    G --> H[Rule / Action 可调用 context.random<br/>每次 Action 在事务 draft 中写入 State]
    H --> I[提交事务：失效并重算受影响的 Rule]
    I --> J{有满足条件的 Reaction？}
    J -- 是 --> K[按注册顺序调度并执行 Reaction Action]
    K --> H
    J -- 否，状态稳定 --> L[phase → event_handle]

    L --> M[执行可启动事件的 start_event<br/>创建或继续 active EventInstance]
    M --> N[进入事件节点，展示文本 / 接收玩家选择 / 执行节点或选项 Action]
    N --> O{事件仍有待处理节点？}
    O -- 是 --> N
    O -- 否 --> P[事件实例完成；继续处理本回合其他事件]
    P --> Q{本回合还有事件需要处理？}
    Q -- 是 --> M
    Q -- 否 --> R[phase → turn_end]

    R --> S[执行 turn_end 引发的 Action / Reaction<br/>直至状态稳定]
    S --> T{脚本判定本局成功？}
    T -- 否 --> U[创建 turn_end TurnData 完整快照<br/>原子更新 RunData.currentTurnId 与 Profile.current]
    U --> F
    T -- 是 --> V[终局事务：完成状态写入与 Reaction 队列<br/>RunData.status → succeeded，写入 endedAt]
    V --> W[原子创建 terminal TurnData<br/>更新 RunData.currentTurnId 与 Profile.current]
    W --> X[恢复通关结果界面]
```

## 关键点

- `initial` 检查点在回合开始前创建；每个正常回合结束后创建 `turn_end` 检查点。两者都保存 Profile、Run、Turn 与 PRNG 的完整状态快照。
- Action 只在事务 draft 中改写 State。每次提交后，引擎重算受影响的 Rule，并持续执行满足条件的 Reaction Action，直到没有新的变化。
- 所有随机判定都由 Rule 或 Action 通过 `context.random()` 执行。PRNG 返回 `[0, 1)` 内的值，其 seed 与 cursor 保存在 RunData 及 TurnData snapshot 中。
- `start_event` 会为事件创建 `EventInstance`；已有同一事件的 active 实例时不会重复创建。事件可以跨回合继续，实例完成后才允许再次创建。
- 成功在本回合的 `turn_end` 阶段判定。终局会创建 `terminal` 检查点并将 RunData 标记为 `succeeded`；该检查点仅用于通关结果与历史记录，不会再进入下一回合。
