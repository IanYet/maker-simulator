import { Link } from 'react-router'
import { PageChrome } from './PageChrome'
import pageStyles from './pages.module.css'
import styles from './ArtsPage.module.css'

const artProjects = [
	{
		id: 'retrofuturism-pool',
		title: 'Retrofuturism Pool',
		tags: ['retrofuturism'],
		cover: `${import.meta.env.BASE_URL}imgs/retrofuturism-pool-cover.jpg`,
	},
] as const

/** 展示现有视觉项目的 Arts Gallery 列表页。 */
export function ArtsPage() {
	return (
		<div className={styles.page}>
			<PageChrome>
				<p className={pageStyles.eyebrow}>Visual experiments / Gallery</p>
				<h1 className={pageStyles.title}>Arts Gallery</h1>
				<p className={pageStyles.subtitle}>探索可能用于游戏中的实时画面、材质与视觉特效。</p>
				<section className={styles.gallery} aria-label="Arts projects">
					<div className={styles.grid}>
						{artProjects.map((project) => (
							<article key={project.id} className={styles.card}>
								<Link className={styles.cardLink} to={`/arts/${project.id}`}>
									<div className={styles.coverFrame}>
										<img
											className={styles.cover}
											src={project.cover}
											alt=""
											width="1600"
											height="1000"
											loading="lazy"
											decoding="async"
										/>
										<ul className={styles.tags} aria-label={`${project.title} tags`}>
											{project.tags.map((tag) => (
												<li key={tag} className={styles.tag}>
													{tag}
												</li>
											))}
										</ul>
									</div>
									<div className={styles.cardMeta}>
										<h2 className={styles.cardTitle}>{project.title}</h2>
									</div>
								</Link>
							</article>
						))}
					</div>
				</section>
			</PageChrome>
		</div>
	)
}
