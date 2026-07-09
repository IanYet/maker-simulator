/** 单次随机数推进的结果。 */
export interface RandomResult {
  /** 归一化到 [0, 1) 区间的随机值。 */
  value: number
  /** 推进后的新种子。 */
  seed: string
}

/**
 * 使用 FNV-1a 将字符串种子折叠为 32 位无符号整数。
 *
 * @param value - 原始字符串种子。
 * @returns 可供线性同余生成器使用的整数状态。
 */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(value)

  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash
}

/**
 * 基于当前种子生成下一个确定性随机数。
 *
 * @param seed - 当前随机种子。
 * @returns 随机值和推进后的新种子。
 */
export function nextRandom(seed: string): RandomResult {
  const state = fnv1a(seed)
  const next = (Math.imul(1664525, state) + 1013904223) >>> 0

  return {
    value: next / 0x100000000,
    seed: next.toString(16).padStart(8, '0'),
  }
}

/**
 * 为新开局创建浏览器级随机种子。
 *
 * @returns 由两个 32 位随机数拼接而成的十六进制种子。
 */
export function createSeed(): string {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')
}
