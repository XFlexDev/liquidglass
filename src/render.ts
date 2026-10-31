import type { GlassController, GlassOptions, GlassTier } from './index'
import { clamp, createDisplacementMap, DEFAULTS, roundedRectSdf, stepSpring } from './math'

const SVG_NS = 'http://www.w3.org/2000/svg'
const sourceImages = new WeakMap<HTMLElement, HTMLImageElement>()
let uid = 0
let sharedSvg: SVGSVGElement | null = null
let gl: WebGLRenderingContext | null = null
let glProgram: WebGLProgram | null = null
let glTexture: WebGLTexture | null = null
let glPosition: number | null = null
let glUniforms: Record<string, WebGLUniformLocation | null> = {}
let glCanvas: HTMLCanvasElement | null = null
const clients = new Set<(time: number) => boolean>()
const groupSourceUpdates = new WeakMap<HTMLElement, (shapes: SourceShape[], blend: number) => void>()
let motionFrame = 0

export interface SourceShape {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export interface SupportInfo {
  webgl: boolean
  refract: boolean
  element: boolean
}

function getSharedSvg(): SVGSVGElement {
  if (sharedSvg?.isConnected) return sharedSvg
  sharedSvg = document.createElementNS(SVG_NS, 'svg')
  sharedSvg.setAttribute('aria-hidden', 'true')
  sharedSvg.dataset.liquidglassSvg = ''
  sharedSvg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  ;(document.body ?? document.documentElement).appendChild(sharedSvg)
  return sharedSvg
}

function canvasDataUrl(width: number, height: number, data: Uint8ClampedArray): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return ''
  const image = context.createImageData(width, height)
  image.data.set(data)
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function resolveSource(source: GlassOptions['source']): Element | null {
  if (typeof source === 'string') {
    try {
      return document.querySelector(source)
    } catch {
      return null
    }
  }
  return source instanceof Element ? source : null
}

function sourceImage(source: Element): CanvasImageSource | null {
  if (source instanceof HTMLImageElement || source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement) return source
  if (!(source instanceof HTMLElement)) return null
  const imageUrl = getComputedStyle(source).backgroundImage.match(/url\((["']?)(.*?)\1\)/)?.[2]
  if (!imageUrl) return null
  let image = sourceImages.get(source)
  if (!image) {
    image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = imageUrl
    sourceImages.set(source, image)
  } else if (image.src !== new URL(imageUrl, document.baseURI).href) {
    image.src = imageUrl
  }
  return image.complete && image.naturalWidth > 0 ? image : null
}

function supportsWebGl(): boolean {
  return typeof document !== 'undefined' && initWebGl()
}

function initWebGl(): boolean {
  if (gl && glProgram && glTexture) return true
  if (!glCanvas) glCanvas = document.createElement('canvas')
  gl = glCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
  if (!gl) return false
  const vertex = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `
  const fragment = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_source;
    uniform vec2 u_size;
    uniform float u_radius;
    uniform float u_bezel;
    uniform float u_thickness;
    uniform float u_ior;
    uniform float u_dispersion;
    uniform float u_frost;
    uniform float u_saturation;
    uniform float u_brightness;
    uniform float u_profile;
    uniform int u_shape_count;
    uniform vec4 u_shapes[16];
    uniform float u_radii[16];
    uniform float u_blend;
    float smoothMin(float a, float b, float k) {
      if (k <= 0.0) return min(a, b);
      float h = max(k - abs(a - b), 0.0) / k;
      return min(a, b) - h * h * k * 0.25;
    }
    float roundedRect(vec2 p, vec4 shape, float radius) {
      vec2 q = abs(p - shape.xy) - shape.zw + radius;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }
    float sdf(vec2 p) {
      if (u_shape_count > 0) {
        float distance = 1e20;
        for (int i = 0; i < 16; i++) {
          if (i >= u_shape_count) break;
          distance = smoothMin(distance, roundedRect(p, u_shapes[i], u_radii[i]), u_blend);
        }
        return distance;
      }
      vec2 q = abs(p) - u_size * 0.5 + u_radius;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
    }
    float profile(float t) {
      float q = 1.0 - clamp(t, 0.0, 1.0);
      float s = pow(max(0.0, 1.0 - pow(q, 4.0)), 0.25);
      float c = sqrt(max(0.0, 1.0 - q * q));
      float l = clamp(s - 0.08 * sin(3.14159265 * t), 0.0, 1.0);
      return u_profile < 0.5 ? s : (u_profile < 1.5 ? c : l);
    }
    vec2 bend(vec2 uv) {
      vec2 p = (uv - 0.5) * u_size;
      float d = -sdf(p);
      if (d <= 0.0 || d >= u_bezel) return uv;
      float t = d / u_bezel;
      float h = u_thickness * profile(t);
      float e = 0.002;
      float slope = u_thickness * (profile(t + e) - profile(t - e)) / (2.0 * e * u_bezel);
      float a = atan(slope);
      float refracted = asin(clamp(sin(a) / max(1.0, u_ior), -1.0, 1.0));
      float mag = clamp(h * tan(a - refracted), 0.0, u_thickness * 0.75);
      vec2 grad = vec2(
        sdf(p + vec2(0.5, 0.0)) - sdf(p - vec2(0.5, 0.0)),
        sdf(p + vec2(0.0, 0.5)) - sdf(p - vec2(0.0, 0.5))
      );
      return uv - normalize(grad) * mag / u_size;
    }
    void main() {
      vec2 uv = bend(v_uv);
      vec2 spread = vec2(u_dispersion * 0.003);
      vec4 red = texture2D(u_source, clamp(uv + spread, 0.001, 0.999));
      vec4 green = texture2D(u_source, clamp(uv, 0.001, 0.999));
      vec4 blue = texture2D(u_source, clamp(uv - spread, 0.001, 0.999));
      vec3 color = vec3(red.r, green.g, blue.b);
      if (u_frost > 0.1) {
        vec2 blur = vec2(u_frost * 0.0015);
        color = (color + texture2D(u_source, uv + blur).rgb + texture2D(u_source, uv - blur).rgb
          + texture2D(u_source, uv + vec2(blur.x, -blur.y)).rgb
          + texture2D(u_source, uv - vec2(blur.x, -blur.y)).rgb) / 5.0;
      }
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, u_saturation) * u_brightness;
      gl_FragColor = vec4(color, 1.0);
    }
  `
  const compile = (kind: number, source: string): WebGLShader | null => {
    const shader = gl!.createShader(kind)
    if (!shader) return null
    gl!.shaderSource(shader, source)
    gl!.compileShader(shader)
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) return null
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, vertex)
  const fs = compile(gl.FRAGMENT_SHADER, fragment)
  if (!vs || !fs) return false
  glProgram = gl.createProgram()
  if (!glProgram) return false
  gl.attachShader(glProgram, vs)
  gl.attachShader(glProgram, fs)
  gl.linkProgram(glProgram)
  if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) return false
  glPosition = gl.getAttribLocation(glProgram, 'a_position')
  glUniforms = Object.fromEntries(
    ['u_source', 'u_size', 'u_radius', 'u_bezel', 'u_thickness', 'u_ior', 'u_dispersion', 'u_frost', 'u_saturation', 'u_brightness', 'u_profile', 'u_shape_count', 'u_shapes[0]', 'u_radii[0]', 'u_blend']
      .map((name) => [name, gl!.getUniformLocation(glProgram!, name)]),
  )
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.useProgram(glProgram)
  gl.enableVertexAttribArray(glPosition)
  gl.vertexAttribPointer(glPosition, 2, gl.FLOAT, false, 0, 0)
  glTexture = gl.createTexture()
  if (!glTexture) return false
  gl.bindTexture(gl.TEXTURE_2D, glTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return true
}

function isBlink(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { brands: Array<{ brand: string }> } }
  return Boolean(
    nav.userAgentData?.brands.some(({ brand }) => brand === 'Chromium') ||
    (/Chrome\/\d/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)),
  )
}

function detectTier(options: GlassOptions): GlassTier {
  const mode = options.mode ?? 'auto'
  const source = resolveSource(options.source)
  const sourceUsable = Boolean(source && sourceImage(source))
  const webglSupported = supportsWebGl()
  const firefox = /Firefox\/\d/.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)
  if (mode === 'material') return 'material'
  if (mode === 'refract') return isBlink() ? 'refract' : 'material'
  if (mode === 'source') return sourceUsable && webglSupported ? 'source' : 'material'
  if (mode === 'element') return firefox && source instanceof HTMLElement ? 'element' : 'material'
  if (isBlink()) return 'refract'
  if (sourceUsable && webglSupported) return 'source'
  if (firefox && source instanceof HTMLElement) return 'element'
  return 'material'
}

export function detectSupport(): SupportInfo {
  return {
    webgl: supportsWebGl(),
    refract: typeof navigator !== 'undefined' && isBlink(),
    element: typeof CSS !== 'undefined' && CSS.supports('background', '-moz-element(#x)'),
  }
}

function createLayer(doc: Document): HTMLDivElement {
  const node = doc.createElement('div')
  node.dataset.liquidglassLayer = ''
  node.setAttribute('aria-hidden', 'true')
  node.style.cssText = 'position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1'
  return node
}

function sourceCanvasImage(
  source: CanvasImageSource,
  sourceElement: Element,
  target: HTMLCanvasElement,
  width: number,
  height: number,
): boolean {
  const context = target.getContext('2d')
  if (!context) return false
  context.clearRect(0, 0, width, height)
  let sw = 0
  let sh = 0
  if (source instanceof HTMLVideoElement) {
    sw = source.videoWidth
    sh = source.videoHeight
  } else if (source instanceof HTMLImageElement) {
    sw = source.naturalWidth
    sh = source.naturalHeight
  } else if (source instanceof HTMLCanvasElement) {
    sw = source.width
    sh = source.height
  } else if (source instanceof ImageBitmap) {
    sw = source.width
    sh = source.height
  }
  if (!sw || !sh) return false
  let fit = 'fill'
  let position = '50% 50%'
  if (sourceElement instanceof HTMLElement && sourceElement !== source) {
    const style = getComputedStyle(sourceElement)
    fit = style.backgroundSize === 'cover' ? 'cover' : style.backgroundSize === 'contain' ? 'contain' : 'fill'
    position = style.backgroundPosition
  } else if (sourceElement instanceof HTMLElement) {
    const style = getComputedStyle(sourceElement)
    fit = style.objectFit || 'fill'
    position = style.objectPosition || '50% 50%'
  }
  const scale = fit === 'cover' ? Math.max(width / sw, height / sh) : fit === 'contain' ? Math.min(width / sw, height / sh) : Math.max(width / sw, height / sh)
  const dw = sw * scale
  const dh = sh * scale
  const [px = '50%', py = '50%'] = position.split(/\s+/)
  const positionOffset = (value: string, targetSize: number, drawnSize: number): number => {
    if (value.endsWith('%')) return (targetSize - drawnSize) * (parseFloat(value) / 100)
    if (value.endsWith('px')) return parseFloat(value)
    if (value === 'left' || value === 'top') return 0
    if (value === 'right' || value === 'bottom') return targetSize - drawnSize
    return (targetSize - drawnSize) / 2
  }
  const dx = fit === 'fill' ? 0 : positionOffset(px, width, dw)
  const dy = fit === 'fill' ? 0 : positionOffset(py, height, dh)
  try {
    context.drawImage(source, dx, dy, fit === 'fill' ? width : dw, fit === 'fill' ? height : dh)
    return true
  } catch {
    return false
  }
}

function renderSource(
  source: CanvasImageSource,
  sourceElement: Element,
  output: HTMLCanvasElement,
  width: number,
  height: number,
  options: GlassOptions,
  shapes: SourceShape[] | null = null,
  blend = 0,
): boolean {
  if (!initWebGl() || !gl || !glCanvas || !glProgram || !glTexture) return false
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const pixelWidth = Math.max(1, Math.round(width * dpr))
  const pixelHeight = Math.max(1, Math.round(height * dpr))
  let input = output.dataset.sourceCanvas ? document.getElementById(output.dataset.sourceCanvas) as HTMLCanvasElement | null : null
  if (!input) {
    input = document.createElement('canvas')
    input.id = `lg-source-${++uid}`
    input.dataset.liquidglassSource = ''
    input.style.display = 'none'
    document.body.appendChild(input)
    output.dataset.sourceCanvas = input.id
  }
  input.width = pixelWidth
  input.height = pixelHeight
  if (!sourceCanvasImage(source, sourceElement, input, pixelWidth, pixelHeight)) return false
  glCanvas.width = pixelWidth
  glCanvas.height = pixelHeight
  gl.viewport(0, 0, pixelWidth, pixelHeight)
  gl.useProgram(glProgram)
  gl.bindTexture(gl.TEXTURE_2D, glTexture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input)
  } catch {
    return false
  }
  const minSize = Math.min(width, height)
  const radius = options.radius === 'auto' || options.radius === undefined
    ? Math.min(minSize / 2, parseFloat(getComputedStyle(sourceElement as Element).borderRadius) || 12)
    : options.radius
  const bezel = options.bezel === 'auto' || options.bezel === undefined ? clamp(minSize * 0.3, 8, 48) : options.bezel
  const uniforms = glUniforms
  gl.uniform1i(uniforms.u_source, 0)
  gl.uniform2f(uniforms.u_size, width, height)
  gl.uniform1f(uniforms.u_radius, radius)
  gl.uniform1f(uniforms.u_bezel, bezel)
  gl.uniform1f(uniforms.u_thickness, options.thickness ?? DEFAULTS.thickness)
  gl.uniform1f(uniforms.u_ior, options.ior ?? DEFAULTS.ior)
  gl.uniform1f(uniforms.u_dispersion, (options.dispersion ?? DEFAULTS.dispersion) * 20)
  gl.uniform1f(uniforms.u_frost, options.frost ?? DEFAULTS.frost)
  gl.uniform1f(uniforms.u_saturation, options.saturation ?? DEFAULTS.saturation)
  gl.uniform1f(uniforms.u_brightness, options.brightness ?? DEFAULTS.brightness)
  gl.uniform1f(uniforms.u_profile, options.profile === 'circle' ? 1 : options.profile === 'lip' ? 2 : 0)
  const sourceShapes = shapes?.slice(0, 16) ?? []
  const shapeData = new Float32Array(16 * 4)
  const radiusData = new Float32Array(16)
  sourceShapes.forEach((shape, index) => {
    shapeData.set([
      shape.x + shape.width / 2 - width / 2,
      shape.y + shape.height / 2 - height / 2,
      shape.width / 2,
      shape.height / 2,
    ], index * 4)
    radiusData[index] = shape.radius
  })
  gl.uniform1i(uniforms.u_shape_count, sourceShapes.length)
  gl.uniform4fv(uniforms.u_shapes, shapeData)
  gl.uniform1fv(uniforms.u_radii, radiusData)
  gl.uniform1f(uniforms.u_blend, blend)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  const context = output.getContext('2d')
  if (!context) return false
  output.width = pixelWidth
  output.height = pixelHeight
  context.clearRect(0, 0, pixelWidth, pixelHeight)
  context.drawImage(glCanvas, 0, 0)
  return true
}

