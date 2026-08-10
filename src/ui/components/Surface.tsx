import type { HTMLAttributes } from 'react'
import styles from './primitives.module.css'

export type SurfaceTone =
	'white' | 'soft' | 'lime' | 'lilac' | 'cream' | 'pink' | 'mint' | 'coral' | 'navy'

/** 提供统一背景色和边界样式的内容表面容器。 */
export function Surface({
	tone = 'white',
	className = '',
	...props
}: HTMLAttributes<HTMLDivElement> & { tone?: SurfaceTone }) {
	return <div className={`${styles.surface} ${styles[tone]} ${className}`} {...props} />
}
