// src/router.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import useStore from './lib/store'
import Auth       from './pages/Auth'
import Onboarding from './components/onboarding/Onboarding'
import Home       from './pages/Home'
import Profile    from './pages/Profile'
import Watchlist  from './pages/Watchlist'
import Search     from './pages/Search'
import BottomNav  from './components/BottomNav'
import Welcome from './pages/Welcome'

function ProtectedRoute({ children }) {
  const { currentUser, onboardingDone } = useStore()
  if (!currentUser) return <Navigate to="/auth" replace />
  if (!onboardingDone) return <Navigate to="/onboarding" replace />
  return children
}

function GuestRoute({ children }) {
  const { currentUser, onboardingDone } = useStore()
  if (currentUser) return <Navigate to={onboardingDone ? '/home' : '/onboarding'} replace />
  return children
}

function OnboardingRoute({ children }) {
  const { currentUser, onboardingDone } = useStore()
  if (!currentUser) return <Navigate to="/auth" replace />
  if (onboardingDone) return <Navigate to="/home" replace />
  return children
}

function RootRedirect() {
  const { currentUser, onboardingDone } = useStore()
  if (!currentUser) return <Navigate to="/auth" replace />
  if (!onboardingDone) return <Navigate to="/onboarding" replace />
  return <Navigate to="/home" replace />
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"           element={<RootRedirect />} />
        <Route path="/auth"       element={<GuestRoute><Auth /></GuestRoute>} />
        <Route path="/onboarding" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
        <Route path="/home"       element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/profile"    element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/watchlist"  element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
        <Route path="/search"     element={<ProtectedRoute><Search /></ProtectedRoute>} />
        <Route path="*"           element={<Navigate to="/" replace />} />
        <Route path="/welcome"    element={<Welcome />} />
      </Routes>
      <BottomNav />
    </BrowserRouter>
  )
}