function createRim(canvas: HTMLCanvasElement, width: number, height: number, radius: number, bezel: number, specular: number, lightAngle: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.createImageData(canvas.width, canvas.height)
  const light = (lightAngle * Math.PI) / 180
  const lx = Math.cos(light)
  const ly = Math.sin(light)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + 0.5) / dpr - width / 2
      const py = (y + 0.5) / dpr - height / 2
      const distance = roundedRectSdf(px, py, width, height, radius)
      const inward = -distance
      if (distance > 0.5 || inward > bezel * 0.6) continue
      const epsilon = 0.5
      const gx = (roundedRectSdf(px + epsilon, py, width, height, radius) - roundedRectSdf(px - epsilon, py, width, height, radius)) / 1
      const gy = (roundedRectSdf(px, py + epsilon, width, height, radius) - roundedRectSdf(px, py - epsilon, width, height, radius)) / 1
      const norm = Math.hypot(gx, gy) || 1
      const dot = (gx * lx + gy * ly) / norm
      const spec = Math.pow(Math.max(0, dot), 5) + 0.45 * Math.pow(Math.max(0, -dot), 5)
      const falloff = Math.exp(-Math.max(0, -inward) / Math.max(1, bezel * 0.12))
      const alpha = clamp((spec * falloff * specular * 0.8 + (Math.abs(inward) < 1 ? 0.15 : 0)), 0, 0.8)
      const idx = (y * canvas.width + x) * 4
      image.data[idx] = 255
      image.data[idx + 1] = 255
      image.data[idx + 2] = 255
      image.data[idx + 3] = Math.round(alpha * 255)
    }
  }
  context.putImageData(image, 0, 0)
}

