// src/pages/Auth.jsx
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useStore from '../lib/store'
import styles from './Auth.module.css'

export default function Auth() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialMode = params.get('mode') === 'signup' ? 'signup' : 'login'

  const [mode, setMode] = useState(initialMode)
  const [email, setEmail]           = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword]     = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [loading, setLoading]       = useState(false)
  const [localError, setLocalError] = useState(null)

  const { login, signup, authError, clearAuthError, currentUser, onboardingDone } = useStore()

  // Redirect if already logged in
  useEffect(() => {
    if (currentUser) {
      navigate(onboardingDone ? '/home' : '/onboarding', { replace: true })
    }
  }, [currentUser])

  useEffect(() => {
    clearAuthError()
    setLocalError(null)
  }, [mode])

  const error = localError || authError

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLocalError(null)
    clearAuthError()

    if (mode === 'signup') {
      if (!displayName.trim()) return setLocalError('Please enter a display name.')
      if (password.length < 6) return setLocalError('Password must be at least 6 characters.')
      if (password !== confirmPw) return setLocalError('Passwords do not match.')
    }

    setLoading(true)
    await new Promise(r => setTimeout(r, 600)) // mock latency

    let success
    if (mode === 'login') {
      success = login(email, password)
    } else {
      success = signup(email, displayName.trim(), password)
    }

    setLoading(false)

    if (success) {
      navigate(mode === 'signup' ? '/onboarding' : '/home', { replace: true })
    }
  }

  return (
    <div className={styles.shell}>
      {/* Ambient background blobs */}
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      <div className={styles.logo} onClick={() => navigate('/')}>MUAD'FILM</div>

      <div className={styles.card}>
        {/* Mode tabs */}
        <div className={styles.tabs}>
          {['login', 'signup'].map(m => (
            <button
              key={m}
              className={`${styles.tab} ${mode === m ? styles.tabActive : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
          <motion.div
            className={styles.tabIndicator}
            animate={{ x: mode === 'login' ? 0 : '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          />
        </div>

        <AnimatePresence mode="wait">
          <motion.form
            key={mode}
            className={styles.form}
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div
                  className={styles.field}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <label className={styles.label}>Display name</label>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="How you'll appear"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    required
                    autoFocus
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus={mode === 'login'}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Password</label>
              <input
                className={styles.input}
                type="password"
                placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div
                  className={styles.field}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <label className={styles.label}>Confirm password</label>
                  <input
                    className={styles.input}
                    type="password"
                    placeholder="Same again"
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    required
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.p
                  className={styles.error}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button className={styles.submit} type="submit" disabled={loading}>
              {loading
                ? <span className={styles.spinner} />
                : mode === 'login' ? 'Sign in →' : 'Create account →'
              }
            </button>

            {mode === 'login' && (
              <p className={styles.switchHint}>
                No account?{' '}
                <button type="button" className={styles.switchLink} onClick={() => setMode('signup')}>
                  Create one
                </button>
              </p>
            )}
          </motion.form>
        </AnimatePresence>
      </div>

      <p className={styles.footnote}>
        This is a demo app. No real authentication is used.
      </p>
    </div>
  )
}
