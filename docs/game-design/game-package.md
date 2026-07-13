# 外部游戏包与加载

本文定义游戏包如何被发现、加载、校验并与存档 State 组成可执行的游戏运行时。对应公共类型见 [package.ts](../../src/types/package.ts)。游戏脚本的 Config 结构见[游戏脚本编写指南](./script-authoring.md)，State、事务与恢复语义见[运行时系统设计](./runtime-system.md)，Action 请求终局的协议见[终局与结局](./endings.md)，回合和事件处理见[游戏运行时流程与 UI 绑定](./gameplay-runtime-flow.md)。

一个游戏包就是游戏列表中的一个游戏。Config、Rule 与 Action 都从包的外部资源加载，不写死在引擎代码中。

## 概念与边界

| 对象 | 职责 | 是否进入存档 |
| --- | --- | --- |
| Catalog | 列出当前可选的游戏包版本及其 manifest 位置 | 否 |
| Manifest | 描述一个游戏包的身份、Config 入口、JavaScript 入口与资源基准位置 | 否 |
| GameConfig | 保存可序列化的内容定义、默认值以及 Rule/Action 调用描述 | 否 |
| RuleRegistry | 保存由名称索引的纯计算 Rule JavaScript 实现 | 否 |
| ActionRegistry | 保存由名称索引、在受控处理单元中执行的 Action JavaScript 实现 | 否 |
| LoadedGamePackage | 封装经过完整校验和链接的 Config、registry 与资源位置 | 否 |
| StoredProfile / RunData / TurnData | 保存一次具体游玩的稳定检查点与时间线 | 是 |

GameConfig 中的 `Rule` 和 `Action` 是调用描述，只保存 registry key 与基础类型参数；RuleRegistry 和 ActionRegistry 中的函数才是 JavaScript 实现。存档只记录 `configId` 与 `configVersion`，不复制 manifest、Config 或函数。

## 信任模型

游戏包中的 JavaScript 被视为完全可信，并以宿主应用的权限执行。引擎不为游戏包提供安全沙箱：

- JavaScript module 在 import 时就会执行顶层代码；
- 包脚本可以访问当前 JavaScript 宿主允许的全局 API；
- schema 校验、只读 Proxy 和事务回滚只用于保证游戏运行时的数据约束，不是恶意代码隔离机制；
- 只能安装或加载用户明确信任的游戏包。

信任 JavaScript 不等于跳过正确性校验。引擎仍然必须在进入游戏前校验 manifest、Config、registry 和它们之间的全部静态引用，并在 Action 执行时使用原子处理单元保护 State。

## Catalog

Web 服务器通常不允许客户端枚举目录，因此游戏列表来自显式 catalog，而不是扫描引擎源码或打包器的静态 import。

```ts
interface GameCatalog {
    schemaVersion: 1;
    games: GamePackageDescriptor[];
    /** 每个游戏 id 创建新游戏时使用的版本。 */
    defaultVersions: Record<string, string>;
}

interface GamePackageDescriptor {
    /** 游戏包稳定 id。 */
    id: string;
    /** 该 catalog 项指向的精确内容版本。 */
    version: string;
    /** 游戏列表中使用的名称。 */
    name: string;
    /** 游戏列表中的可选简介。 */
    background?: string;
    /** 相对 catalog 位置解析的 manifest 位置。 */
    manifest: string;
    /** 可选的列表封面，相对 catalog 位置解析。 */
    cover?: string;
}
```

Catalog 只包含绘制游戏列表所需的轻量信息，读取 catalog 不得 import 任何包脚本。多个版本可以同时存在；包的唯一身份是 `(id, version)`，来源 URL 不是身份的一部分。`defaultVersions[id]` 必须指向同 id 的一个 descriptor，且每个 id 恰好有一个默认版本。

游戏列表按稳定 `id` 合并版本，只显示一张游戏卡；新游戏加载 default version，存档恢复加载该 Profile 记录的 exact version。旧版本 descriptor 可以隐藏在兼容性详情中，不作为另一款游戏。应用级“最近 Profile”索引按 config id 保存，选择后再按 Profile.configVersion 解析具体包。

