// src/lib/tmdb.js
const TMDB_BASE = import.meta.env.VITE_TMDB_BASE_URL
const TMDB_KEY  = import.meta.env.VITE_TMDB_API_KEY
const IMG_BASE  = 'https://image.tmdb.org/t/p'

const tmdb = async (path, params = {}) => {
  const url = new URL(`${TMDB_BASE}${path}`)
  url.searchParams.set('api_key', TMDB_KEY)
  url.searchParams.set('language', 'en-US')
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
  })
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`)
  return res.json()
}

export const posterUrl   = (path, size = 'w500')  => path ? `${IMG_BASE}/${size}${path}` : null
export const backdropUrl = (path, size = 'w1280') => path ? `${IMG_BASE}/${size}${path}` : null
export const profileUrl  = (path, size = 'w185')  => path ? `${IMG_BASE}/${size}${path}` : null

export const searchMulti    = (query) => tmdb('/search/multi',  { query, include_adult: false })
export const searchPerson   = (query) => tmdb('/search/person', { query })
export const getTrending    = (mediaType = 'all', window = 'week') => tmdb(`/trending/${mediaType}/${window}`)
export const getMovie       = (id) => tmdb(`/movie/${id}`, { append_to_response: 'credits,videos,keywords,similar' })
export const getTvShow      = (id) => tmdb(`/tv/${id}`,    { append_to_response: 'credits,videos,keywords,similar' })
export const getMovieVideos = (id, mediaType = 'movie') => tmdb(`/${mediaType}/${id}/videos`)

// ─── discoverMovies ───────────────────────────────────────────────────────────
// Always excludes:
//   - Documentaries (99)
//   - TV Movies (10770)
//   - Adult content
// Language is injected from tasteGraph.language when supplied.

const EXCLUDED_GENRES = '99,10770'

export const discoverMovies = (filters = {}, language = null) => {
  const base = {
    sort_by:        'popularity.desc',
    include_adult:  false,
    without_genres: EXCLUDED_GENRES,
  }
  // Language filter — when set, hard-filters original language
  if (language && language !== 'any') {
    base.with_original_language = language
  }
  return tmdb('/discover/movie', { ...base, ...filters })
}

// ─── Trending — also filter out excluded genres ───────────────────────────────
// TMDB trending doesn't support without_genres natively, so we post-filter.
export const getTrendingMovies = async (language = null) => {
  const data = await tmdb('/trending/movie/week')
  let results = data.results || []
  // Filter out excluded genre IDs
  const excluded = new Set([99, 10770])
  results = results.filter(m => !(m.genre_ids || []).some(id => excluded.has(id)))
  // Language filter
  if (language && language !== 'any') {
    results = results.filter(m => m.original_language === language)
  }
  return { ...data, results }
}

export const extractTrailerKey = (videosData) => {
  if (!videosData?.results?.length) return null
  const vids = videosData.results
  const official = vids.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official === true)
  if (official) return official.key
  const anyTrailer = vids.find(v => v.site === 'YouTube' && v.type === 'Trailer')
  if (anyTrailer) return anyTrailer.key
  const teaser = vids.find(v => v.site === 'YouTube' && v.type === 'Teaser')
  return teaser?.key || null
}

// genre_id → internal name
export const GENRE_MAP = {
  28: 'action', 12: 'adventure', 16: 'animation',
  35: 'comedy', 80: 'crime', 99: 'documentary',
  18: 'drama', 10751: 'family', 14: 'fantasy',
  36: 'history', 27: 'horror', 10402: 'music',
  9648: 'mystery', 10749: 'romance', 878: 'sci_fi',
  10770: 'tv_movie', 53: 'thriller', 10752: 'war',
  37: 'western',
}

// internal name → genre_id
export const GENRE_ID_MAP = Object.fromEntries(
  Object.entries(GENRE_MAP).map(([id, name]) => [name, Number(id)])
)

// ─── Supported language options ───────────────────────────────────────────────
export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese (Mandarin)' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'any', label: 'Any language' },
]

// ─── Tone inference from TMDB keywords ───────────────────────────────────────
const KEYWORD_TONE_MAP = {
  'psychological': 'cerebral', 'mind-bending': 'cerebral', 'philosophy': 'cerebral',
  'surrealism': 'cerebral', 'existentialism': 'cerebral', 'nonlinear timeline': 'cerebral',
  'unreliable narrator': 'cerebral', 'twist ending': 'cerebral',
  'dark': 'dark', 'nihilism': 'dark', 'dystopia': 'dark',
  'corruption': 'dark', 'moral ambiguity': 'dark', 'tragedy': 'dark',
  'despair': 'dark', 'grief': 'dark', 'obsession': 'dark',
  'paranoia': 'dark', 'trauma': 'dark',
  'hope': 'hopeful', 'redemption': 'hopeful', 'feel-good': 'hopeful',
  'triumph': 'hopeful', 'underdog': 'hopeful', 'inspirational': 'hopeful',
  'coming of age': 'hopeful', 'second chance': 'hopeful',
  'violence': 'visceral', 'gore': 'visceral', 'action-packed': 'visceral',
  'adrenaline': 'visceral', 'survival': 'visceral', 'brutal': 'visceral',
  'slow burn': 'quiet', 'meditative': 'quiet', 'atmospheric': 'quiet',
  'minimalist': 'quiet', 'introspective': 'quiet', 'nature': 'quiet',
  'emotional': 'emotional', 'tearjerker': 'emotional', 'heartwarming': 'emotional',
  'love story': 'emotional', 'loss': 'emotional', 'friendship': 'emotional',
  'loneliness': 'emotional', 'nostalgia': 'emotional',
  'comedy': 'funny', 'satire': 'funny', 'humor': 'funny',
  'parody': 'funny', 'slapstick': 'funny', 'dark comedy': 'funny', 'witty': 'funny',
  'suspense': 'intense', 'thriller': 'intense', 'tension': 'intense',
  'conspiracy': 'intense', 'espionage': 'intense', 'heist': 'intense',
}

export const inferToneTags = (keywords = []) => {
  const tones = new Set()
  keywords.forEach(kw => {
    const tone = KEYWORD_TONE_MAP[kw.name?.toLowerCase()]
    if (tone) tones.add(tone)
  })
  return [...tones]
}

export const getSeedTiles = async () => {
  const seedIds = [
    { id: 278, type: 'movie' }, { id: 238, type: 'movie' },
    { id: 424, type: 'movie' }, { id: 155, type: 'movie' },
    { id: 13,  type: 'movie' }, { id: 680, type: 'movie' },
    { id: 550, type: 'movie' }, { id: 11,  type: 'movie' },
    { id: 274, type: 'movie' },
  ]
  return Promise.all(
    seedIds.map(async ({ id, type }) => {
      const data = await (type === 'movie' ? getMovie(id) : getTvShow(id))
      return { ...data, media_type: type }
    })
  )
}