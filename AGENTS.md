# Maker Simulator 项目协作规范

这些规则适用于仓库根目录及其所有子目录。更深层目录中的 `AGENTS.md` 可以补充本文件；发生冲突时，以更具体目录的规则为准。

## 任务开始前

- 项目开发运行环境是 WSL（Ubuntu-24.04）。所有项目命令（包括 Git、依赖安装、脚本、测试、构建和 lint）必须在 WSL 的 `/home/tong/projects/maker-simulator` 中执行，使用 WSL 内的 Node.js、pnpm 等工具链。
- 从 Windows/PowerShell 调用时，统一使用 `wsl.exe -d Ubuntu-24.04 --cd /home/tong/projects/maker-simulator bash -ic '<命令>'`；不要直接使用 Windows 工具链在 UNC 仓库路径中运行项目命令。
- 检查当前分支是否是main分支，如果是main分支，给出告警提示并询问当前在main分支，是否继续开发，得到肯定的提示后再继续
- 先阅读与任务相关的 `docs/`、`docs/game-design/`、`README.md` 和现有实现，再修改代码。
- 处理故事脚本或游戏包时，使用 `.codex/skills/write-story-script/SKILL.md`；按该 skill 指向的文档逐步校验。
- 保留用户已有改动，只修改当前任务需要的文件；不要使用破坏性 Git 命令覆盖未提交内容。
- 修改 `todo.md` 中的任务时，按原有顺序完成并同步勾选对应条目；不要删除尚未完成的条目。

## 代码原则

- 不维护向后兼容。删除已废弃的实现路径，不为旧实现添加兼容层、兼容回退或兼容迁移。
- 选择能完整满足当前需求的最简单实现，避免为假设中的需求增加抽象、配置或间接层。
- 按可运行的纵向功能切片推进，先完成最小端到端流程，再增加下一项能力；遵循 `docs/technical-spec.md` 的交付顺序。
- 保持组件和模块职责清晰，分离不同关注点。
- 在能降低整体复杂度或提高可靠性时，优先采用成熟且维护良好的库；没有明确理由时，不重复实现通用能力。
- 添加依赖前先复用现有依赖；判断某项能力缺失前，查阅已安装版本的文档和类型定义。
- 架构决策应适合文档定义的产品需求，避免采用计划稍后替换的临时方案。
- 优先使用直接、清晰的导入；只有实际出现第二个实现或使用方、使抽象有明确价值时，才新增接口、适配器、统一导出文件或共享抽象。
- 引入设计文档明确排除的基础设施或改变既定架构边界前，先明确调整对应的权威设计文档。
- 依赖管理和脚本命令统一使用 pnpm，不手工编辑 `pnpm-lock.yaml`。
- 保持改动范围集中，避免顺手重排无关代码或升级依赖；不手工修改或提交构建产物、覆盖率输出和本地环境文件。

## 代码与架构边界

- 宏观分为 UI 与 Gameplay。UI 仅从 `src/gameplay/index.ts` 导入 Gameplay、Game 与只读数据；负责用户操作、确认、pending、焦点、导航和展示转换。不要在页面直接操作 Profile、RunData、Repository、具体 Runtime 或脚本。
- Runtime 直接实现 Game，是状态变更、事务、回滚、阶段、Reaction 与检查点的唯一权威。Gameplay 协调包与存档用例，不返回页面路由。历史投影共用 rules/state-view/snapshot，不创建 Runtime 或持续 observer。新增状态语义先更新 `src/gameplay/types` 与设计文档。
- Gameplay 不反向依赖 UI、React、路由或 DOM；HTTP/IndexedDB 限定在 I/O 模块，环境选项由 UI 启动代码传入。类按职责命名，不使用 Impl 后缀；内部直接导入，公共入口显式导出。
- `package-loader` 负责外部输入的 schema 校验、registry 校验和 linking；可信游戏包脚本通过 Rule/Action registry 接入。
- `persistence` 负责 Profile 结构校验、IndexedDB 和检查点操作；Repository 使用 `validateStoredProfile()` 隔离未知记录，加载精确游戏包后由应用层或 Runtime 使用 `validateProfileAgainstConfig()` 完成领域校验。写入前复制并校验数据。
- 游戏内容放在 `public/games/<id>/<version>/`，不要把具体剧情、数值或包 id 硬编码进通用 Runtime。
- 修改 `public/games/frostbound/1.0.0/config.json` 时，优先修改 `scripts/build-frostbound-package.mjs` 后重新生成；不要手工维护生成结果。

## Runtime 与存档不变量

