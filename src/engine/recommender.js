// src/engine/recommender.js
import { GENRE_MAP, inferToneTags } from '../lib/tmdb'

const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

export const SIGNAL_TARGETS = {
  rewatched:     +1.0,
  liked:         +0.8,
  completed:     +0.5,
  watchlisted:   +0.35,
  viewed:        +0.15,
  search_click:  +0.20,
  unwatchlisted: -0.15,
  skipped:       -0.3,
  abandoned:     -0.6,
  disliked:      -1.0,
}

// ─── Age bracket from DOB ─────────────────────────────────────────────────────
// Used to bias era preference at seed time if user hasn't explicitly set one.
export const getAgeBracket = (dob) => {
  if (!dob) return null
  const age = Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 60 * 60 * 1000))
  if (age < 18)  return 'gen_z_young'   // <18: very modern content
  if (age < 28)  return 'gen_z'         // 18–27: modern, some 2000s
  if (age < 40)  return 'millennial'    // 28–39: 90s–2000s + modern
  if (age < 55)  return 'gen_x'         // 40–54: 80s–2000s
  return 'boomer'                        // 55+: classic + retro
}

const ERA_BIAS_FROM_AGE = {
  gen_z_young: 'modern',
  gen_z:       'modern',
  millennial:  'any',     // comfortable with any era
  gen_x:       'retro',
  boomer:      'classic',
}

// ─── Era scoring ──────────────────────────────────────────────────────────────
const scoreEra = (year, eraPref) => {
  const currentYear = new Date().getFullYear()

  if (!eraPref || eraPref === 'any') {
    const age = currentYear - year
    if (age <= 2)  return 0.72
    if (age <= 5)  return 0.68
    if (age <= 10) return 0.62
    if (age <= 20) return 0.55
    if (age <= 35) return 0.45
    return 0.35
  }
  if (eraPref === 'classic') {
    if (year < 1970) return 0.95
    if (year < 1990) return 0.85
    if (year < 2005) return 0.50
    return 0.25
  }
  if (eraPref === 'retro') {
    if (year >= 1985 && year < 1995) return 0.95
    if (year >= 1995 && year < 2008) return 0.85
    if (year < 1985)  return 0.50
    return 0.30
  }
  if (eraPref === 'modern') {
    if (year >= 2015) return 0.95
    if (year >= 2010) return 0.80
    if (year >= 2005) return 0.55
    return 0.25
  }
  return 0.5
}

