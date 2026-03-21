// src/components/onboarding/Onboarding.jsx
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { searchMulti, searchPerson, posterUrl, LANGUAGE_OPTIONS } from '../../lib/tmdb'
import { seedTasteGraph, getDynamicSeedTiles } from '../../engine/recommender'
import useStore from '../../lib/store'
import styles from './Onboarding.module.css'

const GENRE_SHELVES = [
  { id: 'thriller_crime', label: 'Thriller & Crime', emoji: '🔪' },
  { id: 'sci_fi_fantasy', label: 'Sci-Fi & Fantasy',  emoji: '🚀' },
  { id: 'dark_drama',     label: 'Dark Drama',         emoji: '🎭' },
  { id: 'comedy_light',  label: 'Comedy & Feel-Good', emoji: '😂' },
  { id: 'horror_intense', label: 'Horror & Intense',   emoji: '😱' },
]

// Languages shown on the quick-pick step (most common)
const QUICK_LANGUAGES = [
  { code: 'en',  label: 'English',    flag: '🇬🇧' },
  { code: 'fr',  label: 'French',     flag: '🇫🇷' },
  { code: 'es',  label: 'Spanish',    flag: '🇪🇸' },
  { code: 'de',  label: 'German',     flag: '🇩🇪' },
  { code: 'it',  label: 'Italian',    flag: '🇮🇹' },
  { code: 'ja',  label: 'Japanese',   flag: '🇯🇵' },
  { code: 'ko',  label: 'Korean',     flag: '🇰🇷' },
  { code: 'zh',  label: 'Chinese',    flag: '🇨🇳' },
  { code: 'pt',  label: 'Portuguese', flag: '🇵🇹' },
  { code: 'any', label: 'Any language', flag: '🌍' },
]

