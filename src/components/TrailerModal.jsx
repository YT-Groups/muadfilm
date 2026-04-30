// src/components/TrailerModal.jsx
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useTrailer from '../hooks/useTrailer'
import useYouTubePlayer from '../hooks/useYouTubePlayer'
import styles from './TrailerModal.module.css'

export default function TrailerModal({ item, onClose }) {
  const [playerReady, setPlayerReady] = useState(false)
  const [muted, setMuted]             = useState(false)
  const { trailerKey, loading }       = useTrailer(item)
  const containerId                   = `yt-trailer-${item?.id}`
  const playerRef = useYouTubePlayer({
    containerId, videoId: trailerKey, muted: false, enabled: !!trailerKey,
    onReady: () => setPlayerReady(true),
    onEnded: onClose,
  })

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = '' }
  }, [onClose])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !playerReady) return
    try { muted ? p.mute() : p.unMute() } catch {}
  }, [muted, playerReady])

  const title = item?.title || item?.name

  return (
    <AnimatePresence>
      <motion.div
        className={styles.overlay}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          className={styles.modal}
          initial={{ opacity: 0, scale: 0.95, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 12 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className={styles.header}>
            <span className={styles.title}>{title}</span>
            <div className={styles.controls}>
              {playerReady && (
                <button className={styles.muteBtn} onClick={() => setMuted(m => !m)}>
                  {muted ? '🔇' : '🔊'}
                </button>
              )}
              <button className={styles.closeBtn} onClick={onClose}>✕</button>
            </div>
          </div>

          <div className={styles.playerWrap}>
            {loading && !trailerKey && (
              <div className={styles.placeholder}>
                <span className={styles.placeholderText}>Loading trailer...</span>
              </div>
            )}
            {!loading && !trailerKey && (
              <div className={styles.placeholder}>
                <span className={styles.placeholderText}>No trailer available</span>
              </div>
            )}
            <div id={containerId} className={styles.ytTarget} />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
