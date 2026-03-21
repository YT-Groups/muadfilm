// src/hooks/useYouTubePlayer.js
// Loads the YouTube IFrame API once globally, then creates a Player instance
// on a given DOM element. Calls onEnded when the video finishes.

import { useEffect, useRef } from 'react'

// Load the YT script only once across the whole app
let ytApiReady = false
let ytApiCallbacks = []

const loadYTApi = () => {
  if (window.YT && window.YT.Player) {
    ytApiReady = true
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    ytApiCallbacks.push(resolve)
    if (document.getElementById('yt-iframe-api')) return // already loading
    const tag = document.createElement('script')
    tag.id  = 'yt-iframe-api'
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true
      ytApiCallbacks.forEach(cb => cb())
      ytApiCallbacks = []
    }
  })
}

export default function useYouTubePlayer({
  containerId,   // id of the <div> to replace with player
  videoId,       // YouTube video key
  muted = true,
  onEnded,       // called when video ends
  onReady,       // called when player is ready
  enabled = true,
}) {
  const playerRef = useRef(null)

  // Keep callbacks in refs so we never capture stale closures inside the player events
  const onEndedRef = useRef(onEnded)
  const onReadyRef = useRef(onReady)
  useEffect(() => { onEndedRef.current = onEnded }, [onEnded])
  useEffect(() => { onReadyRef.current = onReady }, [onReady])

  useEffect(() => {
    if (!videoId || !enabled) return
    let destroyed = false

    const init = async () => {
      await loadYTApi()
      if (destroyed || !document.getElementById(containerId)) return

      // Destroy any existing player on this container before creating a new one
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch {}
        playerRef.current = null
      }

      playerRef.current = new window.YT.Player(containerId, {
        videoId,
        playerVars: {
          autoplay:       1,
          mute:           muted ? 1 : 0,
          controls:       0,
          modestbranding: 1,
          showinfo:       0,
          rel:            0,
          iv_load_policy: 3,
          playsinline:    1,
        },
        events: {
          onReady: (e) => {
            if (destroyed) return
            if (muted) e.target.mute()
            e.target.playVideo()
            onReadyRef.current?.(e.target)
          },
          onStateChange: (e) => {
            if (destroyed) return
            // YT.PlayerState.ENDED === 0
            if (e.data === 0) onEndedRef.current?.()
          },
          onError: () => {
            if (destroyed) return
            // Trailer unavailable / blocked — treat as ended so slideshow continues
            onEndedRef.current?.()
          },
        },
      })
    }

    init()

    return () => {
      destroyed = true
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch {}
        playerRef.current = null
      }
    }
  // Re-run only when the actual video or container changes, not on every callback change
  }, [videoId, containerId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return playerRef
}