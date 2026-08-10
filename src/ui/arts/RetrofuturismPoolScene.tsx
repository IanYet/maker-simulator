import { useEffect, useRef } from 'react'
import { mountRetrofuturismPoolScene } from './retrofuturismPoolScene'
import styles from './RetrofuturismPoolScene.module.css'

/** 固定机位的复古未来泳池画布，并在卸载时释放全部 Three.js 资源。 */
export function RetrofuturismPoolScene() {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) {
			return
		}

		try {
			const controller = mountRetrofuturismPoolScene(container)
			return () => controller.dispose()
		} catch (error) {
			console.error('无法创建 Retrofuturism Pool 场景。', error)
			container.dataset.error = 'true'
			return () => {
				delete container.dataset.error
			}
		}
	}, [])

	return (
		<div
			ref={containerRef}
			className={styles.scene}
			role="img"
			aria-label="复古未来主义室内泳池：拱形建筑环绕水面，多颗行星悬浮于穹顶，一名穿红色泳衣的人站在池边。"
		>
			<p className={styles.fallback}>当前浏览器无法显示 WebGL 场景。</p>
		</div>
	)
}
