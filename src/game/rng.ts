export interface RandomResult {
  value: number
  seed: string
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(value)

  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash
}

export function nextRandom(seed: string): RandomResult {
  const state = fnv1a(seed)
  const next = (Math.imul(1664525, state) + 1013904223) >>> 0

  return {
    value: next / 0x100000000,
    seed: next.toString(16).padStart(8, '0'),
  }
}

export function createSeed(): string {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')
}
