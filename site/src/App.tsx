import { useEffect, useMemo, useRef, useState } from 'react'
import { Glass, GlassGroup } from 'liquidglass/react'
import { Code, Slider, Swap, Toggle, copy, useDrag, useIndicator } from './ui'

const REPO = 'https://github.com/XFlexDev/liquidglass'
const SECTIONS = ['Overview', 'Components', 'Merge', 'Playground', 'Docs'] as const
type Section = (typeof SECTIONS)[number]

function Nav() {
  const [active, setActive] = useState<Section>('Overview')
  const { box, bind } = useIndicator(active)
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) setActive(e.target.getAttribute('data-sec') as Section)
    }, { rootMargin: '-45% 0px -50% 0px' })
    document.querySelectorAll('[data-sec]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return (
    <nav className="nav">
      <Glass className="nav-brand" as="a" href="#overview" style={{ textDecoration: 'none', color: '#fff' }}>liquidglass</Glass>
      <Glass className="nav-bar">
        <span className="nav-pill" style={{ left: box.left, width: box.width }} />
        {SECTIONS.map((s) => (
          <a key={s} ref={bind(s)} className="nav-link" href={`#${s.toLowerCase()}`} aria-current={s === active} style={{ textDecoration: 'none' }}>{s}</a>
        ))}
      </Glass>
    </nav>
  )
}

function Hero() {
  const stage = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const size = typeof window !== 'undefined' && window.innerWidth < 640 ? 128 : 180
  const lens = useDrag({ x: typeof window !== 'undefined' ? window.innerWidth * 0.62 : 600, y: typeof window !== 'undefined' ? window.innerHeight * 0.3 : 200 }, () => stage.current?.getBoundingClientRect(), size)
  return (
    <div className="hero" id="overview" data-sec="Overview">
      <div className="stage" ref={stage}>
        <img className="stage-img" src="/img/fjord.webp" alt="" />
        <div className="hero-copy">
          <h1>Liquid<br />Glass</h1>
          <p>Real refraction for HTML and React. Every browser, any content, zero dependencies.</p>
          <div className="hero-actions">
            <Glass as="button" className="chip" interactive onClick={() => { copy('npm i liquidglass'); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
              <Swap show={copied} a={<code>npm i liquidglass</code>} b={<code>Copied</code>} />
            </Glass>
            <Glass as="a" className="chip" interactive href={REPO} style={{ textDecoration: 'none' }}>GitHub</Glass>
          </div>
        </div>
        <div className="lens-handle" style={{ transform: `translate(${lens.pos.x}px, ${lens.pos.y}px)` }} {...lens.handlers}>
          <Glass className="lens" interactive={{ press: true, light: true, stretch: false }} thickness={40} bezel={60} dispersion={0.5} frost={0} />
        </div>
      </div>
    </div>
  )
}

const PlayIcon = () => <svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
const PauseIcon = () => <svg viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16" rx="1.5" /><rect x="14" y="4" width="5" height="16" rx="1.5" /></svg>
const SkipIcon = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" style={back ? { transform: 'scaleX(-1)' } : undefined}><path d="M3 6v12l8.5-6L3 6Zm9 0v12l8.5-6L12 6Z" /></svg>
)

function Components() {
  const [playing, setPlaying] = useState(true)
  const [t, setT] = useState(0.38)
  const [vol, setVol] = useState(0.7)
  const [wifi, setWifi] = useState(true)
  const [focus, setFocus] = useState(false)
  const [seg, setSeg] = useState<'Day' | 'Week' | 'Month'>('Week')
  const segInd = useIndicator(seg)
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setT((v) => (v >= 1 ? 0 : v + 1 / 214)), 1000)
    return () => clearInterval(id)
  }, [playing])
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (
    <section id="components" data-sec="Components">
      <div className="wrap">
        <div className="sec-head"><h2>Components</h2><p>Drop it on anything. Buttons, sliders, toggles and cards keep their markup and behaviour.</p></div>
        <div className="stage comp-stage">
          <img className="stage-img" src="/img/berries.webp" alt="" />
          <Glass className="card c-player">
            <div className="player-top">
              <div className="art" style={{ backgroundImage: 'url(/img/jelly.webp)' }} />
              <div><div className="p-title">Drift</div><div className="p-sub">Deep Water</div></div>
            </div>
            <div style={{ marginTop: 18 }}><Slider glass label="Position" value={t} onChange={setT} /></div>
            <div className="p-time"><span>{fmt(t * 214)}</span><span>-{fmt((1 - t) * 214)}</span></div>
            <div className="p-buttons">
              <Glass as="button" className="round sm" interactive aria-label="Previous" onClick={() => setT(0)}><SkipIcon back /></Glass>
              <Glass as="button" className="round" interactive aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{playing ? <PauseIcon /> : <PlayIcon />}</Glass>
              <Glass as="button" className="round sm" interactive aria-label="Next" onClick={() => setT(0)}><SkipIcon /></Glass>
            </div>
            <div style={{ marginTop: 14 }}><Slider glass label="Volume" value={vol} onChange={setVol} /></div>
          </Glass>
          <div className="c-controls">
            <Glass className="row">Wi-Fi<Toggle label="Wi-Fi" on={wifi} onChange={setWifi} /></Glass>
            <Glass className="row">Focus<Toggle label="Focus" on={focus} onChange={setFocus} /></Glass>
            <Glass className="seg" style={{ background: 'transparent' }}>
              <Glass className="seg-ind" style={{ left: segInd.box.left, width: segInd.box.width }} thickness={8} tint="rgba(255,255,255,0.12)" />
              {(['Day', 'Week', 'Month'] as const).map((s) => (
                <button key={s} ref={segInd.bind(s)} className="seg-btn" aria-pressed={s === seg} onClick={() => setSeg(s)}>{s}</button>
              ))}
            </Glass>
            <Glass className="card notif">
              <div className="notif-dot" />
              <div><b>Harvest</b><span>Fresh batch is ready for pickup.</span></div>
            </Glass>
          </div>
          <div className="c-side">
            <Glass className="card"><div className="big-num">72°</div><div className="big-sub">Sunny, light breeze</div></Glass>
            <Glass className="card"><div className="big-num">9:41</div><div className="big-sub">Saturday</div></Glass>
          </div>
        </div>
      </div>
    </section>
  )
}