用户选择新游戏时，加载选中 descriptor 的版本。恢复存档时，包解析器必须根据 `Profile.configId` 与 `Profile.configVersion` 定位精确版本，不得默认用 catalog 中的更新版本打开旧存档。

普通继续游戏要求存档版本与已加载包版本完全一致。当前开发阶段不提供内容升级或迁移路径；精确版本不在 catalog 中时，该存档保持不可游玩状态，不得交给 GameplayRuntime。内容或存档结构发生不兼容变化时，可以直接舍弃对应旧包和旧存档。

## 游戏包布局与 Manifest

推荐的可发布布局如下：

```text
games/
  catalog.json
  example-game/
    1.0.0/
      manifest.json
      config.json
      rules.js
      actions.js
      assets/
```

Manifest 使用以下结构：

```ts
interface GamePackageManifest {
    /** manifest 格式版本，与 Config 版本和 State schema 版本无关。 */
    schemaVersion: 1;
    id: string;
    version: string;
    name: string;
    entries: {
        /** GameConfig JSON 入口。 */
        config: string;
        /** 导出 rules 的 JavaScript ES module。 */
        rules: string;
        /** 导出 actions 的 JavaScript ES module。 */
        actions: string;
    };
    /** Config 中包内资源引用的基准位置。 */
    assets?: string;
}
```

一个最小 manifest 例如：

```json
{
  "schemaVersion": 1,
  "id": "example-game",
  "version": "1.0.0",
  "name": "Example Game",
  "entries": {
    "config": "./config.json",
    "rules": "./rules.js",
    "actions": "./actions.js"
  },
  "assets": "./assets/"
}
```

`entries` 与 `assets` 都相对 manifest 所在位置解析。`assets` 省略时使用 manifest 所在目录。引擎保留原始 Config 中的资源引用，由包资源解析器在读取时将它们相对 `assetsBaseLocation` 解析，不为了绝对路径而改写或复制 Config。

Descriptor、manifest 和 `config.meta` 中的 `id`、`version` 与 `name` 必须分别相同；descriptor 提供 `background` 时还必须等于 `config.meta.background`。Manifest 的 `schemaVersion` 选择 manifest 解析器，`config.meta.version` 是精确内容版本。StoredProfile 不保存结构迁移版本，只保存 `configId`、`configVersion` 和用于并发写入的 `storageRevision`。

## Rule 与 Action Module

Rule 入口模块必须导出名为 `rules` 的 RuleRegistry，Action 入口模块必须导出名为 `actions` 的 ActionRegistry。默认导出不参与包协议。

```ts
interface RuleModule {
    rules: RuleRegistry;
}

interface ActionModule {
    actions: ActionRegistry;
}

interface RuleImplementation<TResult = unknown> {
    /** Rule 的注册名称。 */
    key: string;
    calc: (context: RuleContext, ...args: Primitive[]) => TResult;
}

interface ActionImplementation {
    /** Action 的注册名称。 */
    key: string;
    exec: (context: ActionContext, ...args: Primitive[]) => void;
}

type RuleRegistry = Readonly<Record<string, RuleImplementation>>;
type ActionRegistry = Readonly<Record<string, ActionImplementation>>;
```

Registry 的 object key 必须等于对应 implementation 的 `key`。key 使用与 Config id 相同的字符约束，不得为 `__proto__`、`prototype` 或 `constructor`。同一 registry 内不能出现重复 key。

例如，一个 Rule module 可以写成：

```js
export const rules = {
  'player.is-tired': {
    key: 'player.is-tired',
    calc: (context) =>
      context.runState.characters.player.attributes.energy.value <= 2,
  },
};
```

一个 Action module 可以写成：

```js
export const actions = {
  'run.finish': {
    key: 'run.finish',
    exec: (context, endingValue) => {
      context.runState.characters.run.attributes.ending.value = endingValue;
      context.endRun();
    },
  },
};
```

`context.endRun()` 不接收结局参数；Action 先将游戏包自己的结局内容写入普通 RunState，再在同一处理单元中请求终局。Manifest 和 registry 不定义事件启动或 phase 转换指令；这些属于 GameplayRuntime 的流程协议，不通过特殊 Action key 与包加载器耦合。

### Rule 是纯计算

Rule 会在每次 UI 读取、Reaction 全量扫描和嵌套 Rule 调用时直接执行，因此 Rule 必须是对 Config、State 与参数的纯计算：

