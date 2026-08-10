import { RetrofuturismPoolScene } from '../arts/RetrofuturismPoolScene'
import styles from './ArtsPage.module.css'

/** 展示固定机位 Three.js 视觉实验的 Arts Gallery 页面。 */
export function ArtsPage() {
	return (
		<main className={styles.page}>
			<RetrofuturismPoolScene />
			<h1 className={styles.heading}>Arts Gallery</h1>
			<p className={styles.studyLabel}>
				Retrofuturism Pool
				<br />
				Study 001 · Fixed View
			</p>
		</main>
	)
}