// ─── Core scoring ─────────────────────────────────────────────────────────────
export const scoreContent = (content, tasteGraph) => {
  if (!tasteGraph) return 0.5

  let score = 0, weight = 0

  // Language gate — if user has a language preference and this film doesn't match,
  // apply a heavy penalty instead of hard-excluding (hard exclusion happens at query level,
  // this catches anything that slips through trending/fallback queries)
  if (tasteGraph.language && tasteGraph.language !== 'any') {
    const lang = content.original_language || content.original_lang
    if (lang && lang !== tasteGraph.language) {
      // Non-matching language: cap score at 0.3 regardless of other signals
      return 0.15
    }
  }

  // Hard exclude docs and TV movies that slip through (e.g. from trending)
  const genreIds = content.genre_ids || []
  if (genreIds.includes(99) || genreIds.includes(10770)) return 0

  // Genre — 35%
  const genres = genreIds.map(id => GENRE_MAP[id]).filter(Boolean)
  if (genres.length > 0) {
    const s = genres.reduce((sum, g) => sum + (tasteGraph.genre_weights[g] ?? 0.5), 0) / genres.length
    score += s * 0.35; weight += 0.35
  }

  // Tone — 18%
  const tones = content.tone_tags || []
  if (tones.length > 0) {
    const s = tones.reduce((sum, t) => sum + (tasteGraph.tone_weights[t] ?? 0.5), 0) / tones.length
    score += s * 0.18; weight += 0.18
  }

  // Era — 14%
  const year = parseInt((content.release_date || content.first_air_date || '2000').slice(0, 4))
  score += scoreEra(year, tasteGraph.era_preference) * 0.14; weight += 0.14

  // Quality — 10%
  const voteAvg    = content.vote_average ?? 5
  const voteCount  = content.vote_count   ?? 0
  const voteWeight = Math.min(voteCount / 5000, 1)
  score += ((voteAvg / 10) * (0.6 + 0.4 * voteWeight)) * 0.10; weight += 0.10

  // Popularity — 8%
  const pop = content.popularity || 50
  let popScore
  if (tasteGraph.discovery_mode === 'new') {
    popScore = pop < 20 ? 0.85 : pop < 60 ? 0.70 : pop < 150 ? 0.50 : pop < 300 ? 0.30 : 0.15
  } else {
    popScore = clamp(pop / 200, 0, 1)
  }
  score += popScore * 0.08; weight += 0.08

  // Pace — 6%
  if (content.pace_score !== undefined) {
    const diff = Math.abs((content.pace_score ?? 0) - (tasteGraph.pace_score ?? 0))
    score += Math.exp(-diff * diff * 2) * 0.06; weight += 0.06
  }

  // Context — 5%
  const h = new Date().getHours()
  const isLateNight = h >= 22 || h <= 4
  score += (tasteGraph.watch_context?.[isLateNight ? 'late_night' : 'daytime'] ?? 0.5) * 0.05
  weight += 0.05

  // Director affinity — additive
  if (content.director_id) {
    const match = (tasteGraph.director_affinities || []).find(d => d.id === content.director_id)
    if (match) score += match.score * 0.08
  }

  // Actor affinity — additive, 1.5x for actors with 3+ appearances
  if ((tasteGraph.actor_affinities || []).length > 0 && content.cast_ids?.length > 0) {
    const castSet = new Set(content.cast_ids)
    let actorBonus = 0
    ;(tasteGraph.actor_affinities).forEach(a => {
      if (castSet.has(a.id)) {
        const multiplier = (a.appearances || 0) >= 3 ? 1.5 : 1.0
        actorBonus += a.score * multiplier
      }
    })
    if (actorBonus > 0) score += clamp(actorBonus, 0, 0.15)
  }

  return weight > 0 ? clamp(score / weight, 0, 1) : 0.5
}

// ─── Diversity re-ranking ─────────────────────────────────────────────────────
export const diversifyShelf = (items, maxPerGenre = 4) => {
  const genreCount = {}
  const result = [], overflow = []
  for (const item of items) {
    const g = (item.genre_ids || [])[0]
    const count = genreCount[g] || 0
    if (count < maxPerGenre) { result.push(item); genreCount[g] = count + 1 }
    else overflow.push(item)
  }
  return [...result, ...overflow].slice(0, items.length)
}

// ─── Online gradient descent ──────────────────────────────────────────────────
const BASE_LR = 0.8

export const processSignalLocally = (tasteGraph, event, contentMeta) => {
  const y = SIGNAL_TARGETS[event.event_type]
  if (y === undefined) return tasteGraph

  const confidence = tasteGraph.confidence ?? 0.3
  const α          = BASE_LR * (1 - confidence)
  const ŷ          = scoreContent(contentMeta, tasteGraph)
  const residual   = y - ŷ

  if (Math.abs(residual) < 0.04)
    return { ...tasteGraph, confidence: clamp(confidence + 0.01, 0, 1) }

  const genreWeights = { ...tasteGraph.genre_weights }
  const toneWeights  = { ...tasteGraph.tone_weights }

  const genres = (contentMeta.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean)
  const genreX = genres.length > 0 ? 1 / genres.length : 0
  genres.forEach(g => {
    if (genreWeights[g] !== undefined)
      genreWeights[g] = clamp(genreWeights[g] + α * residual * genreX, 0, 1)
  })

  const tones = contentMeta.tone_tags || []
  const toneX = tones.length > 0 ? 1 / tones.length : 0
  tones.forEach(t => {
    if (toneWeights[t] !== undefined)
      toneWeights[t] = clamp(toneWeights[t] + α * residual * toneX, 0, 1)
  })

  let actorAffinities = (tasteGraph.actor_affinities || []).map(a => ({ ...a }))
  if (y >= 0.35 && contentMeta.cast_ids?.length > 0) {
    contentMeta.cast_ids.slice(0, 5).forEach(id => {
      const existing = actorAffinities.find(a => a.id === id)
      if (existing) {
        existing.score       = clamp(existing.score + α * 0.08 * Math.max(y, 0), 0, 1)
        existing.appearances = (existing.appearances || 1) + 1
      } else if (y >= 0.5) {
        actorAffinities.push({ id, name: contentMeta.cast_names?.[id] || '', score: 0.5 + α * 0.1, appearances: 1 })
      }
    })
  }
  if (y < 0 && contentMeta.cast_ids?.length > 0) {
    actorAffinities = actorAffinities.map(a =>
      contentMeta.cast_ids.includes(a.id)
        ? { ...a, score: clamp(a.score + α * residual * 0.05, 0, 1) }
        : a
    )
  }

  let directorAffinities = (tasteGraph.director_affinities || []).map(d => ({ ...d }))
  if (contentMeta.director_id) {
    const existing = directorAffinities.find(d => d.id === contentMeta.director_id)
    if (existing) {
      existing.score = clamp(existing.score + α * residual * 0.1, 0, 1)
    } else if (y >= 0.5) {
      directorAffinities.push({ id: contentMeta.director_id, name: contentMeta.director_name || '', score: 0.5 + α * 0.08 })
    }
  }

  return {
    ...tasteGraph,
    genre_weights:       genreWeights,
    tone_weights:        toneWeights,
    actor_affinities:    actorAffinities,
    director_affinities: directorAffinities,
    confidence:          clamp(confidence + 0.02, 0, 1),
  }
}

