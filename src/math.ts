import type { GlassOptions } from './index'

export const DEFAULTS: Required<Omit<GlassOptions, 'source'>> & { source: GlassOptions['source'] } = {
  radius: 'auto',
  bezel: 'auto',
  thickness: 24,
  ior: 1.5,
  profile: 'squircle',
  dispersion: 0.3,
  frost: 1.5,
  saturation: 1.6,
  brightness: 1.05,
  tint: 'rgba(255,255,255,0.03)',
  specular: 0.7,
  lightAngle: -50,
  shadow: true,
  interactive: false,
  source: null,
  mode: 'auto',
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function roundedRectSdf(x: number, y: number, width: number, height: number, radius: number): number {
  const r = clamp(radius, 0, Math.min(width, height) / 2)
  const qx = Math.abs(x) - width / 2 + r
  const qy = Math.abs(y) - height / 2 + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

export function profileHeight(profile: NonNullable<GlassOptions['profile']>, t: number): number {
  const v = clamp(t, 0, 1)
  const q = 1 - v
  const squircle = Math.pow(Math.max(0, 1 - Math.pow(q, 4)), 0.25)
  if (profile === 'circle') return Math.sqrt(Math.max(0, 1 - q * q))
  if (profile === 'lip') return clamp(squircle - 0.08 * Math.sin(Math.PI * v), 0, 1)
  return squircle
}

export function profileDerivative(profile: NonNullable<GlassOptions['profile']>, t: number): number {
  const step = 0.0005
  const lo = clamp(t - step, 0, 1)
  const hi = clamp(t + step, 0, 1)
  return hi === lo ? 0 : (profileHeight(profile, hi) - profileHeight(profile, lo)) / (hi - lo)
}

export interface MapGeometry {
  width: number
  height: number
  radius: number
  bezel: number
  thickness: number
  ior: number
  profile: NonNullable<GlassOptions['profile']>
  dispersion: number
}

export interface DisplacementMap {
  width: number
  height: number
  margin: number
  maxD: number
  data: Uint8ClampedArray
}

const mapCache = new Map<string, DisplacementMap>()
const CACHE_LIMIT = 32

function cacheKey(g: MapGeometry): string {
  return [g.width, g.height, g.radius, g.bezel, g.thickness, g.ior, g.profile, g.dispersion].join(':')
}

export function clearMapCache(): void {
  mapCache.clear()
}

export function getMapCacheSize(): number {
  return mapCache.size
}

export function createDisplacementMap(geometry: MapGeometry): DisplacementMap {
  const key = cacheKey(geometry)
  const cached = mapCache.get(key)
  if (cached) {
    mapCache.delete(key)
    mapCache.set(key, cached)
    return cached
  }
  const { width, height } = geometry
  const minSize = Math.min(width, height)
  const radius = clamp(geometry.radius, 0, minSize / 2)
  const bezel = clamp(geometry.bezel, 1, minSize / 2)
  const maxD = Math.max(1, geometry.thickness * 0.75)
  const margin = Math.ceil(maxD) + 2
  const mapWidth = Math.max(1, Math.ceil(width + margin * 2))
  const mapHeight = Math.max(1, Math.ceil(height + margin * 2))
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4)
  const edge = (x: number, y: number): number => roundedRectSdf(x, y, width, height, radius)

  for (let py = 0; py < mapHeight; py++) {
    for (let px = 0; px < mapWidth; px++) {
      const x = px + 0.5 - margin - width / 2
      const y = py + 0.5 - margin - height / 2
      const distance = -edge(x, y)
      let dx = 0
      let dy = 0
      if (distance > 0 && distance < bezel) {
        const t = distance / bezel
        const slope = (geometry.thickness * profileDerivative(geometry.profile, t)) / bezel
        const theta1 = Math.atan(slope)
        const theta2 = Math.asin(clamp(Math.sin(theta1) / Math.max(1, geometry.ior), -1, 1))
        const heightAtT = geometry.thickness * profileHeight(geometry.profile, t)
        const magnitude = clamp(heightAtT * Math.tan(theta1 - theta2), 0, maxD)
        const epsilon = 0.5
        const gx = (edge(x + epsilon, y) - edge(x - epsilon, y)) / (epsilon * 2)
        const gy = (edge(x, y + epsilon) - edge(x, y - epsilon)) / (epsilon * 2)
        const norm = Math.hypot(gx, gy) || 1
        dx = (-gx / norm) * magnitude
        dy = (-gy / norm) * magnitude
      }
      const idx = (py * mapWidth + px) * 4
      data[idx] = Math.round(clamp(0.5 + dx / (2 * maxD), 0, 1) * 255)
      data[idx + 1] = Math.round(clamp(0.5 + dy / (2 * maxD), 0, 1) * 255)
      data[idx + 2] = data[idx + 1]
      data[idx + 3] = 255
    }
  }
  const result = { width: mapWidth, height: mapHeight, margin, maxD, data }
  mapCache.set(key, result)
  if (mapCache.size > CACHE_LIMIT) mapCache.delete(mapCache.keys().next().value!)
  return result
}

export interface SpringState {
  value: number
  velocity: number
}

export function stepSpring(
  state: SpringState,
  target: number,
  deltaSeconds: number,
  stiffness = 380,
  dampingRatio = 0.8,
): SpringState {
  const dt = Math.min(deltaSeconds, 1 / 30)
  const damping = 2 * dampingRatio * Math.sqrt(stiffness)
  const acceleration = stiffness * (target - state.value) - damping * state.velocity
  const velocity = state.velocity + acceleration * dt
  const value = state.value + velocity * dt
  if (Math.abs(target - value) < 0.001 && Math.abs(velocity) < 0.001) {
    return { value: target, velocity: 0 }
  }
  return { value, velocity }
}

export function parseGlassOptions(input: Record<string, unknown>): Partial<GlassOptions> {
  const result: Partial<GlassOptions> = {}
  const numeric = ['radius', 'bezel', 'thickness', 'ior', 'dispersion', 'frost', 'saturation', 'brightness', 'specular', 'lightAngle'] as const
  for (const key of numeric) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
    else if (value === 'auto' && (key === 'radius' || key === 'bezel')) result[key] = value
  }
  if (typeof input.profile === 'string' && ['squircle', 'circle', 'lip'].includes(input.profile)) {
    result.profile = input.profile as GlassOptions['profile']
  }
  if (typeof input.tint === 'string') result.tint = input.tint
  if (typeof input.shadow === 'boolean' || typeof input.shadow === 'string') result.shadow = input.shadow
  if (typeof input.interactive === 'boolean' || (input.interactive && typeof input.interactive === 'object')) {
    result.interactive = input.interactive as GlassOptions['interactive']
  }
  if (typeof input.source === 'string' || (typeof Element !== 'undefined' && input.source instanceof Element) || input.source === null) {
    result.source = input.source as GlassOptions['source']
  }
  if (typeof input.mode === 'string' && ['auto', 'refract', 'source', 'element', 'material'].includes(input.mode)) {
    result.mode = input.mode as GlassOptions['mode']
  }
  return result
}
