// src/hooks/useTrailer.js
// Fetches the YouTube trailer key for a given TMDB item.
// Returns { trailerKey, loading } — trailerKey is null if none found.

import { useState, useEffect, useRef } from 'react'
import { getMovieVideos, extractTrailerKey } from '../lib/tmdb'

// Simple in-memory cache so we don't re-fetch on slideshow advance
const cache = {}

export default function useTrailer(item) {
  const [trailerKey, setTrailerKey] = useState(null)
  const [loading, setLoading]       = useState(false)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!item?.id) { setTrailerKey(null); return }

    const cacheKey = `${item.media_type || 'movie'}_${item.id}`

    // Already cached (including null — "no trailer")
    if (cacheKey in cache) {
      setTrailerKey(cache[cacheKey])
      return
    }

    // If the full movie object already has embedded videos (from getMovie())
    if (item.videos?.results?.length >= 0) {
      const key = extractTrailerKey(item.videos)
      cache[cacheKey] = key
      setTrailerKey(key)
      return
    }

    // Fetch from API
    setLoading(true)
    const mediaType = item.media_type === 'tv' ? 'tv' : 'movie'

    getMovieVideos(item.id, mediaType)
      .then(data => {
        const key = extractTrailerKey(data)
        cache[cacheKey] = key
        setTrailerKey(key)
      })
      .catch(() => {
        cache[cacheKey] = null
        setTrailerKey(null)
      })
      .finally(() => setLoading(false))
  }, [item?.id])

  return { trailerKey, loading }
}