function Blob({ initial, stage, label }: { initial: { x: number; y: number }; stage: React.RefObject<HTMLDivElement>; label: string }) {
  const d = useDrag(initial, () => stage.current?.getBoundingClientRect(), 96)
  return <Glass className="blob" style={{ transform: `translate(${d.pos.x}px, ${d.pos.y}px)` }} {...d.handlers}>{label}</Glass>
}

function Merge() {
  const stage = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [w, setW] = useState(900)
  useEffect(() => { if (stage.current) setW(stage.current.clientWidth) }, [])
  const items = ['Share', 'Save', 'Edit']
  return (
    <section id="merge" data-sec="Merge">
      <div className="wrap">
        <div className="sec-head"><h2>Merge</h2><p>Glass in a group melts together when shapes meet, like SwiftUI's glass containers. Drag the drops.</p></div>
        <div className="stage merge-stage" ref={stage}>
          <img className="stage-img" src="/img/ocean.webp" alt="" />
          <GlassGroup className="merge-group" blend={28}>
            <Blob stage={stage} label="" initial={{ x: w * 0.3, y: 200 }} />
            <Blob stage={stage} label="" initial={{ x: w * 0.3 + 120, y: 230 }} />
            <Blob stage={stage} label="" initial={{ x: w * 0.3 + 60, y: 330 }} />
          </GlassGroup>
          <GlassGroup className="menu-group" blend={16} data-open={open}>
            {items.map((it, i) => (
              <Glass key={it} className="menu-item" style={{ transform: open ? `translateY(${-(i + 1) * 80}px)` : 'none' }} as="button" aria-label={it} tabIndex={open ? 0 : -1}>{it}</Glass>
            ))}
            <Glass as="button" className="menu-main" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" /></svg>
            </Glass>
          </GlassGroup>
        </div>
      </div>
    </section>
  )
}

function Live() {
  const tabs = ['Library', 'Search', 'Radio'] as const
  const [tab, setTab] = useState<(typeof tabs)[number]>('Library')
  const ind = useIndicator(tab)
  const imgs = ['jelly', 'berries', 'falls', 'snow', 'fjord', 'ocean']
  const rows = Array.from({ length: 2 }).flatMap(() => [
    <div className="live-text" key={Math.random()}>Anything <span>underneath</span></div>,
    <div className="live-row" key={Math.random()}>{imgs.slice(0, 3).map((i) => <div key={i} className="live-tile" style={{ backgroundImage: `url(/img/${i}.webp)` }} />)}</div>,
    <div className="live-text" key={Math.random()}>stays live.</div>,
    <div className="live-row" key={Math.random()}>{imgs.slice(3).map((i) => <div key={i} className="live-tile" style={{ backgroundImage: `url(/img/${i}.webp)` }} />)}</div>,
  ])
  return (
    <section>
      <div className="wrap">
        <div className="sec-head"><h2>Live backdrop</h2><p>Scrolling text, video and animated UI refract in real time. No snapshots, no re-render calls.</p></div>
        <div className="stage live-stage">
          <div className="live-scroll">{rows}</div>
          <Glass className="live-bar">
            <span className="tab-ind" style={{ left: ind.box.left, width: ind.box.width }} />
            {tabs.map((t) => <button key={t} ref={ind.bind(t)} className="tab" aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>)}
          </Glass>
        </div>
      </div>
    </section>
  )
}

