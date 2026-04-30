// src/pages/Home.jsx
import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import useStore from '../lib/store'
import { getTrendingMovies, discoverMovies, posterUrl, backdropUrl, GENRE_MAP, GENRE_ID_MAP } from '../lib/tmdb'
import { scoreContent, diversifyShelf } from '../engine/recommender'
import useTrailer from '../hooks/useTrailer'
import useYouTubePlayer from '../hooks/useYouTubePlayer'
import useLearningLoop from '../hooks/useLearningLoop'
import MovieModal from '../components/MovieModal'
import RatePrompt from '../components/RatePrompt'
import styles from './Home.module.css'

const SHELF_LABELS = {
  for_you:     'Curated for you',
  mood_match:  'Right now',
  hidden_gems: 'Hidden gems',
  trending:    'Trending',
}

const TRAILER_DELAY     = 2500
const NO_TRAILER_LIMIT  = 12000
const POST_TRAILER_WAIT = 2500

export default function Home() {
  const navigate = useNavigate()
  const {
    tasteGraph, recordWatchEvent,
    currentUser, logout, onboardingDone,
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    markWatched, isWatched,
  } = useStore()

  const [heroFilms, setHeroFilms]       = useState([])
  const [heroIndex, setHeroIndex]       = useState(0)
  const [shelves, setShelves]           = useState({})
  const [loading, setLoading]           = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)
  const [nowPlaying, setNowPlaying]     = useState(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [trailerArmed, setTrailerArmed] = useState(false)

  const heroIndexRef = useRef(0)
  const heroFilmsRef = useRef([])
  const allTimers    = useRef([])
  const hasLoadedRef = useRef(false)

  useLearningLoop()

  const clearAllTimers = () => { allTimers.current.forEach(clearTimeout); allTimers.current = [] }
  const later = (fn, ms) => { const id = setTimeout(fn, ms); allTimers.current.push(id); return id }

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

  const advanceSlide = useCallback(() => {
    const films = heroFilmsRef.current
    if (!films.length) return
    goToSlide((heroIndexRef.current + 1) % films.length)
  }, []) // eslint-disable-line

  const goToSlide = useCallback((index) => {
    clearAllTimers()
    setTrailerArmed(false)
    setHeroIndex(index)
    later(() => setTrailerArmed(true), TRAILER_DELAY)
    later(advanceSlide, TRAILER_DELAY + NO_TRAILER_LIMIT)
  }, []) // eslint-disable-line

  useEffect(() => {
    if (heroFilms.length === 0) return
    goToSlide(0)
    return clearAllTimers
  }, [heroFilms.length > 0]) // eslint-disable-line

  const handleTrailerEnded = useCallback(() => {
    clearAllTimers()
    later(advanceSlide, POST_TRAILER_WAIT)
  }, [advanceSlide])

  const bumpSlide = (dir) => {
    const films = heroFilmsRef.current
    if (!films.length) return
    goToSlide((heroIndexRef.current + dir + films.length) % films.length)
  }

  const loadContent = async () => {
    setLoading(true)
    try {
      const graph    = useStore.getState().tasteGraph
      const language = graph?.language || 'en'

      const topGenreIds = graph
        ? Object.entries(graph.genre_weights)
            .filter(([g]) => g !== 'documentary') // never include docs
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([g]) => GENRE_ID_MAP[g])
            .filter(Boolean)
        : []

      const secondaryGenreIds = graph
        ? Object.entries(graph.genre_weights)
            .filter(([g]) => g !== 'documentary')
            .sort((a, b) => b[1] - a[1])
            .slice(4, 8)
            .map(([g]) => GENRE_ID_MAP[g])
            .filter(Boolean)
        : []

      const eraFilter = (() => {
        const pref = graph?.era_preference
        if (!pref || pref === 'any') return { 'primary_release_date.gte': '2000-01-01' }
        if (pref === 'classic') return { 'primary_release_date.lte': '1990-12-31', 'primary_release_date.gte': '1950-01-01' }
        if (pref === 'retro')   return { 'primary_release_date.lte': '2005-12-31', 'primary_release_date.gte': '1990-01-01' }
        if (pref === 'modern')  return { 'primary_release_date.gte': '2010-01-01' }
        return {}
      })()

      const promotedActors = (graph?.actor_affinities || [])
        .filter(a => (a.appearances || 0) >= 3)
        .slice(0, 2)

      const [trendingData, primaryGenreData, secondaryGenreData, qualityData, deepCutData, ...actorData] = await Promise.all([
        getTrendingMovies(language),
        topGenreIds.length
          ? discoverMovies({ with_genres: topGenreIds.slice(0, 2).join('|'), sort_by: 'vote_average.desc', 'vote_count.gte': 200, ...eraFilter }, language)
          : Promise.resolve({ results: [] }),
        secondaryGenreIds.length
          ? discoverMovies({ with_genres: secondaryGenreIds.slice(0, 2).join('|'), sort_by: 'vote_average.desc', 'vote_count.gte': 200, ...eraFilter }, language)
          : Promise.resolve({ results: [] }),
        discoverMovies({ sort_by: 'vote_average.desc', 'vote_count.gte': 500, ...eraFilter }, language),
        discoverMovies({ sort_by: 'vote_average.desc', 'vote_count.gte': 100, 'popularity.lte': 40, ...eraFilter }, language),
        ...promotedActors.map(actor =>
          discoverMovies({ with_cast: actor.id, sort_by: 'vote_average.desc', 'vote_count.gte': 100 }, language)
        ),
      ])

      const all = [
        ...(primaryGenreData.results   || []),
        ...(secondaryGenreData.results || []),
        ...actorData.flatMap(r => r.results || []),
        ...(qualityData.results        || []),
        ...(deepCutData.results        || []),
        ...(trendingData.results       || []),
      ]

      const seen   = new Set()
      const unique = all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })

      const scored = graph
        ? unique.map(c => ({ ...c, _score: scoreContent(c, graph) }))
            .filter(c => c._score > 0) // remove hard-excluded items (score === 0)
            .sort((a, b) => b._score - a._score)
        : unique.map(c => ({ ...c, _score: 0.5 }))

      setHeroFilms(scored.filter(c => c.backdrop_path).slice(0, 6))

      const hour        = new Date().getHours()
      const isLateNight = hour >= 22 || hour <= 4
      const trendingIds = new Set((trendingData.results || []).map(t => t.id))

      setShelves({
        for_you:     diversifyShelf(scored.filter(c => !trendingIds.has(c.id)).slice(0, 60), 4).slice(0, 20),
        mood_match:  diversifyShelf(scored.filter(c => (c.genre_ids || []).some(id => isLateNight ? [53, 80, 27, 9648].includes(id) : [28, 35, 12, 10749].includes(id))), 3).slice(0, 14),
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

  return (
    <div className={styles.shell} onClick={() => setShowUserMenu(false)}>
      <Nav currentUser={currentUser} showUserMenu={showUserMenu} setShowUserMenu={setShowUserMenu} logout={logout} navigate={navigate} />

      {heroFilm && (
        <HeroSlideshow
          films={heroFilms} currentIndex={heroIndex} trailerArmed={trailerArmed}
          onTrailerEnded={handleTrailerEnded}
          onPrev={() => bumpSlide(-1)} onNext={() => bumpSlide(1)} onDotClick={(i) => goToSlide(i)}
          onWatch={() => handleWatch(heroFilm)} onOpen={() => openModal(heroFilm)}
          isWatched={isWatched(heroFilm.id)} isInWatchlist={isInWatchlist(heroFilm.id)}
          onToggleWatchlist={() => isInWatchlist(heroFilm.id) ? removeFromWatchlist(heroFilm.id) : addToWatchlist(heroFilm)}
        />
      )}

      <main className={styles.main}>
        {Object.entries(shelves).map(([key, items], i) =>
          items?.length > 0 && (
            <Shelf key={key} label={SHELF_LABELS[key]} items={items} index={i}
              onWatch={handleWatch} onOpen={openModal}
              isInWatchlist={isInWatchlist} addToWatchlist={addToWatchlist}
              removeFromWatchlist={removeFromWatchlist} isWatched={isWatched}
            />
          )
        )}
      </main>

      <AnimatePresence>
        {selectedItem && (
          <MovieModal item={selectedItem} onClose={closeModal} onWatch={() => { handleWatch(selectedItem); closeModal() }} />
        )}
      </AnimatePresence>

      <RatePrompt nowPlaying={nowPlaying} onDismiss={() => setNowPlaying(null)} />
    </div>
  )
}

function HeroSlideshow({ films, currentIndex, trailerArmed, onTrailerEnded, onPrev, onNext, onDotClick, onWatch, onOpen, isWatched, isInWatchlist, onToggleWatchlist }) {
  const [muted, setMuted]               = useState(true)
  const [playerReady, setPlayerReady]   = useState(false)
  const [trailerEnded, setTrailerEnded] = useState(false)

  const film   = films[currentIndex]
  const title  = film?.title || film?.name
  const year   = (film?.release_date || film?.first_air_date || '').slice(0, 4)
  const genres = (film?.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 3)

  useEffect(() => { setPlayerReady(false); setTrailerEnded(false) }, [currentIndex])

  const { trailerKey } = useTrailer(trailerArmed ? film : null)
  const containerId    = `yt-hero-${film?.id}`

  const playerRef = useYouTubePlayer({
    containerId, videoId: trailerKey, muted: true,
    enabled: !!trailerKey && trailerArmed,
    onReady: () => setPlayerReady(true),
    onEnded: () => { setTrailerEnded(true); onTrailerEnded() },
  })

  useEffect(() => {
    const p = playerRef.current
    if (!p || !playerReady) return
    try { muted ? p.mute() : p.unMute() } catch {}
  }, [muted, playerReady])

  const trailerLive = trailerArmed && !!trailerKey && playerReady && !trailerEnded

  return (
    <div className={styles.hero}>
      <AnimatePresence mode="sync">
        <motion.div key={`backdrop-${film?.id}`} className={styles.heroBackdropWrap} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9 }}>
          <div className={styles.heroBackdrop} style={{ backgroundImage: film?.backdrop_path ? `url(${backdropUrl(film.backdrop_path)})` : undefined }} />
          {trailerArmed && (
            <div className={`${styles.heroTrailerWrap} ${trailerLive ? styles.heroTrailerVisible : ''}`}>
              <div id={containerId} className={styles.ytTarget} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className={styles.heroGradient} />
      <AnimatePresence mode="wait">
        <motion.div key={`copy-${film?.id}`} className={styles.heroContent} initial={{ opacity: 0, y: 20 }} animate={{ opacity: trailerLive ? 0 : 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.7 }} style={{ pointerEvents: trailerLive ? 'none' : 'auto' }}>
          <div className={styles.heroBadge}>
            {genres.map(g => <span key={g} className={styles.tag}>{g}</span>)}
            {year && <span className={styles.tag}>{year}</span>}
            {isWatched && <span className={`${styles.tag} ${styles.tagWatched}`}>✓ Watched</span>}
          </div>
          <h1 className={styles.heroTitle}>{title}</h1>
          {film?.overview && <p className={styles.heroOverview}>{film.overview.slice(0, 180)}…</p>}
          <div className={styles.heroCtas}>
            <button className={styles.btnPrimary} onClick={onWatch}>▶ Watch now</button>
            <button className={styles.btnSecondary} onClick={onOpen}>More info</button>
            <button className={`${styles.btnIcon} ${isInWatchlist ? styles.btnIconActive : ''}`} onClick={onToggleWatchlist}>
              {isInWatchlist ? '✓' : '+'}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>
        {trailerLive && (
          <motion.button className={styles.heroMuteBtn} onClick={() => setMuted(m => !m)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            {muted ? '🔇 Unmute' : '🔊 Mute'}
          </motion.button>
        )}
      </AnimatePresence>
      <button className={`${styles.slideArrow} ${styles.slideArrowLeft}`}  onClick={onPrev}>‹</button>
      <button className={`${styles.slideArrow} ${styles.slideArrowRight}`} onClick={onNext}>›</button>
      <div className={styles.slideDots}>
        {films.map((_, i) => <button key={i} className={`${styles.slideDot} ${i === currentIndex ? styles.slideDotActive : ''}`} onClick={() => onDotClick(i)} />)}
      </div>
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
            <motion.div className={styles.userMenu} initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.18 }} onClick={e => e.stopPropagation()}>
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
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: index * 0.08 }}>
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
    <motion.div className={styles.card} onHoverStart={() => setHovered(true)} onHoverEnd={() => setHovered(false)} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
      <div className={styles.cardPoster} onClick={onOpen}>
        {film.poster_path
          ? <img src={posterUrl(film.poster_path)} alt={title} className={styles.cardImg} loading="lazy" />
          : <div className={styles.cardPlaceholder}>{title?.slice(0, 2)}</div>
        }
        <AnimatePresence>
          {hovered && (
            <motion.div className={styles.cardOverlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {film.overview && <p className={styles.cardSynopsis}>{film.overview.slice(0, 100)}{film.overview.length > 100 ? '…' : ''}</p>}
              <div className={styles.cardButtons}>
                <button className={styles.cardPlay} onClick={(e) => { e.stopPropagation(); onWatch() }}>▶</button>
                <button className={`${styles.cardSave} ${inWatchlist ? styles.cardSaveActive : ''}`} onClick={(e) => { e.stopPropagation(); onToggleWatchlist() }}>{inWatchlist ? '✓' : '+'}</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {film._score > 0.72 && <div className={styles.matchBadge}>{Math.round(film._score * 100)}%</div>}
        {watched && <div className={styles.watchedBadge}>✓</div>}
      </div>
      <div className={styles.cardMeta}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardYear}>{year}</span>
      </div>
    </motion.div>
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