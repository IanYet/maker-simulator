import { Link, NavLink } from 'react-router'
import type { ReactNode } from 'react'
import styles from './pages.module.css'

const githubIconLocation = `${import.meta.env.BASE_URL}icons.svg#github-icon`

/** 页面统一外壳，提供品牌、主导航和可选右侧操作区。 */
export function PageChrome({ children, action }: { children: ReactNode; action?: ReactNode }) {
	return (
		<main className={styles.chromePage}>
			<header className={styles.topbar}>
				<div className={styles.topbarInner}>
					<div className={styles.brandGroup}>
						<Link className={styles.brand} to="/games">
							MAKER SIMULATOR
						</Link>
						<a
							className={styles.githubLink}
							href="https://github.com/IanYet/maker-simulator"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="在 GitHub 上查看 Maker Simulator 项目"
							title="在 GitHub 上查看项目"
						>
							<svg aria-hidden="true" focusable="false" viewBox="0 0 19 19">
								<use href={githubIconLocation} />
							</svg>
						</a>
					</div>
					<nav className={styles.primaryNav} aria-label="主要导航">
						<NavLink
							className={({ isActive }) =>
								isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
							}
							to="/games"
						>
							Games
						</NavLink>
						<NavLink
							className={({ isActive }) =>
								isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
							}
							to="/arts"
						>
							Arts
						</NavLink>
					</nav>
					{action && <div className={styles.topbarAction}>{action}</div>}
				</div>
			</header>
			<div className={styles.chromeContent}>{children}</div>
		</main>
	)
}
