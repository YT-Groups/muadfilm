// src/pages/Auth.jsx
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useStore from '../lib/store'
import { isSupabaseEnabled } from '../lib/supabase'
import styles from './Auth.module.css'

export default function Auth() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialMode = params.get('mode') === 'signup' ? 'signup' : 'login'

  const [mode, setMode]               = useState(initialMode)
  const [email, setEmail]             = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPw, setConfirmPw]     = useState('')
  const [loading, setLoading]         = useState(false)
  const [localError, setLocalError]   = useState(null)
  const [resetSent, setResetSent]     = useState(false)
  const [showReset, setShowReset]     = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false) // ← new

  const { login, signup, authError, clearAuthError, currentUser, onboardingDone, sendPasswordReset } = useStore()

  useEffect(() => {
    if (currentUser) navigate(onboardingDone ? '/home' : '/onboarding', { replace: true })
  }, [currentUser])

  useEffect(() => { clearAuthError(); setLocalError(null); setShowReset(false); setConfirmationSent(false) }, [mode])

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
    const success = mode === 'login'
      ? await login(email, password)
      : await signup(email, displayName.trim(), password)
    setLoading(false)

    if (success) {
      if (!isSupabaseEnabled) {
        navigate(mode === 'signup' ? '/onboarding' : '/home', { replace: true })
      } else if (mode === 'signup') {
        setConfirmationSent(true) // ← show check-your-email screen
      }
      // login: onAuthStateChange handles the redirect
    }
  }

  const handlePasswordReset = async () => {
    if (!email) return setLocalError('Enter your email address first.')
    setLoading(true)
    const r = await sendPasswordReset(email)
    setLoading(false)
    if (r.error) setLocalError(r.error)
    else setResetSent(true)
  }

  // ── Confirmation screen ───────────────────────────────────────────────────────
  if (confirmationSent) {
    return (
      <div className={styles.shell}>
        <div className={styles.blob1} />
        <div className={styles.blob2} />
        <div className={styles.logo}>MUAD'FILM</div>
        <motion.div className={styles.card} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <p className={styles.confirmIcon}>📬</p>
          <h2 className={styles.confirmTitle}>Check your email</h2>
          <p className={styles.confirmBody}>
            We sent a confirmation link to <strong>{email}</strong>.<br />
            Click it to activate your account and get started.
          </p>
          <button className={styles.switchLink} type="button" onClick={() => { setConfirmationSent(false); setMode('login') }}>
            Back to sign in
          </button>
        </motion.div>
        <p className={styles.footnote}>Secured by Supabase.</p>
      </div>
    )
  }

  // ── Main auth form ────────────────────────────────────────────────────────────
  return (
    <div className={styles.shell}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />
      <div className={styles.logo}>MUAD'FILM</div>

      {!isSupabaseEnabled && (
        <div className={styles.demoBanner}>
          Demo mode — no real auth. Your data is stored locally.
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.tabs}>
          {['login', 'signup'].map(m => (
            <button key={m} className={`${styles.tab} ${mode === m ? styles.tabActive : ''}`} onClick={() => setMode(m)}>
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
          <motion.div className={styles.tabIndicator} animate={{ x: mode === 'login' ? 0 : '100%' }} transition={{ type: 'spring', stiffness: 400, damping: 35 }} />
        </div>

        <AnimatePresence mode="wait">
          <motion.form key={mode} className={styles.form} onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>

            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div className={styles.field} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
                  <label className={styles.label}>Display name</label>
                  <input className={styles.input} type="text" placeholder="How you'll appear" value={displayName} onChange={e => setDisplayName(e.target.value)} required autoFocus />
                </motion.div>
              )}
            </AnimatePresence>

            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input className={styles.input} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required autoFocus={mode === 'login'} />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Password</label>
              <input className={styles.input} type="password" placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'} value={password} onChange={e => setPassword(e.target.value)} required />
            </div>

            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div className={styles.field} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
                  <label className={styles.label}>Confirm password</label>
                  <input className={styles.input} type="password" placeholder="Same again" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.p className={styles.error} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {error}
                </motion.p>
              )}
              {resetSent && (
                <motion.p className={styles.success} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  Password reset email sent — check your inbox.
                </motion.p>
              )}
            </AnimatePresence>

            <button className={styles.submit} type="submit" disabled={loading}>
              {loading ? <span className={styles.spinner} /> : mode === 'login' ? 'Sign in →' : 'Create account →'}
            </button>

            {mode === 'login' && isSupabaseEnabled && !showReset && (
              <button type="button" className={styles.forgotLink} onClick={() => setShowReset(true)}>
                Forgot password?
              </button>
            )}

            <AnimatePresence>
              {showReset && (
                <motion.div className={styles.resetRow} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <p className={styles.resetHint}>We'll send a reset link to the email above.</p>
                  <button type="button" className={styles.resetBtn} onClick={handlePasswordReset} disabled={loading}>
                    Send reset email
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {mode === 'login' && (
              <p className={styles.switchHint}>
                No account?{' '}
                <button type="button" className={styles.switchLink} onClick={() => setMode('signup')}>Create one</button>
              </p>
            )}
          </motion.form>
        </AnimatePresence>
      </div>
      <p className={styles.footnote}>{isSupabaseEnabled ? 'Secured by Supabase.' : 'Demo mode — local auth only.'}</p>
    </div>
  )
}