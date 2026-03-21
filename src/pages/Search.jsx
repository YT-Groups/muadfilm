// src/pages/Search.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import useStore from '../lib/store'
import { discoverMovies, posterUrl, GENRE_ID_MAP } from '../lib/tmdb'
import { scoreContent } from '../engine/recommender'
import MovieModal from '../components/MovieModal'
import styles from './Search.module.css'

// ─── Filter config ────────────────────────────────────────────────────────────

const GENRE_OPTIONS = [
  { id: 28,    label: 'Action' },
  { id: 27,    label: 'Horror' },
  { id: 53,    label: 'Thriller' },
  { id: 18,    label: 'Drama' },
  { id: 35,    label: 'Comedy' },
  { id: 80,    label: 'Crime' },
  { id: 878,   label: 'Sci-Fi' },
  { id: 14,    label: 'Fantasy' },
  { id: 9648,  label: 'Mystery' },
  { id: 99,    label: 'Documentary' },
  { id: 10749, label: 'Romance' },
  { id: 16,    label: 'Animation' },
  { id: 12,    label: 'Adventure' },
  { id: 36,    label: 'History' },
]

const ERA_OPTIONS = [
  { id: 'classic', label: 'Classic', sub: 'Before 1990' },
  { id: 'retro',   label: 'Retro',   sub: '1990–2005' },
  { id: 'modern',  label: 'Modern',  sub: '2010+' },
]

const TONE_OPTIONS = [
  { id: 'dark',      label: 'Dark' },
  { id: 'cerebral',  label: 'Cerebral' },
  { id: 'hopeful',   label: 'Hopeful' },
  { id: 'visceral',  label: 'Visceral' },
  { id: 'quiet',     label: 'Quiet' },
  { id: 'emotional', label: 'Emotional' },
  { id: 'funny',     label: 'Funny' },
  { id: 'intense',   label: 'Intense' },
]

const ERA_FILTERS = {
  classic: { 'primary_release_date.lte': '1989-12-31', 'primary_release_date.gte': '1950-01-01' },
  retro:   { 'primary_release_date.lte': '2005-12-31', 'primary_release_date.gte': '1990-01-01' },
  modern:  { 'primary_release_date.gte': '2010-01-01' },
}

const TONE_GENRE_MAP = {
  dark:      [18, 27, 53, 80],
  cerebral:  [878, 9648, 18],
  hopeful:   [18, 35, 12, 10751],
  visceral:  [28, 27, 53],
  quiet:     [18, 99],
  emotional: [18, 10749],
  funny:     [35, 16],
  intense:   [53, 28, 27],
}

