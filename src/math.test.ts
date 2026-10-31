import { describe, expect, it } from 'vitest'
import {
  clearMapCache,
  createDisplacementMap,
  getMapCacheSize,
  parseGlassOptions,
  profileDerivative,
  profileHeight,
  roundedRectSdf,
  stepSpring,
} from './math'

describe('rounded rectangle SDF', () => {
  it('distinguishes the interior, edge, and rounded corner', () => {
    expect(roundedRectSdf(0, 0, 100, 60, 12)).toBe(-30)
    expect(roundedRectSdf(50, 0, 100, 60, 12)).toBe(0)
    expect(roundedRectSdf(50, 30, 100, 60, 12)).toBeCloseTo(Math.sqrt(288) - 12)
  })
})

describe('surface profiles', () => {
  it('starts at the edge and reaches full height at the bezel end', () => {
    for (const profile of ['squircle', 'circle', 'lip'] as const) {
      expect(profileHeight(profile, 0)).toBeCloseTo(0, 3)
      expect(profileHeight(profile, 1)).toBeCloseTo(1, 3)
      expect(profileDerivative(profile, 0.5)).toBeGreaterThan(0)
    }
  })
})

describe('displacement map', () => {
  it('has a neutral center and positive inward displacement at the top rim', () => {
    const map = createDisplacementMap({
      width: 100,
      height: 60,
      radius: 12,
      bezel: 18,
      thickness: 24,
      ior: 1.5,
      profile: 'squircle',
      dispersion: 0.3,
    })
    const center = ((map.margin + 30) * map.width + map.margin + 50) * 4
    expect(map.data[center]).toBe(128)
    expect(map.data[center + 1]).toBe(128)
    const topRim = ((map.margin + 2) * map.width + map.margin + 50) * 4
    expect(map.data[topRim + 1]).toBeGreaterThan(128)
    expect(map.width).toBe(100 + 2 * map.margin)
    expect(map.height).toBe(60 + 2 * map.margin)
    expect(map.maxD).toBe(18)
  })

  it('reuses recent map instances with a bounded cache', () => {
    clearMapCache()
    const geometry = {
      width: 12,
      height: 12,
      radius: 4,
      bezel: 4,
      thickness: 8,
      ior: 1.5,
      profile: 'circle' as const,
      dispersion: 0.3,
    }
    const first = createDisplacementMap(geometry)
    expect(createDisplacementMap(geometry)).toBe(first)
    for (let width = 13; width < 50; width++) createDisplacementMap({ ...geometry, width })
    expect(getMapCacheSize()).toBe(32)
  })
})

describe('option parsing and motion', () => {
  it('parses only valid option values', () => {
    expect(parseGlassOptions({ radius: 'auto', thickness: 18, mode: 'source', profile: 'lip', dispersion: Number.NaN })).toEqual({
      radius: 'auto',
      thickness: 18,
      mode: 'source',
      profile: 'lip',
    })
  })

  it('settles a spring at its target without residual velocity', () => {
    let state = { value: 1, velocity: 0 }
    for (let i = 0; i < 300; i++) state = stepSpring(state, 1.08, 1 / 60)
    expect(state.value).toBe(1.08)
    expect(state.velocity).toBe(0)
  })
})
