import type { ReactNode } from 'react'
import styles from './primitives.module.css'

export function StatusBanner({ tone, children }: { tone: 'loading' | 'error' | 'empty' | 'success'; children: ReactNode }) {
	return <div className={`${styles.banner} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function LiveRegion({ children }: { children: ReactNode }) {
	return <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">{children}</div>
}