- RuleContext 只提供只读 `config`、`profileState`、`runState`、`turnState` 和 `rule`；
- RuleContext **不提供** `action`、`random` 或 `endRun`；
- Rule 可以调用另一个 Rule，但不能调用 Action、修改 State、请求终局或产生其他外部副作用；
- Rule 不得读取 `Math.random()`、真实时间或其他非受管输入；
- 在相同 Config、State 和参数下，Rule 必须返回相同结果。

```ts
interface RuleContext {
    readonly config: DeepReadonly<GameConfig>;
    readonly profileState: DeepReadonly<ProfileRuntime>;
    readonly runState: DeepReadonly<RunRuntime>;
    readonly turnState: DeepReadonly<TurnRuntime>;
    readonly rule: RuleFunctions;
}
```

`profileState`、`runState` 与 `turnState` 是将 Config 静态定义与对应 State 合并后的解析视图，不是包含快照、时间线或恢复元数据的 Profile、RunData 与 TurnData 持久化容器。Rule 只能读取这些 State 视图，不能写入。

所有随机判定都必须在 Action 中通过 `context.random()` 执行。需要在 Rule 重复执行、快照恢复或读档后保持的随机结果，必须由 Action 写入 State，然后由 Rule 读取该事实。

完全可信的 JavaScript 仍可以主动访问全局 API；纯计算是游戏包作者必须遵守的正确性协议。引擎可以通过只读 Proxy、执行期调用栈和开发期 lint 尽可能发现违规，但不把它宣称为安全隔离。

### Action 的注入与处理单元

ActionContext 提供处理单元内可写的解析后 State 视图、受管 PRNG、已注册 Action/Rule 的调用集合，以及无参数的 `endRun`：

```ts
interface ActionContext {
    readonly config: DeepReadonly<GameConfig>;
    readonly profileState: ActionProfileRuntime;
    readonly runState: ActionRunRuntime;
    readonly turnState: ActionTurnRuntime;
    readonly random: Random;
    readonly action: ActionFunctions;
    readonly rule: RuleFunctions;
    readonly endRun: () => void;
}
```

Registry 本身不保存任何一局的 State context。运行时执行器每次调用时根据当前处理单元绑定 context，并在调用 Config 中的 Action 时先传入 context，再展开 `args`。嵌套 Action 与后续 Reaction Action 共享 State、PRNG、EventInstance State 写入和终局请求 draft；完整队列稳定后才提交。

`profileState`、`runState` 与 `turnState` 的名称表明脚本收到的是对应作用域的 State 视图；Profile、RunData 与 TurnData 的 id、快照、分支、时间戳和恢复游标不会注入脚本上下文。`turnNumber` 与 `phase` 在 ActionTurnRuntime 中只读。

节点 Action 直接通过 `runState` 修改当前 EventInstance。EventState 的只读 `activeInstanceId` 由引擎在启动、完成或放弃实例时维护，因此 Action 无需遍历 `instances`：

```js
function goToNode(context, eventId, nextNodeId) {
  const eventState = context.runState.events[eventId];
  const instanceId = eventState.activeInstanceId;
  if (instanceId === undefined) {
    throw new Error(`Event ${eventId} has no active instance`);
  }

  eventState.instances[instanceId].currentNodeId = nextNodeId;
}
```

Action 可修改 active instance 的 `currentNodeId` 和 `status`；`activeInstanceId`、`instanceId`、`eventId`、`nodePath`、`startedTurn` 与 `endedTurn` 由引擎维护。引擎在同一处理单元中校验赋值，由 `currentNodeId` 变化追加 `nodePath` 并切换节点 Reaction，由终止 `status` 变化清除 `activeInstanceId` 并写入 `endedTurn`。事件启动和阶段推进仍由宿主命令与引擎状态机负责。

包模块不得把可变的 module-level 变量当作游戏状态。同一包的 module 可能被多个 Profile 或 RunData 共享和缓存，这类变量不进入快照，会导致跨存档污染且无法重现。所有会影响游戏结果的可变事实都必须通过 context 写入 ProfileState、RunState 或 TurnState。