// ─── Periodic reinforcement ───────────────────────────────────────────────────
export const runPeriodicReinforcement = (tasteGraph, watched, watchlist) => {
  if (!tasteGraph) return tasteGraph
  let graph = { ...tasteGraph }

  const reactionSignals = { loved: 'rewatched', liked: 'liked', mid: 'completed', abandoned: 'abandoned' }

  ;(watched || []).slice(0, 30).forEach(item => {
    if (!item.reaction) return
    const y = SIGNAL_TARGETS[reactionSignals[item.reaction] || 'completed']
    if (!y) return
    const confidence = graph.confidence ?? 0.3
    const α          = BASE_LR * (1 - confidence) * 0.2
    const ŷ          = scoreContent(item, graph)
    const residual   = y - ŷ
    if (Math.abs(residual) < 0.08) return

    const genreWeights = { ...graph.genre_weights }
    const genres = (item.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean)
    const genreX = genres.length > 0 ? 1 / genres.length : 0
    genres.forEach(g => {
      if (genreWeights[g] !== undefined)
        genreWeights[g] = clamp(genreWeights[g] + α * residual * genreX, 0, 1)
    })

    const toneWeights = { ...graph.tone_weights }
    ;(item.tone_tags || []).forEach(t => {
      if (toneWeights[t] !== undefined)
        toneWeights[t] = clamp(toneWeights[t] + α * residual / Math.max(item.tone_tags.length, 1), 0, 1)
    })

    graph = { ...graph, genre_weights: genreWeights, tone_weights: toneWeights }
  })

  ;(watchlist || []).slice(0, 20).forEach(item => {
    const y  = SIGNAL_TARGETS['watchlisted']
    const α  = BASE_LR * (1 - (graph.confidence ?? 0.3)) * 0.1
    const ŷ  = scoreContent(item, graph)
    const residual = y - ŷ
    if (Math.abs(residual) < 0.10) return

    const genreWeights = { ...graph.genre_weights }
    const genres = (item.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean)
    const genreX = genres.length > 0 ? 1 / genres.length : 0
    genres.forEach(g => {
      if (genreWeights[g] !== undefined)
        genreWeights[g] = clamp(genreWeights[g] + α * residual * genreX, 0, 1)
    })
    graph = { ...graph, genre_weights: genreWeights }
  })

  return graph
}

// ─── Tone enrichment ──────────────────────────────────────────────────────────
export const enrichContentWithTones = (content, keywords = []) => ({
  ...content,
  tone_tags: inferToneTags(keywords),
})

