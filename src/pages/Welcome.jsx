// src/pages/Welcome.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'

export default function Welcome() {
  const navigate = useNavigate()
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    // Supabase lands here with a session after email confirmation
    // onAuthStateChange in initAuth will pick it up automatically
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer)
          navigate('/home', { replace: true })
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div style={styles.shell}>
      <div style={styles.blob1} />
      <div style={styles.blob2} />

      <motion.div
        style={styles.card}
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          style={styles.icon}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 18 }}
        >
          🎬
        </motion.div>

        <motion.div style={styles.logo} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          MUAD'FILM
        </motion.div>

        <motion.h1 style={styles.heading} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          You're in.
        </motion.h1>

        <motion.p style={styles.body} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          Thanks for confirming your email. Your account is ready — time to build your taste graph.
        </motion.p>

        <motion.div style={styles.footer} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
          <span style={styles.countdownText}>Taking you in </span>
          <motion.span
            key={countdown}
            style={styles.countdownNum}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {countdown}
          </motion.span>
          <span style={styles.countdownText}>…</span>
        </motion.div>

        <motion.button
          style={styles.btn}
          onClick={() => navigate('/home', { replace: true })}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
        >
          Let's go →
        </motion.button>
      </motion.div>
    </div>
  )
}

// Inline styles so this works without the CSS module
// Feel free to move these into Welcome.module.css
const styles = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0a0f',
    fontFamily: 'inherit',
    position: 'relative',
    overflow: 'hidden',
  },
  blob1: {
    position: 'absolute', top: '-20%', left: '-10%',
    width: '500px', height: '500px', borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(99,60,180,0.18) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  blob2: {
    position: 'absolute', bottom: '-20%', right: '-10%',
    width: '500px', height: '500px', borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(180,60,100,0.14) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '20px',
    padding: '48px 40px',
    width: '100%', maxWidth: '400px',
    textAlign: 'center',
    backdropFilter: 'blur(12px)',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '12px',
    display: 'block',
  },
  logo: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.22em',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: '20px',
    textTransform: 'uppercase',
  },
  heading: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 12px',
    letterSpacing: '-0.02em',
  },
  body: {
    fontSize: '15px',
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.6,
    margin: '0 0 32px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    marginBottom: '20px',
  },
  countdownText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.3)',
  },
  countdownNum: {
    display: 'inline-block',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.5)',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '10px',
  },
  btn: {
    width: '100%',
    padding: '13px',
    background: '#fff',
    color: '#0a0a0f',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.01em',
  },
}
