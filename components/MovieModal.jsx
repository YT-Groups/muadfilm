// src/components/MovieModal.jsx
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useStore from '../lib/store'
import { getMovie, getTvShow, posterUrl, backdropUrl, profileUrl, GENRE_MAP } from '../lib/tmdb'
import useTrailer from '../hooks/useTrailer'
import useYouTubePlayer from '../hooks/useYouTubePlayer'
import styles from './MovieModal.module.css'

const REACTIONS = [
  { id: 'loved',    emoji: '🔥', label: 'Loved it' },
  { id: 'liked',    emoji: '👍', label: 'Liked it' },
  { id: 'mid',      emoji: '😐', label: 'Okay' },
  { id: 'abandoned', emoji: '💀', label: 'Dropped it' },
]

const MODAL_TRAILER_DELAY = 1800

export default function MovieModal({ item, onClose, onWatch }) {
  const [details, setDetails]           = useState(null)
  const [loading, setLoading]           = useState(true)
  const [ratingDone, setRatingDone]     = useState(false)
  const [trailerArmed, setTrailerArmed] = useState(false)
  const [playerReady, setPlayerReady]   = useState(false)
  const [muted, setMuted]               = useState(true)
  const [trailerEnded, setTrailerEnded] = useState(false)
  const armTimer = useRef(null)

  const {
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    markWatched, updateReaction, isWatched, watched,
    enrichAndLearn,
  } = useStore()

  const inWatchlist      = item ? isInWatchlist(item.id) : false
  const alreadyWatched   = item ? isWatched(item.id) : false
  const existingReaction = watched.find(w => w.id === item?.id)?.reaction || null

  useEffect(() => {
    armTimer.current = setTimeout(() => setTrailerArmed(true), MODAL_TRAILER_DELAY)
    return () => clearTimeout(armTimer.current)
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Fetch full details — then enrich taste graph with keywords/tones
  useEffect(() => {
    if (!item) return
    setLoading(true)
    setDetails(null)
    const fetcher = item.media_type === 'tv' ? getTvShow : getMovie
    fetcher(item.id)
      .then(data => {
        setDetails(data)
        // Fire enrichAndLearn after details load so every modal open
        // contributes keyword → tone inference to the taste graph
        enrichAndLearn(item, data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [item?.id])

  const { trailerKey } = useTrailer(trailerArmed ? item : null)
  const containerId    = `yt-modal-${item?.id}`

  const playerRef = useYouTubePlayer({
    containerId,
    videoId:  trailerKey,
    muted:    true,
    enabled:  !!trailerKey && trailerArmed,
    onReady:  () => setPlayerReady(true),
    onEnded:  () => setTrailerEnded(true),
  })

  useEffect(() => {
    const p = playerRef.current
    if (!p || !playerReady) return
    try { muted ? p.mute() : p.unMute() } catch {}
  }, [muted, playerReady])

  const handleReaction = (reaction) => {
    if (alreadyWatched) {
      updateReaction(item.id, reaction.id)
    } else {
      markWatched(item, reaction.id)
    }
    setRatingDone(true)
    setTimeout(() => setRatingDone(false), 2000)
  }

  if (!item) return null

  const title    = details?.title || details?.name || item.title || item.name
  const year     = (details?.release_date || details?.first_air_date || item.release_date || item.first_air_date || '').slice(0, 4)
  const runtime  = details?.runtime ? `${details.runtime}m` : details?.episode_run_time?.[0] ? `${details.episode_run_time[0]}m/ep` : null
  const rating   = details?.vote_average ? details.vote_average.toFixed(1) : null
  const overview = details?.overview || item.overview || ''
  const genres   = (details?.genres || []).map(g => g.name)
  const director = details?.credits?.crew?.find(c => c.job === 'Director')
  const cast     = (details?.credits?.cast || []).slice(0, 8)
  const backdrop = details?.backdrop_path || item.backdrop_path
  const poster   = details?.poster_path   || item.poster_path

  const trailerLive = trailerArmed && !!trailerKey && playerReady && !trailerEnded

  return (
    <AnimatePresence>
      <motion.div
        className={styles.overlay}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          className={styles.modal}
          initial={{ opacity: 0, y: 48, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {/* ── Header ── */}
          <div className={styles.backdropWrap}>
            {backdrop && (
              <img
                src={backdropUrl(backdrop)}
                alt=""
                className={styles.backdropImg}
                style={{ opacity: trailerLive ? 0 : 1, transition: 'opacity 0.8s ease' }}
              />
            )}

            {trailerArmed && (
              <div className={`${styles.trailerWrap} ${playerReady && !trailerEnded ? styles.trailerVisible : ''}`}>
                <div id={containerId} className={styles.ytTarget} />
              </div>
            )}

            <div className={styles.backdropGradient} />

            <div className={styles.headerControls}>
              {trailerLive && (
                <button className={styles.muteBtn} onClick={() => setMuted(m => !m)}>
                  {muted ? '🔇' : '🔊'}
                </button>
              )}
              <button className={styles.closeBtn} onClick={onClose}>✕</button>
            </div>

            <div className={styles.backdropActions}>
              {onWatch && (
                <button className={styles.watchBtn} onClick={onWatch}>▶ Watch now</button>
              )}
              <button
                className={`${styles.watchlistBtn} ${inWatchlist ? styles.watchlistBtnActive : ''}`}
                onClick={() => inWatchlist ? removeFromWatchlist(item.id) : addToWatchlist(item)}
              >
                {inWatchlist ? '✓ Saved' : '+ Watchlist'}
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className={styles.body}>
            <div className={styles.bodyInner}>
              <div className={styles.posterCol}>
                {poster
                  ? <img src={posterUrl(poster)} alt={title} className={styles.poster} />
                  : <div className={styles.posterFallback}>{title?.slice(0, 2)}</div>
                }
              </div>

              <div className={styles.infoCol}>
                {loading ? (
                  <LoadingSkeleton />
                ) : (
                  <>
                    <div className={styles.titleRow}>
                      <h1 className={styles.title}>{title}</h1>
                      {alreadyWatched && <span className={styles.watchedPill}>✓ Watched</span>}
                    </div>

                    <div className={styles.metaRow}>
                      {year     && <span className={styles.metaChip}>{year}</span>}
                      {runtime  && <span className={styles.metaChip}>{runtime}</span>}
                      {rating   && <span className={styles.metaChip}>★ {rating}</span>}
                      {director && <span className={styles.metaChip}>Dir. {director.name}</span>}
                    </div>

                    {genres.length > 0 && (
                      <div className={styles.genreRow}>
                        {genres.map(g => (
                          <span key={g} className={styles.genreTag}>{g}</span>
                        ))}
                      </div>
                    )}

                    <p className={styles.overview}>{overview || 'No synopsis available.'}</p>

                    {cast.length > 0 && (
                      <div className={styles.castSection}>
                        <p className={styles.castLabel}>Cast</p>
                        <div className={styles.castScroll}>
                          {cast.map(actor => (
                            <div key={actor.id} className={styles.castMember}>
                              {actor.profile_path
                                ? <img src={profileUrl(actor.profile_path)} alt={actor.name} className={styles.castImg} />
                                : <div className={styles.castImgFallback}>{actor.name?.slice(0,1)}</div>
                              }
                              <span className={styles.castName}>{actor.name}</span>
                              <span className={styles.castChar}>{actor.character}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={styles.rateSection}>
                      <p className={styles.rateLabel}>
                        {alreadyWatched ? 'Your rating' : 'Rate this film'}
                      </p>
                      <AnimatePresence mode="wait">
                        {ratingDone ? (
                          <motion.p
                            key="done"
                            className={styles.rateDone}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                          >
                            Saved ✓
                          </motion.p>
                        ) : (
                          <motion.div key="btns" className={styles.rateButtons} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            {REACTIONS.map(r => (
                              <button
                                key={r.id}
                                className={`${styles.rateBtn} ${existingReaction === r.id ? styles.rateBtnActive : ''}`}
                                onClick={() => handleReaction(r)}
                                title={r.label}
                              >
                                <span className={styles.rateBtnEmoji}>{r.emoji}</span>
                                <span className={styles.rateBtnLabel}>{r.label}</span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function LoadingSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={`${styles.skLine} ${styles.skTitle}`} />
      <div className={`${styles.skLine} ${styles.skMeta}`} />
      <div className={`${styles.skLine} ${styles.skBody}`} />
      <div className={`${styles.skLine} ${styles.skBody}`} />
      <div className={`${styles.skLine} ${styles.skBodyShort}`} />
    </div>
  )
}