// ─── Taste graph seeding ──────────────────────────────────────────────────────
export const seedTasteGraph = (answers) => {
  // Infer era bias from age if user hasn't explicitly set era preference
  const ageBracket = getAgeBracket(answers.dob)
  const inferredEra = answers.era_preference || ERA_BIAS_FROM_AGE[ageBracket] || 'any'

  const graph = {
    genre_weights: {
      action: 0.5, thriller: 0.5, drama: 0.5, comedy: 0.5,
      horror: 0.5, sci_fi: 0.5, romance: 0.5, documentary: 0.5,
      animation: 0.5, crime: 0.5, mystery: 0.5, fantasy: 0.5,
      adventure: 0.5, history: 0.5,
    },
    tone_weights: {
      dark: 0.5, hopeful: 0.5, intense: 0.5, cerebral: 0.5,
      visceral: 0.5, quiet: 0.5, emotional: 0.5, funny: 0.5,
    },
    pace_score: 0, actor_affinities: [], director_affinities: [],
    watch_context: { solo: 0.5, social: 0.5, late_night: 0.5, daytime: 0.5 },
    catalogue_depth: 0.5,
    watch_frequency:    answers.watch_frequency    || 'weekly',
    era_preference:     inferredEra,
    rewatch_preference: answers.rewatch_preference || 'new',
    discovery_mode:     answers.discovery_mode     || 'new',
    mood_preference:    answers.mood_preference    || 'either',
    language:           answers.language           || 'en',  // default: English
    dob:                answers.dob                || null,
    age_bracket:        ageBracket,
    confidence: 0.3,
  }

  // Documentary genre weight — set to 0 since we exclude it everywhere
  graph.genre_weights.documentary = 0

  if (answers.watch_frequency === 'daily')  graph.catalogue_depth = 0.8
  if (answers.watch_frequency === 'rarely') graph.catalogue_depth = 0.3
  if (answers.finished_last === false && answers.abandon_reason === 'too_slow') graph.pace_score = 0.5

  if (answers.character_type === 'villain') {
    graph.tone_weights.dark += 0.25; graph.tone_weights.cerebral += 0.15
    graph.genre_weights.thriller += 0.20; graph.genre_weights.crime += 0.20
  } else if (answers.character_type === 'complex') {
    graph.tone_weights.cerebral += 0.25; graph.tone_weights.emotional += 0.15
    graph.genre_weights.drama += 0.20
  } else if (answers.character_type === 'hero') {
    graph.tone_weights.hopeful += 0.20
    graph.genre_weights.action += 0.15; graph.genre_weights.adventure += 0.15
  }

  if (answers.pace === 'fast') graph.pace_score = 0.65
  else if (answers.pace === 'slow') graph.pace_score = -0.5

  if (answers.watch_context === 'solo') {
    graph.watch_context.solo = 0.85; graph.tone_weights.dark += 0.12; graph.tone_weights.cerebral += 0.12
  } else if (answers.watch_context === 'social') {
    graph.watch_context.social = 0.85; graph.genre_weights.comedy += 0.20; graph.tone_weights.funny += 0.20
  }

  const shelfBoosts = {
    thriller_crime: { thriller: 0.30, crime: 0.30, mystery: 0.18 },
    sci_fi_fantasy: { sci_fi: 0.30, fantasy: 0.25, adventure: 0.12 },
    dark_drama:     { drama: 0.30, tone_dark: 0.25, tone_emotional: 0.18 },
    comedy_light:   { comedy: 0.35, romance: 0.12, tone_funny: 0.25, tone_hopeful: 0.18 },
    horror_intense: { horror: 0.35, thriller: 0.18, tone_visceral: 0.25 },
  }
  Object.entries(shelfBoosts[answers.genre_shelf] || {}).forEach(([key, val]) => {
    if (key.startsWith('tone_')) {
      const tk = key.replace('tone_', '')
      if (graph.tone_weights[tk] !== undefined) graph.tone_weights[tk] = clamp(graph.tone_weights[tk] + val, 0, 1)
    } else if (graph.genre_weights[key] !== undefined) {
      graph.genre_weights[key] = clamp(graph.genre_weights[key] + val, 0, 1)
    }
  })

  if (answers.mood_preference === 'feel') {
    graph.tone_weights.emotional += 0.22; graph.tone_weights.quiet += 0.12; graph.genre_weights.drama += 0.18
  } else if (answers.mood_preference === 'entertain') {
    graph.tone_weights.funny += 0.12; graph.genre_weights.action += 0.12
    graph.genre_weights.comedy += 0.12; graph.genre_weights.adventure += 0.12
  } else if (answers.mood_preference === 'escape') {
    graph.genre_weights.sci_fi += 0.18; graph.genre_weights.fantasy += 0.18; graph.genre_weights.adventure += 0.12
  }

  if (answers.rewatch_preference === 'comfort') graph.catalogue_depth = clamp(graph.catalogue_depth - 0.1, 0, 1)
  else if (answers.rewatch_preference === 'new') { graph.discovery_mode = 'new'; graph.catalogue_depth = clamp(graph.catalogue_depth + 0.15, 0, 1) }

  if (answers.fav_actor)    graph.actor_affinities.push({ id: answers.fav_actor.id, name: answers.fav_actor.name, score: 0.85, appearances: 1 })
  if (answers.fav_director) graph.director_affinities.push({ id: answers.fav_director.id, name: answers.fav_director.name, score: 0.9 })

  if (answers.fav_film) {
    ;(answers.fav_film.genre_ids || []).forEach(id => {
      const g = GENRE_MAP[id]
      if (g && graph.genre_weights[g] !== undefined) graph.genre_weights[g] = clamp(graph.genre_weights[g] + 0.22, 0, 1)
    })
  }

  if (answers.poster_picks?.length > 0) {
    answers.poster_picks.forEach(pick => {
      ;(pick.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean).forEach(g => {
        if (graph.genre_weights[g] !== undefined) graph.genre_weights[g] = clamp(graph.genre_weights[g] + 0.18, 0, 1)
      })
    })
  }

  Object.keys(graph.genre_weights).forEach(k => { graph.genre_weights[k] = clamp(graph.genre_weights[k], 0, 1) })
  Object.keys(graph.tone_weights).forEach(k => { graph.tone_weights[k] = clamp(graph.tone_weights[k], 0, 1) })
  return graph
}

