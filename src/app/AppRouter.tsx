import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import {
	GameMenuPage,
	GamesPage,
	NewGamePage,
	PlayPage,
	ResultPage,
	SavesPage,
} from '../ui/pages'
import { AppServicesProvider } from './AppServicesProvider'

export function AppRouter() {
	return (
		<AppServicesProvider>
			<BrowserRouter basename={import.meta.env.BASE_URL}>
				<Routes>
					<Route path="/games" element={<GamesPage />} />
					<Route path="/games/:gameId" element={<GameMenuPage />} />
					<Route path="/games/:gameId/new" element={<NewGamePage />} />
					<Route path="/games/:gameId/saves" element={<SavesPage />} />
					<Route path="/play/:profileId" element={<PlayPage />} />
					<Route path="/result/:profileId/:runId/:turnId" element={<ResultPage />} />
					<Route path="*" element={<Navigate to="/games" replace />} />
				</Routes>
			</BrowserRouter>
		</AppServicesProvider>
	)
}
