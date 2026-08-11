import { Link } from 'react-router'
import { RetrofuturismPoolScene } from '../arts/RetrofuturismPoolScene'
import styles from './RetrofuturismPoolPage.module.css'

/** 展示固定机位复古未来泳池场景的视觉项目详情页。 */
export function RetrofuturismPoolPage() {
	return (
		<main className={styles.page}>
			<RetrofuturismPoolScene />
			<Link className={styles.galleryLink} to="/arts">
				Arts Gallery
			</Link>
			<h1 className={styles.studyLabel}>
				Retrofuturism Pool
				<span>Study 001 · Fixed View</span>
			</h1>
		</main>
	)
}