- `StoredProfile` 只保存稳定检查点；当前回合工作状态由 Runtime 单独持有。退出或切换存档时丢弃未提交工作状态，不把它写回 Profile。
- Runtime 处理单元先稳定 draft、完成 Config 感知校验并生成 candidate snapshot；需要保存时等待 Repository 成功，随后一次性替换状态、响应式依赖图、baseline、revision 与 snapshot。持久化或 selector 失败必须保留提交前状态。
- `advance-turn` 的 `turn_end` 是独立持久化边界。下一回合启动失败时保留并发布已提交的 `turn_end`，失败结果使用 `committed: true`，再次执行同一命令从该边界重试。
- Rule 计算节点通过 State Proxy 的 `get`、`ownKeys` 与集合成员读取收集动态依赖；成功重算替换旧依赖，基础类型结果缓存，异常不缓存。State 写入只失效反向可达节点，Reaction 与 Effect 生命周期只处理 dirty observer，禁止退回全量 watch 扫描。
- 项目处于开发阶段，不维护旧存档结构迁移或兼容分支。持久化结构变化时递增 `DATABASE_VERSION`，升级过程保留对象仓库和索引定义并清空旧 Profile 与应用元数据。

## 故事脚本默认规则

- 不需要玩家点击事件卡、会随回合或状态变化自动执行的 Reaction，优先放在 Effect 上，并在 Effect 的 `displayName`/`description` 中说明影响。
- Event 用于叙事内容、玩家选择和事件分支；EventConfig Reaction 用于事件内容自身的持续响应，TextNode Reaction 用于 active 节点局部逻辑。
- `required` 是回合门禁。待处理事件入口、CheckNode 候选链或 active 节点链上存在 required 内容时，`advance-turn` 必须保持阻塞。
- Rule 保持纯计算；Action 通过 `ActionContext` 写入允许的 State 视图，随机数使用 `context.random()`，终局使用 `context.endRun()`。
- 事件节点、Effect 前置、结局条件和资源循环必须可达且能形成可理解的叙事闭环；用生成器审计和人工路线验收共同确认。
- 这些是策划默认规则，不在通用 Runtime 中增加强制的“Reaction 只能声明在哪一层”限制。

## 注释规范

- 公开类、函数、接口和关键状态转换使用中文 JSDoc，说明职责、参数、返回值、异常或生命周期边界。
- 复杂私有逻辑注释其设计原因、不变量和回滚/顺序约束，避免逐行复述代码。

## 文档原则

- 按职责查阅和维护权威资料：`src/gameplay/types` 定义跨模块公共数据结构和命令协议；`docs/game-design/` 定义游戏、运行时、存档、终局和玩家流程语义；`docs/technical-spec.md` 定义架构、技术选型和交付顺序；`DESIGN.md` 定义视觉与响应式表现；`docs/development.md` 定义开发流程和仓库约定；`README.md` 提供项目入口、当前能力和常用命令。
- 规范优先级遵循 `docs/technical-spec.md`：`src/gameplay/types` → `docs/game-design/` → `docs/technical-spec.md` → `DESIGN.md`。开发文档和 README 应与对应权威资料保持一致，不得静默覆盖上层规范。
- 文档发生冲突时，明确指出冲突；预期行为清楚时，在同一变更中同步更新对应权威资料；需要作出新的产品决策时先向用户确认。
- 使用清晰、直接、通用易懂的语言；技术术语只在提高准确性时使用。保持链接、命令、文件路径和项目状态描述准确、有效。
- 文档内容从 A 改为 B 时直接替换为 B，不添加“不是 A 而是 B”一类历史对比措辞，除非用户明确要求保留对比。
- 代码行为、Config 字段、数据结构、运行流程、路由、命令、环境变量、依赖、安全边界或开发流程发生变化时，在同一变更中同步更新对应的设计文档、`docs/development.md` 和受影响的 `README.md` 内容。

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

- `dev` 是日常集成分支，`main` 是 Production 分支；禁止直接在 `main` 上开发。
- 所有功能分支（`feat/*` 或 `feat-*`）必须基于最新 `dev` 创建；开发期间需要同步上游变更时，从 `dev` 获取代码。
- 功能开发完成并通过分支验证后，只能通过 PR 合入 `dev`；禁止功能分支直接合入或向 `main` 提交 PR。
- `dev` 合并功能后必须完成自动验证和所需人工检查；确认无问题后，再由 `dev` 向 `main` 提交 PR。合入 `main` 后触发 Production 部署。
- 用户明确要求时才创建 commit；commit message 使用简洁的 Conventional Commit 风格，例如 `feat: ...`、`fix: ...`、`docs: ...`。
- 最终回复说明结果、关键文件、验证命令和仍需人工确认的事项；不要声称未执行的测试已经通过。
