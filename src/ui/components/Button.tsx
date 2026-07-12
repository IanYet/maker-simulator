import { Link } from 'react-router'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './primitives.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'

export function Button({
	variant = 'primary',
	icon = false,
	className = '',
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: boolean }) {
	return <button className={`${styles.button} ${styles[variant]} ${icon ? styles.icon : ''} ${className}`} {...props} />
}

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
