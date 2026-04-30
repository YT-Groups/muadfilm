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

const REFRESH_INTERVAL = 7 * 60 * 1000 // 7 minutes

export default function Home() {
  const navigate = useNavigate()
  const {
    tasteGraph, recordWatchEvent,
    currentUser, logout, onboardingDone,
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    markWatched, isWatched, watchlist,
  } = useStore()

  const [heroFilms, setHeroFilms]       = useState([])
  const [heroIndex, setHeroIndex]       = useState(0)
  const [shelves, setShelves]           = useState({})
  const [loading, setLoading]           = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)
  const [trailerItem, setTrailerItem]   = useState(null)
  const [nowPlaying, setNowPlaying]     = useState(null)
  const [showUserMenu, setShowUserMenu] = useState(false)

  // Keep refs so timers/intervals always have fresh values
  const heroFilmsRef    = useRef([])
  const heroIndexRef    = useRef(0)
  const tasteGraphRef   = useRef(tasteGraph)
  const slideTimer      = useRef(null)
  const refreshTimer    = useRef(null)
  const contentPoolRef  = useRef([]) // raw scored pool — rescore without refetching

  useLearningLoop()

  // Sync tasteGraph ref so rescoring always uses latest graph
  useEffect(() => { tasteGraphRef.current = tasteGraph }, [tasteGraph])
  useEffect(() => { heroIndexRef.current  = heroIndex },  [heroIndex])
  useEffect(() => { heroFilmsRef.current  = heroFilms },  [heroFilms])

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser)    navigate('/auth',       { replace: true })
    else if (!onboardingDone) navigate('/onboarding', { replace: true })
  }, [currentUser, onboardingDone])

  // ── Initial load + periodic refresh ────────────────────────────────────────
  useEffect(() => {
    if (!currentUser || !onboardingDone) return

    loadContent()

    // Refresh every 7 minutes
    refreshTimer.current = setInterval(() => {
      loadContent()
    }, REFRESH_INTERVAL)

    // Also refresh on tab focus (when user comes back)
    const onFocus = () => loadContent()
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(refreshTimer.current)
      window.removeEventListener('focus', onFocus)
    }
  }, [currentUser, onboardingDone])

  // ── Rescore shelves when taste graph changes (NO refetch) ───────────────────
  // This fires every time a signal updates the graph — watchlist, ratings, etc.
  // We use a debounce so rapid signals (e.g. bulk watchlist adds) don't thrash
  const rescoreTimer = useRef(null)
  useEffect(() => {
    if (!tasteGraph || contentPoolRef.current.length === 0) return
    clearTimeout(rescoreTimer.current)
    rescoreTimer.current = setTimeout(() => {
      buildShelves(contentPoolRef.current, useStore.getState().tasteGraph)
    }, 800)
    return () => clearTimeout(rescoreTimer.current)
  }, [JSON.stringify(tasteGraph?.genre_weights)])

  // ── Hero auto-advance ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!heroFilms.length) return
    clearInterval(slideTimer.current)
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

  // ── Fetch content from TMDB ─────────────────────────────────────────────────
  const loadContent = async () => {
    setLoading(prev => contentPoolRef.current.length === 0 ? true : prev)
    try {
      const graph    = useStore.getState().tasteGraph
      const language = graph?.language || 'en'

      const topGenreIds = graph
        ? Object.entries(graph.genre_weights)
            .filter(([g]) => g !== 'documentary')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4).map(([g]) => GENRE_ID_MAP?.[g]).filter(Boolean)
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

      // Store raw pool for rescoring later
      contentPoolRef.current = unique

      buildShelves(unique, graph, trendingData.results || [])
    } catch (e) {
      console.error('Failed to load content:', e)
    } finally {
      setLoading(false)
    }
  }

  // ── Score + assign shelves (called on load AND on graph change) ─────────────
  const buildShelves = (pool, graph, trendingRaw = null) => {
    // Always read latest graph from store — avoids stale closure
    const freshGraph = useStore.getState().tasteGraph || graph
    const scored = freshGraph
      ? pool.map(c => ({ ...c, _score: scoreContent(c, freshGraph) }))
          .filter(c => c._score > 0)
          .sort((a, b) => b._score - a._score)
      : pool.map(c => ({ ...c, _score: 0.5 }))

    // Hero: top scored with poster
    const newHero = scored.filter(c => c.poster_path).slice(0, 6)
    setHeroFilms(newHero)

    const hour        = new Date().getHours()
    const isLateNight = hour >= 22 || hour <= 4
    const trendingIds = new Set((trendingRaw || []).map(t => t.id))

    setShelves({
      for_you:     diversifyShelf(scored.filter(c => !trendingIds.has(c.id)).slice(0, 60), 4).slice(0, 20),
      mood_match:  diversifyShelf(scored.filter(c =>
        (c.genre_ids || []).some(id => isLateNight
          ? [53,80,27,9648].includes(id)
          : [28,35,12,10749].includes(id)
        )), 3).slice(0, 14),
      hidden_gems: diversifyShelf(scored.filter(c => (c.popularity || 999) < 40 && (c.vote_average || 0) >= 7.0), 3).slice(0, 14),
      trending:    diversifyShelf((trendingRaw || pool.slice(0, 20)).map(c => ({
        ...c, _score: freshGraph ? scoreContent(c, freshGraph) : 0.5
      })).sort((a,b) => b._score - a._score), 3).slice(0, 14),
    })
  }

  const handleWatch = (content) => {
    setNowPlaying(content)
    recordWatchEvent(
      { event_type: 'started', tmdb_id: content.id, media_type: content.media_type || 'movie' },
      { genre_ids: content.genre_ids || [], tone_tags: content.tone_tags || [], popularity: content.popularity }
    )
  }

  // Trailer watch — fires a signal too
  const handleTrailer = (content) => {
    setTrailerItem(content)
    recordWatchEvent(
      { event_type: 'viewed', tmdb_id: content.id, media_type: content.media_type || 'movie' },
      { genre_ids: content.genre_ids || [], tone_tags: content.tone_tags || [], popularity: content.popularity }
    )
  }

  const openModal  = useCallback((item) => setSelectedItem(item), [])
  const closeModal = useCallback(() => setSelectedItem(null), [])

  if (!currentUser || !onboardingDone) return null
  if (loading && heroFilms.length === 0) return <LoadingScreen />

  const heroFilm    = heroFilms[heroIndex]
  const yourListShelf = watchlist.slice(0, 20)

  return (
    <div className={styles.shell} onClick={() => setShowUserMenu(false)}>
      <Nav
        currentUser={currentUser} showUserMenu={showUserMenu}
        setShowUserMenu={setShowUserMenu} logout={logout} navigate={navigate}
      />

      {heroFilm && (
        <HeroSection
          films={heroFilms} currentIndex={heroIndex}
          onDotClick={goToSlide}
          onPrev={() => goToSlide((heroIndex - 1 + heroFilms.length) % heroFilms.length)}
          onNext={() => goToSlide((heroIndex + 1) % heroFilms.length)}
          onOpen={() => openModal(heroFilm)}
          onTrailer={() => handleTrailer(heroFilm)}
          isWatched={isWatched(heroFilm.id)}
          isInWatchlist={isInWatchlist(heroFilm.id)}
          onToggleWatchlist={() => isInWatchlist(heroFilm.id) ? removeFromWatchlist(heroFilm.id) : addToWatchlist(heroFilm)}
        />
      )}

      <main className={styles.main}>
        {yourListShelf.length > 0 && (
          <Shelf label={SHELF_LABELS.your_list} items={yourListShelf} index={0}
            onWatch={handleWatch} onOpen={openModal}
            isInWatchlist={isInWatchlist} addToWatchlist={addToWatchlist}
            removeFromWatchlist={removeFromWatchlist} isWatched={isWatched}
          />
        )}
        {Object.entries(shelves).map(([key, items], i) =>
          items?.length > 0 && (
            <Shelf key={key} label={SHELF_LABELS[key]} items={items}
              index={yourListShelf.length > 0 ? i + 1 : i}
              onWatch={handleWatch} onOpen={openModal}
              isInWatchlist={isInWatchlist} addToWatchlist={addToWatchlist}
              removeFromWatchlist={removeFromWatchlist} isWatched={isWatched}
            />
          )
        )}
      </main>

      <AnimatePresence>
        {selectedItem && (
          <MovieModal item={selectedItem} onClose={closeModal}
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

// ── Hero — tile on mobile, landscape on desktop ───────────────────────────────
function HeroSection({ films, currentIndex, onDotClick, onPrev, onNext, onOpen, onTrailer, isWatched, isInWatchlist, onToggleWatchlist }) {
  const film   = films[currentIndex]
  const title  = film?.title || film?.name
  const year   = (film?.release_date || film?.first_air_date || '').slice(0, 4)
  const genres = (film?.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 2)

  return (
    <div className={styles.hero}>
      {/* Desktop: blur backdrop */}
      <div className={styles.heroBgBlur}
        style={{ backgroundImage: film?.backdrop_path ? `url(${backdropUrl(film.backdrop_path)})` : undefined }}
      />
      <div className={styles.heroGradient} />

      {/* Portrait poster */}
      <AnimatePresence mode="sync">
        <motion.div key={film?.id} className={styles.heroPosterWrap}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {film?.poster_path && (
            <img src={posterUrl(film.poster_path, 'w500')} alt={title} className={styles.heroPoster} />
          )}
          <div className={styles.heroPosterGradient} />
        </motion.div>
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div key={`copy-${film?.id}`} className={styles.heroContent}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className={styles.heroBadge}>
            {genres.map(g => <span key={g} className={styles.tag}>{g}</span>)}
            {year && <span className={styles.tag}>{year}</span>}
            {isWatched && <span className={`${styles.tag} ${styles.tagWatched}`}>✓ Watched</span>}
          </div>
          <h1 className={styles.heroTitle}>{title}</h1>
          <div className={styles.heroCtas}>
            {/* No Play button — More Info + Trailer + My List */}
            <button className={styles.btnInfo} onClick={onOpen}>ⓘ More info</button>
            <button className={styles.btnTrailer} onClick={onTrailer}>▶ Trailer</button>
            <button className={`${styles.btnList} ${isInWatchlist ? styles.btnListActive : ''}`} onClick={onToggleWatchlist}>
              {isInWatchlist ? '✓' : '+'} My List
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className={styles.slideDots}>
        {films.map((_, i) => (
          <button key={i} className={`${styles.slideDot} ${i === currentIndex ? styles.slideDotActive : ''}`} onClick={() => onDotClick(i)} />
        ))}
      </div>
      <button className={`${styles.slideArrow} ${styles.slideArrowLeft}`}  onClick={onPrev}>‹</button>
      <button className={`${styles.slideArrow} ${styles.slideArrowRight}`} onClick={onNext}>›</button>
    </div>
  )
}

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
            <motion.div className={styles.userMenu}
              initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
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

function Shelf({ label, items, index, onWatch, onOpen, isInWatchlist, addToWatchlist, removeFromWatchlist, isWatched }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.06, 0.3) }}
    >
      <h2 className={styles.shelfLabel}>{label}</h2>
      <div className={styles.shelfScroll}>
        {items.map((item, i) => (
          <Card key={`${item.id}-${i}`} film={item}
            onWatch={() => onWatch(item)} onOpen={() => onOpen(item)}
            inWatchlist={isInWatchlist(item.id)}
            onToggleWatchlist={() => isInWatchlist(item.id) ? removeFromWatchlist(item.id) : addToWatchlist(item)}
            watched={isWatched(item.id)}
          />
        ))}
      </div>
    </motion.section>
  )
}

