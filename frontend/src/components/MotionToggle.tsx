import { useEffect, useState } from 'react'

export type MotionMode = 'system' | 'on' | 'off'

const STORAGE_KEY = 'motion'

/**
 * The OS preference is the default, not the only voice. A visitor whose desktop asks for reduced
 * motion may still want the page to move, and a visitor with no OS preference may want it still —
 * so the resolved answer lives on `<html data-motion>` and every animation rule gates on that,
 * instead of on a media query the visitor cannot override.
 */
function resolveMode(mode: MotionMode): 'on' | 'off' {
  if (mode === 'on') return 'on'
  if (mode === 'off') return 'off'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'on'
}

export function applyMotionMode(mode: MotionMode): void {
  const root = document.documentElement
  root.dataset.motion = resolveMode(mode)
  root.dataset.motionMode = mode
}

function readMode(): MotionMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'on' || stored === 'off' ? stored : 'system'
}

const NEXT: Record<MotionMode, MotionMode> = { system: 'on', on: 'off', off: 'system' }

const LABELS: Record<MotionMode, string> = {
  system: 'Motion: sys',
  on: 'Motion: on',
  off: 'Motion: off',
}

const DESCRIPTIONS: Record<MotionMode, string> = {
  system: 'Motion follows your system setting. Click to allow motion.',
  on: 'Motion is allowed. Click to stop it.',
  off: 'Motion is stopped. Click to follow your system setting again.',
}

export default function MotionToggle() {
  const [mode, setMode] = useState<MotionMode>('system')

  useEffect(() => {
    const initial = readMode()
    setMode(initial)
    applyMotionMode(initial)
  }, [])

  // Only the "system" setting needs to keep listening; an explicit choice outranks the OS.
  useEffect(() => {
    if (mode !== 'system') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => applyMotionMode('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode])

  function cycleMode() {
    const next = NEXT[mode]
    setMode(next)
    applyMotionMode(next)
    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
  }

  return (
    <button
      type="button"
      onClick={cycleMode}
      aria-label={`Motion: ${DESCRIPTIONS[mode]}`}
      title={DESCRIPTIONS[mode]}
      className="theme-toggle motion-toggle"
    >
      {LABELS[mode]}
    </button>
  )
}
