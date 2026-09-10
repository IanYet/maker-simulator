import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

const ArtsPage = lazy(() =>
	import('../pages/ArtsPage').then(({ ArtsPage }) => ({ default: ArtsPage })),
)
const GameLayout = lazy(() => import('./GameLayout'))
const GamesPage = lazy(() =>
	import('../pages/GamesPage').then(({ GamesPage }) => ({ default: GamesPage })),
)
const GameMenuPage = lazy(() =>
	import('../pages/GameMenuPage').then(({ GameMenuPage }) => ({ default: GameMenuPage })),
)
const NewGamePage = lazy(() =>
	import('../pages/NewGamePage').then(({ NewGamePage }) => ({ default: NewGamePage })),
)
const SavesPage = lazy(() =>
	import('../pages/SavesPage').then(({ SavesPage }) => ({ default: SavesPage })),
)
const PlayPage = lazy(() =>
	import('../pages/PlayPage').then(({ PlayPage }) => ({ default: PlayPage })),
)
const ResultPage = lazy(() =>
	import('../pages/ResultPage').then(({ ResultPage }) => ({ default: ResultPage })),
)

/** 应用路由表；页面通过 profile/run/turn 参数恢复精确存档位置。 */
export function AppRouter() {
	return (
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<Suspense fallback={null}>
				<Routes>
					<Route path="/arts" element={<ArtsPage />} />
					<Route element={<GameLayout />}>
						<Route path="/games" element={<GamesPage />} />
						<Route path="/games/:gameId" element={<GameMenuPage />} />
						<Route path="/games/:gameId/new" element={<NewGamePage />} />
						<Route path="/games/:gameId/saves" element={<SavesPage />} />
						<Route path="/play/:profileId" element={<PlayPage />} />
						<Route path="/result/:profileId/:runId/:turnId" element={<ResultPage />} />
					</Route>
					<Route path="*" element={<Navigate to="/games" replace />} />
				</Routes>
			</Suspense>
		</BrowserRouter>
	)
}
