import type { HTMLAttributes } from 'react'
import styles from './primitives.module.css'

export type SurfaceTone = 'white' | 'soft' | 'lime' | 'lilac' | 'cream' | 'pink' | 'mint' | 'coral' | 'navy'

export function Surface({ tone = 'white', className = '', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: SurfaceTone }) {
	return <div className={`${styles.surface} ${styles[tone]} ${className}`} {...props} />
}
