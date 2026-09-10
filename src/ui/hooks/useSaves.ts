import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { CheckpointRef, GameSnapshot, SaveCollection, OperationResult } from '../../gameplay'
import { useGameplay } from '../app/useGameplay'
import { playLocation } from '../app/routes'
import { checkpointKey } from '../presentation'

type SavesState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; view: SaveCollection }

interface TruncateTarget {
	profileId: string
	source: CheckpointRef
	removedCount: number
	pinnedCount: number
}

type DeleteTarget =
	| {
			kind: 'checkpoint'
			profileId: string
			source: CheckpointRef
			label: string
			pinned: boolean
	  }
	| {
			kind: 'run'
			profileId: string
			runId: string
			checkpointCount: number
			pinnedCount: number
	  }
	| {
			kind: 'profile'
			profileId: string
			label: string
			runCount: number
			checkpointCount: number
			pinnedCount: number
	  }

type PreviewState =
	| { status: 'loading'; key: string }
	| { status: 'error'; key: string; message: string }
	| { status: 'ready'; key: string; preview: GameSnapshot }

/** 存档交互状态与异步请求生命周期；变更只通过 Gameplay 具名接口。 */
export function useSaves(gameId: string) {
	const services = useGameplay()
	const navigate = useNavigate()
	const [state, setState] = useState<SavesState>({ status: 'loading' })
	const [selectedId, setSelectedId] = useState<string>()
	const [message, setMessage] = useState<string>()
	const [truncateTarget, setTruncateTarget] = useState<TruncateTarget>()
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>()
	const [previewState, setPreviewState] = useState<PreviewState>()
	const [expandedPreviewKey, setExpandedPreviewKey] = useState<string>()
	const previewRequest = useRef(0)

	const listRequest = useRef(0)
	const mounted = useRef(false)
	const pending = useRef(false)
	const [busy, setBusy] = useState(false)

	const load = useCallback(() => {
		const request = ++listRequest.current
		previewRequest.current += 1
		return services.listSaves(gameId).then(
			(view) => {
				if (!mounted.current || request !== listRequest.current) return
				setState({ status: 'ready', view })
				setExpandedPreviewKey(undefined)
				setPreviewState(undefined)
				setSelectedId((current) =>
					current && view.profiles.some((profile) => profile.profileId === current)
						? current
						: view.profiles[0]?.profileId,
				)
			},
			(error: unknown) => {
				if (mounted.current && request === listRequest.current)
					setState({
						status: 'error',
						message: error instanceof Error ? error.message : String(error),
					})
			},
		)
	}, [gameId, services])

	useEffect(() => {
		mounted.current = true
		void load()
		return () => {
			mounted.current = false
			listRequest.current += 1
			previewRequest.current += 1
		}
	}, [load])

	const selected =
		state.status === 'ready'
			? state.view.profiles.find((profile) => profile.profileId === selectedId)
			: undefined

	async function runCommand(
		operation: () => Promise<OperationResult<CheckpointRef | void>>,
		navigateAfter = false,
	): Promise<OperationResult<CheckpointRef | void> | undefined> {
		if (pending.current) return
		pending.current = true
		setBusy(true)
		setMessage(undefined)
		try {
			const result = await operation()
			if (!mounted.current) return result
			if (!result.ok) setMessage(result.message)
			else if (navigateAfter && result.value) navigate(playLocation(result.value.profileId))
			else await load()
			return result
		} catch (error) {
			if (mounted.current) setMessage(error instanceof Error ? error.message : String(error))
		} finally {
			pending.current = false
			if (mounted.current) setBusy(false)
		}
	}

	const truncateSummary = useMemo(
		() =>
			truncateTarget
				? `将永久删除其后的 ${truncateTarget.removedCount} 个检查点，其中 ${truncateTarget.pinnedCount} 个已固定。此操作不可撤销。`
				: '',
		[truncateTarget],
	)
	const deleteDialog = useMemo(() => {
		if (!deleteTarget) return { title: '', description: '', confirmLabel: '删除' }
		if (deleteTarget.kind === 'checkpoint') {
			return {
				title: '删除检查点？',
				description: `将永久删除“${deleteTarget.label}”。${deleteTarget.pinned ? '该检查点已固定，但固定状态不会阻止手动删除。' : '固定状态不会影响手动删除。'}若这是时间线的最后一个检查点，将同时删除该时间线；存档因此为空时也会一并删除。`,
				confirmLabel: '删除检查点',
			}
		}
		if (deleteTarget.kind === 'run') {
			return {
				title: '删除时间线？',
				description: `将永久删除这条时间线及其 ${deleteTarget.checkpointCount} 个检查点，其中 ${deleteTarget.pinnedCount} 个已固定。固定状态不会阻止手动删除；若这是最后一条时间线，将同时删除整个存档。`,
				confirmLabel: '删除时间线',
			}
		}
		return {
			title: '删除存档？',
			description: `将永久删除“${deleteTarget.label}”中的 ${deleteTarget.runCount} 条时间线和 ${deleteTarget.checkpointCount} 个检查点，其中 ${deleteTarget.pinnedCount} 个已固定。固定状态不会阻止手动删除，此操作不可撤销。`,
			confirmLabel: '删除存档',
		}
	}, [deleteTarget])

	function selectProfile(profileId: string): void {
		previewRequest.current += 1
		setExpandedPreviewKey(undefined)
		setPreviewState(undefined)
		setSelectedId(profileId)
	}

	function toggleCheckpointPreview(source: CheckpointRef): void {
		const key = checkpointKey(source)
		if (expandedPreviewKey === key) {
			previewRequest.current += 1
			setExpandedPreviewKey(undefined)
			return
		}

		setExpandedPreviewKey(key)
		if (previewState?.key === key && previewState.status === 'ready') return

		const request = ++previewRequest.current
		setPreviewState({ status: 'loading', key })
		services.getCheckpoint(source).then(
			(preview) => {
				if (mounted.current && previewRequest.current === request) {
					setPreviewState({ status: 'ready', key, preview })
				}
			},
			(error: unknown) => {
				if (mounted.current && previewRequest.current === request) {
					setPreviewState({
						status: 'error',
						key,
						message: error instanceof Error ? error.message : String(error),
					})
				}
			},
		)
	}

	return {
		state,
		selected,
		selectedId,
		message,
		busy,
		services,
		runCommand,
		truncateTarget,
		setTruncateTarget,
		truncateSummary,
		deleteTarget,
		setDeleteTarget,
		deleteDialog,
		previewState,
		expandedPreviewKey,
		selectProfile,
		toggleCheckpointPreview,
	}
}
