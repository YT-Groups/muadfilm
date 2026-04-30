// src/hooks/useLearningLoop.js
// Runs runPeriodicReinforcement every INTERVAL_MS.
// Silently updates the taste graph in localStorage and store state
// without triggering a full content reload.

import { useEffect, useRef } from 'react'
import useStore from '../lib/store'
import { runPeriodicReinforcement } from '../engine/recommender'

const INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export default function useLearningLoop() {
  const intervalRef = useRef(null)

  useEffect(() => {
    const run = () => {
      const { tasteGraph, watched, watchlist, currentUser } = useStore.getState()
      if (!tasteGraph || !currentUser) return

      const updated = runPeriodicReinforcement(tasteGraph, watched, watchlist)
      if (!updated) return

      // Check if anything actually changed before writing
      const changed =
        JSON.stringify(updated.genre_weights) !== JSON.stringify(tasteGraph.genre_weights) ||
        JSON.stringify(updated.tone_weights)  !== JSON.stringify(tasteGraph.tone_weights)

      if (!changed) return

      // Save to localStorage
      try {
        localStorage.setItem(
          `mf_${currentUser.id}_taste_graph`,
          JSON.stringify(updated)
        )
      } catch {}

      // Silent state update — no subscriber notification, no re-render
      useStore.setState({ tasteGraph: updated }, false)
    }

    // Run once after a short delay on mount, then every 5 minutes
    const initialTimer = setTimeout(run, 30_000) // 30s after mount
    intervalRef.current = setInterval(run, INTERVAL_MS)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(intervalRef.current)
    }
  }, [])
}
