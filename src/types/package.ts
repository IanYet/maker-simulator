import type {
	ActionRegistry,
	DeepReadonly,
	GameConfig,
	RuleRegistry,
} from './model'

/** 宿主可发现的游戏包目录。 */
export interface GameCatalog {
	schemaVersion: 1
	games: GamePackageDescriptor[]
	/** 每个游戏 id 创建新游戏时使用的版本。 */
	defaultVersions: Record<string, string>
}

/** 游戏列表使用的轻量包描述。 */
export interface GamePackageDescriptor {
	id: string
	version: string
	name: string
	background?: string
	manifest: string
	cover?: string
}

/** 一个精确游戏包版本的外部入口。 */
export interface GamePackageManifest {
	schemaVersion: 1
	id: string
	version: string
	name: string
	entries: {
		config: string
		rules: string
		actions: string
	}
	assets?: string
}

/** 游戏包规则脚本模块的 ESM 导出形状。 */
export interface RuleModule {
	rules: RuleRegistry
}

/** 游戏包动作脚本模块的 ESM 导出形状。 */
export interface ActionModule {
	actions: ActionRegistry
}

/** 已解析 catalog 位置的包描述。 */
export interface LocatedGamePackage {
	readonly descriptor: DeepReadonly<GamePackageDescriptor>
	readonly manifestLocation: string
	readonly coverLocation?: string
}

export interface LocatedGameCatalog {
	readonly packages: readonly LocatedGamePackage[]
	readonly defaultVersions: Readonly<Record<string, string>>
}

/** 完成 schema 校验与 linking 后交给运行时的只读包。 */
export interface LoadedGamePackage {
	readonly location: DeepReadonly<LocatedGamePackage>
	readonly manifest: DeepReadonly<GamePackageManifest>
	readonly config: DeepReadonly<GameConfig>
	readonly rules: RuleRegistry
	readonly actions: ActionRegistry
	readonly assetsBaseLocation: string
}

/** HTTP、本地目录或测试内存源共同实现的包 I/O 边界。 */
export interface GamePackageSource {
	/** 读取 catalog 并解析资源位置。 */
	list(): Promise<LocatedGameCatalog>
	/** 读取任意 JSON 资源；schema 校验由 loader 负责。 */
	readJson<T>(location: string): Promise<T>
	/** 导入可信 Rule/Action ESM 模块。 */
	importTrustedModule(location: string): Promise<unknown>
	/** 解析并限制包内资源 URL。 */
	resolve(base: string, reference: string): string
}

export type PackageLoadStage =
	| 'catalog'
	| 'manifest'
	| 'config'
	| 'module-import'
	| 'schema-validation'
	| 'registry-validation'
	| 'linking'

/** 对外展示的游戏包加载错误结构。 */
export interface PackageLoadError {
	stage: PackageLoadStage
	packageId?: string
	packageVersion?: string
	path?: string
	message: string
	cause?: unknown
}
