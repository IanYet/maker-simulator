# Maker Simulator

Maker Simulator 是一个面向*网状叙事的事件驱动的构建 roguelike 游戏*脚本的模拟运行环境，主要用于快速验证玩法、数值循环、事件网络与多结局流程。

项目当前已经实现可直接游玩的 Viewer。游戏内容以外部游戏包交付：策划使用 JSON 定义 Attribute、Effect、Event 与节点图，使用可信 JavaScript 模块编写 Rule 和 Action；运行环境负责加载、校验、执行、存档和呈现。

[Maker Simulator](https://maker-simulator.vercel.app/)

## 当前能力

- 从 `public/games/catalog.json` 发现并加载多个游戏包与精确版本。
- 使用 Zod 校验 catalog、manifest、Config、脚本 registry 和存档，并在 linking 阶段检查全部静态引用。
- 使用动态依赖图增量执行 Rule、Action、Reaction、单选、多选、NodeCommand、CheckNode 和确定性随机判定。
- 支持已获得 Effect 的手动激活，以及激活后由 Effect Reaction 驱动的状态变化。
- 通过事务处理 State、PRNG、事件节点跳转和终局请求；脚本失败时整体回滚。
- 支持 Profile、RunData、TurnData 和 `initial`、`turn_end`、`terminal`、`abandoned` 检查点。
- 使用 IndexedDB 原子保存，支持继续、创建分支、截断、pin、分层手动删除、放弃和 restart。
- 提供游戏列表、游戏菜单、存档树、游戏界面与通用结果页，并适配桌面和窄屏。
- 提供可选 RuntimeMonitor，在开发者控制台输出命令、Action、Reaction、事务、Rule 重算/依赖汇总和持久化耗时。
- Config 中的 `xxxValue` 基础值会物化到 RunState，`xxx` 字段始终通过 Rule 计算有效值。

## 内置游戏包

### 空白状态实验场

`blank-game@1.0.0` 是只定义角色和属性的最小游戏包，包含 1 个角色、2 个属性、0 个 Effect 与 0 个 Event，用于检查没有事件网络时的新局创建、回合推进和存档流程。

### 白夜余烬

`frostbound@1.0.0` 是一套完整的极寒末日求生脚本。玩家经营移动避难所，在第十日终末白障到来前搜集设施、连接幸存者并构建逃生路线。

该包包含：

- 15 个 Effect；
- 20 个 Event；
- 最少 10 个回合的主流程；
- 4 个可达结局；
- 单选、多选、自动检查节点、随机分支、Reaction、资源门禁、跨事件前置条件与脚本终局。

游戏包源文件位于 [`public/games/frostbound/1.0.0`](./public/games/frostbound/1.0.0)，可重复生成并执行可达性审计的 authoring 脚本位于 [`scripts/build-frostbound-package.mjs`](./scripts/build-frostbound-package.mjs)。

仓库同时提供较小的 `example-game@1.0.0`，用于快速检查运行时基本流程。

## 本地运行

需要 Node.js 和 pnpm。

```bash
pnpm install
pnpm dev
```

生产构建与静态检查：

```bash
pnpm build
pnpm format
pnpm lint
pnpm test
pnpm preview
```

`pre-commit` hook 会用项目内固定的 Prettier 配置格式化已暂存代码；VS Code 保存时只格式化 Git 标记的修改行。文档、游戏包、Frostbound 生成脚本和锁文件不参与自动格式化。

应用的主要路由：

```text
/games                              游戏列表
/games/:gameId                      游戏菜单
/games/:gameId/new                  创建新 Profile
/games/:gameId/saves                存档与分支浏览器
/play/:profileId                    从稳定检查点游玩
/result/:profileId/:runId/:turnId   终局或放弃记录
```

## 游戏包结构

```text
public/games/
  catalog.json
  your-game/
    1.0.0/
      manifest.json
      config.json
      rules.js
      actions.js
      assets/
```

`rules.js` 与 `actions.js` 是自包含的 ESM 文件，分别导出 `rules` 与 `actions` registry。游戏包 JavaScript 以宿主应用权限执行，只应加载可信内容。

新增游戏包时，先阅读：

- [开发文档](./docs/development.md)
- [故事脚本编写 Skill](./.codex/skills/write-story-script/SKILL.md)
- [游戏脚本编写指南](./docs/game-design/script-authoring.md)
- [外部游戏包与加载](./docs/game-design/game-package.md)
- [运行时系统设计](./docs/game-design/runtime-system.md)
- [MVP 技术规格](./docs/technical-spec.md)

修改“白夜余烬”的 authoring 源后重新生成 Config：

```bash
node scripts/build-frostbound-package.mjs
```

生成器会同时检查 Effect/Event/结局数量、事件节点可达性以及跨事件 Effect 前置依赖。

## 存档与确定性

稳定存档保存在浏览器 IndexedDB 的 `maker-simulator` 数据库中，只包含检查点历史、恢复游标和持久化元数据。普通事件操作保留在 Runtime 的当前回合工作状态；`advance-turn` 成功、终局、放弃、分支、截断、pin、手动删除与 restart 才会跨越对应的稳定持久化边界。检查点、时间线和整个存档都可以在二次确认后删除；pin 只保护自动清理，不阻止手动删除。

每个检查点保存完整 State 以及该时间线的 seed 与 PRNG cursor。同一检查点、同一命令序列会得到相同的随机结果。退出游戏界面或切换存档会丢弃当前回合尚未提交的进度。

## 运行监控

开发环境默认启用控制台 RuntimeMonitor。生产环境可通过查询参数临时启用：

```text
?runtimeMonitor=1         命令、Action、Reaction、事务与汇总
?runtimeMonitor=verbose   额外输出逐 Rule 记录
```

日志会把指令参数直接展开到单行中，例如事件、实例、节点、Choice、Command、数量和多选值；Action 会同时显示 Action key、参数与事件节点跳转值：

```text
[maker-runtime] ... command choose-single commandType=choose-single eventInstanceId=event-01 nodeId=entry choiceId=explore actionKey=event.goto ... ok
[maker-runtime] ... command activate-effect commandType=activate-effect effectId=lucky-token ... ok
[maker-runtime] ... action event.goto actionKey=event.goto args=["crossroads","fortune-check"] eventInstanceId=event-01 eventField=currentNodeId previousValue=entry nextValue=fortune-check ... ok
```

监控数据只输出到当前浏览器控制台，不写入存档，也不会打印完整 State 或 Config。

## 架构

```text
React UI → AppServices read models / GameSession
AppServices → GamePackageLoader / SaveRepository / GameplayRuntime
GameSession → GameplayRuntime → SaveRepository → IndexedDB
GamePackageLoader → schema/linker → LoadedGamePackage
```

- UI 只消费应用层 read model、GameSession 接口、SessionView 和 RuntimeSnapshot。
- AppServices 隐藏游戏包、Repository 与具体 Runtime 实现，并组合页面查询和应用命令。
- Session 管理 busy、事件焦点、导航与应用命令。
- Runtime 分开持有稳定存档和未提交工作状态，管理事务、脚本执行、事件图和回合状态机。
- Package loader 负责外部输入校验与静态链接。
- Persistence 只接收可序列化、已校验的稳定存档，并在单个 IndexedDB 事务中完成写入或删除。

## 计划

1. 用 DSL 代替 JavaScript 进行脚本表达。
2. 实现游戏脚本的可视化编辑器。
3. 接入 AI，提供游戏脚本生成 Agent App。

后续还计划补充包级媒体字段、完整调试协议、自动化验证工具和更大规模的脚本性能分析。