export default function Onboarding() {
  const navigate = useNavigate()
  const { completeOnboarding } = useStore()

  const [step, setStep]       = useState(0)
  const [answers, setAnswers] = useState({ language: 'en' }) // default English

  const [movieQuery, setMovieQuery]       = useState('')
  const [movieResults, setMovieResults]   = useState([])
  const [actorQuery, setActorQuery]       = useState('')
  const [actorResults, setActorResults]   = useState([])
  const [directorQuery, setDirectorQuery] = useState('')
  const [directorResults, setDirectorResults] = useState([])
  const [favFilmQuery, setFavFilmQuery]   = useState('')
  const [favFilmResults, setFavFilmResults] = useState([])

  const [dobValue, setDobValue]           = useState('')
  const [dobError, setDobError]           = useState('')

  const [seedTiles, setSeedTiles]             = useState([])
  const [loadingTiles, setLoadingTiles]       = useState(false)
  const [selectedPosters, setSelectedPosters] = useState([])
  const [hoveredPoster, setHoveredPoster]     = useState(null)

  const [searching, setSearching]   = useState(false)
  const [completing, setCompleting] = useState(false)

  // Separate debounce refs so searches don't cancel each other
  const movieTimer    = useRef(null)
  const favFilmTimer  = useRef(null)
  const actorTimer    = useRef(null)
  const directorTimer = useRef(null)

  useEffect(() => {
    if (!movieQuery || movieQuery.length < 2) { setMovieResults([]); return }
    clearTimeout(movieTimer.current)
    movieTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await searchMulti(movieQuery)
        setMovieResults(data.results?.slice(0, 6) || [])
      } finally { setSearching(false) }
    }, 400)
  }, [movieQuery])

  useEffect(() => {
    if (!favFilmQuery || favFilmQuery.length < 2) { setFavFilmResults([]); return }
    clearTimeout(favFilmTimer.current)
    favFilmTimer.current = setTimeout(async () => {
      try {
        const data = await searchMulti(favFilmQuery)
        setFavFilmResults(data.results?.filter(r => r.media_type === 'movie').slice(0, 6) || [])
      } catch {}
    }, 400)
  }, [favFilmQuery])

  useEffect(() => {
    if (!actorQuery || actorQuery.length < 2) { setActorResults([]); return }
    clearTimeout(actorTimer.current)
    actorTimer.current = setTimeout(async () => {
      try {
        const data = await searchPerson(actorQuery)
        setActorResults(data.results?.slice(0, 5) || [])
      } catch {}
    }, 400)
  }, [actorQuery])

  useEffect(() => {
    if (!directorQuery || directorQuery.length < 2) { setDirectorResults([]); return }
    clearTimeout(directorTimer.current)
    directorTimer.current = setTimeout(async () => {
      try {
        const data = await searchPerson(directorQuery)
        setDirectorResults(data.results?.filter(r => r.known_for_department === 'Directing').slice(0, 5) || [])
      } catch {}
    }, 400)
  }, [directorQuery])

  const answer = (key, value) => setAnswers(prev => ({ ...prev, [key]: value }))
  const next   = () => setStep(s => s + 1)

  const getSteps = () => {
    const s = ['q0_dob', 'q0_language', 'q1_frequency']

    if (answers.watch_frequency === 'daily' || answers.watch_frequency === 'weekly') {
      s.push('q2_last_watched')
      if (answers.last_watched) {
        s.push('q3_finished')
        if (answers.finished_last === false) s.push('q3_why')
      }
      s.push('q3_actor')
    } else {
      s.push('q2_genre_shelf')
    }

    s.push('q4_character', 'q4_pace', 'q4_context')
    s.push('q5_mood', 'q5_rewatch', 'q5_era')
    s.push('q6_fav_film', 'q6_director')
    s.push('q7_posters')
    return s
  }

  const steps       = getSteps()
  const currentStep = steps[step] || 'q7_posters'
  const progress    = (step / Math.max(steps.length - 1, 1)) * 100

  useEffect(() => {
    if (currentStep === 'q7_posters' && seedTiles.length === 0) {
      setLoadingTiles(true)
      getDynamicSeedTiles(answers)
        .then(tiles => setSeedTiles(tiles))
        .catch(console.error)
        .finally(() => setLoadingTiles(false))
    }
  }, [currentStep])

  const handleDobNext = () => {
    if (!dobValue) { next(); return } // DOB is optional
    const parsed = new Date(dobValue)
    if (isNaN(parsed.getTime())) { setDobError('Please enter a valid date.'); return }
    const age = (Date.now() - parsed) / (365.25 * 24 * 60 * 60 * 1000)
    if (age < 5 || age > 120) { setDobError('Please enter a valid date of birth.'); return }
    answer('dob', dobValue)
    setDobError('')
    next()
  }

  const handleComplete = () => {
    setCompleting(true)
    const graph = seedTasteGraph({ ...answers, poster_picks: selectedPosters })
    completeOnboarding(graph)
    navigate('/home')
  }

  const stepNum = (n) => <p className={styles.stepNum}>{String(n).padStart(2, '0')} —</p>

  return (
    <div className={styles.shell}>
      <div className={styles.progressTrack}>
        <motion.div className={styles.progressFill} animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} />
      </div>
      <div className={styles.logo}>MUAD'FILM</div>
      <div className={styles.content}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            className={styles.step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.45 }}
          >

            {/* ── Q0a: Date of birth ── */}
            {currentStep === 'q0_dob' && (
              <>
                {stepNum(1)}
                <h1 className={styles.q}>When were you born?</h1>
                <p className={styles.hint}>Helps us understand the era you grew up with. Optional.</p>
                <div className={styles.dobWrap}>
                  <input
                    className={styles.input}
                    type="date"
                    value={dobValue}
                    onChange={e => { setDobValue(e.target.value); setDobError('') }}
                    max={new Date().toISOString().split('T')[0]}
                    autoFocus
                  />
                  {dobError && <p className={styles.inputError}>{dobError}</p>}
                </div>
                <button className={styles.cta} onClick={handleDobNext}>
                  {dobValue ? 'Continue →' : 'Skip →'}
                </button>
              </>
            )}

            {/* ── Q0b: Language ── */}
            {currentStep === 'q0_language' && (
              <>
                {stepNum(2)}
                <h1 className={styles.q}>What language do you watch in?</h1>
                <p className={styles.hint}>We'll prioritise films in your language. English is the default.</p>
                <div className={styles.langGrid}>
                  {QUICK_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      className={`${styles.langCard} ${answers.language === lang.code ? styles.langCardActive : ''}`}
                      onClick={() => { answer('language', lang.code); next() }}
                    >
                      <span className={styles.langFlag}>{lang.flag}</span>
                      <span className={styles.langLabel}>{lang.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Q1: Frequency ── */}
            {currentStep === 'q1_frequency' && (
              <>
                {stepNum(3)}
                <h1 className={styles.q}>How often do you watch?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'daily',  label: 'Every day',          sub: 'Film is a daily ritual' },
                    { id: 'weekly', label: 'A few times a week', sub: 'When I have time' },
                    { id: 'rarely', label: 'Rarely',             sub: 'I need the right recommendation' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('watch_frequency', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q2a: Last watched ── */}
            {currentStep === 'q2_last_watched' && (
              <>
                {stepNum(4)}
                <h1 className={styles.q}>Last film or show you watched?</h1>
                <div className={styles.searchWrap}>
                  <input
                    className={styles.input}
                    placeholder="Start typing..."
                    value={movieQuery}
                    onChange={e => setMovieQuery(e.target.value)}
                    autoFocus
                  />
                  <AnimatePresence>
                    {movieResults.length > 0 && (
                      <motion.div className={styles.results} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {movieResults.map(r => (
                          <button key={r.id} className={styles.result} onClick={() => {
                            answer('last_watched', r); setMovieQuery(r.title || r.name); setMovieResults([]); next()
                          }}>
                            {r.poster_path && <img src={posterUrl(r.poster_path, 'w92')} alt="" className={styles.resultImg} />}
                            <div>
                              <div className={styles.resultTitle}>{r.title || r.name}</div>
                              <div className={styles.resultMeta}>{r.media_type} · {(r.release_date || r.first_air_date || '').slice(0,4)}</div>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button className={styles.skip} onClick={() => { answer('last_watched', null); next() }}>Skip</button>
              </>
            )}

            {/* ── Q3a: Finished? ── */}
            {currentStep === 'q3_finished' && (
              <>
                {stepNum(4)}
                <h1 className={styles.q}>Did you finish <em>{answers.last_watched?.title || answers.last_watched?.name}</em>?</h1>
                <div className={styles.choices}>
                  <Choice label="Yes, watched it all" sub="" onSelect={() => { answer('finished_last', true); next() }} />
                  <Choice label="No, I stopped" sub="" onSelect={() => { answer('finished_last', false); next() }} />
                </div>
              </>
            )}

            {/* ── Q3b: Why stopped ── */}
            {currentStep === 'q3_why' && (
              <>
                {stepNum(4)}
                <h1 className={styles.q}>Why did you stop?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'too_slow',   label: 'Too slow',         sub: 'Lost patience' },
                    { id: 'not_good',   label: 'Just not for me',  sub: 'Wrong vibe' },
                    { id: 'distracted', label: 'Got distracted',   sub: 'Life happened' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('abandon_reason', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q3c: Actor (daily/weekly path) ── */}
            {currentStep === 'q3_actor' && (
              <>
                {stepNum(5)}
                <h1 className={styles.q}>A favourite actor?</h1>
                <p className={styles.hint}>Someone whose films you'll always give a shot.</p>
                <div className={styles.searchWrap}>
                  <input
                    className={styles.input}
                    placeholder="e.g. Denzel Washington..."
                    value={actorQuery}
                    onChange={e => setActorQuery(e.target.value)}
                    autoFocus
                  />
                  <AnimatePresence>
                    {actorResults.length > 0 && (
                      <motion.div className={styles.results} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {actorResults.map(r => (
                          <button key={r.id} className={styles.result} onClick={() => {
                            answer('fav_actor', r); setActorQuery(r.name); setActorResults([]); next()
                          }}>
                            {r.profile_path && <img src={`https://image.tmdb.org/t/p/w92${r.profile_path}`} alt="" className={styles.resultImg} style={{ borderRadius: '50%' }} />}
                            <div>
                              <div className={styles.resultTitle}>{r.name}</div>
                              <div className={styles.resultMeta}>{r.known_for_department}</div>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button className={styles.skip} onClick={() => { answer('fav_actor', null); next() }}>Skip</button>
              </>
            )}

            {/* ── Q2b: Genre shelf (rarely path) ── */}
            {currentStep === 'q2_genre_shelf' && (
              <>
                {stepNum(4)}
                <h1 className={styles.q}>What's your default shelf?</h1>
                <p className={styles.hint}>The section you always check first.</p>
                <div className={styles.shelfGrid}>
                  {GENRE_SHELVES.map(s => (
                    <button key={s.id} className={styles.shelfCard}
                      onClick={() => { answer('genre_shelf', s.id); next() }}>
                      <span className={styles.shelfEmoji}>{s.emoji}</span>
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Q4a: Character type ── */}
            {currentStep === 'q4_character' && (
              <>
                {stepNum(5)}
                <h1 className={styles.q}>Who do you root for?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'hero',    label: 'The hero',         sub: 'Clear morals, big stakes' },
                    { id: 'villain', label: 'The villain',      sub: 'Complex, seductive, broken' },
                    { id: 'complex', label: 'Neither',          sub: 'Real people don\'t fit boxes' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('character_type', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q4b: Pace ── */}
            {currentStep === 'q4_pace' && (
              <>
                {stepNum(6)}
                <h1 className={styles.q}>Your ideal pace?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'fast',   label: 'Fast',    sub: 'Never a dull moment' },
                    { id: 'medium', label: 'Balanced', sub: 'Story and action in rhythm' },
                    { id: 'slow',   label: 'Slow',    sub: 'Let it breathe' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('pace', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q4c: Context ── */}
            {currentStep === 'q4_context' && (
              <>
                {stepNum(7)}
                <h1 className={styles.q}>How do you usually watch?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'solo',   label: 'Solo',          sub: 'Just me and the screen' },
                    { id: 'social', label: 'With people',   sub: 'Group watch, shared reactions' },
                    { id: 'either', label: 'Either',        sub: 'Depends on the film' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('watch_context', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q5a: Mood ── */}
            {currentStep === 'q5_mood' && (
              <>
                {stepNum(8)}
                <h1 className={styles.q}>What do you want from a film?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'feel',      label: 'To feel something',     sub: 'Emotion, weight, meaning' },
                    { id: 'entertain', label: 'To be entertained',     sub: 'Fun, action, laughs' },
                    { id: 'escape',    label: 'To escape',             sub: 'Other worlds, other lives' },
                    { id: 'either',    label: 'Depends on the night',  sub: 'No fixed preference' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('mood_preference', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q5b: Rewatch ── */}
            {currentStep === 'q5_rewatch' && (
              <>
                {stepNum(9)}
                <h1 className={styles.q}>New films or comfort picks?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'new',     label: 'Always something new',   sub: 'Discovery is the point' },
                    { id: 'comfort', label: 'Back to favourites',     sub: 'Some films never get old' },
                    { id: 'either',  label: 'Mix of both',            sub: 'Mood-dependent' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('rewatch_preference', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q5c: Era ── */}
            {currentStep === 'q5_era' && (
              <>
                {stepNum(10)}
                <h1 className={styles.q}>Any era preference?</h1>
                <div className={styles.choices}>
                  {[
                    { id: 'modern',  label: 'Modern',  sub: '2010 and newer' },
                    { id: 'retro',   label: 'Retro',   sub: '1990s to 2005' },
                    { id: 'classic', label: 'Classic', sub: 'Before 1990' },
                    { id: 'any',     label: 'No preference', sub: 'Best film wins' },
                  ].map(o => (
                    <Choice key={o.id} label={o.label} sub={o.sub}
                      onSelect={() => { answer('era_preference', o.id); next() }} />
                  ))}
                </div>
              </>
            )}

            {/* ── Q6a: Favourite film ── */}
            {currentStep === 'q6_fav_film' && (
              <>
                {stepNum(11)}
                <h1 className={styles.q}>Do you have a favourite film?</h1>
                <p className={styles.hint}>The one you'd show someone to explain your taste.</p>
                <div className={styles.searchWrap}>
                  <input
                    className={styles.input}
                    placeholder="Search for a film..."
                    value={favFilmQuery}
                    onChange={e => setFavFilmQuery(e.target.value)}
                    autoFocus
                  />
                  <AnimatePresence>
                    {favFilmResults.length > 0 && (
                      <motion.div className={styles.results} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {favFilmResults.map(r => (
                          <button key={r.id} className={styles.result} onClick={() => {
                            answer('fav_film', r); setFavFilmQuery(r.title || r.name); setFavFilmResults([]); next()
                          }}>
                            {r.poster_path && <img src={posterUrl(r.poster_path, 'w92')} alt="" className={styles.resultImg} />}
                            <div>
                              <div className={styles.resultTitle}>{r.title || r.name}</div>
                              <div className={styles.resultMeta}>{(r.release_date || '').slice(0,4)}</div>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button className={styles.skip} onClick={() => { answer('fav_film', null); next() }}>Skip</button>
              </>
            )}

            {/* ── Q6b: Favourite director ── */}
            {currentStep === 'q6_director' && (
              <>
                {stepNum(12)}
                <h1 className={styles.q}>A director whose work you trust?</h1>
                <p className={styles.hint}>Someone whose name on a poster is enough.</p>
                <div className={styles.searchWrap}>
                  <input
                    className={styles.input}
                    placeholder="e.g. Christopher Nolan..."
                    value={directorQuery}
                    onChange={e => setDirectorQuery(e.target.value)}
                    autoFocus
                  />
                  <AnimatePresence>
                    {directorResults.length > 0 && (
                      <motion.div className={styles.results} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {directorResults.map(r => (
                          <button key={r.id} className={styles.result} onClick={() => {
                            answer('fav_director', r); setDirectorQuery(r.name); setDirectorResults([]); next()
                          }}>
                            {r.profile_path && <img src={`https://image.tmdb.org/t/p/w92${r.profile_path}`} alt="" className={styles.resultImg} style={{ borderRadius: '50%' }} />}
                            <div>
                              <div className={styles.resultTitle}>{r.name}</div>
                              <div className={styles.resultMeta}>Director</div>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button className={styles.skip} onClick={() => { answer('fav_director', null); next() }}>Skip</button>
              </>
            )}

            {/* ── Q7: Poster picks ── */}
            {currentStep === 'q7_posters' && (
              <>
                {stepNum(13)}
                <h1 className={styles.q}>Pick three that resonate.</h1>
                <p className={styles.hint}>{selectedPosters.length}/3 selected · hover for synopsis</p>

                {loadingTiles ? (
                  <div className={styles.tilesLoading}>
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}>
                      Curating picks for you...
                    </motion.span>
                  </div>
                ) : (
                  <div className={styles.posterGrid}>
                    {seedTiles.map(film => {
                      const sel      = selectedPosters.some(p => p.id === film.id)
                      const isHovered = hoveredPoster === film.id
                      return (
                        <motion.button
                          key={film.id}
                          className={`${styles.posterTile} ${sel ? styles.posterSel : ''}`}
                          onClick={() => {
                            if (sel) setSelectedPosters(p => p.filter(x => x.id !== film.id))
                            else if (selectedPosters.length < 3) setSelectedPosters(p => [...p, film])
                          }}
                          onHoverStart={() => setHoveredPoster(film.id)}
                          onHoverEnd={() => setHoveredPoster(null)}
                          whileHover={{ scale: 1.03 }}
                          transition={{ duration: 0.2 }}
                        >
                          {film.poster_path
                            ? <img src={posterUrl(film.poster_path)} alt={film.title} className={styles.posterImg} />
                            : <div className={styles.posterFallback}>{film.title?.slice(0,2)}</div>
                          }
                          <div className={styles.posterTitle}>{film.title}</div>
                          <AnimatePresence>
                            {isHovered && (
                              <motion.div className={styles.posterSynopsis} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                                <p className={styles.posterSynopsisYear}>
                                  {(film.release_date || '').slice(0,4)}
                                  {film.vote_average ? ` · ${film.vote_average.toFixed(1)}★` : ''}
                                </p>
                                <p className={styles.posterSynopsisText}>
                                  {film.overview ? film.overview.slice(0, 120) + (film.overview.length > 120 ? '…' : '') : 'No synopsis available.'}
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          {sel && <motion.div className={styles.posterCheck} initial={{ scale: 0 }} animate={{ scale: 1 }}>✓</motion.div>}
                        </motion.button>
                      )
                    })}
                  </div>
                )}

                <button
                  className={styles.cta}
                  onClick={handleComplete}
                  disabled={completing || loadingTiles || selectedPosters.length < 3}
                >
                  {completing ? 'Building your profile...' : "Enter Muad'film →"}
                </button>
              </>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Choice({ label, sub, onSelect }) {
  return (
    <motion.button className={styles.choice} onClick={onSelect} whileHover={{ x: 8 }} transition={{ duration: 0.15 }}>
      <span className={styles.choiceLabel}>{label}</span>
      {sub && <span className={styles.choiceSub}>{sub}</span>}
      <span className={styles.choiceArrow}>→</span>
    </motion.button>
  )
}