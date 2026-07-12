import type { ReactNode } from 'react'
import styles from './primitives.module.css'

/** 展示加载、成功、空状态或错误信息，并为错误提供 alert 语义。 */
export function StatusBanner({ tone, children }: { tone: 'loading' | 'error' | 'empty' | 'success'; children: ReactNode }) {
	return <div className={`${styles.banner} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

/** 向屏幕阅读器播报命令状态，不改变视觉布局。 */
export function LiveRegion({ children }: { children: ReactNode }) {
	return <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">{children}</div>
}
