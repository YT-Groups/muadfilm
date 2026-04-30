// src/App.jsx
import { useEffect } from 'react'
import useStore from './lib/store'
import AppRouter from './router'
import './styles/globals.css'

export default function App() {
  const { initAuth, authLoading } = useStore()

  useEffect(() => { initAuth() }, [])

  if (authLoading) return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--void)', fontFamily: 'var(--font-mono)',
      fontSize: '11px', letterSpacing: '0.3em', color: 'var(--muted)'
    }}>
      MUAD'FILM
    </div>
  )

  return <AppRouter />
}