任一 Action 抛出异常时，引擎回滚当前处理单元中的 State、PRNG、EventInstance 写入与终局请求，并在错误中附上包 id、版本、Action key 和调用链。

## GamePackageSource 与加载器边界

引擎不应把 HTTP URL、浏览器文件 API 或桌面端路径写进运行时核心。不同宿主通过以下抽象提供包资源：

```ts
interface GamePackageSource {
    /** 返回游戏列表中的可用包版本及已解析位置。 */
    list(): Promise<LocatedGameCatalog>;
    /** 读取并解析指定位置的 JSON。 */
    readJson<T>(location: string): Promise<T>;
    /** 以完全可信模式导入 JavaScript ES module。 */
    importTrustedModule(location: string): Promise<unknown>;
    /** 以 base 为基准解析包内相对位置。 */
    resolve(base: string, reference: string): string;
}

interface LocatedGamePackage {
    readonly descriptor: DeepReadonly<GamePackageDescriptor>;
    /** descriptor.manifest 相对 catalog 解析后的位置。 */
    readonly manifestLocation: string;
    /** descriptor.cover 相对 catalog 解析后的位置。 */
    readonly coverLocation?: string;
}

interface LocatedGameCatalog {
    readonly packages: readonly LocatedGamePackage[];
    readonly defaultVersions: Readonly<Record<string, string>>;
}

interface LoadedGamePackage {
    readonly location: DeepReadonly<LocatedGamePackage>;
    readonly manifest: DeepReadonly<GamePackageManifest>;
    readonly config: DeepReadonly<GameConfig>;
    readonly rules: RuleRegistry;
    readonly actions: ActionRegistry;
    readonly assetsBaseLocation: string;
}
```

`GamePackageSource` 可由 HTTP catalog、本地目录、桌面容器或测试内存对象实现。加载器依赖 source，GameplayRuntime 只依赖 `LoadedGamePackage`；因此切换包来源不会改变 Rule、Action、State 或存档语义。

## 包级加载与链接顺序

加载器按以下顺序工作：

1. 从 catalog 取得 located package；恢复存档时先按 `configId` 与 `configVersion` 选择精确 descriptor。
2. 读取 manifest，根据 `schemaVersion` 校验其结构，并确认 descriptor 与 manifest 身份一致。
3. 相对 manifest 位置解析 Config、Rule module、Action module 与资源基准位置。
4. 并行读取 Config JSON，并 import Rule 与 Action module。模块的顶层代码在这一步执行，但加载器尚未创建任何 Profile 或 RunData。
5. 校验 GameConfig schema、所有 object key/id、枚举、数值范围、唯一性与 Config 内部引用，并确认 `config.meta` 与 manifest 身份一致。
6. 校验模块的 `rules` / `actions` 导出、registry key、implementation.key 与 `calc` / `exec` 函数形状。
7. 链接全部 Config 调用描述：递归遍历 `xxxValue`/Rule 字段、Choice、Command、CheckNode 和 Reaction，确认每个 Rule key 存在于 RuleRegistry、每个 Action key 存在于 ActionRegistry，并校验 event/node/choice/character/effect 等稳定 id 引用；ValueRef 的非空路径必须从声明位置或指定 State 根定位到静态 Primitive 或派生字段，派生字段的返回值在运行时继续校验为 Primitive。`manuallyActivatable` 的 Effect 可以使用任意 `actived` Rule，RuntimeCommand 修改对应的 `activedValue`。
8. 为 Reaction 声明生成稳定注册顺序，冻结 manifest、Config 与 registry 外壳，产出 `LoadedGamePackage`。

链接阶段不执行任何 Rule 或 Action。JavaScript 函数的任意参数含义和 Rule 的业务返回类型无法只根据 JavaScript 函数形状完全证明；加载器校验 Config `args` 只包含 Primitive，具体返回值和 State 写入在 Rule 计算或 Action 事务执行时继续校验。

### 稳定的 Reaction 声明顺序

引擎不使用 JSON `Record` 的插入顺序决定 Reaction 执行结果。链接器为每个 Reaction 模板生成 canonical key：

1. EffectConfig Reaction：`[0, effect.order, effect.id, reactionListIndex]`；
2. EventConfig Reaction：`[1, event.order, event.id, reactionListIndex]`；
3. TextNode Reaction 模板：`[2, event.order, event.id, node.order, node.id, reactionListIndex]`。