type Shape = 'Pill' | 'Circle' | 'Card'
const SHAPES: Record<Shape, { w: number; h: number; r: number }> = {
  Pill: { w: 280, h: 96, r: 48 },
  Circle: { w: 200, h: 200, r: 100 },
  Card: { w: 320, h: 220, r: 36 },
}
const BACKDROPS = ['fjord', 'jelly', 'falls', 'snow', 'text', 'grid'] as const
const DEFAULTS = { thickness: 24, bezel: 32, ior: 1.5, dispersion: 0.3, frost: 1.5, saturation: 1.6, specular: 0.7, lightAngle: -50, tint: 0.03 }

function Playground() {
  const stage = useRef<HTMLDivElement>(null)
  const [shape, setShape] = useState<Shape>('Pill')
  const [bd, setBd] = useState<(typeof BACKDROPS)[number]>('jelly')
  const [profile, setProfile] = useState<'squircle' | 'circle' | 'lip'>('squircle')
  const [o, setO] = useState(DEFAULTS)
  const [tier, setTier] = useState('')
  const s = SHAPES[shape]
  const drag = useDrag({ x: 160, y: 200 }, () => stage.current?.getBoundingClientRect(), Math.max(s.w, s.h) * 0.5)
  const glassRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = setTimeout(() => setTier(glassRef.current?.dataset.lgTier ?? ''), 120)
    return () => clearTimeout(id)
  })
  const ctl = (k: keyof typeof DEFAULTS, label: string, min: number, max: number, step = 0) => (
    <div className="ctl" key={k}>
      <div className="ctl-top"><span>{label}</span><b>{Number(o[k]).toFixed(step >= 1 ? 0 : 2)}</b></div>
      <Slider label={label} value={o[k]} min={min} max={max} step={step} onChange={(v) => setO({ ...o, [k]: v })} />
    </div>
  )
  const props = useMemo(() => {
    const p: Record<string, string | number> = {}
    for (const k of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) if (o[k] !== DEFAULTS[k]) p[k] = k === 'tint' ? `rgba(255,255,255,${o.tint})` : o[k]
    if (profile !== 'squircle') p.profile = profile
    return p
  }, [o, profile])
  const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
  const reactCode = `import { Glass } from 'liquidglass/react'\n\n<Glass${Object.entries(props).map(([k, v]) => ` ${k}=${typeof v === 'string' ? `"${v}"` : `{${v}}`}`).join('')}\n  style={{ width: ${s.w}, height: ${s.h}, borderRadius: ${s.r} }}\n/>`
  const htmlCode = `<script type="module" src="https://unpkg.com/liquidglass/dist/liquidglass.global.js"></script>\n\n<liquid-glass${Object.entries(props).map(([k, v]) => ` ${kebab(k)}="${v}"`).join('')}\n  style="width:${s.w}px;height:${s.h}px;border-radius:${s.r}px"></liquid-glass>`
  const jsCode = `import { createGlass } from 'liquidglass'\n\nconst glass = createGlass(document.querySelector('.panel'), ${JSON.stringify(props, null, 2).replace(/"(\w+)":/g, '$1:')})\nglass.set({ frost: 4 })\nglass.destroy()`
  return (
    <section id="playground" data-sec="Playground">
      <div className="wrap">
        <div className="sec-head"><h2>Playground</h2><p>Drag the glass. Every option updates live without rebuilding the element.</p></div>
        <div className="pg">
          <div className="stage pg-stage" ref={stage}>
            {bd === 'text' ? (
              <div className="backdrop-text"><h3>Refraction, not blur.</h3>{'Light bends through a curved rim, magnifies what sits beneath the edge and splits into colour at the steepest angles. The centre stays perfectly flat and sharp. '.repeat(6)}</div>
            ) : bd === 'grid' ? <div className="backdrop-grid" /> : <img className="stage-img" src={`/img/${bd}.webp`} alt="" />}
            <div className="pg-subject" style={{ transform: `translate(${drag.pos.x}px, ${drag.pos.y}px)` }} {...drag.handlers}>
              <Glass
                ref={glassRef}
                interactive={{ press: true, light: true, stretch: true }}
                profile={profile}
                {...o}
                tint={`rgba(255,255,255,${o.tint})`}
                style={{ width: s.w, height: s.h, borderRadius: s.r, transition: 'width .5s var(--spring), height .5s var(--spring), border-radius .5s var(--spring)' }}
              />
            </div>
          </div>
          <div className="pg-panel">
            <div className="opts">{(Object.keys(SHAPES) as Shape[]).map((k) => <button key={k} className="opt" aria-pressed={k === shape} onClick={() => setShape(k)}>{k}</button>)}</div>
            <div className="opts">
              {BACKDROPS.map((b) => (
                <button key={b} className="swatch" aria-label={b} aria-pressed={b === bd} onClick={() => setBd(b)}
                  style={b === 'text' ? { background: '#111', color: '#fff', fontSize: 12, fontWeight: 700 } : b === 'grid' ? { backgroundImage: 'linear-gradient(135deg,#ff375f,#5e5ce6,#30d158)' } : { backgroundImage: `url(/img/${b}.webp)` }}>
                  {b === 'text' ? 'Aa' : ''}
                </button>
              ))}
            </div>
            <div className="opts">{(['squircle', 'circle', 'lip'] as const).map((p) => <button key={p} className="opt" aria-pressed={p === profile} onClick={() => setProfile(p)}>{p}</button>)}</div>
            {ctl('thickness', 'Thickness', 0, 80, 1)}
            {ctl('bezel', 'Bezel', 4, 100, 1)}
            {ctl('ior', 'Index of refraction', 1, 2.4)}
            {ctl('dispersion', 'Dispersion', 0, 1)}
            {ctl('frost', 'Frost', 0, 20)}
            {ctl('saturation', 'Saturation', 0, 3)}
            {ctl('specular', 'Specular', 0, 1)}
            {ctl('lightAngle', 'Light angle', -180, 180, 1)}
            {ctl('tint', 'Tint', 0, 0.5)}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="tier">Renderer <b>{tier || '...'}</b></span>
              <button className="opt" onClick={() => { setO(DEFAULTS); setProfile('squircle') }}>Reset</button>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}><Code tabs={{ React: reactCode, HTML: htmlCode, JavaScript: jsCode }} /></div>
      </div>
    </section>
  )
}

