import type { GameModelData } from '../types'
import { validateGameModelData, type ValidationWarning } from './validation'

export interface LoadedContent {
  data: GameModelData
  warnings: ValidationWarning[]
}

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