数字按升序比较，字符串按 Unicode code point 升序比较；`reactionListIndex` 是 Reaction 在所属数组中的下标。当 TextNode 模板被具体 EventInstance 注册时，运行时在 event 与 node 字段之间加入 `[instance.startedTurn, instance.instanceId]`，使多个 active instance 在恢复后仍得到相同顺序。

Reaction 初次注册只建立基准值，不执行 Action。一次 draft 写入使多个 Reaction 同时匹配时，引擎按 canonical key 将它们加入 FIFO；Reaction Action 引发的新任务追加到队尾。创建、读档、branch 与截断恢复在相同 Config 和 State 上必须得到相同的初始顺序。

## 加载失败与原子边界

加载错误应保留可定位的阶段与路径：

```ts
type PackageLoadStage =
    | 'catalog'
    | 'manifest'
    | 'config'
    | 'module-import'
    | 'schema-validation'
    | 'registry-validation'
    | 'linking';

interface PackageLoadError {
    errorId: string;
    stage: PackageLoadStage;
    packageId?: string;
    packageVersion?: string;
    resourceLocation?: string;
    jsonPointer?: string;
    message: string;
    cause?: unknown;
}
```

`resourceLocation` 定位 manifest、Config 或脚本资源；`jsonPointer` 定位该资源内部的 schema、registry 或 linking 字段，两者不复用。加载边界会补齐缺失的包 id/version，并保留原错误为 cause。对外消息附带 `errorId`；完整 cause 只进入开发诊断。

Manifest 读取、module import、校验或链接任一失败时，该包不得进入可游玩列表的 ready 状态，也不得创建或改写 Profile。游戏列表可以保留 descriptor 并展示包加载失败，但不能向 GameplayRuntime 传递部分加载的 Config 或 registry。

`LoadedGamePackage` 是包加载的原子成功边界。对相同 `(id, version)` 的成功结果可以缓存；已发布版本的内容应保持不变，任何内容修改都应使用新的 `version`，以避免同一存档身份对应不同脚本。

## 从包级初始化到局级运行时

ActionRegistry 和 RuleRegistry 在包加载时建立一次，不为每个 Profile、RunData 或回合重新 import。每个 RunData 创建自己的 State、PRNG、Proxy、Reaction 基准值与 context-bound 执行器。

新游戏或 restart 的衔接顺序是：

1. 接收已成功链接的 `LoadedGamePackage`。
2. 创建稀疏 ProfileState/RunState/TurnState 与 RandomState，把 Config 的 `xxxValue` 基础值和初始生命周期事实物化到 RunState。
3. 校验初始 State，构造包含 `initial` TurnData 的 RunData 与 StoredProfile，并持久化。
4. 打开 GameplayRuntime，从 `initial` snapshot 克隆唯一工作状态，创建处理单元管理器和 Config/State 合并 Proxy，再绑定 RuleRegistry 与 ActionRegistry。
5. 按 canonical key 收集配置级 Reaction 并建立基准；失败时关闭 Runtime，已持久化的 `initial` 保持不变。
6. 将已就绪的运行时交给回合状态机，由它以 initial 为回滚边界开始首回合；首回合脚本失败时同样保留完整 initial 并报告错误。

继续、branch 或截断恢复的衔接顺序是：

1. 校验 StoredProfile，并根据其中的 Config id 与版本取得完全匹配的 `LoadedGamePackage`；精确版本不可用时停止恢复。
2. 从选中 snapshot 克隆 ProfileState、RunState、TurnState 与 RandomState 工作副本。
3. 创建处理单元管理器、合并 Proxy、context-bound Rule/Action 执行器和 Reaction baseline。
4. 按 canonical key 注册所有配置级 Reaction，并为每个 active EventInstance 的当前 TextNode 恢复节点 Reaction；所有 Reaction 都只建立基准值。
5. `initial` 与 `turn_end` 交给状态机开始下一回合；`terminal` 或 `abandoned` 只恢复结果界面，不创建可接受游戏指令的回合运行时。

这一边界保证了包代码、内容数据和具体游玩 State 的生命周期分离：切换存档只重建局级运行时，切换游戏包才会替换 Config 和 registry。
