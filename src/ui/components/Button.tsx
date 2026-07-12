import { Link } from 'react-router'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './primitives.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'

/** 统一应用视觉样式的原生 Button 包装组件。 */
export function Button({
	variant = 'primary',
	icon = false,
	className = '',
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: boolean }) {
	return <button className={`${styles.button} ${styles[variant]} ${icon ? styles.icon : ''} ${className}`} {...props} />
}

/** 使用同一套按钮样式渲染 React Router 链接。 */
export function ButtonLink({
	to,
	children,
	variant = 'primary',
	className = '',
}: {
	to: string
	children: ReactNode
	variant?: ButtonVariant
	className?: string
}) {
	return <Link className={`${styles.button} ${styles[variant]} ${className}`} to={to}>{children}</Link>
}
