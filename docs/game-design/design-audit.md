# 设计一致性审计

本次审计逐份检查了 `docs/game-design` 下的 7 份既有设计文档，以及 `src/types/model.ts`、`package.ts`、`runtime.ts` 和统一出口 `index.ts`。审计目标是消除文档之间、文档与公共类型之间会导致不同实现解释的冲突，并记录已经明确延期的设计边界。

## 已统一的设计

| 问题 | 统一后的约定 | 修改位置 |
| --- | --- | --- |
| Reaction 的 `source + field` 无法区分同名 id，也无法定位嵌套 Attribute | `ValueRef.source` 只表示 `self` 或一个 State 根，`path` 使用非空字符串数组定位 Primitive 字段 | `model.ts`、脚本指南、包 linking |
| UI 要展示 Character 名称、当前节点、Choice、选择数量和 Command，但 read model 没有这些字段 | 增加 Character 展示名、TextNode/Choice/Command 视图，并把当前 TextNode 放入 `ActiveEventView` | `runtime.ts`、运行时流程 |
| 文档使用 `focusEvent`，`GameSession` 类型没有该方法 | 增加只修改应用级 focus 的同步 `focusEvent` | `runtime.ts`、玩家 UI |
| 任意 Action/Reaction 都能调用 `endRun()`，但 ended snapshot 强制要求一个触发事件，且读档时无法确定来源实例 | `endingEvent` 改为可选；terminal 记录首次请求的可选 `endingEventInstanceId`，无关联节点时使用通用结果页 | `model.ts`、`runtime.ts`、终局、运行时流程、玩家 UI |
| ProfileState 被定义为快照的一部分，同时脚本指南声称回退后 `unlocked` 永不回退 | ProfileState 跨 Run 保存，但 branch 或截断恢复时仍恢复所选 snapshot | 脚本指南、运行时系统 |
| UI 需要持久化存档显示名，`Profile` 没有对应字段 | `Profile.label?: string` 作为存档元数据，并在修改时更新 `updatedAt` | `model.ts`、运行时系统、SessionView |
| abandoned 记录是否允许“再来一局”存在相反描述 | active Run 只能放弃；ended 或 abandoned 结果都可以创建 restart RunData | 终局、运行时系统、运行时流程、玩家 UI |
| Vision 链接到不存在的总结文件 | 改为链接本审计文档 | `vision.md` |

## 已确认但延期的边界

以下内容不会让当前领域类型产生相互矛盾的解释，但在实现对应功能前仍需补充协议：

1. `PackageCatalog`、`SaveRepository`、应用级最近 Profile 索引只有职责描述，还没有公共接口和错误类型。
2. `SaveBrowserController` 目前只有写命令，没有存档树、检查点预览、选择状态的 read model 与订阅接口。
3. 内容版本迁移说明了原子语义，但 migration module 的发现、版本链和执行接口尚未定义；MVP 继续只加载存档记录的 exact package version。
4. 难度和其他新游戏初始化参数被明确延期；增加时需要同时定义包配置、创建命令和持久化位置。
5. Manifest 已提供 `assetsBaseLocation`，当前 GameConfig 尚无图片、音频等资源引用字段；引入媒体内容时需要定义相对资源引用的 schema 和 UI 投影。
6. Reaction/Action 循环必须有限额，但具体的 Action 数、Rule 重算轮数和自动节点跳转上限尚未配置化。

这些延期项应在进入对应 MVP 步骤前转成独立设计任务；它们不需要在当前 Config/State/RuntimeCommand 基线中预留魔法字段。

## 审计结论

现有文档与 `src/types` 对 Config、State 分层、包加载、回合状态机、事件实例、终局、快照恢复和基础 UI 命令已经形成一致基线。上节列出的延期边界仍需后续设计，但本轮未发现其他必须立即修改才能开始运行时核心实现的冲突。
