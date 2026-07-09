# 仓库协作指南

## 项目概况

本仓库是使用 React 19、TypeScript 和 Vite 构建的回合制事件驱动游戏玩法验证项目。游戏内容由 JSON 描述，领域模型以 `src/types/model.ts` 为类型契约，系统规则以 `docs/system/` 为依据，具体实现以 `docs/design/technical-specification.md` 为准。

当前阶段优先验证玩法闭环，不引入服务端、账号系统、路由库、外部状态管理库或无明确需求的抽象层。

## 目录职责

```text
src/
  components/  React 展示组件
  game/        内容加载、规则引擎、状态机、随机数和持久化
  types/       游戏领域类型
  App.tsx      应用状态和模块组装
  main.tsx     浏览器入口
docs/
  system/      游戏模型和运行规则
  design/      技术规格
  example/     模型示例数据
public/
  example/     浏览器运行时直接加载的内容 JSON
```

`docs/` 和 `src/types/` 是现有模型契约，不得移动或删除。修改模型时，必须同步更新类型、系统说明、技术规格和相关示例。`public/example/` 中供应用加载的数据应与对应的 `docs/example/` 内容保持一致。

`src/game/` 按职责使用少量直接模块：

- `content.ts`：加载内容 JSON。
- `validation.ts`：运行时模型校验。
- `engine.ts`：回合流程和事件状态机。
- `rules.ts`：值表达式、条件、动作、Selector 和候选池。
- `rng.ts`：确定性随机数。
- `persistence.ts`：IndexedDB 存档和快照。

不要为每种条件、动作、节点或效果建立类。使用判别联合和穷尽 `switch` 处理规则。

## 开发命令

统一使用 `pnpm`：

- `pnpm install`：按锁文件安装依赖。
- `pnpm dev`：启动 Vite 开发服务器。
- `pnpm build`：执行 TypeScript 检查并生成生产构建。
- `pnpm lint`：运行 ESLint。
- `pnpm preview`：本地预览生产构建。

提交前至少执行 `pnpm lint` 和 `pnpm build`。

## 编码规范

- TypeScript 和 TSX 使用两空格缩进、单引号、无分号，并在支持的位置保留尾随逗号。
- React 组件和接口使用 PascalCase，函数和变量使用 camelCase。
- JSON 判别值和内容 ID 使用 `snake_case`。
- React UI 不得直接修改 `GameModelData`；所有领域状态修改必须通过游戏引擎完成。
- 游戏引擎不得依赖 React、DOM 或 IndexedDB。
- 模型数组是持久化的唯一数据源；ID Map 只能作为单次命令内的临时索引。
- 不使用 `Math.random()`；所有玩法随机必须推进 `meta.seed`。
- 不使用 `dangerouslySetInnerHTML` 渲染内容 JSON。

Effect `kind` 和 Event/Node `visibility` 只用于分类和 UI 样式，不得作为隐藏实体或改变执行逻辑的条件。玩法验证界面应保留全部效果和事件的可见状态。

## 数据与运行规则

- 默认数据、玩家存档和局内数据必须通过深拷贝隔离。
- 未声明动作作用域时默认修改局内数据。
- 一条玩家命令必须整体成功或整体失败，不能提交部分修改。
- 候选池只负责筛选和抽取，抽取后的修改由调用方动作负责。
- 事件是否自动启动由 `startMode` 决定；是否需要玩家输入由节点 `type` 决定。
- 每回合结束保存完整局内快照，持久化使用 IndexedDB。

如实现细节与现有文档冲突，先澄清并同步文档，不要在代码中引入未记录的隐式行为。

## 检查要求

当前没有独立的自动化测试框架。变更后应：

1. 运行 `pnpm lint`。
2. 运行 `pnpm build`。
3. 涉及模型时，确认 `docs/example/` 与 `public/example/` 中相关 JSON 可以解析。
4. 涉及 UI 时，通过 `pnpm dev` 检查受影响流程。

新增测试时，使用 `*.test.ts` 或 `*.test.tsx` 与源码就近放置，并在 `package.json` 中增加对应命令。

## 提交与合并要求

提交信息使用 Conventional Commits，例如 `feat:`、`fix:`、`refactor:`、`docs:`、`chore:`。主题使用简洁的祈使句，一个提交只处理一个逻辑目标；必要时在正文说明关键设计决策、迁移内容和验证结果。

Pull Request 应说明：

- 变更目的和主要实现。
- 重要的模型或运行语义决策。
- 已执行的检查。
- 对文档、示例数据或存档兼容性的影响。

可见 UI 变更应附截图或录屏；关联任务存在时应链接对应 Issue。
