// src/pages/Home.jsx
import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import useStore from '../lib/store'
import { getTrendingMovies, discoverMovies, posterUrl, backdropUrl, GENRE_MAP, GENRE_ID_MAP } from '../lib/tmdb'
import { scoreContent, diversifyShelf } from '../engine/recommender'
import useLearningLoop from '../hooks/useLearningLoop'
import MovieModal from '../components/MovieModal'
import RatePrompt from '../components/RatePrompt'
import TrailerModal from '../components/TrailerModal'
import styles from './Home.module.css'

const SHELF_LABELS = {
  your_list:   'Your list',
  for_you:     'Curated for you',
  mood_match:  'Right now',
  hidden_gems: 'Hidden gems',
  trending:    'Trending',
}

export default function Home() {
  const navigate = useNavigate()
  const {
    tasteGraph, recordWatchEvent,
    currentUser, logout, onboardingDone,
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    markWatched, isWatched, watchlist,
  } = useStore()

  const [heroFilms, setHeroFilms]         = useState([])
  const [heroIndex, setHeroIndex]         = useState(0)
  const [shelves, setShelves]             = useState({})
  const [loading, setLoading]             = useState(true)
  const [selectedItem, setSelectedItem]   = useState(null)
  const [trailerItem, setTrailerItem]     = useState(null)
  const [nowPlaying, setNowPlaying]       = useState(null)
  const [showUserMenu, setShowUserMenu]   = useState(false)

  const heroIndexRef = useRef(0)
  const heroFilmsRef = useRef([])
  const hasLoadedRef = useRef(false)
  const slideTimer   = useRef(null)

  useLearningLoop()

  useEffect(() => {
    if (!currentUser) navigate('/auth', { replace: true })
    else if (!onboardingDone) navigate('/onboarding', { replace: true })
  }, [currentUser, onboardingDone])

  useEffect(() => {
    if (!currentUser || !onboardingDone) return
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    loadContent()
  }, [currentUser, onboardingDone])

  useEffect(() => { heroIndexRef.current = heroIndex }, [heroIndex])
  useEffect(() => { heroFilmsRef.current = heroFilms }, [heroFilms])

  // Auto-advance hero every 8s
  useEffect(() => {
    if (!heroFilms.length) return
    slideTimer.current = setInterval(() => {
      setHeroIndex(i => (i + 1) % heroFilmsRef.current.length)
    }, 8000)
    return () => clearInterval(slideTimer.current)
  }, [heroFilms.length])

  const goToSlide = (index) => {
    clearInterval(slideTimer.current)
    setHeroIndex(index)
    slideTimer.current = setInterval(() => {
      setHeroIndex(i => (i + 1) % heroFilmsRef.current.length)
    }, 8000)
  }

  const loadContent = async () => {
    setLoading(true)
    try {
      const graph    = useStore.getState().tasteGraph
      const language = graph?.language || 'en'

      const topGenreIds = graph
        ? Object.entries(graph.genre_weights)
            .filter(([g]) => g !== 'documentary')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4).map(([g]) => GENRE_ID_MAP[g]).filter(Boolean)
        : []

      const eraFilter = (() => {
        const pref = graph?.era_preference
        if (!pref || pref === 'any') return { 'primary_release_date.gte': '2000-01-01' }
        if (pref === 'classic') return { 'primary_release_date.lte': '1990-12-31', 'primary_release_date.gte': '1950-01-01' }
        if (pref === 'retro')   return { 'primary_release_date.lte': '2005-12-31', 'primary_release_date.gte': '1990-01-01' }
        if (pref === 'modern')  return { 'primary_release_date.gte': '2010-01-01' }
        return {}
      })()

      const [trendingData, primaryGenreData, qualityData, deepCutData] = await Promise.all([
        getTrendingMovies(language),
        topGenreIds.length
          ? discoverMovies({ with_genres: topGenreIds.slice(0, 2).join('|'), sort_by: 'vote_average.desc', 'vote_count.gte': 200, ...eraFilter }, language)
          : Promise.resolve({ results: [] }),
        discoverMovies({ sort_by: 'vote_average.desc', 'vote_count.gte': 500, ...eraFilter }, language),
        discoverMovies({ sort_by: 'vote_average.desc', 'vote_count.gte': 100, 'popularity.lte': 40, ...eraFilter }, language),
      ])

      const all = [
        ...(primaryGenreData.results || []),
        ...(qualityData.results      || []),
        ...(deepCutData.results      || []),
        ...(trendingData.results     || []),
      ]

      const seen   = new Set()
      const unique = all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })

      const scored = graph
        ? unique.map(c => ({ ...c, _score: scoreContent(c, graph) }))
            .filter(c => c._score > 0)
            .sort((a, b) => b._score - a._score)
        : unique.map(c => ({ ...c, _score: 0.5 }))

      // Hero: top scored films with a poster (portrait mode)
      setHeroFilms(scored.filter(c => c.poster_path).slice(0, 6))

      const hour        = new Date().getHours()
      const isLateNight = hour >= 22 || hour <= 4
      const trendingIds = new Set((trendingData.results || []).map(t => t.id))

      setShelves({
        for_you:     diversifyShelf(scored.filter(c => !trendingIds.has(c.id)).slice(0, 60), 4).slice(0, 20),
        mood_match:  diversifyShelf(scored.filter(c => (c.genre_ids || []).some(id => isLateNight ? [53,80,27,9648].includes(id) : [28,35,12,10749].includes(id))), 3).slice(0, 14),
        hidden_gems: diversifyShelf(scored.filter(c => (c.popularity || 999) < 40 && (c.vote_average || 0) >= 7.0), 3).slice(0, 14),
        trending:    diversifyShelf((trendingData.results || []).map(c => ({ ...c, _score: graph ? scoreContent(c, graph) : 0.5 })).filter(c => c._score > 0), 3).slice(0, 14),
      })
    } catch (e) {
      console.error('Failed to load content:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleWatch = (content) => {
    setNowPlaying(content)
    recordWatchEvent(
      { event_type: 'started', tmdb_id: content.id, media_type: content.media_type || 'movie' },
      { genre_ids: content.genre_ids || [], tone_tags: content.tone_tags || [], popularity: content.popularity }
    )
  }

  const openModal  = useCallback((item) => setSelectedItem(item), [])
  const closeModal = useCallback(() => setSelectedItem(null), [])

  if (!currentUser || !onboardingDone) return null
  if (loading) return <LoadingScreen />

  const heroFilm = heroFilms[heroIndex]

  // Build your_list shelf from watchlist state
  const yourListShelf = watchlist.slice(0, 20)

  return (
    <div className={styles.shell} onClick={() => setShowUserMenu(false)}>
      <Nav
        currentUser={currentUser} showUserMenu={showUserMenu}
        setShowUserMenu={setShowUserMenu} logout={logout} navigate={navigate}
      />

      {/* Hero — Netflix mobile style portrait card */}
      {heroFilm && (
        <HeroSection
          films={heroFilms} currentIndex={heroIndex}
          onDotClick={goToSlide}
          onPrev={() => goToSlide((heroIndex - 1 + heroFilms.length) % heroFilms.length)}
          onNext={() => goToSlide((heroIndex + 1) % heroFilms.length)}
          onWatch={() => handleWatch(heroFilm)}
          onOpen={() => openModal(heroFilm)}
          onTrailer={() => setTrailerItem(heroFilm)}
          isWatched={isWatched(heroFilm.id)}
          isInWatchlist={isInWatchlist(heroFilm.id)}
          onToggleWatchlist={() => isInWatchlist(heroFilm.id) ? removeFromWatchlist(heroFilm.id) : addToWatchlist(heroFilm)}
        />
      )}

      <main className={styles.main}>
        {/* Your List — always first if has items */}
        {yourListShelf.length > 0 && (
          <Shelf
            label={SHELF_LABELS.your_list}
            items={yourListShelf}
            onWatch={handleWatch} onOpen={openModal}
            isInWatchlist={isInWatchlist}
            addToWatchlist={addToWatchlist}
            removeFromWatchlist={removeFromWatchlist}
            isWatched={isWatched}
            index={0}
          />
        )}

        {Object.entries(shelves).map(([key, items], i) =>
          items?.length > 0 && (
            <Shelf
              key={key} label={SHELF_LABELS[key]} items={items}
              onWatch={handleWatch} onOpen={openModal}
              isInWatchlist={isInWatchlist}
              addToWatchlist={addToWatchlist}
              removeFromWatchlist={removeFromWatchlist}
              isWatched={isWatched}
              index={yourListShelf.length > 0 ? i + 1 : i}
            />
          )
        )}
      </main>

      <AnimatePresence>
        {selectedItem && (
          <MovieModal
            item={selectedItem} onClose={closeModal}
            onWatch={() => { handleWatch(selectedItem); closeModal() }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {trailerItem && (
          <TrailerModal item={trailerItem} onClose={() => setTrailerItem(null)} />
        )}
      </AnimatePresence>

      <RatePrompt nowPlaying={nowPlaying} onDismiss={() => setNowPlaying(null)} />
    </div>
  )
}

// ── Hero — portrait poster style (Netflix mobile) ─────────────────────────────
function HeroSection({ films, currentIndex, onDotClick, onPrev, onNext, onWatch, onOpen, onTrailer, isWatched, isInWatchlist, onToggleWatchlist }) {
  const film   = films[currentIndex]
  const title  = film?.title || film?.name
  const year   = (film?.release_date || film?.first_air_date || '').slice(0, 4)
  const genres = (film?.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 2)

  return (
    <div className={styles.hero}>
      {/* Background blur layer (desktop) */}
      <div
        className={styles.heroBgBlur}
        style={{ backgroundImage: film?.backdrop_path ? `url(${backdropUrl(film.backdrop_path)})` : undefined }}
      />
      <div className={styles.heroGradient} />

      {/* Portrait poster (mobile-first) */}
      <AnimatePresence mode="sync">
        <motion.div
          key={film?.id}
          className={styles.heroPosterWrap}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {film?.poster_path && (
            <img
              src={posterUrl(film.poster_path, 'w500')}
              alt={title}
              className={styles.heroPoster}
            />
          )}
          <div className={styles.heroPosterGradient} />
        </motion.div>
      </AnimatePresence>

      {/* Content over poster */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`copy-${film?.id}`}
          className={styles.heroContent}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className={styles.heroBadge}>
            {genres.map(g => <span key={g} className={styles.tag}>{g}</span>)}
            {year && <span className={styles.tag}>{year}</span>}
            {isWatched && <span className={`${styles.tag} ${styles.tagWatched}`}>✓</span>}
          </div>
          <h1 className={styles.heroTitle}>{title}</h1>

          <div className={styles.heroCtas}>
            <button className={styles.btnPlay} onClick={onWatch}>▶ Play</button>
            <button className={styles.btnTrailer} onClick={onTrailer}>▶ Trailer</button>
            <button
              className={`${styles.btnList} ${isInWatchlist ? styles.btnListActive : ''}`}
              onClick={onToggleWatchlist}
            >
              {isInWatchlist ? '✓' : '+'} My List
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Slide dots */}
      <div className={styles.slideDots}>
        {films.map((_, i) => (
          <button
            key={i}
            className={`${styles.slideDot} ${i === currentIndex ? styles.slideDotActive : ''}`}
            onClick={() => onDotClick(i)}
          />
        ))}
      </div>

      {/* Desktop arrows */}
      <button className={`${styles.slideArrow} ${styles.slideArrowLeft}`}  onClick={onPrev}>‹</button>
      <button className={`${styles.slideArrow} ${styles.slideArrowRight}`} onClick={onNext}>›</button>
    </div>
  )
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function Nav({ currentUser, showUserMenu, setShowUserMenu, logout, navigate }) {
  return (
    <nav className={styles.nav}>
      <span className={styles.navLogo}>MUAD'FILM</span>
      <div className={styles.navLinks}>
        <button className={styles.navLink} onClick={() => navigate('/search')}>Search</button>
        <button className={styles.navLink} onClick={() => navigate('/watchlist')}>Watchlist</button>
      </div>
      <div className={styles.navRight}>
        <button className={styles.navAvatar} onClick={(e) => { e.stopPropagation(); setShowUserMenu(v => !v) }}>
          {currentUser.displayName?.slice(0, 2).toUpperCase()}
        </button>
        <AnimatePresence>
          {showUserMenu && (
            <motion.div
              className={styles.userMenu}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              onClick={e => e.stopPropagation()}
            >
              <p className={styles.userMenuName}>{currentUser.displayName}</p>
              <p className={styles.userMenuEmail}>{currentUser.email}</p>
              <div className={styles.userMenuDivider} />
              <button className={styles.userMenuItem} onClick={() => navigate('/profile')}>Profile & settings</button>
              <button className={styles.userMenuItem} onClick={() => navigate('/watchlist')}>Watchlist</button>
              <button className={styles.userMenuItemDanger} onClick={() => { logout(); navigate('/auth') }}>Sign out</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </nav>
  )
}

// ── Shelf ─────────────────────────────────────────────────────────────────────
function Shelf({ label, items, index, onWatch, onOpen, isInWatchlist, addToWatchlist, removeFromWatchlist, isWatched }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
    >
      <h2 className={styles.shelfLabel}>{label}</h2>
      <div className={styles.shelfScroll}>
        {items.map((item, i) => (
          <Card
            key={`${item.id}-${i}`} film={item}
            onWatch={() => onWatch(item)}
            onOpen={() => onOpen(item)}
            inWatchlist={isInWatchlist(item.id)}
            onToggleWatchlist={() => isInWatchlist(item.id) ? removeFromWatchlist(item.id) : addToWatchlist(item)}
            watched={isWatched(item.id)}
          />
        ))}
      </div>
    </motion.section>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
function Card({ film, onWatch, onOpen, inWatchlist, onToggleWatchlist, watched }) {
  const [pressed, setPressed] = useState(false)
  const title = film.title || film.name
  const year  = (film.release_date || film.first_air_date || '').slice(0, 4)

  return (
    <div
      className={styles.card}
      onMouseEnter={() => setPressed(true)}
      onMouseLeave={() => setPressed(false)}
    >
      <div className={styles.cardPoster} onClick={onOpen}>
        {film.poster_path
          ? <img src={posterUrl(film.poster_path)} alt={title} className={styles.cardImg} loading="lazy" />
          : <div className={styles.cardPlaceholder}>{title?.slice(0, 2)}</div>
        }

        {/* Save button — always visible on mobile */}
        <button
          className={`${styles.cardSaveBtn} ${inWatchlist ? styles.cardSaveBtnActive : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleWatchlist() }}
        >
          {inWatchlist ? '✓' : '+'}
        </button>

        {film._score > 0.72 && <div className={styles.matchBadge}>{Math.round(film._score * 100)}%</div>}
        {watched && <div className={styles.watchedBadge}>✓</div>}

        {/* Hover overlay — desktop only */}
        <AnimatePresence>
          {pressed && (
            <motion.div
              className={styles.cardOverlay}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              {film.overview && (
                <p className={styles.cardSynopsis}>{film.overview.slice(0, 80)}…</p>
              )}
              <div className={styles.cardButtons}>
                <button className={styles.cardPlay} onClick={(e) => { e.stopPropagation(); onWatch() }}>▶</button>
                <button
                  className={`${styles.cardSave} ${inWatchlist ? styles.cardSaveActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleWatchlist() }}
                >
                  {inWatchlist ? '✓' : '+'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardYear}>{year}</span>
      </div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className={styles.loading}>
      <motion.span
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className={styles.loadingText}
      >
        MUAD'FILM
      </motion.span>
    </div>
  )
}