// ─── Dynamic seed tiles ───────────────────────────────────────────────────────
export const getDynamicSeedTiles = async (partialAnswers) => {
  const { discoverMovies } = await import('../lib/tmdb')
  const language = partialAnswers.language || 'en'

  const genreMap        = { thriller_crime: [53, 80], sci_fi_fantasy: [878, 14], dark_drama: [18], comedy_light: [35], horror_intense: [27] }
  const characterGenres = { villain: [53, 80, 18], complex: [18, 9648], hero: [28, 12] }
  const moodGenres      = { feel: [18, 10749], entertain: [28, 35, 12], escape: [878, 14, 12] }
  const eraFilters      = {
    classic: { 'primary_release_date.lte': '1990-12-31', 'primary_release_date.gte': '1950-01-01' },
    retro:   { 'primary_release_date.lte': '2005-12-31', 'primary_release_date.gte': '1990-01-01' },
    modern:  { 'primary_release_date.gte': '2010-01-01' },
    any:     { 'primary_release_date.gte': '2000-01-01' },
  }

  // Infer era from DOB if not set
  const ageBracket  = getAgeBracket(partialAnswers.dob)
  const inferredEra = partialAnswers.era_preference || ERA_BIAS_FROM_AGE[ageBracket] || 'any'

  const allGenreIds = [...new Set([
    ...(genreMap[partialAnswers.genre_shelf] || []),
    ...(characterGenres[partialAnswers.character_type] || []),
    ...(moodGenres[partialAnswers.mood_preference] || []),
  ])]
  const eraFilter = eraFilters[inferredEra] || eraFilters.any

  try {
    const results = await Promise.all([
      allGenreIds.length
        ? discoverMovies({ with_genres: allGenreIds.slice(0, 2).join('|'), sort_by: 'vote_average.desc', 'vote_count.gte': 500, ...eraFilter }, language)
        : Promise.resolve({ results: [] }),
      discoverMovies({ with_genres: allGenreIds.length ? allGenreIds.slice(0, 3).join('|') : '', sort_by: 'popularity.desc', 'vote_count.gte': 300, ...eraFilter }, language),
      discoverMovies({ sort_by: 'vote_average.desc', 'vote_count.gte': 800, ...eraFilter }, language),
    ])
    const seen = new Set()
    const unique = results.flatMap(r => r.results || []).filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
    const partialGraph = seedTasteGraph(partialAnswers)
    const scored = unique.map(c => ({ ...c, _score: scoreContent(c, partialGraph) })).sort((a, b) => b._score - a._score)
    return diversifyShelf(scored, 3).slice(0, 12)
  } catch (e) {
    console.error('getDynamicSeedTiles failed:', e)
    return []
  }
}