// src/lib/store.js
import { create } from 'zustand'
import { processSignalLocally, enrichContentWithTones, getAgeBracket } from '../engine/recommender'
import { supabase, isSupabaseEnabled } from './supabase'

// ─── Local storage helpers ────────────────────────────────────────────────────
const userKey    = (uid, key) => `mf_${uid}_${key}`
const load       = (uid, key, fb = null) => { try { const s = localStorage.getItem(userKey(uid, key)); return s ? JSON.parse(s) : fb } catch { return fb } }
const save       = (uid, key, val) => { try { localStorage.setItem(userKey(uid, key), JSON.stringify(val)) } catch {} }
const loadGlobal = (key, fb = null) => { try { const s = localStorage.getItem(`mf_${key}`); return s ? JSON.parse(s) : fb } catch { return fb } }
const saveGlobal = (key, val) => { try { localStorage.setItem(`mf_${key}`, JSON.stringify(val)) } catch {} }

// ─── Mock auth fallback ───────────────────────────────────────────────────────
const getUsers  = () => loadGlobal('users', {})
const saveUsers = (u) => saveGlobal('users', u)
const mockHash  = (pw) => btoa(pw)
const mockSignup = (email, displayName, password) => {
  const users = getUsers()
  if (Object.values(users).find(u => u.email === email)) return { error: 'An account with this email already exists.' }
  const id = `user_${Date.now()}`
  const user = { id, email, displayName, passwordHash: mockHash(password), createdAt: new Date().toISOString() }
  users[id] = user; saveUsers(users); return { user }
}
const mockLogin = (email, password) => {
  const users = getUsers()
  const user  = Object.values(users).find(u => u.email === email)
  if (!user) return { error: 'No account found with this email.' }
  if (user.passwordHash !== mockHash(password)) return { error: 'Incorrect password.' }
  return { user }
}
const mockUpdateProfile = (uid, updates) => {
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

// ─── Default taste graph ──────────────────────────────────────────────────────
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
  language: 'en', dob: null, age_bracket: null, confidence: 0.1,
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
const sb = {
  async loadGraph(uid) {
    if (!isSupabaseEnabled) return null
    const { data } = await supabase.from('taste_graphs').select('graph, onboarding_done, confidence').eq('user_id', uid).single()
    return data
  },
  async saveGraph(uid, graph, onboardingDone) {
    if (!isSupabaseEnabled) return
    supabase.from('taste_graphs').upsert({ user_id: uid, graph, confidence: graph.confidence ?? 0.1, onboarding_done: onboardingDone ?? false, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).then(() => {})
  },
  async loadWatchlist(uid) {
    if (!isSupabaseEnabled) return null
    const { data } = await supabase.from('watchlist').select('tmdb_id, media_type, snapshot, added_at').eq('user_id', uid).order('added_at', { ascending: false })
    return data?.map(r => ({ ...r.snapshot, id: r.tmdb_id, media_type: r.media_type, addedAt: r.added_at })) || []
  },
  async addWatchlist(uid, item) {
    if (!isSupabaseEnabled) return
    supabase.from('watchlist').upsert({ user_id: uid, tmdb_id: item.id, media_type: item.media_type || 'movie', snapshot: item, added_at: new Date().toISOString() }, { onConflict: 'user_id,tmdb_id' }).then(() => {})
  },
  async removeWatchlist(uid, tmdbId) {
    if (!isSupabaseEnabled) return
    supabase.from('watchlist').delete().eq('user_id', uid).eq('tmdb_id', tmdbId).then(() => {})
  },
  async loadWatched(uid) {
    if (!isSupabaseEnabled) return null
    const { data } = await supabase.from('watched').select('tmdb_id, media_type, reaction, snapshot, watched_at').eq('user_id', uid).order('watched_at', { ascending: false })
    return data?.map(r => ({ ...r.snapshot, id: r.tmdb_id, media_type: r.media_type, reaction: r.reaction, watchedAt: r.watched_at })) || []
  },
  async upsertWatched(uid, item, reaction) {
    if (!isSupabaseEnabled) return
    supabase.from('watched').upsert({ user_id: uid, tmdb_id: item.id, media_type: item.media_type || 'movie', reaction, snapshot: item, watched_at: new Date().toISOString() }, { onConflict: 'user_id,tmdb_id' }).then(() => {})
  },
  async updateReaction(uid, tmdbId, reaction) {
    if (!isSupabaseEnabled) return
    supabase.from('watched').update({ reaction }).eq('user_id', uid).eq('tmdb_id', tmdbId).then(() => {})
  },
  async loadFavourites(uid) {
    if (!isSupabaseEnabled) return null
    const { data } = await supabase.from('favourites').select('slot_0, slot_1, slot_2').eq('user_id', uid).single()
    return data ? [data.slot_0, data.slot_1, data.slot_2] : [null, null, null]
  },
  async saveFavourites(uid, slots) {
    if (!isSupabaseEnabled) return
    supabase.from('favourites').upsert({ user_id: uid, slot_0: slots[0] || null, slot_1: slots[1] || null, slot_2: slots[2] || null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).then(() => {})
  },
  async logEvent(uid, event, contentMeta) {
    if (!isSupabaseEnabled) return
    supabase.from('watch_events').insert({ user_id: uid, tmdb_id: event.tmdb_id || contentMeta.id, media_type: event.media_type || 'movie', event_type: event.event_type, completion_pct: event.completion_pct || null, watch_hour: new Date().getHours(), watch_dow: new Date().getDay(), content_meta: contentMeta }).then(() => {})
  },
}

// ─── Load all user state ──────────────────────────────────────────────────────
const loadUserState = async (uid) => {
  const local = {
    tasteGraph:     load(uid, 'taste_graph', { ...DEFAULT_GRAPH }),
    onboardingDone: load(uid, 'onboarding', false),
    watchlist:      load(uid, 'watchlist', []),
    watched:        load(uid, 'watched', []),
    favourites:     load(uid, 'favourites', [null, null, null]),
  }
  if (!isSupabaseEnabled) return local
  try {
    const [graphData, watchlistData, watchedData, favouritesData] = await Promise.all([
      sb.loadGraph(uid), sb.loadWatchlist(uid), sb.loadWatched(uid), sb.loadFavourites(uid),
    ])
    const merged = { ...local }
    if (graphData?.graph && Object.keys(graphData.graph).length > 0) {
      merged.tasteGraph     = { ...DEFAULT_GRAPH, ...graphData.graph }
      merged.onboardingDone = graphData.onboarding_done ?? local.onboardingDone
      save(uid, 'taste_graph', merged.tasteGraph)
      save(uid, 'onboarding', merged.onboardingDone)
    }
    if (watchlistData?.length > 0) { merged.watchlist = watchlistData; save(uid, 'watchlist', watchlistData) }
    if (watchedData?.length > 0)   { merged.watched   = watchedData;   save(uid, 'watched', watchedData) }
    if (favouritesData)             { merged.favourites = favouritesData; save(uid, 'favourites', favouritesData) }
    return merged
  } catch (e) {
    console.warn('Supabase hydration failed, using local state:', e)
    return local
  }
}

const silentGraphUpdate = (uid, updated, onboardingDone) => {
  save(uid, 'taste_graph', updated)
  sb.saveGraph(uid, updated, onboardingDone)
  useStore.setState({ tasteGraph: updated }, false)
}

const normalizeSupabaseUser = (u) => ({
  id: u.id, email: u.email,
  displayName: u.user_metadata?.displayName || u.email?.split('@')[0] || 'User',
  createdAt: u.created_at,
})

// ─── Store ────────────────────────────────────────────────────────────────────
const useStore = create((set, get) => {
  const sessionUid  = !isSupabaseEnabled ? loadGlobal('session_uid', null) : null
  const sessionUser = sessionUid ? (getUsers()[sessionUid] || null) : null

  return {
    currentUser: sessionUser, authError: null, authLoading: isSupabaseEnabled,
    tasteGraph: { ...DEFAULT_GRAPH }, onboardingDone: false,
    watchlist: [], watched: [], favourites: [null, null, null],
    ...(sessionUser ? {
      tasteGraph:     load(sessionUser.id, 'taste_graph', { ...DEFAULT_GRAPH }),
      onboardingDone: load(sessionUser.id, 'onboarding', false),
      watchlist:      load(sessionUser.id, 'watchlist', []),
      watched:        load(sessionUser.id, 'watched', []),
      favourites:     load(sessionUser.id, 'favourites', [null, null, null]),
    } : {}),

    initAuth: async () => {
      if (!isSupabaseEnabled) { set({ authLoading: false }); return }
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const user  = normalizeSupabaseUser(session.user)
        const state = await loadUserState(user.id)
        set({ currentUser: user, authLoading: false, ...state })
      } else { set({ authLoading: false }) }
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const user  = normalizeSupabaseUser(session.user)
          const state = await loadUserState(user.id)
          set({ currentUser: user, authError: null, ...state })
        }
        if (event === 'SIGNED_OUT') {
          set({ currentUser: null, authError: null, tasteGraph: { ...DEFAULT_GRAPH }, onboardingDone: false, watchlist: [], watched: [], favourites: [null, null, null] })
        }
      })
    },

    signup: async (email, displayName, password) => {
      set({ authError: null })
      if (isSupabaseEnabled) {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { displayName } } })
        if (error) { set({ authError: error.message }); return false }
        return true
      } else {
        const r = mockSignup(email, displayName, password)
        if (r.error) { set({ authError: r.error }); return false }
        saveGlobal('session_uid', r.user.id)
        const state = await loadUserState(r.user.id)
        set({ currentUser: r.user, authError: null, ...state }); return true
      }
    },

    login: async (email, password) => {
      set({ authError: null })
      if (isSupabaseEnabled) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) { set({ authError: error.message }); return false }
        return true
      } else {
        const r = mockLogin(email, password)
        if (r.error) { set({ authError: r.error }); return false }
        saveGlobal('session_uid', r.user.id)
        const state = await loadUserState(r.user.id)
        set({ currentUser: r.user, authError: null, ...state }); return true
      }
    },

    logout: async () => {
      if (isSupabaseEnabled) { await supabase.auth.signOut() }
      else {
        saveGlobal('session_uid', null)
        set({ currentUser: null, authError: null, tasteGraph: { ...DEFAULT_GRAPH }, onboardingDone: false, watchlist: [], watched: [], favourites: [null, null, null] })
      }
    },

    sendPasswordReset: async (email) => {
      if (!isSupabaseEnabled) return { error: 'Not available in demo mode.' }
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
      return error ? { error: error.message } : { success: true }
    },

    clearAuthError: () => set({ authError: null }),

    updateProfile: async (updates) => {
      const { currentUser } = get()
      if (!currentUser) return { error: 'Not logged in.' }
      if (isSupabaseEnabled) {
        const sbUpdates = {}
        if (updates.displayName) sbUpdates.data = { displayName: updates.displayName }
        if (updates.email)       sbUpdates.email = updates.email
        if (updates.newPassword) sbUpdates.password = updates.newPassword
        const { data, error } = await supabase.auth.updateUser(sbUpdates)
        if (error) return { error: error.message }
        await supabase.from('profiles').update({ display_name: updates.displayName || currentUser.displayName, email: updates.email || currentUser.email }).eq('id', currentUser.id)
        set({ currentUser: normalizeSupabaseUser(data.user) }); return { success: true }
      } else {
        const r = mockUpdateProfile(currentUser.id, updates)
        if (r.error) return r
        set({ currentUser: r.user }); return { success: true }
      }
    },

    completeOnboarding: (graph) => {
      const { currentUser } = get()
      const uid = currentUser?.id || 'guest'
      save(uid, 'taste_graph', graph); save(uid, 'onboarding', true)
      sb.saveGraph(uid, graph, true)
      set({ tasteGraph: graph, onboardingDone: true })
    },

    resetTasteGraph: () => {
      const { currentUser } = get()
      const uid = currentUser?.id || 'guest'
      save(uid, 'taste_graph', { ...DEFAULT_GRAPH }); save(uid, 'onboarding', false)
      sb.saveGraph(uid, { ...DEFAULT_GRAPH }, false)
      set({ tasteGraph: { ...DEFAULT_GRAPH }, onboardingDone: false })
    },

    updateTasteGraphPrefs: ({ language, dob }) => {
      const { tasteGraph, currentUser, onboardingDone } = get()
      if (!tasteGraph) return
      const uid = currentUser?.id || 'guest'
      const ageBracket = getAgeBracket(dob)
      const updated = { ...tasteGraph, language: language ?? tasteGraph.language, dob: dob ?? tasteGraph.dob, age_bracket: ageBracket ?? tasteGraph.age_bracket }
      save(uid, 'taste_graph', updated); sb.saveGraph(uid, updated, onboardingDone)
      set({ tasteGraph: updated })
    },

    recordWatchEvent: (event, contentMeta) => {
      const { tasteGraph, currentUser, onboardingDone } = get()
      if (!tasteGraph) return
      const uid     = currentUser?.id || 'guest'
      const updated = processSignalLocally(tasteGraph, event, contentMeta)
      save(uid, 'taste_graph', updated)
      sb.saveGraph(uid, updated, onboardingDone)
      sb.logEvent(uid, event, contentMeta)
      set({ tasteGraph: updated })
    },

    enrichAndLearn: (item, details) => {
      const { tasteGraph, currentUser, watched, onboardingDone } = get()
      if (!tasteGraph || !details) return
      const uid      = currentUser?.id || 'guest'
      const keywords = details.keywords?.keywords || details.keywords?.results || []
      const toneTags = enrichContentWithTones(item, keywords).tone_tags
      const castIds  = (details.credits?.cast || []).slice(0, 10).map(a => a.id)
      const director = details.credits?.crew?.find(c => c.job === 'Director')
      let updated    = { ...tasteGraph }
      const alreadyRated = watched.some(w => w.id === item.id)
      if (!alreadyRated && toneTags.length > 0) {
        updated = processSignalLocally(updated, { event_type: 'viewed' }, { genre_ids: item.genre_ids || [], tone_tags: toneTags, cast_ids: castIds, popularity: item.popularity, director_id: director?.id })
      } else if (toneTags.length > 0) {
        const tw = { ...updated.tone_weights }
        toneTags.forEach(t => { if (tw[t] !== undefined) tw[t] = Math.min(Math.max(tw[t] + 0.01, 0), 1) })
        updated = { ...updated, tone_weights: tw }
      }
      if (director) {
        const dirs = (updated.director_affinities || []).map(d => ({ ...d }))
        const ex = dirs.find(d => d.id === director.id)
        if (ex) ex.score = Math.min(ex.score + 0.02, 1)
        updated = { ...updated, director_affinities: dirs }
      }
      silentGraphUpdate(uid, updated, onboardingDone)
    },

    recordSearchClick: (item) => {
      const { tasteGraph, currentUser, onboardingDone } = get()
      if (!tasteGraph) return
      const uid     = currentUser?.id || 'guest'
      const updated = processSignalLocally(tasteGraph, { event_type: 'search_click' }, { genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [], popularity: item.popularity })
      silentGraphUpdate(uid, updated, onboardingDone)
    },

    addToWatchlist: (item) => {
      const { watchlist, tasteGraph, currentUser, onboardingDone } = get()
      const uid = currentUser?.id || 'guest'
      if (watchlist.some(w => w.id === item.id)) return
      const updated = [{ ...item, addedAt: new Date().toISOString() }, ...watchlist]
      save(uid, 'watchlist', updated); sb.addWatchlist(uid, item)
      set({ watchlist: updated })
      if (tasteGraph) {
        const g = processSignalLocally(tasteGraph, { event_type: 'watchlisted' }, { genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [], popularity: item.popularity })
        silentGraphUpdate(uid, g, onboardingDone)
      }
    },

    removeFromWatchlist: (itemId) => {
      const { watchlist, tasteGraph, currentUser, onboardingDone } = get()
      const uid = currentUser?.id || 'guest'
      const item = watchlist.find(w => w.id === itemId)
      const updated = watchlist.filter(w => w.id !== itemId)
      save(uid, 'watchlist', updated); sb.removeWatchlist(uid, itemId)
      set({ watchlist: updated })
      if (tasteGraph && item) {
        const g = processSignalLocally(tasteGraph, { event_type: 'unwatchlisted' }, { genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [], popularity: item.popularity })
        silentGraphUpdate(uid, g, onboardingDone)
      }
    },

    isInWatchlist: (itemId) => get().watchlist.some(w => w.id === itemId),

    markWatched: (item, reaction = null) => {
      const { watched, currentUser } = get()
      const uid = currentUser?.id || 'guest'
      const updated = [{ ...item, watchedAt: new Date().toISOString(), reaction }, ...watched.filter(w => w.id !== item.id)]
      save(uid, 'watched', updated); sb.upsertWatched(uid, item, reaction)
      set({ watched: updated })
      if (reaction) get()._applyReactionSignal(item, reaction)
    },

    updateReaction: (itemId, reaction) => {
      const { watched, currentUser } = get()
      const uid = currentUser?.id || 'guest'
      const updated = watched.map(w => w.id === itemId ? { ...w, reaction } : w)
      save(uid, 'watched', updated); sb.updateReaction(uid, itemId, reaction)
      set({ watched: updated })
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

    isWatched:   (itemId) => get().watched.some(w => w.id === itemId),
    getReaction: (itemId) => get().watched.find(w => w.id === itemId)?.reaction || null,

    setFavourite: (item, slot) => {
      const { favourites, currentUser, tasteGraph, onboardingDone } = get()
      const uid = currentUser?.id || 'guest'
      const updated = [...favourites]; while (updated.length < 3) updated.push(null)
      updated[slot] = item; save(uid, 'favourites', updated); sb.saveFavourites(uid, updated)
      set({ favourites: updated })
      // Favourite = strongest possible signal — treated like rewatched
      if (tasteGraph && item) {
        const g = processSignalLocally(tasteGraph, { event_type: 'rewatched' }, {
          genre_ids: item.genre_ids || [], tone_tags: item.tone_tags || [],
          cast_ids: item.cast_ids || [], popularity: item.popularity,
        })
        silentGraphUpdate(uid, g, onboardingDone)
        sb.logEvent(uid, { event_type: 'favourited', tmdb_id: item.id, media_type: item.media_type || 'movie' }, item)
      }
    },

    removeFavourite: (slot) => {
      const { favourites, currentUser } = get()
      const uid = currentUser?.id || 'guest'
      const updated = [...favourites]; while (updated.length < 3) updated.push(null)
      updated[slot] = null; save(uid, 'favourites', updated); sb.saveFavourites(uid, updated)
      set({ favourites: updated })
    },
  }
})

export default useStore