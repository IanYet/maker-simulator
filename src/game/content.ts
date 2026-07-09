import type { GameModelData } from '../types'
import { validateGameModelData, type ValidationWarning } from './validation'

/** 浏览器加载并校验后的内容数据。 */
export interface LoadedContent {
  /** 可直接传入游戏引擎的模型数据。 */
  data: GameModelData
  /** 内容校验阶段产生的非阻塞警告。 */
  warnings: ValidationWarning[]
}

/**
 * 从指定 URL 加载游戏内容 JSON，并执行运行时模型校验。
 *
 * @param url - 内容 JSON 的浏览器可访问地址。
 * @returns 校验通过的模型数据和警告列表。
 * @throws {Error} 当网络请求、JSON 解析或模型校验失败时抛出。
 */
export async function loadContent(url: string): Promise<LoadedContent> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`内容加载失败：HTTP ${response.status}`)
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new Error('内容不是合法的 JSON')
  }

  const result = validateGameModelData(raw)
  if (!result.success) {
    throw new Error(result.errors.map((error) => `${error.path}：${error.message}`).join('\n'))
  }

  return {
    data: result.data,
    warnings: result.warnings,
  }
}
