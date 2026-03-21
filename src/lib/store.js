// src/lib/store.js
import { create } from 'zustand'
import { processSignalLocally, enrichContentWithTones, getAgeBracket } from '../engine/recommender'

const userKey    = (uid, key) => `mf_${uid}_${key}`
const load       = (uid, key, fallback = null) => { try { const s = localStorage.getItem(userKey(uid, key)); return s ? JSON.parse(s) : fallback } catch { return fallback } }
const save       = (uid, key, val) => { try { localStorage.setItem(userKey(uid, key), JSON.stringify(val)) } catch {} }
const loadGlobal = (key, fallback = null) => { try { const s = localStorage.getItem(`mf_${key}`); return s ? JSON.parse(s) : fallback } catch { return fallback } }
const saveGlobal = (key, val) => { try { localStorage.setItem(`mf_${key}`, JSON.stringify(val)) } catch {} }

const getUsers  = () => loadGlobal('users', {})
const saveUsers = (users) => saveGlobal('users', users)
const mockHash  = (pw) => btoa(pw)

export const mockSignup = (email, displayName, password) => {
  const users = getUsers()
  if (Object.values(users).find(u => u.email === email)) return { error: 'An account with this email already exists.' }
  const id = `user_${Date.now()}`
  const user = { id, email, displayName, passwordHash: mockHash(password), createdAt: new Date().toISOString() }
  users[id] = user; saveUsers(users); return { user }
}

export const mockLogin = (email, password) => {
  const users = getUsers()
  const user  = Object.values(users).find(u => u.email === email)
  if (!user) return { error: 'No account found with this email.' }
  if (user.passwordHash !== mockHash(password)) return { error: 'Incorrect password.' }
  return { user }
}

export const mockUpdateProfile = (uid, updates) => {
  const users = getUsers()
  if (!users[uid]) return { error: 'User not found.' }
  if (updates.newPassword) {
    if (updates.currentPassword && users[uid].passwordHash !== mockHash(updates.currentPassword))
      return { error: 'Current password is incorrect.' }
    updates.passwordHash = mockHash(updates.newPassword)
    delete updates.newPassword; delete updates.currentPassword
  }
  users[uid] = { ...users[uid], ...updates }; saveUsers(users); return { user: users[uid] }
}

export const DEFAULT_GRAPH = {
  genre_weights: {
    action: 0.5, thriller: 0.5, drama: 0.5, comedy: 0.5,
    horror: 0.5, sci_fi: 0.5, romance: 0.5, documentary: 0,
    animation: 0.5, crime: 0.5, mystery: 0.5, fantasy: 0.5,
    adventure: 0.5, history: 0.5,
  },
  tone_weights: {
    dark: 0.5, hopeful: 0.5, intense: 0.5, cerebral: 0.5,
    visceral: 0.5, quiet: 0.5, emotional: 0.5, funny: 0.5,
  },
  pace_score: 0, actor_affinities: [], director_affinities: [],
  watch_context: { solo: 0.5, social: 0.5, late_night: 0.5, daytime: 0.5 },
  catalogue_depth: 0.5, watch_frequency: 'weekly', era_preference: 'any',
  rewatch_preference: 'new', discovery_mode: 'new', mood_preference: 'either',
  language: 'en',   // default: English only
  dob: null,
  age_bracket: null,
  confidence: 0.1,
}

const loadUserState = (uid) => ({
  tasteGraph:     load(uid, 'taste_graph', { ...DEFAULT_GRAPH }),
  onboardingDone: load(uid, 'onboarding', false),
  watchlist:      load(uid, 'watchlist', []),
  watched:        load(uid, 'watched', []),
  favourites:     load(uid, 'favourites', [null, null, null]),
})

const silentGraphUpdate = (uid, updated) => {
  try { localStorage.setItem(userKey(uid, 'taste_graph'), JSON.stringify(updated)) } catch {}
  useStore.setState({ tasteGraph: updated }, false)
}

