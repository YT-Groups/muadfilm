// src/components/RatePrompt.jsx
// Drop this into Home.jsx — it watches for a "now playing" item and surfaces
// a floating prompt after PROMPT_DELAY ms asking the user to react.

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useStore from '../lib/store'
import { posterUrl } from '../lib/tmdb'
import styles from './RatePrompt.module.css'

const PROMPT_DELAY = 45_000 // 45 seconds

const REACTIONS = [
  { id: 'loved',    emoji: '🔥', label: 'Loved it' },
  { id: 'liked',    emoji: '👍', label: 'Liked it' },
  { id: 'mid',      emoji: '😐', label: 'It was okay' },
  { id: 'abandoned',emoji: '💀', label: 'Stopped watching' },
]

export default function RatePrompt({ nowPlaying, onDismiss }) {
  const [visible, setVisible]   = useState(false)
  const [reacted, setReacted]   = useState(false)
  const [chosen, setChosen]     = useState(null)
  const timer = useRef(null)
  const { markWatched } = useStore()

  useEffect(() => {
    if (!nowPlaying) { setVisible(false); return }
    clearTimeout(timer.current)
    setReacted(false)
    setChosen(null)
    timer.current = setTimeout(() => setVisible(true), PROMPT_DELAY)
    return () => clearTimeout(timer.current)
  }, [nowPlaying?.id])

  const handleReaction = (reaction) => {
    setChosen(reaction)
    setReacted(true)
    markWatched(nowPlaying, reaction.id)
    setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, 1400)
  }

  const handleDismiss = () => {
    setVisible(false)
    onDismiss?.()
  }

  if (!nowPlaying) return null

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.prompt}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        >
          <button className={styles.close} onClick={handleDismiss}>✕</button>

          <div className={styles.header}>
            {nowPlaying.poster_path && (
              <img
                src={posterUrl(nowPlaying.poster_path, 'w92')}
                alt={nowPlaying.title}
                className={styles.poster}
              />
            )}
            <div>
              <p className={styles.eyebrow}>Still watching?</p>
              <p className={styles.title}>{nowPlaying.title || nowPlaying.name}</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {reacted ? (
              <motion.div
                key="thanks"
                className={styles.thanks}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className={styles.thanksEmoji}>{chosen.emoji}</span>
                <span className={styles.thanksText}>{chosen.label} — noted.</span>
              </motion.div>
            ) : (
              <motion.div
                key="reactions"
                className={styles.reactions}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {REACTIONS.map((r, i) => (
                  <motion.button
                    key={r.id}
                    className={styles.reaction}
                    onClick={() => handleReaction(r)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <span className={styles.reactionEmoji}>{r.emoji}</span>
                    <span className={styles.reactionLabel}>{r.label}</span>
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
