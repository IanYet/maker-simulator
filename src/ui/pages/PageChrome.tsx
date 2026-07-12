import { Link } from 'react-router'
import type { ReactNode } from 'react'
import styles from './pages.module.css'

/** 页面统一外壳，提供品牌导航和可选右侧操作区。 */
export function PageChrome({ children, action }: { children: ReactNode; action?: ReactNode }) {
	return (
		<main className={styles.page}>
			<header className={styles.topbar}>
				<Link className={styles.brand} to="/games">MAKER SIMULATOR</Link>
				{action}
			</header>
			{children}
		</main>
	)
}