function Card({ film, onWatch, onOpen, inWatchlist, onToggleWatchlist, watched }) {
  const [hovered, setHovered] = useState(false)
  const title = film.title || film.name
  const year  = (film.release_date || film.first_air_date || '').slice(0, 4)

  return (
    <div className={styles.card} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className={styles.cardPoster} onClick={onOpen}>
        {film.poster_path
          ? <img src={posterUrl(film.poster_path)} alt={title} className={styles.cardImg} loading="lazy" />
          : <div className={styles.cardPlaceholder}>{title?.slice(0, 2)}</div>
        }
        <button
          className={`${styles.cardSaveBtn} ${inWatchlist ? styles.cardSaveBtnActive : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleWatchlist() }}
        >{inWatchlist ? '✓' : '+'}</button>
        {film._score > 0.72 && <div className={styles.matchBadge}>{Math.round(film._score * 100)}%</div>}
        {watched && <div className={styles.watchedBadge}>✓</div>}
        <AnimatePresence>
          {hovered && (
            <motion.div className={styles.cardOverlay}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              {film.overview && <p className={styles.cardSynopsis}>{film.overview.slice(0, 80)}…</p>}
              <div className={styles.cardButtons}>
                <button className={styles.cardPlay} onClick={(e) => { e.stopPropagation(); onWatch() }}>▶</button>
                <button className={`${styles.cardSave} ${inWatchlist ? styles.cardSaveActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleWatchlist() }}>
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
      <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }} className={styles.loadingText}>
        MUAD'FILM
      </motion.span>
    </div>
  )
}