function Docs() {
  return (
    <section id="docs" data-sec="Docs">
      <div className="wrap">
        <div className="sec-head"><h2>Use it</h2><p>One package. React component, web component, plain JavaScript or a CSS class.</p></div>
        <div className="docs">
          <div><h3>React</h3><Code tabs={{ tsx: `import { Glass, GlassGroup } from 'liquidglass/react'\n\n<Glass as="button" interactive className="pill">\n  Play\n</Glass>\n\n<GlassGroup blend={18}>\n  <Glass className="dot" />\n  <Glass className="dot" />\n</GlassGroup>` }} /></div>
          <div><h3>HTML</h3><Code tabs={{ html: `<script type="module">\n  import 'liquidglass/element'\n</script>\n\n<liquid-glass interactive class="pill">\n  Play\n</liquid-glass>\n\n<liquid-glass-group blend="18">\n  <liquid-glass class="dot"></liquid-glass>\n  <liquid-glass class="dot"></liquid-glass>\n</liquid-glass-group>` }} /></div>
          <div><h3>Any element</h3><Code tabs={{ js: `import { createGlass } from 'liquidglass'\n\nconst glass = createGlass(el, {\n  thickness: 24,\n  dispersion: 0.3,\n  interactive: true,\n})\n\nglass.tier // 'refract'\nglass.set({ frost: 6 })\nglass.destroy()` }} /></div>
        </div>
        <div className="sec-head" style={{ marginTop: 72 }}><h2>Every browser</h2><p>The best renderer each engine supports is picked automatically. Same API everywhere.</p></div>
        <div className="tiers-wrap">
          <table className="tiers">
            <thead><tr><th>Renderer</th><th>Where</th><th>What you get</th></tr></thead>
            <tbody>
              <tr><td>refract</td><td>Chrome, Edge, Opera, Arc, Brave, Samsung Internet</td><td>Physically based refraction of the live page with dispersion, frost and specular rim.</td></tr>
              <tr><td>source</td><td>Safari, iOS, Firefox, with an image, video or canvas source</td><td>The same optics rendered in WebGL from the source pixels, video included.</td></tr>
              <tr><td>element</td><td>Firefox, with any element as source</td><td>Live refraction of that element through its SVG filter.</td></tr>
              <tr><td>material</td><td>Everything else, and before JavaScript loads</td><td>Backdrop blur with a thick refractive-looking rim and the same specular highlight.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <>
      <Nav />
      <Hero />
      <Components />
      <Merge />
      <Live />
      <Playground />
      <Docs />
      <div className="wrap">
        <footer>
          <span>MIT licensed. Built on ideas from liquid-glass-react, vitrio, liquidGL and kube.io.</span>
          <a href={REPO}>GitHub</a>
        </footer>
      </div>
    </>
  )
}
