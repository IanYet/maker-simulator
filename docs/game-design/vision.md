# Vision
此文档描述了一个游戏的基本框架与结构。

## 概述
- 我想创建一个网状叙事的事件驱动的构建rougelike游戏。类似《密教模拟器》或者没有卡牌战斗的《杀戮尖塔》没有战斗的《哈迪斯》。
- 每个外部游戏包对应游戏列表中的一个游戏；游戏包通过 JSON 定义 Config，通过可信 JavaScript module 定义 Rule 与 Action，宿主在玩家选择后加载并交给引擎执行。
- 非开发人员可以通过编写json与js脚本就可以完成游戏换皮与数值调整。
- 游戏包含：属性，效果，事件，规则，动作。第一点说的构建，是指效果与事件的构建。其中，属性，效果，事件是通过json定义，规则与动作用js脚本编写。
- 效果与事件会去触发规则与动作，规则与动作反过来会修改属性，效果，事件的某些值。
- 游戏脚本通过 Action 请求结束当前 RunData；具体结局是游戏包写入普通 RunState 的内容数据，可以有任意种类。引擎只管理 RunData 生命周期与终局快照，不解释结局含义。

## 文档导航

- [游戏脚本编写指南](./script-authoring.md)：面向策划，定义 Config、Attribute、Effect、Event、Rule、Action 与 Reaction 的编写方式。
- [外部游戏包与加载](./game-package.md)：定义 catalog、manifest、可信 JavaScript、registry、加载校验与初始化衔接。
- [运行时系统设计](./runtime-system.md)：面向开发，定义 State、Profile、RunData、TurnData、快照分支和响应式引擎。
- [终局与结局](./endings.md)：定义 Action 结束 RunData 的协议，以及与游戏包结局数据的边界。
- [游戏运行时流程与 UI 绑定](./gameplay-runtime-flow.md)：定义 RuntimeCommand、状态机、局级初始化、UI 绑定与单回合流程。
- [玩家流程与界面设计](./player-flow-and-ui.md)：定义游戏列表、存档分支、游戏布局、按钮语义与开发前建议。
- [本轮设计更新总结](../../design-update-summary.md)：总结新增与修订内容，并说明修改原有文档的原因。
- [TypeScript 类型声明](../../src/types/index.ts)：领域模型、游戏包、RuntimeCommand 与 UI read model 的统一类型出口。

## 数据分层

| 数据层 | 职责 |
| --- | --- |
| Config | 策划编写的只读内容、脚本调用和默认值 |
| Profile | 跨越多局游戏的用户存档与局外状态 |
| RunData | 一条独立的局内时间线 |
| TurnData | 稳定边界上的可恢复状态快照 |
