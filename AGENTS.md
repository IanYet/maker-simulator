# Maker Simulator 项目协作规范

这些规则适用于仓库根目录及其所有子目录。更深层目录中的 `AGENTS.md` 可以补充本文件；发生冲突时，以更具体目录的规则为准。

## 任务开始前

- 先阅读与任务相关的 `docs/`、`docs/game-design/`、`README.md` 和现有实现，再修改代码。
- 处理故事脚本或游戏包时，使用 `.codex/skills/write-story-script/SKILL.md`；按该 skill 指向的文档逐步校验。
- 保留用户已有改动，只修改当前任务需要的文件；不要使用破坏性 Git 命令覆盖未提交内容。
- 修改 `todo.md` 中的任务时，按原有顺序完成并同步勾选对应条目；不要删除尚未完成的条目。

## 代码与架构边界

- UI 通过 AppServices 页面 read model 或 `GameSession`/`SessionView` 读取状态并发出命令；不要在页面中直接操作 Profile、RunData、IndexedDB、具体 Runtime 实现或游戏脚本。
- `GameplayRuntimeImpl` 是状态变更、事务、回滚、回合阶段、Reaction 和检查点的权威实现；`selectors.ts`、`reactions.ts` 与 `errors.ts` 只承接对应的纯投影、定义收集和错误协议。新增状态语义先更新 `src/types` 和设计文档。
- `package-loader` 负责外部输入的 schema 校验、registry 校验和 linking；可信游戏包脚本通过 Rule/Action registry 接入。
- `persistence` 负责 Profile 结构校验、IndexedDB 和检查点操作；Repository 使用 `validateStoredProfile()` 隔离未知记录，加载精确游戏包后由应用层或 Runtime 使用 `validateProfileAgainstConfig()` 完成领域校验。写入前复制并校验数据。
- 游戏内容放在 `public/games/<id>/<version>/`，不要把具体剧情、数值或包 id 硬编码进通用 Runtime。
- 修改 `public/games/frostbound/1.0.0/config.json` 时，优先修改 `scripts/build-frostbound-package.mjs` 后重新生成；不要手工维护生成结果。

## Runtime 与存档不变量

- `StoredProfile` 只保存稳定检查点；当前回合工作状态由 Runtime 单独持有。退出或切换存档时丢弃未提交工作状态，不把它写回 Profile。
- Runtime 处理单元先稳定 draft、完成 Config 感知校验并生成 candidate snapshot；需要保存时等待 Repository 成功，随后一次性替换状态、baseline、revision 与 snapshot。持久化或 selector 失败必须保留提交前状态。
- `advance-turn` 的 `turn_end` 是独立持久化边界。下一回合启动失败时保留并发布已提交的 `turn_end`，失败结果使用 `committed: true`，再次执行同一命令从该边界重试。
- Rule 每次读取时直接执行，不缓存、不收集依赖；root 操作后及每个 Reaction Action 后按 canonical 顺序全量扫描当前 watch。新增优化前先用性能数据证明 eager scan 已成为瓶颈。
- 项目处于开发阶段，不维护旧存档结构迁移或兼容分支。持久化结构变化时递增 `DATABASE_VERSION`，升级过程保留对象仓库和索引定义并清空旧 Profile 与应用元数据。

## 故事脚本默认规则

- 不需要玩家点击事件卡、会随回合或状态变化自动执行的 Reaction，优先放在 Effect 上，并在 Effect 的 `displayName`/`description` 中说明影响。
- Event 用于叙事内容、玩家选择和事件分支；EventConfig Reaction 用于事件内容自身的持续响应，TextNode Reaction 用于 active 节点局部逻辑。
- `required` 是回合门禁。待处理事件入口、CheckNode 候选链或 active 节点链上存在 required 内容时，`advance-turn` 必须保持阻塞。
- Rule 保持纯计算；Action 通过 `ActionContext` 写入允许的 State 视图，随机数使用 `context.random()`，终局使用 `context.endRun()`。
- 事件节点、Effect 前置、结局条件和资源循环必须可达且能形成可理解的叙事闭环；用生成器审计和人工路线验收共同确认。
- 这些是策划默认规则，不在通用 Runtime 中增加强制的“Reaction 只能声明在哪一层”限制。

## 注释与文档

- 公开类、函数、接口和关键状态转换使用中文 JSDoc，说明职责、参数、返回值、异常或生命周期边界。
- 复杂私有逻辑注释其设计原因、不变量和回滚/顺序约束，避免逐行复述代码。
- 文档内容从 A 改为 B 时直接替换为 B，不添加“不是 A 而是 B”一类历史对比措辞，除非用户明确要求保留对比。
- 代码行为、Config 字段、运行流程发生变化时同步更新 `docs/development.md` 或对应 `docs/game-design/` 文档。

## 验证流程

提交前运行：

```bash
node scripts/build-frostbound-package.mjs  # 修改 Frostbound authoring 时
pnpm run test
pnpm run build
pnpm run lint
git diff --check
```

- Runtime、持久化、包加载器或纯应用命令发生变化时补充非 UI 自动回归；可以使用 Vitest、`fake-indexeddb` 和完成测试所需的第三方库。
- 不编写 UI 自动测试；页面布局、键盘、焦点、触控目标和完整玩家流程由人工操作确认。

涉及 Runtime、游戏包或存档时，额外人工检查：

- 新游戏能创建并进入首回合；
- 自动回合逻辑、Effect Reaction 和属性变化符合描述；
- required 事件会阻止下一回合，完成后解除阻塞；
- 单选、多选、CheckNode、随机分支、Effect 获得/激活、分支/截断和终局均可操作；
- IndexedDB 升级后对象仓库与索引定义正确，开发期旧记录按约定清空；
- `?runtimeMonitor=1` 或 `?runtimeMonitor=verbose` 下能看到具体命令、Action、Reaction 的 id、value 和参数。

## Git 与交付

- 用户明确要求时才创建 commit；commit message 使用简洁的 Conventional Commit 风格，例如 `feat: ...`、`fix: ...`、`docs: ...`。
- 最终回复说明结果、关键文件、验证命令和仍需人工确认的事项；不要声称未执行的测试已经通过。
