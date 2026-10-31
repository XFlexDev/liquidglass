import { createGlass as createGlassController, detectSupport as detectBrowserSupport } from './render'
import { createGlassGroup as createGroupController, type GlassGroupController, type GlassGroupOptions } from './group'

export interface GlassOptions {
  radius?: number | 'auto'
  bezel?: number | 'auto'
  thickness?: number
  ior?: number
  profile?: 'squircle' | 'circle' | 'lip'
  dispersion?: number
  frost?: number
  saturation?: number
  brightness?: number
  tint?: string
  specular?: number
  lightAngle?: number
  shadow?: boolean | string
  interactive?: boolean | { press?: boolean; stretch?: boolean; light?: boolean }
  source?: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | HTMLElement | string | null
  mode?: 'auto' | 'refract' | 'source' | 'element' | 'material'
}

export type GlassTier = 'refract' | 'source' | 'element' | 'material'

export interface GlassController {
  readonly tier: GlassTier
  set(options: Partial<GlassOptions>): void
  refresh(): void
  destroy(): void
}

export type { GlassGroupController, GlassGroupOptions }
export type { SupportInfo } from './render'

export const createGlass = createGlassController
export const createGlassGroup = createGroupController

export const detectSupport = detectBrowserSupport

export { DEFAULTS, clearMapCache, createDisplacementMap, getMapCacheSize, parseGlassOptions, profileDerivative, profileHeight, roundedRectSdf, stepSpring } from './math'
