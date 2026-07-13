import {
	Dialog,
	DialogBackdrop,
	DialogDescription,
	DialogPanel,
	DialogTitle,
} from '@headlessui/react'
import { useState } from 'react'
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
	onConfirm: () => void | Promise<void>
	onClose: () => void
}) {
	const [busy, setBusy] = useState(false)

	async function handleConfirm(): Promise<void> {
		if (busy) return
		setBusy(true)
		try {
			await onConfirm()
		} finally {
			setBusy(false)
		}
	}

	function handleClose(): void {
		if (!busy) onClose()
	}

	return (
		<Dialog open={open} onClose={handleClose}>
			<DialogBackdrop transition className={styles.dialogBackdrop} />
			<div className={styles.dialogWrap}>
				<DialogPanel transition aria-busy={busy} className={styles.dialogPanel}>
					<DialogTitle className={styles.dialogTitle}>{title}</DialogTitle>
					<DialogDescription className={styles.dialogText}>{description}</DialogDescription>
					<div className={styles.dialogActions}>
						<Button disabled={busy} variant="secondary" onClick={handleClose}>
							取消
						</Button>
						<Button
							disabled={busy}
							variant={danger ? 'danger' : 'primary'}
							onClick={() => void handleConfirm()}
						>
							{busy ? '处理中…' : confirmLabel}
						</Button>
					</div>
				</DialogPanel>
			</div>
		</Dialog>
	)
}
