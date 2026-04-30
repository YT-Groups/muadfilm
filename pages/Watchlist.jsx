// src/pages/Watchlist.jsx
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import useStore from '../lib/store'
import { posterUrl } from '../lib/tmdb'
import MovieModal from '../components/MovieModal'
import styles from './Watchlist.module.css'

const REACTIONS = [
  { id: 'loved',    emoji: '🔥', label: 'Loved it' },
  { id: 'liked',    emoji: '👍', label: 'Liked it' },
  { id: 'mid',      emoji: '😐', label: 'Okay' },
  { id: 'abandoned', emoji: '💀', label: 'Dropped it' },
]

export default function Watchlist() {
  const navigate = useNavigate()
  const {
    watchlist, removeFromWatchlist,
    markWatched, updateReaction, isWatched, getReaction,
    currentUser,
  } = useStore()

  const [selectedItem, setSelectedItem] = useState(null)
  const [filter, setFilter]             = useState('all') // 'all' | 'unwatched' | 'watched'
  const [ratingItem, setRatingItem]     = useState(null)  // item currently being rated inline

  const displayed = filter === 'unwatched'
    ? watchlist.filter(i => !isWatched(i.id))
    : filter === 'watched'
      ? watchlist.filter(i => isWatched(i.id))
      : watchlist

  const handleMarkWatched = (item) => {
    markWatched(item, null)
    // Open inline rating immediately after marking
    setRatingItem(item.id)
  }

  const handleRate = (item, reaction) => {
    if (isWatched(item.id)) {
      updateReaction(item.id, reaction)
    } else {
      markWatched(item, reaction)
    }
    setRatingItem(null)
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <button className={styles.navBack} onClick={() => navigate('/home')}>← Home</button>
        <span className={styles.navLogo}>MUAD'FILM</span>
        <div className={styles.navRight}>
          <button className={styles.navAvatar} onClick={() => navigate('/profile')}>
            {currentUser?.displayName?.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </nav>

      <div className={styles.content}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.pageTitle}>Watchlist</h1>
            <p className={styles.pageSub}>{watchlist.length} {watchlist.length === 1 ? 'film' : 'films'} saved</p>
          </div>
          <div className={styles.filters}>
            {[['all', 'All'], ['unwatched', 'Unwatched'], ['watched', 'Watched']].map(([val, label]) => (
              <button
                key={val}
                className={`${styles.filterBtn} ${filter === val ? styles.filterBtnActive : ''}`}
                onClick={() => setFilter(val)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {displayed.length === 0 && (
          <motion.div className={styles.empty} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <p className={styles.emptyTitle}>
              {filter === 'unwatched' ? 'All caught up' : filter === 'watched' ? 'Nothing watched yet' : 'Nothing here yet'}
            </p>
            <p className={styles.emptySub}>
              {filter === 'all' ? 'Hit + on any film to save it for later.' : 'Switch filters to see more.'}
            </p>
            {filter === 'all' && (
              <button className={styles.emptyBtn} onClick={() => navigate('/home')}>Browse films →</button>
            )}
          </motion.div>
        )}

        <div className={styles.grid}>
          <AnimatePresence>
            {displayed.map((item, i) => (
              <WatchlistCard
                key={item.id}
                item={item}
                index={i}
                watched={isWatched(item.id)}
                reaction={getReaction(item.id)}
                ratingOpen={ratingItem === item.id}
                onOpen={() => setSelectedItem(item)}
                onRemove={() => removeFromWatchlist(item.id)}
                onMarkWatched={() => handleMarkWatched(item)}
                onRate={(reaction) => handleRate(item, reaction)}
                onToggleRating={() => setRatingItem(ratingItem === item.id ? null : item.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {selectedItem && (
          <MovieModal item={selectedItem} onClose={() => setSelectedItem(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

function WatchlistCard({ item, index, watched, reaction, ratingOpen, onOpen, onRemove, onMarkWatched, onRate, onToggleRating }) {
  const [hovered, setHovered] = useState(false)
  const title = item.title || item.name
  const year  = (item.release_date || item.first_air_date || '').slice(0, 4)
  const added = item.addedAt
    ? new Date(item.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''

  const currentReaction = REACTIONS.find(r => r.id === reaction)

  return (
    <motion.div
      className={styles.card}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
    >
      <div className={styles.cardPoster} onClick={onOpen}>
        {item.poster_path
          ? <img src={posterUrl(item.poster_path)} alt={title} className={styles.cardImg} loading="lazy" />
          : <div className={styles.cardFallback}>{title?.slice(0, 2)}</div>
        }
        <AnimatePresence>
          {hovered && (
            <motion.div className={styles.cardHover} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className={styles.cardHoverText}>View details</span>
            </motion.div>
          )}
        </AnimatePresence>
        {watched && (
          <div className={styles.watchedBadge}>
            {currentReaction ? currentReaction.emoji : '✓'}
          </div>
        )}
      </div>

      <div className={styles.cardMeta}>
        <div className={styles.cardMetaTop}>
          <span className={styles.cardTitle}>{title}</span>
          <span className={styles.cardYear}>{year}</span>
        </div>
        {added && <span className={styles.cardAdded}>Added {added}</span>}

        {/* Inline rating panel */}
        <AnimatePresence>
          {ratingOpen && (
            <motion.div
              className={styles.ratingPanel}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <p className={styles.ratingLabel}>How was it?</p>
              <div className={styles.ratingBtns}>
                {REACTIONS.map(r => (
                  <button
                    key={r.id}
                    className={`${styles.ratingBtn} ${reaction === r.id ? styles.ratingBtnActive : ''}`}
                    onClick={() => onRate(r.id)}
                    title={r.label}
                  >
                    <span>{r.emoji}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.cardActions}>
          <button className={styles.cardActionBtn} onClick={onOpen}>Details</button>
          {!watched
            ? <button className={styles.cardActionBtn} onClick={onMarkWatched}>Mark watched</button>
            : <button className={`${styles.cardActionBtn} ${ratingOpen ? styles.cardActionBtnActive : ''}`} onClick={onToggleRating}>
                {currentReaction ? `${currentReaction.emoji} Rate` : 'Rate'}
              </button>
          }
          <button className={`${styles.cardActionBtn} ${styles.cardActionRemove}`} onClick={onRemove}>Remove</button>
        </div>
      </div>
    </motion.div>
  )
}