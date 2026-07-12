---
name: write-story-script
description: 编写、扩展和审计本项目的网状叙事游戏包故事脚本，覆盖 Config、Effect、Event、节点图、Rule、Action、Reaction、资源门禁、回合推进与多结局。用户要求设计新故事、修改现有剧情、补全游戏包、检查可达性或把叙事转成可执行脚本时使用。
---

# 故事脚本编写

把创意转成可加载、可游玩、可校验的外部游戏包。先理解故事和玩法循环，再落地 Config、Rule、Action 与生成/校验脚本；保持叙事、数值、状态和事件图一致。

## 开始前读取

在本项目中工作时，先读取：

1. 根目录 `AGENTS.md`；
2. `docs/development.md`；
3. `docs/game-design/script-authoring.md`；
4. `docs/game-design/game-package.md`；
5. `docs/game-design/runtime-system.md`、`docs/game-design/gameplay-runtime-flow.md` 和 `docs/game-design/endings.md`。

根据任务范围继续读取 `README.md`、现有游戏包的 `manifest.json`、`config.json`、`rules.js`、`actions.js`。修改 Frostbound 时同时阅读 `scripts/build-frostbound-package.mjs`，把它作为 authoring 源；生成的 `config.json` 由脚本写出。

## 工作流

### 1. 明确故事骨架

先写一个简短设计表，至少确定：

- 玩家身份、核心资源、资源变化方向和失败压力；
- 主要 Effect、它们的获得方式、激活条件和玩家可见说明；
- Event 的解锁回合、前置 Effect、入口节点、分支结果和跨事件影响；
- 每个结局的达成条件、终局节点和玩家可理解的叙事闭环；
- 每个回合玩家能做什么，以及自动回合逻辑何时发生。

让叙事中的名词和 Config id 一一对应。需要扩展现有包时，先画出新增节点/事件/Effect 的边，再修改脚本。

### 2. 设计 Config

按 `script-authoring.md` 的类型创建 `characters`、`effects`、`events`：

- 为同一集合分配唯一 `id` 和 `order`；对象 key 必须与 `id` 相同；
- 为玩家能感知的属性、Effect、Event 和节点填写清楚的 `displayName`、`description` 或 `content`；
- 用字面 `acquired`/`actived` 表示开局就存在的 Effect，用 ReactiveValue 表示派生条件；
- 用 `required` 表达回合门禁。入口是 CheckNode 时，检查所有候选 TextNode 是否存在 required 节点；
- 让 `entryNodeId`、`event.goto`、CheckNode 候选、结局节点和 Effect 前置引用都指向真实对象；
- 用 `event.resolve`、`event.resolve-route` 或包自定义 Action 统一表达玩家选择造成的状态变化。

自动规则的策划默认约定：不需要玩家点击事件卡、会随回合或状态变化执行的 Reaction 放在 Effect 上，并在 Effect 说明中解释影响；EventConfig Reaction 用于事件内容自身的持续响应，TextNode Reaction 用于 active 节点局部逻辑。不要为这个约定添加运行时强制限制。

### 3. 编写 Rule 和 Action

在 `rules.js` 中导出 `{ rules }`，在 `actions.js` 中导出 `{ actions }`。每个 registry 项的 `key` 必须等于对象 key。

Rule 要保持纯计算：

```js
'resource.at-least': {
  key: 'resource.at-least',
  calc: (context, characterId, attributeId, minimum) =>
    context.runState.characters[characterId].attributes[attributeId].value >= minimum,
}
```

Action 通过上下文视图写入状态；嵌套调用使用 `context.action[...]`，随机数使用 `context.random()`，请求终局使用 `context.endRun()`：

```js
'state.change': {
  key: 'state.change',
  exec: (context, characterId, attributeId, amount) => {
    context.runState.characters[characterId].attributes[attributeId].value += amount
  },
}
```

不要直接写 Profile/RunData 容器、回合阶段、实例 id、`nodePath` 或 `activeInstanceId`。事件生命周期只能通过允许的 Action 写入。不要在 Rule/Action 中使用 `Math.random()` 或依赖外部可变状态。

### 4. 连接叙事与状态

逐个检查每个 Choice/Command 的 Action 参数：

- 玩家看到的文本应准确描述 Action 会造成的资源、Effect、路线或节点变化；
- 获得 Effect 的 Action 要同时设置 `acquired` 和 `actived`，除非设计明确区分二者；
- 状态变化需要被后续 Rule、Effect 或 Event 使用时，确认 State 层级正确：Profile、Run 或 Turn；
- 跨回合持续逻辑放在 Effect Reaction，并确认触发顺序不会形成 Reaction 循环；
- 同一事件的重复启动、required 节点和终局请求要符合 Runtime 的回合门禁。

把世界推进、资源消耗、温度/天气、持续伤害等非玩家手动触发逻辑建模成可见 Effect；玩家应能从 Effects 面板和描述理解状态变化来源。

### 5. 可达性与一致性审计

完成脚本后做两次审计：

1. 图审计：从每个 Event 的入口沿 Choice、Command、CheckNode 候选和 Action 跳转遍历，确认没有孤立节点、死循环或缺失目标；
2. 玩法审计：从初始状态模拟关键路线，确认每个 Effect 能获得、每个解锁前置可达、至少一个结局始终可达，同时保留其他结局的差异化条件。

Frostbound 使用：

```bash
node scripts/build-frostbound-package.mjs
```

生成器必须通过数量、节点可达性和跨事件 Effect 依赖审计。新游戏包没有专用生成器时，至少用加载器 schema/linking、应用启动和人工事件路线检查来验证。

### 6. 验证与交付

运行：

```bash
node scripts/build-frostbound-package.mjs  # 仅修改 Frostbound authoring 时
pnpm run build
pnpm run lint
git diff --check
```

人工验收至少覆盖：新游戏、首回合自动逻辑、required 事件、单选、多选、CheckNode、随机分支、Effect 获得/激活、下一回合、分支/截断和所有结局入口。开发环境可使用 `?runtimeMonitor=1` 或 `?runtimeMonitor=verbose`，确认 command、Action、Reaction 的具体 id、value 和参数。

交付时说明：新增/修改了哪些 Config、Rule、Action、生成器或文档；Effect/Event/结局数量和可达性结果；执行过的验证命令；仍需人工确认的剧情细节。

## 常见错误

- `Record key/id mismatch`：对象 key 与对象内部 `id` 不一致。
- `Unknown Rule/Action`：Config 调用 key 未在 registry 导出，或 registry 项的 `key` 不一致。
- `Unknown entry/candidate node`：入口、跳转或 CheckNode 候选指向不存在的节点。
- `advance-turn blocked`：待处理事件卡或 active 节点链上仍有 required 内容；检查 `advanceTurnBlockers`。
- Effect 未显示：检查 `visible`、`unlocked`、`acquired` 和初始 RunState；玩家面板只展示已获得的 Effect。
- 自动逻辑来源不清：把持续世界变化声明为 Effect Reaction，并让 `description` 解释触发规则和影响。

## 参考文档

- `docs/development.md`：项目开发、运行时、持久化和排错流程；
- `docs/game-design/script-authoring.md`：Config、Rule、Action、Reaction 的完整字段语义；
- `docs/game-design/game-package.md`：catalog、manifest、schema、linking 和包版本；
- `docs/game-design/runtime-system.md`：State、事务、回滚、Reaction 和检查点；
- `docs/game-design/gameplay-runtime-flow.md`：回合与 UI 命令流程；
- `docs/game-design/endings.md`：终局请求和结局节点语义。