function ringMask(width: number, height: number, radius: number, bezel: number): string {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.ceil(width * dpr))
  const h = Math.max(1, Math.ceil(height * dpr))
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = roundedRectSdf((x + 0.5) / dpr - width / 2, (y + 0.5) / dpr - height / 2, width, height, radius)
    const edge = Math.max(0, -d)
    const alpha = d > 1 || edge > bezel ? 0 : d >= 0 ? 255 : Math.round((1 - edge / Math.max(1, bezel)) * 255)
    const i = (y * w + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 255
    data[i + 3] = alpha
  }
  return canvasDataUrl(w, h, data)
}

export function createGlass(el: HTMLElement, initial: GlassOptions = {}): GlassController {
  let options: GlassOptions = { ...DEFAULTS, ...initial }
  const originalStyle = el.getAttribute('style')
  const originalEnhanced = el.getAttribute('data-liquidglass-enhanced')
  el.setAttribute('data-liquidglass-enhanced', '')
  const controllerId = `lg-${++uid}`
  const abort = new AbortController()
  const layers: HTMLDivElement[] = []
  let backdrop = createLayer(document)
  backdrop.dataset.liquidglassBackdrop = ''
  backdrop.style.zIndex = '-3'
  let edge = createLayer(document)
  edge.dataset.liquidglassEdge = ''
  edge.style.zIndex = '-2'
  let tint = createLayer(document)
  tint.dataset.liquidglassTint = ''
  tint.style.zIndex = '-2'
  let rim = document.createElement('canvas')
  rim.dataset.liquidglassRim = ''
  rim.setAttribute('aria-hidden', 'true')
  rim.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;mix-blend-mode:screen'
  let sourceLayer = document.createElement('canvas')
  sourceLayer.dataset.liquidglassSourceLayer = ''
  sourceLayer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-3'
  let filter: SVGFilterElement | null = null
  let feImage: SVGFEImageElement | null = null
  let resize: ResizeObserver | null = null
  let videoFrame = 0
  let sourceElement: Element | null = null
  let watchedSource: Element | null = null
  let sourceShapes: SourceShape[] | null = null
  let sourceBlend = 0
  let sourceFrame = 0
  let lightPoint = { x: 0.5, y: 0.5 }
  let scale = { value: 1, velocity: 0 }
  let stretchScaleX = { value: 1, velocity: 0 }
  let stretchScaleY = { value: 1, velocity: 0 }
  let translateX = { value: 0, velocity: 0 }
  let translateY = { value: 0, velocity: 0 }
  let targetScale = 1
  let targetStretchScaleX = 1
  let targetStretchScaleY = 1
  let targetX = 0
  let targetY = 0
  let pointerDown = false
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  if (!el.style.position || el.style.position === 'static') el.style.position = 'relative'
  if (!el.style.isolation) el.style.isolation = 'isolate'
  el.style.overflow = el.style.overflow || 'visible'
  layers.push(backdrop, edge, tint)
  el.prepend(backdrop, edge, tint, rim, sourceLayer)
  if (options.shadow === true) el.style.boxShadow = '0 6px 24px rgba(0,0,0,.18)'
  else if (typeof options.shadow === 'string') el.style.boxShadow = options.shadow

  const updateLayout = (): void => {
    const rect = el.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    const size = Math.min(width, height)
    const computed = getComputedStyle(el)
    const radius = options.radius === 'auto' || options.radius === undefined
      ? clamp(parseFloat(computed.borderRadius) || 0, 0, size / 2)
      : clamp(options.radius, 0, size / 2)
    const frost = options.frost ?? DEFAULTS.frost
    const saturation = options.saturation ?? DEFAULTS.saturation
    const brightness = options.brightness ?? DEFAULTS.brightness
    const dispersion = options.dispersion ?? DEFAULTS.dispersion
    const bezel = options.bezel === 'auto' || options.bezel === undefined
      ? clamp(size * 0.3, 8, 48)
      : clamp(options.bezel, 1, size / 2)
    if (typeof options.radius === 'number') el.style.borderRadius = `${radius}px`
    const tier = detectTier(options)
    backdrop.style.display = tier === 'source' ? 'none' : ''
    edge.style.display = tier === 'material' ? '' : 'none'
    tint.style.display = ''
    sourceLayer.style.display = tier === 'source' ? '' : 'none'
    sourceLayer.style.borderRadius = `${radius}px`
    rim.style.borderRadius = `${radius}px`
    const cssFilter = `blur(${frost}px) saturate(${saturation}) brightness(${brightness})`
    if (tier === 'material') {
      backdrop.style.backdropFilter = cssFilter
      ;(backdrop.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = cssFilter
      edge.style.backdropFilter = `blur(${frost + 6}px) saturate(${saturation * 1.05}) brightness(${brightness * 1.08})`
      ;(edge.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = edge.style.backdropFilter
      const mask = `url("${ringMask(width, height, radius, bezel)}")`
      edge.style.maskImage = mask
      ;(edge.style as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage = mask
    }
    tint.style.background = options.tint ?? DEFAULTS.tint
    const shadow = typeof options.shadow === 'string' ? options.shadow : options.shadow ? '0 6px 24px rgba(0,0,0,.18)' : 'none'
    el.style.boxShadow = shadow
    createRim(rim, width, height, radius, bezel, options.specular ?? 0, options.lightAngle ?? -50)
    if (tier === 'refract' || tier === 'element') {
      const map = createDisplacementMap({
        width,
        height,
        radius,
        bezel,
        thickness: options.thickness ?? 24,
        ior: options.ior ?? 1.5,
        profile: options.profile ?? 'squircle',
        dispersion: options.dispersion ?? 0.3,
      })
      const url = canvasDataUrl(map.width, map.height, map.data)
      const margin = map.margin
      backdrop.style.inset = `${-margin}px`
      backdrop.style.clipPath = `inset(${margin}px round ${radius}px)`
      const svg = getSharedSvg()
      backdrop.dataset.liquidglassFilter = controllerId
      if (!filter) {
        filter = document.createElementNS(SVG_NS, 'filter')
        filter.id = controllerId
        filter.setAttribute('color-interpolation-filters', 'sRGB')
        filter.setAttribute('filterUnits', 'userSpaceOnUse')
        filter.setAttribute('primitiveUnits', 'userSpaceOnUse')
        feImage = document.createElementNS(SVG_NS, 'feImage')
        feImage.setAttribute('result', 'map')
        feImage.setAttribute('preserveAspectRatio', 'none')
        const blur = document.createElementNS(SVG_NS, 'feGaussianBlur')
        blur.setAttribute('in', 'SourceGraphic')
        blur.setAttribute('stdDeviation', `${frost}`)
        blur.setAttribute('result', 'blurred')
        filter.append(blur, feImage)
        let previous = 'blurred'
        for (const [channel, factor] of [['R', 1 + dispersion * 0.5], ['G', 1], ['B', 1 - dispersion * 0.5]] as const) {
          const displaced = document.createElementNS(SVG_NS, 'feDisplacementMap')
          displaced.setAttribute('in', 'blurred')
          displaced.setAttribute('in2', 'map')
          displaced.setAttribute('scale', `${map.maxD * 2 * factor}`)
          displaced.setAttribute('xChannelSelector', 'R')
          displaced.setAttribute('yChannelSelector', 'G')
          displaced.setAttribute('result', `displaced${channel}`)
          filter.appendChild(displaced)
          const color = document.createElementNS(SVG_NS, 'feColorMatrix')
          color.setAttribute('in', `displaced${channel}`)
          color.setAttribute('type', 'matrix')
          color.setAttribute('values', channel === 'R'
            ? '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'
            : channel === 'G'
              ? '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'
              : '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0')
          color.setAttribute('result', `channel${channel}`)
          filter.appendChild(color)
          previous = `channel${channel}`
        }
        const merge = document.createElementNS(SVG_NS, 'feComposite')
        merge.setAttribute('in', 'channelR')
        merge.setAttribute('in2', 'channelG')
        merge.setAttribute('operator', 'arithmetic')
        merge.setAttribute('k2', '1')
        merge.setAttribute('k3', '1')
        merge.setAttribute('result', 'rg')
        filter.appendChild(merge)
        const mergeBlue = document.createElementNS(SVG_NS, 'feComposite')
        mergeBlue.setAttribute('in', 'rg')
        mergeBlue.setAttribute('in2', 'channelB')
        mergeBlue.setAttribute('operator', 'arithmetic')
        mergeBlue.setAttribute('k2', '1')
        mergeBlue.setAttribute('k3', '1')
        mergeBlue.setAttribute('result', previous)
        filter.appendChild(mergeBlue)
        const saturate = document.createElementNS(SVG_NS, 'feColorMatrix')
        saturate.setAttribute('in', previous)
        saturate.setAttribute('type', 'saturate')
        saturate.setAttribute('values', `${saturation}`)
        filter.appendChild(saturate)
        svg.appendChild(filter)
      }
      filter.setAttribute('x', '0')
      filter.setAttribute('y', '0')
      filter.setAttribute('width', `${map.width}`)
      filter.setAttribute('height', `${map.height}`)
      filter.querySelector('feGaussianBlur')?.setAttribute('stdDeviation', `${frost}`)
      filter.querySelector('[result="displacedR"]')?.setAttribute('scale', `${map.maxD * 2 * (1 + dispersion * 0.5)}`)
      filter.querySelector('[result="displacedG"]')?.setAttribute('scale', `${map.maxD * 2}`)
      filter.querySelector('[result="displacedB"]')?.setAttribute('scale', `${map.maxD * 2 * (1 - dispersion * 0.5)}`)
      filter.querySelector('feColorMatrix[type="saturate"]')?.setAttribute('values', `${saturation}`)
      const mapNode = filter.querySelector('feImage')
      mapNode?.setAttribute('x', '0')
      mapNode?.setAttribute('y', '0')
      mapNode?.setAttribute('width', `${width + margin * 2}`)
      mapNode?.setAttribute('height', `${height + margin * 2}`)
      mapNode?.setAttribute('href', url)
      if (tier === 'refract') {
        backdrop.style.filter = ''
        backdrop.style.background = ''
        backdrop.style.backdropFilter = `url(#${controllerId}) brightness(${brightness})`
        ;(backdrop.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = backdrop.style.backdropFilter
      } else {
        sourceElement = resolveSource(options.source)
        if (sourceElement instanceof HTMLElement) {
          if (!sourceElement.id) sourceElement.id = `${controllerId}-source`
          backdrop.style.background = `-moz-element(#${sourceElement.id})`
          backdrop.style.filter = `url(#${controllerId})`
          backdrop.style.backdropFilter = 'none'
          ;(backdrop.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = 'none'
          const sourceRect = sourceElement.getBoundingClientRect()
          const hostRect = el.getBoundingClientRect()
          backdrop.style.backgroundPosition = `${sourceRect.left - hostRect.left + margin}px ${sourceRect.top - hostRect.top + margin}px`
        }
      }
    } else {
      backdrop.style.inset = '0'
      backdrop.style.clipPath = `inset(0 round ${radius}px)`
      backdrop.style.filter = ''
      backdrop.style.background = ''
      backdrop.style.backgroundPosition = ''
    }
    if (tier === 'source') {
      sourceElement = resolveSource(options.source)
      const image = sourceElement ? sourceImage(sourceElement) : null
      if (sourceElement && image) renderSource(image, sourceElement, sourceLayer, width, height, options, sourceShapes, sourceBlend)
    }
  }

  const redrawSource = (): void => {
    if (videoFrame) cancelAnimationFrame(videoFrame)
    videoFrame = 0
    const tier = detectTier(options)
    if (tier !== 'source' || !sourceElement) return
    const source = sourceImage(sourceElement)
    const rect = el.getBoundingClientRect()
    if (source && !renderSource(source, sourceElement, sourceLayer, rect.width, rect.height, options, sourceShapes, sourceBlend)) {
      options = { ...options, mode: 'material' }
      updateLayout()
      return
    }
    if (source instanceof HTMLVideoElement && !source.paused && !source.ended) {
      videoFrame = requestAnimationFrame(redrawSource)
    }
  }

  const refresh = (): void => {
    sourceElement = resolveSource(options.source)
    if (watchedSource !== sourceElement) {
      watchedSource?.removeEventListener('load', onSourceReady)
      watchedSource?.removeEventListener('loadeddata', onSourceReady)
      watchedSource?.removeEventListener('playing', onSourceReady)
      watchedSource = sourceElement
      watchedSource?.addEventListener('load', onSourceReady)
      watchedSource?.addEventListener('loadeddata', onSourceReady)
      watchedSource?.addEventListener('playing', onSourceReady)
    }
    updateLayout()
    redrawSource()
  }

  const onSourceReady = (): void => {
    updateLayout()
    redrawSource()
  }

  const updateGroupSource = (shapes: SourceShape[], blend: number): void => {
    sourceShapes = shapes
    sourceBlend = blend
    if (detectTier(options) !== 'source' || !sourceElement) return
    const image = sourceImage(sourceElement)
    const rect = el.getBoundingClientRect()
    if (image) renderSource(image, sourceElement, sourceLayer, rect.width, rect.height, options, sourceShapes, sourceBlend)
  }

  const set = (next: Partial<GlassOptions>): void => {
    const shouldResolve = 'mode' in next || 'source' in next
    options = { ...options, ...next }
    if ('interactive' in next) {
      interactive = next.interactive
      interactiveOptions = typeof interactive === 'object'
        ? interactive
        : { press: Boolean(interactive), stretch: Boolean(interactive), light: Boolean(interactive) }
      syncInteractive()
    }
    if (shouldResolve && sourceElement instanceof HTMLElement && sourceElement.id === `${controllerId}-source`) sourceElement.removeAttribute('id')
    refresh()
  }

  const onResize = (): void => {
    refresh()
  }
  const onScroll = (): void => {
    if (detectTier(options) === 'element') updateLayout()
    else redrawSource()
  }
  if (typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(onResize)
    resize.observe(el)
  }
  window.addEventListener('resize', onResize, { signal: abort.signal })
  window.addEventListener('scroll', onScroll, { passive: true, signal: abort.signal })

  let interactive = options.interactive
  let interactiveOptions = typeof interactive === 'object'
    ? interactive
    : { press: Boolean(interactive), stretch: Boolean(interactive), light: Boolean(interactive) }
  let interactiveAttached = false
  const applyTransform = (): void => {
    const transform = originalStyle?.match(/(?:^|;)\s*transform\s*:\s*([^;]+)/i)?.[1]?.trim() ?? ''
    el.style.transform = `${transform} translate3d(${translateX.value}px,${translateY.value}px,0) scale(${scale.value * stretchScaleX.value},${scale.value * stretchScaleY.value})`.trim()
  }
  const scheduleMotion = (): void => {
    if (motionFrame || clients.size === 0) return
    motionFrame = requestAnimationFrame((time) => {
      motionFrame = 0
      for (const client of [...clients]) if (!client(time)) clients.delete(client)
      if (clients.size) scheduleMotion()
    })
  }
  const motionClient = (time: number): boolean => {
    let active = false
    if (interactiveOptions.press && !reducedMotion) {
      scale = stepSpring(scale, targetScale, 1 / 60)
      active ||= Math.abs(scale.value - targetScale) > 0.001 || Math.abs(scale.velocity) > 0.001
    } else scale.value = targetScale
    if (interactiveOptions.stretch && !reducedMotion) {
      translateX = stepSpring(translateX, targetX, 1 / 60)
      translateY = stepSpring(translateY, targetY, 1 / 60)
      stretchScaleX = stepSpring(stretchScaleX, targetStretchScaleX, 1 / 60)
      stretchScaleY = stepSpring(stretchScaleY, targetStretchScaleY, 1 / 60)
      active ||= Math.abs(translateX.value - targetX) > 0.001 || Math.abs(translateY.value - targetY) > 0.001
      active ||= Math.abs(stretchScaleX.value - targetStretchScaleX) > 0.001 || Math.abs(stretchScaleY.value - targetStretchScaleY) > 0.001
    } else {
      translateX.value = 0
      translateY.value = 0
      stretchScaleX.value = 1
      stretchScaleY.value = 1
    }
    applyTransform()
    return active
  }
  const pointerMove = (event: PointerEvent): void => {
    const rect = el.getBoundingClientRect()
    lightPoint = { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) }
    if (pointerDown && interactiveOptions.stretch && !reducedMotion) {
      const dx = event.clientX - rect.left - rect.width / 2
      const dy = event.clientY - rect.top - rect.height / 2
      targetX = clamp(dx * 0.08, -6, 6)
      targetY = clamp(dy * 0.08, -6, 6)
      targetStretchScaleX = 1 + clamp(dx / Math.max(1, rect.width) * 0.1, -0.06, 0.06)
      targetStretchScaleY = 1 + clamp(dy / Math.max(1, rect.height) * 0.1, -0.06, 0.06)
    }
    if (interactiveOptions.light && !reducedMotion) {
      const angle = Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI
      options = { ...options, lightAngle: angle }
      tint.style.backgroundImage = `radial-gradient(circle at ${lightPoint.x * 100}% ${lightPoint.y * 100}%, rgba(255,255,255,.12), transparent 45%)`
      const radius = Math.min(rect.width, rect.height)
      createRim(rim, rect.width, rect.height, Number(options.radius === 'auto' ? parseFloat(getComputedStyle(el).borderRadius) || radius / 4 : options.radius), Number(options.bezel === 'auto' ? clamp(radius * 0.3, 8, 48) : options.bezel), options.specular ?? 0, angle)
    }
    clients.add(motionClient)
    scheduleMotion()
  }
  const pointerDownHandler = (): void => {
    pointerDown = true
    const rect = el.getBoundingClientRect()
    targetScale = interactiveOptions.press
      ? 1 + clamp(14 / Math.max(1, Math.min(rect.width, rect.height)), 0.02, 0.12)
      : 1
    if (interactiveOptions.press && reducedMotion) {
      scale.value = targetScale
      applyTransform()
    }
    clients.add(motionClient)
    scheduleMotion()
  }
  const pointerUp = (): void => {
    pointerDown = false
    targetScale = 1
    targetX = 0
    targetY = 0
    targetStretchScaleX = 1
    targetStretchScaleY = 1
    clients.add(motionClient)
    scheduleMotion()
  }
  const syncInteractive = (): void => {
    if (interactive && !interactiveAttached) {
      el.addEventListener('pointermove', pointerMove, { signal: abort.signal })
      el.addEventListener('pointerdown', pointerDownHandler, { signal: abort.signal })
      window.addEventListener('pointerup', pointerUp, { signal: abort.signal })
      el.addEventListener('pointerleave', pointerUp, { signal: abort.signal })
      interactiveAttached = true
    } else if (!interactive && interactiveAttached) {
      pointerUp()
      el.removeEventListener('pointermove', pointerMove)
      el.removeEventListener('pointerdown', pointerDownHandler)
      window.removeEventListener('pointerup', pointerUp)
      el.removeEventListener('pointerleave', pointerUp)
      pointerDown = false
      interactiveAttached = false
    }
  }
  syncInteractive()

  groupSourceUpdates.set(el, updateGroupSource)
  refresh()

  return {
    get tier() {
      return detectTier(options)
    },
    set,
    refresh,
    destroy() {
      abort.abort()
      groupSourceUpdates.delete(el)
      resize?.disconnect()
      if (videoFrame) cancelAnimationFrame(videoFrame)
      clients.delete(motionClient)
      if (sourceLayer.dataset.sourceCanvas) document.getElementById(sourceLayer.dataset.sourceCanvas)?.remove()
      if (filter?.parentNode) filter.parentNode.removeChild(filter)
      if (sourceElement instanceof HTMLElement && sourceElement.id === `${controllerId}-source`) sourceElement.removeAttribute('id')
      el.querySelectorAll('[data-liquidglass-layer], [data-liquidglass-rim], [data-liquidglass-source-layer]').forEach((node) => node.remove())
      if (originalStyle === null) el.removeAttribute('style')
      else el.setAttribute('style', originalStyle)
      if (originalEnhanced === null) el.removeAttribute('data-liquidglass-enhanced')
      else el.setAttribute('data-liquidglass-enhanced', originalEnhanced)
      if (!document.querySelector('[data-liquidglass-filter]') && sharedSvg?.childElementCount === 0) {
        sharedSvg.remove()
        sharedSvg = null
      }
    },
  }
}

export function updateGlassDisplacementMap(
  element: HTMLElement,
  url: string,
  width: number,
  height: number,
  margin: number,
): void {
  const id = element.querySelector<HTMLElement>('[data-liquidglass-backdrop]')?.dataset.liquidglassFilter
  if (!id) return
  const filter = document.getElementById(id)
  filter?.setAttribute('x', '0')
  filter?.setAttribute('y', '0')
  filter?.setAttribute('width', `${width + margin * 2}`)
  filter?.setAttribute('height', `${height + margin * 2}`)
  const image = filter?.querySelector('feImage')
  image?.setAttribute('x', '0')
  image?.setAttribute('y', '0')
  image?.setAttribute('width', `${width + margin * 2}`)
  image?.setAttribute('height', `${height + margin * 2}`)
  image?.setAttribute('href', url)
}

export function updateGlassGroupSource(element: HTMLElement, shapes: SourceShape[], blend: number): void {
  groupSourceUpdates.get(element)?.(shapes, blend)
}
