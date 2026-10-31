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

export function createGlass(_element: HTMLElement, _options: GlassOptions = {}): GlassController {
  throw new Error('liquidglass is not initialized')
}

export function detectSupport(): { webgl: boolean; refract: boolean; element: boolean } {
  return { webgl: false, refract: false, element: false }
}
