function xmur3(value: string): number {
	let hash = 1779033703 ^ value.length
	for (let index = 0; index < value.length; index += 1) {
		hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353)
		hash = (hash << 13) | (hash >>> 19)
	}
	hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
	hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
	return (hash ^ (hash >>> 16)) >>> 0
}

function mulberry32(seed: number): number {
	let value = (seed + 0x6d2b79f5) >>> 0
	value = Math.imul(value ^ (value >>> 15), value | 1)
	value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
	return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

/**
 * 根据 RunData 的 seed 和已提交调用次数生成下一项确定性随机值。
 * 同一个检查点和命令序列使用当前固定算法，保证稳定重放。
 */
export function nextRandom(seed: string, cursor: number): number {
	return mulberry32((xmur3(seed) + cursor) >>> 0)
}

/** 当前随机算法标识。 */
export const RANDOM_ALGORITHM = 'xmur3-mulberry32'