const useStore = create((set, get) => {
  const sessionUid  = loadGlobal('session_uid', null)
  const sessionUser = sessionUid ? (getUsers()[sessionUid] || null) : null

  return {
    currentUser: sessionUser,
    authError:   null,
    ...(sessionUser ? loadUserState(sessionUser.id) : {
      tasteGraph: { ...DEFAULT_GRAPH }, onboardingDone: false,
      watchlist: [], watched: [], favourites: [null, null, null],
    }),

    signup: (email, displayName, password) => {
      const r = mockSignup(email, displayName, password)
      if (r.error) { set({ authError: r.error }); return false }
      saveGlobal('session_uid', r.user.id)
      set({ currentUser: r.user, authError: null, ...loadUserState(r.user.id) })
      return true
    },

    login: (email, password) => {
      const r = mockLogin(email, password)
      if (r.error) { set({ authError: r.error }); return false }
      saveGlobal('session_uid', r.user.id)
      set({ currentUser: r.user, authError: null, ...loadUserState(r.user.id) })
      return true
    },

    logout: () => {
      saveGlobal('session_uid', null)
      set({ currentUser: null, authError: null, tasteGraph: { ...DEFAULT_GRAPH }, onboardingDone: false, watchlist: [], watched: [], favourites: [null, null, null] })
    },

    clearAuthError: () => set({ authError: null }),

    updateProfile: (updates) => {
      const { currentUser } = get()
      if (!currentUser) return { error: 'Not logged in.' }
      const r = mockUpdateProfile(currentUser.id, updates)
      if (r.error) return r
      set({ currentUser: r.user }); return { success: true }
    },

    completeOnboarding: (graph) => {
      const { currentUser } = get()
      const uid = currentUser?.id || 'guest'
      save(uid, 'taste_graph', graph); save(uid, 'onboarding', true)
      set({ tasteGraph: graph, onboardingDone: true })
    },

    resetTasteGraph: () => {
      const { currentUser } = get()
      const uid = currentUser?.id || 'guest'
      save(uid, 'taste_graph', { ...DEFAULT_GRAPH }); save(uid, 'onboarding', false)
      set({ tasteGraph: { ...DEFAULT_GRAPH }, onboardingDone: false })
    },

    // ── Update language / DOB from Profile ───────────────────────────────
    // These are high-priority preference changes — update React state fully
    // so the UI reflects the change immediately (e.g. language badge in sidebar).
    updateTasteGraphPrefs: ({ language, dob }) => {
      const { tasteGraph, currentUser } = get()
      if (!tasteGraph) return
      const uid = currentUser?.id || 'guest'
      const ageBracket = getAgeBracket(dob)
      const updated = {
        ...tasteGraph,
        language:    language ?? tasteGraph.language,
        dob:         dob ?? tasteGraph.dob,
        age_bracket: ageBracket ?? tasteGraph.age_bracket,
      }
      save(uid, 'taste_graph', updated)
      set({ tasteGraph: updated })
    },

    // ── Core signal processor ─────────────────────────────────────────────

    recordWatchEvent: (event, contentMeta) => {
      const { tasteGraph, currentUser } = get()
      if (!tasteGraph) return
      const uid     = currentUser?.id || 'guest'
      const updated = processSignalLocally(tasteGraph, event, contentMeta)
      save(uid, 'taste_graph', updated); set({ tasteGraph: updated })
    },

    // ── Passive enrichment (no re-render) ────────────────────────────────

    enrichAndLearn: (item, details) => {
      const { tasteGraph, currentUser, watched } = get()
      if (!tasteGraph || !details) return
      const uid      = currentUser?.id || 'guest'
      const keywords = details.keywords?.keywords || details.keywords?.results || []
      const toneTags = enrichContentWithTones(item, keywords).tone_tags
      const castIds  = (details.credits?.cast || []).slice(0, 10).map(a => a.id)
      const director = details.credits?.crew?.find(c => c.job === 'Director')

      let updated = { ...tasteGraph }
      const alreadyRated = watched.some(w => w.id === item.id)

      if (!alreadyRated && toneTags.length > 0) {
        updated = processSignalLocally(updated, { event_type: 'viewed' }, {
          genre_ids: item.genre_ids || [], tone_tags: toneTags,
          cast_ids: castIds, popularity: item.popularity, director_id: director?.id,
        })
      } else if (toneTags.length > 0) {
        const toneWeights = { ...updated.tone_weights }
        toneTags.forEach(t => { if (toneWeights[t] !== undefined) toneWeights[t] = Math.min(Math.max(toneWeights[t] + 0.01, 0), 1) })
        updated = { ...updated, tone_weights: toneWeights }
      }

      if (director) {
        const directorAffinities = (updated.director_affinities || []).map(d => ({ ...d }))
        const existing = directorAffinities.find(d => d.id === director.id)
        if (existing) existing.score = Math.min(existing.score + 0.02, 1)
        updated = { ...updated, director_affinities: directorAffinities }
      }

      silentGraphUpdate(uid, updated)
    },

    // ── Search click ──────────────────────────────────────────────────────

    recordSearchClick: (item) => {
      const { tasteGraph, currentUser } = get()
      if (!tasteGraph) return
      const uid     = currentUser?.id || 'guest'
      const updated = processSignalLocally(tasteGraph, { event_type: 'search_click' }, {
        genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [], popularity: item.popularity,
      })
      silentGraphUpdate(uid, updated)
    },

    // ── Watchlist ─────────────────────────────────────────────────────────

    addToWatchlist: (item) => {
      const { watchlist, tasteGraph, currentUser } = get()
      const uid     = currentUser?.id || 'guest'
      const updated = watchlist.some(w => w.id === item.id)
        ? watchlist
        : [{ ...item, addedAt: new Date().toISOString() }, ...watchlist]
      save(uid, 'watchlist', updated); set({ watchlist: updated })
      if (tasteGraph) {
        const updatedGraph = processSignalLocally(tasteGraph, { event_type: 'watchlisted' }, {
          genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [], popularity: item.popularity,
        })
        silentGraphUpdate(uid, updatedGraph)
      }
    },

    removeFromWatchlist: (itemId) => {
      const { watchlist, tasteGraph, currentUser } = get()
      const uid     = currentUser?.id || 'guest'
      const item    = watchlist.find(w => w.id === itemId)
      const updated = watchlist.filter(w => w.id !== itemId)
      save(uid, 'watchlist', updated); set({ watchlist: updated })
      if (tasteGraph && item) {
        const updatedGraph = processSignalLocally(tasteGraph, { event_type: 'unwatchlisted' }, {
          genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [], popularity: item.popularity,
        })
        silentGraphUpdate(uid, updatedGraph)
      }
    },

    isInWatchlist: (itemId) => get().watchlist.some(w => w.id === itemId),

    // ── Watched ───────────────────────────────────────────────────────────

    markWatched: (item, reaction = null) => {
      const { watched, currentUser } = get()
      const uid      = currentUser?.id || 'guest'
      const filtered = watched.filter(w => w.id !== item.id)
      const entry    = { ...item, watchedAt: new Date().toISOString(), reaction }
      const updated  = [entry, ...filtered]
      save(uid, 'watched', updated); set({ watched: updated })
      if (reaction) get()._applyReactionSignal(item, reaction)
    },

    updateReaction: (itemId, reaction) => {
      const { watched, currentUser } = get()
      const uid     = currentUser?.id || 'guest'
      const updated = watched.map(w => w.id === itemId ? { ...w, reaction } : w)
      save(uid, 'watched', updated); set({ watched: updated })
      const item = watched.find(w => w.id === itemId)
      if (item) get()._applyReactionSignal(item, reaction)
    },

    _applyReactionSignal: (item, reaction) => {
      const eventMap = { loved: 'rewatched', liked: 'liked', mid: 'completed', abandoned: 'abandoned' }
      get().recordWatchEvent(
        { event_type: eventMap[reaction] || 'completed', tmdb_id: item.id, media_type: item.media_type || 'movie' },
        { genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [], cast_ids: item.cast_ids || [], director_id: item.director_id, popularity: item.popularity }
      )
    },

    isWatched:   (itemId)  => get().watched.some(w => w.id === itemId),
    getReaction: (itemId)  => get().watched.find(w => w.id === itemId)?.reaction || null,

    setFavourite: (item, slot) => {
      const { favourites, currentUser } = get()
      const uid = currentUser?.id || 'guest'
      const updated = [...favourites]; while (updated.length < 3) updated.push(null)
      updated[slot] = item; save(uid, 'favourites', updated); set({ favourites: updated })
    },

    removeFavourite: (slot) => {
      const { favourites, currentUser } = get()
      const uid = currentUser?.id || 'guest'
      const updated = [...favourites]; while (updated.length < 3) updated.push(null)
      updated[slot] = null; save(uid, 'favourites', updated); set({ favourites: updated })
    },
  }
})

export default useStore