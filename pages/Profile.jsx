// src/pages/Profile.jsx
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import useStore from '../lib/store'
import { searchMulti, posterUrl, LANGUAGE_OPTIONS } from '../lib/tmdb'
import styles from './Profile.module.css'

export default function Profile() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState('favourites')
  const {
    currentUser, logout, updateProfile,
    favourites, setFavourite, removeFavourite,
    watched, watchlist,
    resetTasteGraph, onboardingDone,
    tasteGraph, updateTasteGraphPrefs,
  } = useStore()

  useEffect(() => {
    if (!currentUser) navigate('/auth', { replace: true })
  }, [currentUser])

  if (!currentUser) return null

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <button className={styles.navBack} onClick={() => navigate('/home')}>← Back</button>
        <span className={styles.navLogo}>MUAD'FILM</span>
        <button className={styles.navLogout} onClick={() => { logout(); navigate('/auth') }}>Sign out</button>
      </nav>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.avatar}>{currentUser.displayName?.slice(0, 2).toUpperCase()}</div>
          <p className={styles.userName}>{currentUser.displayName}</p>
          <p className={styles.userEmail}>{currentUser.email}</p>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statNum}>{watched.length}</span>
              <span className={styles.statLabel}>Watched</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statNum}>{watchlist.length}</span>
              <span className={styles.statLabel}>Saved</span>
            </div>
          </div>

          <nav className={styles.sideNav}>
            {[
              { id: 'favourites', label: 'Favourite films' },
              { id: 'preferences', label: 'Preferences' },
              { id: 'account',    label: 'Account' },
              { id: 'danger',     label: 'Advanced' },
            ].map(s => (
              <button
                key={s.id}
                className={`${styles.sideNavItem} ${activeSection === s.id ? styles.sideNavActive : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className={styles.main}>
          <AnimatePresence mode="wait">
            <motion.div key={activeSection} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>
              {activeSection === 'favourites' && (
                <FavouritesSection favourites={favourites} setFavourite={setFavourite} removeFavourite={removeFavourite} />
              )}
              {activeSection === 'preferences' && (
                <PreferencesSection tasteGraph={tasteGraph} updateTasteGraphPrefs={updateTasteGraphPrefs} />
              )}
              {activeSection === 'account' && (
                <AccountSection currentUser={currentUser} updateProfile={updateProfile} />
              )}
              {activeSection === 'danger' && (
                <DangerSection resetTasteGraph={resetTasteGraph} onboardingDone={onboardingDone} navigate={navigate} logout={logout} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

// ─── Preferences section ──────────────────────────────────────────────────────

function PreferencesSection({ tasteGraph, updateTasteGraphPrefs }) {
  const [language, setLanguage] = useState(tasteGraph?.language || 'en')
  const [dob, setDob]           = useState(tasteGraph?.dob || '')
  const [saved, setSaved]       = useState(false)
  const [dobError, setDobError] = useState('')

  const handleSave = () => {
    if (dob) {
      const parsed = new Date(dob)
      if (isNaN(parsed.getTime())) { setDobError('Invalid date.'); return }
      const age = (Date.now() - parsed) / (365.25 * 24 * 60 * 60 * 1000)
      if (age < 5 || age > 120) { setDobError('Please enter a valid date of birth.'); return }
    }
    setDobError('')
    updateTasteGraphPrefs({ language, dob: dob || null })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Preferences</h2>
      <p className={styles.sectionSub}>These directly affect which films we show you.</p>

      <div className={styles.formGroup}>
        <h3 className={styles.formGroupTitle}>Language</h3>
        <p className={styles.formHint}>Films will be filtered to your preferred original language.</p>
        <div className={styles.langGrid}>
          {LANGUAGE_OPTIONS.map(lang => (
            <button
              key={lang.code}
              className={`${styles.langChip} ${language === lang.code ? styles.langChipActive : ''}`}
              onClick={() => setLanguage(lang.code)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.formGroup}>
        <h3 className={styles.formGroupTitle}>Date of birth</h3>
        <p className={styles.formHint}>Used to calibrate era preferences based on the films you grew up with.</p>
        <div className={styles.formField}>
          <input
            className={styles.formInput}
            type="date"
            value={dob}
            onChange={e => { setDob(e.target.value); setDobError('') }}
            max={new Date().toISOString().split('T')[0]}
          />
          {dobError && <p className={styles.msgError} style={{ marginTop: '0.4rem' }}>{dobError}</p>}
        </div>
      </div>

      {saved && <p className={styles.msgOk} style={{ marginTop: '-0.5rem' }}>Preferences saved ✓</p>}

      <button className={styles.saveBtn} onClick={handleSave}>Save preferences</button>
    </div>
  )
}

// ─── Favourites ───────────────────────────────────────────────────────────────

function FavouritesSection({ favourites, setFavourite, removeFavourite }) {
  const [editingSlot, setEditingSlot] = useState(null)
  const [query, setQuery]             = useState('')
  const [results, setResults]         = useState([])
  const [searching, setSearching]     = useState(false)
  const timer = useRef(null)

  const slots     = [0, 1, 2]
  const safeSlots = [...(favourites || [null, null, null])]
  while (safeSlots.length < 3) safeSlots.push(null)

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await searchMulti(query)
        setResults(data.results?.filter(r => r.media_type === 'movie').slice(0, 6) || [])
      } finally { setSearching(false) }
    }, 400)
  }, [query])

  const openSlot = (slot) => { setEditingSlot(slot); setQuery(''); setResults([]) }
  const pickFilm = (film) => { setFavourite(film, editingSlot); setEditingSlot(null); setQuery(''); setResults([]) }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Favourite films</h2>
      <p className={styles.sectionSub}>Three films that define your taste. These help calibrate your recommendations.</p>

      <div className={styles.favGrid}>
        {slots.map(slot => {
          const film = safeSlots[slot]
          return (
            <div key={slot} className={styles.favSlot}>
              {film ? (
                <motion.div className={styles.favCard} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                  {film.poster_path
                    ? <img src={posterUrl(film.poster_path)} alt={film.title} className={styles.favPoster} />
                    : <div className={styles.favPosterFallback}>{(film.title || film.name)?.slice(0,2)}</div>
                  }
                  <div className={styles.favMeta}>
                    <span className={styles.favTitle}>{film.title || film.name}</span>
                    <span className={styles.favYear}>{(film.release_date || film.first_air_date || '').slice(0,4)}</span>
                  </div>
                  <div className={styles.favActions}>
                    <button className={styles.favChange} onClick={() => openSlot(slot)}>Change</button>
                    <button className={styles.favRemove} onClick={() => removeFavourite(slot)}>✕</button>
                  </div>
                </motion.div>
              ) : (
                <button className={styles.favEmpty} onClick={() => openSlot(slot)}>
                  <span className={styles.favEmptyPlus}>+</span>
                  <span className={styles.favEmptyLabel}>Add film</span>
                </button>
              )}
            </div>
          )
        })}
      </div>

      <AnimatePresence>
        {editingSlot !== null && (
          <motion.div className={styles.searchModal} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => { if (e.target === e.currentTarget) setEditingSlot(null) }}>
            <motion.div className={styles.searchModalInner} initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.25 }}>
              <div className={styles.searchModalHeader}>
                <p className={styles.searchModalTitle}>Choose film #{editingSlot + 1}</p>
                <button className={styles.searchModalClose} onClick={() => setEditingSlot(null)}>✕</button>
              </div>
              <input className={styles.searchInput} placeholder="Search films..." value={query} onChange={e => setQuery(e.target.value)} autoFocus />
              {searching && <p className={styles.searchHint}>Searching...</p>}
              {results.length > 0 && (
                <div className={styles.searchResults}>
                  {results.map(r => (
                    <button key={r.id} className={styles.searchResult} onClick={() => pickFilm(r)}>
                      {r.poster_path && <img src={posterUrl(r.poster_path, 'w92')} alt="" className={styles.searchResultImg} />}
                      <div>
                        <div className={styles.searchResultTitle}>{r.title || r.name}</div>
                        <div className={styles.searchResultMeta}>{(r.release_date || r.first_air_date || '').slice(0,4)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Account ──────────────────────────────────────────────────────────────────

function AccountSection({ currentUser, updateProfile }) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || '')
  const [email, setEmail]             = useState(currentUser.email || '')
  const [currentPw, setCurrentPw]     = useState('')
  const [newPw, setNewPw]             = useState('')
  const [confirmPw, setConfirmPw]     = useState('')
  const [profileMsg, setProfileMsg]   = useState(null)
  const [pwMsg, setPwMsg]             = useState(null)
  const [saving, setSaving]           = useState(false)

  const saveProfile = async () => {
    setSaving(true); setProfileMsg(null)
    await new Promise(r => setTimeout(r, 400))
    const r = updateProfile({ displayName: displayName.trim(), email: email.trim() })
    setSaving(false)
    setProfileMsg(r.error ? { type: 'error', text: r.error } : { type: 'ok', text: 'Profile updated.' })
  }

  const savePassword = async () => {
    if (newPw.length < 6) return setPwMsg({ type: 'error', text: 'Min. 6 characters.' })
    if (newPw !== confirmPw) return setPwMsg({ type: 'error', text: 'Passwords do not match.' })
    setSaving(true); setPwMsg(null)
    await new Promise(r => setTimeout(r, 400))
    const r = updateProfile({ currentPassword: currentPw, newPassword: newPw })
    setSaving(false)
    if (r.error) return setPwMsg({ type: 'error', text: r.error })
    setPwMsg({ type: 'ok', text: 'Password updated.' })
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Account</h2>
      <div className={styles.formGroup}>
        <h3 className={styles.formGroupTitle}>Profile</h3>
        <div className={styles.formField}>
          <label className={styles.formLabel}>Display name</label>
          <input className={styles.formInput} value={displayName} onChange={e => setDisplayName(e.target.value)} />
        </div>
        <div className={styles.formField}>
          <label className={styles.formLabel}>Email</label>
          <input className={styles.formInput} type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        {profileMsg && <p className={`${styles.msg} ${profileMsg.type === 'error' ? styles.msgError : styles.msgOk}`}>{profileMsg.text}</p>}
        <button className={styles.saveBtn} onClick={saveProfile} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
      </div>

      <div className={styles.divider} />

      <div className={styles.formGroup}>
        <h3 className={styles.formGroupTitle}>Change password</h3>
        <div className={styles.formField}>
          <label className={styles.formLabel}>Current password</label>
          <input className={styles.formInput} type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="••••••••" />
        </div>
        <div className={styles.formField}>
          <label className={styles.formLabel}>New password</label>
          <input className={styles.formInput} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 6 characters" />
        </div>
        <div className={styles.formField}>
          <label className={styles.formLabel}>Confirm new password</label>
          <input className={styles.formInput} type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Same again" />
        </div>
        {pwMsg && <p className={`${styles.msg} ${pwMsg.type === 'error' ? styles.msgError : styles.msgOk}`}>{pwMsg.text}</p>}
        <button className={styles.saveBtn} onClick={savePassword} disabled={saving}>{saving ? 'Updating...' : 'Update password'}</button>
      </div>
    </div>
  )
}

// ─── Danger zone ──────────────────────────────────────────────────────────────

function DangerSection({ resetTasteGraph, onboardingDone, navigate, logout }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [done, setDone]                 = useState(false)

  const doReset = () => { resetTasteGraph(); setDone(true); setTimeout(() => navigate('/onboarding'), 1200) }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Advanced</h2>
      <div className={styles.dangerCard}>
        <div className={styles.dangerInfo}>
          <p className={styles.dangerTitle}>Reset taste profile</p>
          <p className={styles.dangerSub}>Wipes your calibrated preferences and restarts the onboarding flow. Your watched history and favourites are preserved.</p>
        </div>
        {done ? (
          <p className={styles.dangerDone}>Done — redirecting...</p>
        ) : confirmReset ? (
          <div className={styles.dangerConfirm}>
            <p className={styles.dangerConfirmText}>Are you sure?</p>
            <button className={styles.dangerConfirmYes} onClick={doReset}>Yes, reset</button>
            <button className={styles.dangerConfirmNo} onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        ) : (
          <button className={styles.dangerBtn} onClick={() => setConfirmReset(true)}>Reset</button>
        )}
      </div>
    </div>
  )
}