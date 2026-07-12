import { Link } from 'react-router'
import type { ReactNode } from 'react'
import styles from './pages.module.css'

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