export default function Search() {
  const navigate = useNavigate()
  const {
    tasteGraph, currentUser, onboardingDone,
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    isWatched, markWatched, updateReaction, getReaction,
    recordSearchClick,
  } = useStore()

  const [query, setQuery]                 = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [browseResults, setBrowseResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [selectedItem, setSelectedItem]   = useState(null)

  const [selectedGenres, setSelectedGenres] = useState([])
  const [selectedEra, setSelectedEra]       = useState(null)
  const [selectedTones, setSelectedTones]   = useState([])
  const [filtersOpen, setFiltersOpen]       = useState(false)

  const debounceRef = useRef(null)
  const inputRef    = useRef(null)

  useEffect(() => {
    if (!currentUser) navigate('/auth', { replace: true })
    else if (!onboardingDone) navigate('/onboarding', { replace: true })
  }, [currentUser, onboardingDone])

  useEffect(() => { inputRef.current?.focus() }, [])

  // Browse: fires on filter change
  useEffect(() => {
    if (query.trim()) return
    loadBrowse()
  }, [selectedGenres, selectedEra, selectedTones])

  // Initial browse load
  useEffect(() => { loadBrowse() }, [])

  // Debounced search — movies only via TMDB search/movie endpoint
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!query.trim()) { setSearchResults([]); return }
    debounceRef.current = setTimeout(() => runSearch(query), 350)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const runSearch = async (q) => {
    setSearchLoading(true)
    try {
      // Use search/movie — strictly movies, no people, no TV
      const url = new URL(`${import.meta.env.VITE_TMDB_BASE_URL}/search/movie`)
      url.searchParams.set('api_key', import.meta.env.VITE_TMDB_API_KEY)
      url.searchParams.set('language', 'en-US')
      url.searchParams.set('query', q)
      url.searchParams.set('include_adult', 'false')
      const res  = await fetch(url.toString())
      const data = await res.json()

      const items = (data.results || []).slice(0, 24).map(item => ({
        ...item,
        media_type: 'movie',
        _score: tasteGraph ? scoreContent(item, tasteGraph) : 0.5,
      }))
      setSearchResults(items)
    } catch (e) {
      console.error('Search failed:', e)
    } finally {
      setSearchLoading(false)
    }
  }

  const loadBrowse = async () => {
    setBrowseLoading(true)
    try {
      const params = {
        sort_by: 'vote_average.desc',
        'vote_count.gte': 500,
        include_adult: false,
      }

      if (selectedGenres.length > 0) params.with_genres = selectedGenres.join(',')
      if (selectedEra && ERA_FILTERS[selectedEra]) Object.assign(params, ERA_FILTERS[selectedEra])

      if (selectedTones.length > 0 && selectedGenres.length === 0) {
        const toneGenreIds = [...new Set(selectedTones.flatMap(t => TONE_GENRE_MAP[t] || []))]
        if (toneGenreIds.length > 0) params.with_genres = toneGenreIds.join('|')
      }

      const data  = await discoverMovies(params)
      const items = (data.results || []).map(c => ({
        ...c,
        media_type: 'movie',
        _score: tasteGraph ? scoreContent(c, tasteGraph) : 0.5,
      })).sort((a, b) => b._score - a._score)

      setBrowseResults(items)
    } catch (e) {
      console.error('Browse failed:', e)
    } finally {
      setBrowseLoading(false)
    }
  }

  const openModal = useCallback((item) => {
    // Fire search click signal — indicates intent
    recordSearchClick(item)
    setSelectedItem(item)
  }, [recordSearchClick])

  const closeModal = useCallback(() => setSelectedItem(null), [])

  const toggleGenre = (id) => setSelectedGenres(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id])
  const toggleTone  = (id) => setSelectedTones(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  const toggleEra   = (id) => setSelectedEra(prev => prev === id ? null : id)

  const hasFilters   = selectedGenres.length > 0 || selectedEra || selectedTones.length > 0
  const isSearching  = !!query.trim()
  const displayItems = isSearching ? searchResults : browseResults
  const isLoading    = isSearching ? searchLoading : browseLoading

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <button className={styles.backBtn} onClick={() => navigate('/home')}>← Back</button>
        <span className={styles.navLogo}>MUAD'FILM</span>
        <div style={{ width: 60 }} />
      </nav>

      <div className={styles.content}>
        {/* Search bar */}
        <div className={styles.searchRow}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>⌕</span>
            <input
              ref={inputRef}
              className={styles.searchInput}
              placeholder="Search movies..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button className={styles.clearBtn} onClick={() => { setQuery(''); inputRef.current?.focus() }}>✕</button>
            )}
          </div>
          {!isSearching && (
            <button
              className={`${styles.filterToggle} ${filtersOpen ? styles.filterToggleActive : ''} ${hasFilters ? styles.filterToggleHasFilters : ''}`}
              onClick={() => setFiltersOpen(v => !v)}
            >
              {hasFilters ? `Filters (${selectedGenres.length + (selectedEra ? 1 : 0) + selectedTones.length})` : 'Filter'}
            </button>
          )}
        </div>

        {/* Filter panel */}
        <AnimatePresence>
          {filtersOpen && !isSearching && (
            <motion.div
              className={styles.filterPanel}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className={styles.filterSection}>
                <p className={styles.filterLabel}>Genre</p>
                <div className={styles.filterChips}>
                  {GENRE_OPTIONS.map(g => (
                    <button key={g.id} className={`${styles.chip} ${selectedGenres.includes(g.id) ? styles.chipActive : ''}`} onClick={() => toggleGenre(g.id)}>{g.label}</button>
                  ))}
                </div>
              </div>
              <div className={styles.filterSection}>
                <p className={styles.filterLabel}>Era</p>
                <div className={styles.filterChips}>
                  {ERA_OPTIONS.map(e => (
                    <button key={e.id} className={`${styles.chip} ${selectedEra === e.id ? styles.chipActive : ''}`} onClick={() => toggleEra(e.id)}>
                      {e.label} <span className={styles.chipSub}>{e.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.filterSection}>
                <p className={styles.filterLabel}>Tone</p>
                <div className={styles.filterChips}>
                  {TONE_OPTIONS.map(t => (
                    <button key={t.id} className={`${styles.chip} ${selectedTones.includes(t.id) ? styles.chipActive : ''}`} onClick={() => toggleTone(t.id)}>{t.label}</button>
                  ))}
                </div>
              </div>
              {hasFilters && (
                <button className={styles.clearFilters} onClick={() => { setSelectedGenres([]); setSelectedEra(null); setSelectedTones([]) }}>Clear all filters</button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section label */}
        <div className={styles.sectionHead}>
          <p className={styles.sectionLabel}>
            {isSearching
              ? searchLoading ? 'Searching...' : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`
              : hasFilters ? 'Filtered results' : 'Browse movies'
            }
          </p>
        </div>

        {/* Grid */}
        {isLoading && displayItems.length === 0 ? (
          <div className={styles.loadingRow}>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className={styles.loadingText}>Loading...</motion.span>
          </div>
        ) : displayItems.length === 0 && isSearching ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No results for "{query}"</p>
            <p className={styles.emptySub}>Try a different title or spelling</p>
          </div>
        ) : (
          <motion.div className={styles.grid} layout>
            <AnimatePresence mode="popLayout">
              {displayItems.map((item, i) => (
                <FilmCard
                  key={item.id}
                  film={item}
                  index={i}
                  onOpen={() => openModal(item)}
                  inWatchlist={isInWatchlist(item.id)}
                  watched={isWatched(item.id)}
                  reaction={getReaction(item.id)}
                  onToggleWatchlist={() => isInWatchlist(item.id) ? removeFromWatchlist(item.id) : addToWatchlist(item)}
                  onMarkWatched={() => markWatched(item, null)}
                  onRate={(r) => isWatched(item.id) ? updateReaction(item.id, r) : markWatched(item, r)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {selectedItem && <MovieModal item={selectedItem} onClose={closeModal} />}
      </AnimatePresence>
    </div>
  )
}

// ─── Film card with inline watched/rate actions ───────────────────────────────

const REACTIONS = [
  { id: 'loved', emoji: '🔥' },
  { id: 'liked', emoji: '👍' },
  { id: 'mid',   emoji: '😐' },
  { id: 'abandoned', emoji: '💀' },
]

function FilmCard({ film, index, onOpen, inWatchlist, watched, reaction, onToggleWatchlist, onMarkWatched, onRate }) {
  const [showRate, setShowRate] = useState(false)
  const title = film.title || film.name
  const year  = (film.release_date || '').slice(0, 4)
  const currentReaction = REACTIONS.find(r => r.id === reaction)

  return (
    <motion.div
      className={styles.card}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.025, 0.3) }}
    >
      <div className={styles.cardPoster} onClick={onOpen}>
        {film.poster_path
          ? <img src={posterUrl(film.poster_path)} alt={title} className={styles.cardImg} loading="lazy" />
          : <div className={styles.cardPlaceholder}>{title?.slice(0, 2)}</div>
        }
        {film._score > 0.72 && <div className={styles.matchBadge}>{Math.round(film._score * 100)}%</div>}
        {watched && <div className={styles.watchedBadge}>{currentReaction ? currentReaction.emoji : '✓'}</div>}
        <button
          className={`${styles.saveBtn} ${inWatchlist ? styles.saveBtnActive : ''}`}
          onClick={e => { e.stopPropagation(); onToggleWatchlist() }}
        >{inWatchlist ? '✓' : '+'}</button>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.cardTitle}>{title}</span>
        {year && <span className={styles.cardYear}>{year}</span>}
      </div>

      {/* Watched / rate row */}
      <div className={styles.cardActions}>
        {!watched ? (
          <button className={styles.cardActionBtn} onClick={() => { onMarkWatched(); setShowRate(true) }}>
            Watched
          </button>
        ) : (
          <button
            className={`${styles.cardActionBtn} ${showRate ? styles.cardActionBtnActive : ''}`}
            onClick={() => setShowRate(v => !v)}
          >
            {currentReaction ? `${currentReaction.emoji} Rated` : 'Rate'}
          </button>
        )}
      </div>

      <AnimatePresence>
        {showRate && (
          <motion.div
            className={styles.rateRow}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            {REACTIONS.map(r => (
              <button
                key={r.id}
                className={`${styles.rateBtn} ${reaction === r.id ? styles.rateBtnActive : ''}`}
                onClick={() => { onRate(r.id); setShowRate(false) }}
              >{r.emoji}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}