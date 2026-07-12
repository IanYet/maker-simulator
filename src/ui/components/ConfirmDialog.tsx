import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { Button } from './Button'
import styles from './primitives.module.css'

/** 用于放弃、截断等不可逆操作的模态确认对话框。 */
export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	danger = false,
	onConfirm,
	onClose,
}: {
	open: boolean
	title: string
	description: string
	confirmLabel: string
	danger?: boolean
	onConfirm: () => void
	onClose: () => void
}) {
	return (
		<Dialog open={open} onClose={onClose}>
			<DialogBackdrop className={styles.dialogBackdrop} />
			<div className={styles.dialogWrap}>
				<DialogPanel className={styles.dialogPanel}>
					<DialogTitle className={styles.dialogTitle}>{title}</DialogTitle>
					<p className={styles.dialogText}>{description}</p>
					<div className={styles.dialogActions}>
						<Button variant="secondary" onClick={onClose}>取消</Button>
						<Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
					</div>
				</DialogPanel>
			</div>
		</Dialog>
	)
}
