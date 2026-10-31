import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Glass } from 'liquidglass/react'

export function useDrag(initial: { x: number; y: number }, bounds?: () => DOMRect | undefined, size = 0) {
  const [pos, setPos] = useState(initial)
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
  }, [pos])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    let x = s.x + e.clientX - s.px
    let y = s.y + e.clientY - s.py
    const b = bounds?.()
    if (b) {
      x = Math.max(-size * 0.25, Math.min(b.width - size * 0.75, x))
      y = Math.max(-size * 0.25, Math.min(b.height - size * 0.75, y))
    }
    setPos({ x, y })
  }, [bounds, size])
  const onPointerUp = useCallback(() => { start.current = null }, [])
  return { pos, setPos, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } }
}

export function Slider({ value, min = 0, max = 1, step = 0, onChange, glass = false, label }: {
  value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; glass?: boolean; label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const pct = (value - min) / (max - min)
  const set = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    let v = min + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (max - min)
    if (step) v = Math.round(v / step) * step
    onChange(Number(v.toFixed(4)))
  }
  const key = (e: React.KeyboardEvent) => {
    const d = step || (max - min) / 50
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { onChange(Math.min(max, value + d)); e.preventDefault() }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { onChange(Math.max(min, value - d)); e.preventDefault() }
  }
  return (
    <div
      ref={ref}
      className={'slider' + (glass ? '' : ' plain')}
      data-active={active}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={key}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActive(true); set(e.clientX) }}
      onPointerMove={(e) => { if (active) set(e.clientX) }}
      onPointerUp={() => setActive(false)}
      onPointerCancel={() => setActive(false)}
    >
      <div className="slider-track"><div className="slider-fill" style={{ width: `${pct * 100}%` }} /></div>
      {glass ? (
        <Glass className="slider-thumb" style={{ left: `${pct * 100}%` }} thickness={10} frost={0.5} specular={0.9} tint="rgba(255,255,255,0.08)" />
      ) : (
        <div className="slider-thumb" style={{ left: `${pct * 100}%` }} />
      )}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <Glass className="toggle-thumb" thickness={10} frost={0.4} specular={0.9} tint="rgba(255,255,255,0.1)" />
    </button>
  )
}

export function useIndicator<T extends string>(active: T) {
  const refs = useRef(new Map<T, HTMLElement>())
  const [box, setBox] = useState({ left: 0, width: 0 })
  useEffect(() => {
    const el = refs.current.get(active)
    if (!el) return
    const update = () => setBox({ left: el.offsetLeft, width: el.offsetWidth })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])
  const bind = (key: T) => (el: HTMLElement | null) => { if (el) refs.current.set(key, el); else refs.current.delete(key) }
  return { box, bind }
}

export function Swap({ show, a, b }: { show: boolean; a: ReactNode; b: ReactNode }) {
  return (
    <span className="chip-swap">
      <span data-hidden={show}>{a}</span>
      <span data-hidden={!show} aria-hidden={!show}>{b}</span>
    </span>
  )
}

export async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
  }
}

function highlight(code: string) {
  const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/(\/\/.*$|&lt;!--.*?--&gt;)/gm, '<span class="tok-c">$1</span>')
    .replace(/('[^'\n]*'|"[^"\n]*")/g, '<span class="tok-s">$1</span>')
    .replace(/\b(import|from|export|function|return|const|new|default)\b/g, '<span class="tok-k">$1</span>')
    .replace(/(&lt;\/?)([A-Za-z][\w-]*)/g, '$1<span class="tok-t">$2</span>')
}

export function Code({ tabs }: { tabs: Record<string, string> }) {
  const names = Object.keys(tabs)
  const [tab, setTab] = useState(names[0])
  const [copied, setCopied] = useState(false)
  const code = tabs[tab] ?? tabs[names[0]]
  return (
    <div className="code">
      {names.length > 1 && (
        <div className="code-tabs">
          {names.map((n) => (
            <button key={n} className="opt" aria-pressed={n === tab} onClick={() => setTab(n)}>{n}</button>
          ))}
        </div>
      )}
      <button className="copy" onClick={() => { copy(code); setCopied(true); setTimeout(() => setCopied(false), 1400) }}>
        <Swap show={copied} a="Copy" b="Copied" />
      </button>
      <pre dangerouslySetInnerHTML={{ __html: highlight(code) }} />
    </div>
  )
}
