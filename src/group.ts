import type { GlassController, GlassOptions } from './index'
import { clamp, profileDerivative, profileHeight, roundedRectSdf } from './math'
import { createGlass, drawSpecularRim, updateGlassDisplacementMap, updateGlassGroupSource } from './render'

export interface GlassGroupOptions extends GlassOptions {
  blend?: number
}

export interface GlassGroupController extends GlassController {
  set(options: Partial<GlassGroupOptions>): void
  add(item: HTMLElement): void
  remove(item: HTMLElement): void
}

interface Shape {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

function shapeDistance(x: number, y: number, shapes: Shape[], blend: number): number {
  let distance = Infinity
  for (const shape of shapes) {
    const next = roundedRectSdf(x - shape.x - shape.width / 2, y - shape.y - shape.height / 2, shape.width, shape.height, shape.radius)
    distance = Number.isFinite(distance) ? smoothMin(distance, next, blend) : next
  }
  return distance
}

function readShapes(container: HTMLElement, items: Set<HTMLElement>): Shape[] {
  const rect = container.getBoundingClientRect()
  return [...items].filter((item) => item.isConnected && container.contains(item)).map((item) => {
    const itemRect = item.getBoundingClientRect()
    const radius = Math.max(0, parseFloat(getComputedStyle(item).borderRadius) || 0)
    return {
      x: itemRect.left - rect.left,
      y: itemRect.top - rect.top,
      width: itemRect.width,
      height: itemRect.height,
      radius: Math.min(radius, itemRect.width / 2, itemRect.height / 2),
    }
  })
}

function maskFor(width: number, height: number, shapes: Shape[], blend: number, resolution: number, margin = 0, ringWidth?: number): string {
  if (!shapes.length) return 'linear-gradient(transparent, transparent)'
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const pixelsPerCss = dpr * resolution
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((width + margin * 2) * pixelsPerCss))
  canvas.height = Math.max(1, Math.ceil((height + margin * 2) * pixelsPerCss))
  const context = canvas.getContext('2d')
  if (!context) return 'linear-gradient(transparent, transparent)'
  const image = context.createImageData(canvas.width, canvas.height)
  const antialias = 0.75 / pixelsPerCss
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + 0.5) / pixelsPerCss - margin
      const py = (y + 0.5) / pixelsPerCss - margin
      const distance = shapeDistance(px, py, shapes, blend)
      const alpha = Math.round(clamp(
        ringWidth === undefined
          ? 0.5 - distance / (antialias * 2)
          : distance >= 0
            ? 1 - distance / antialias
            : 1 + distance / ringWidth,
        0,
        1,
      ) * 255)
      const idx = (y * canvas.width + x) * 4
      image.data[idx] = 255
      image.data[idx + 1] = 255
      image.data[idx + 2] = 255
      image.data[idx + 3] = alpha
    }
  }
  context.putImageData(image, 0, 0)
  return `url("${canvas.toDataURL('image/png')}")`
}

function clipPathFor(shapes: Shape[]): string {
  if (!shapes.length) return 'inset(100%)'
  const paths = shapes.map(({ x, y, width, height, radius }) => {
    const r = clamp(radius, 0, Math.min(width, height) / 2)
    if (r === 0) return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`
    return `M ${x + r} ${y} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${y + r} V ${y + height - r} A ${r} ${r} 0 0 1 ${x + width - r} ${y + height} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + height - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
  }).join(' ')
  return `path("${paths}")`
}

function unionDisplacementMap(
  width: number,
  height: number,
  shapes: Shape[],
  blend: number,
  options: GlassGroupOptions,
  resolution: number,
): { url: string; margin: number } | null {
  if (!shapes.length) return null
  const thickness = options.thickness ?? 24
  const bezel = options.bezel === 'auto' || options.bezel === undefined
    ? clamp(Math.min(width, height) * 0.3, 8, 48)
    : clamp(options.bezel, 1, Math.min(width, height) / 2)
  const maxD = Math.max(1, thickness * 0.75)
  const margin = Math.ceil(maxD) + 2
  const pixelsPerCss = Math.min(2, window.devicePixelRatio || 1) * resolution
  const mapWidth = Math.max(1, Math.ceil((width + margin * 2) * pixelsPerCss))
  const mapHeight = Math.max(1, Math.ceil((height + margin * 2) * pixelsPerCss))
  const canvas = document.createElement('canvas')
  canvas.width = mapWidth
  canvas.height = mapHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  const image = context.createImageData(mapWidth, mapHeight)
  const profile = options.profile ?? 'squircle'
  const ior = options.ior ?? 1.5
  const sdf = (x: number, y: number): number => shapeDistance(x, y, shapes, blend)
  for (let py = 0; py < mapHeight; py++) {
    for (let px = 0; px < mapWidth; px++) {
      const x = (px + 0.5) / pixelsPerCss - margin
      const y = (py + 0.5) / pixelsPerCss - margin
      const distance = -sdf(x, y)
      let dx = 0
      let dy = 0
      if (distance > 0 && distance < bezel) {
        const t = distance / bezel
        const slope = (thickness * profileDerivative(profile, t)) / bezel
        const theta1 = Math.atan(slope)
        const theta2 = Math.asin(clamp(Math.sin(theta1) / Math.max(1, ior), -1, 1))
        const magnitude = clamp(thickness * profileHeight(profile, t) * Math.tan(theta1 - theta2), 0, maxD)
        const gx = (sdf(x + 0.5, y) - sdf(x - 0.5, y))
        const gy = (sdf(x, y + 0.5) - sdf(x, y - 0.5))
        const norm = Math.hypot(gx, gy) || 1
        dx = (-gx / norm) * magnitude
        dy = (-gy / norm) * magnitude
      }
      const index = (py * mapWidth + px) * 4
      image.data[index] = Math.round(clamp(0.5 + dx / (2 * maxD), 0, 1) * 255)
      image.data[index + 1] = Math.round(clamp(0.5 + dy / (2 * maxD), 0, 1) * 255)
      image.data[index + 2] = image.data[index + 1]
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return { url: canvas.toDataURL('image/png'), margin }
}

export function createGlassGroup(container: HTMLElement, initial: GlassGroupOptions = {}): GlassGroupController {
  let options: GlassGroupOptions = { blend: 18, ...initial }
  const items = new Set<HTMLElement>()
  const originalGroup = container.getAttribute('data-liquidglass-group')
  container.dataset.liquidglassGroup = ''
  const controller = createGlass(container, { ...options, shadow: false })
  let observer: ResizeObserver | null = null
  let mutation: MutationObserver | null = null
  let frame = 0
  let stableFrames = 0
  let lastSignature = ''
  let destroyed = false

  const render = (): void => {
    if (destroyed) return
    const rect = container.getBoundingClientRect()
    const shapes = readShapes(container, items)
    const signature = shapes.map((shape) => [shape.x, shape.y, shape.width, shape.height, shape.radius].join(',')).join(';')
    const moving = signature !== lastSignature
    if (moving) stableFrames = 0
    else stableFrames++
    lastSignature = signature
    const resolution = stableFrames < 8 ? 0.5 : 1
    const blend = options.blend ?? 18
    const usesDisplacementMap = controller.tier === 'refract' || controller.tier === 'element'
    const margin = usesDisplacementMap ? Math.ceil(Math.max(1, (options.thickness ?? 24) * 0.75)) + 2 : 0
    const backdrop = container.querySelector<HTMLElement>(':scope > [data-liquidglass-backdrop]')
    const backdropMask = maskFor(rect.width, rect.height, shapes, blend, resolution, margin)
    if (backdrop) {
      backdrop.style.maskImage = backdropMask
      ;(backdrop.style as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage = backdropMask
      backdrop.style.maskSize = '100% 100%'
      backdrop.style.maskRepeat = 'no-repeat'
    }
    if (controller.tier === 'material') {
      const bezel = options.bezel === 'auto' || options.bezel === undefined
        ? clamp(Math.min(rect.width, rect.height) * 0.3, 8, 48)
        : clamp(options.bezel, 1, Math.min(rect.width, rect.height) / 2)
      const edge = container.querySelector<HTMLElement>(':scope > [data-liquidglass-edge]')
      const edgeMask = maskFor(rect.width, rect.height, shapes, blend, resolution, 0, bezel)
      if (edge) {
        edge.style.maskImage = edgeMask
        ;(edge.style as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage = edgeMask
        edge.style.maskSize = '100% 100%'
        edge.style.maskRepeat = 'no-repeat'
      }
    }
    const tint = container.querySelector<HTMLElement>(':scope > [data-liquidglass-tint]')
    if (tint && (moving || stableFrames === 1)) tint.style.clipPath = clipPathFor(shapes)
    if (moving || stableFrames === 1 || stableFrames === 8) {
      const rim = container.querySelector<HTMLCanvasElement>(':scope > [data-liquidglass-rim]')
      if (rim) {
        const bezel = options.bezel === 'auto' || options.bezel === undefined
          ? clamp(Math.min(rect.width, rect.height) * 0.3, 8, 48)
          : clamp(options.bezel, 1, Math.min(rect.width, rect.height) / 2)
        drawSpecularRim(
          rim,
          rect.width,
          rect.height,
          (x, y) => shapeDistance(x, y, shapes, blend),
          bezel,
          options.specular ?? 0.7,
          options.lightAngle ?? -50,
        )
      }
    }
    if (usesDisplacementMap) {
      const map = unionDisplacementMap(rect.width, rect.height, shapes, blend, options, resolution)
      if (map) updateGlassDisplacementMap(container, map.url, rect.width, rect.height, map.margin)
    } else if (controller.tier === 'source') {
      updateGlassGroupSource(container, shapes, blend)
    }
    if (moving || stableFrames < 8) frame = requestAnimationFrame(render)
    else frame = 0
  }

  const invalidate = (): void => {
    if (!frame) frame = requestAnimationFrame(render)
  }
  const add = (item: HTMLElement): void => {
    if (items.has(item)) return
    items.add(item)
    item.dataset.liquidglassGroupItem = ''
    observer?.observe(item)
    invalidate()
  }
  const remove = (item: HTMLElement): void => {
    items.delete(item)
    delete item.dataset.liquidglassGroupItem
    observer?.unobserve(item)
    invalidate()
  }

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(invalidate)
    observer.observe(container)
  }
  if (typeof MutationObserver !== 'undefined') {
    mutation = new MutationObserver(invalidate)
    mutation.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
  }
  container.addEventListener('transitionrun', invalidate, true)
  container.addEventListener('animationstart', invalidate, true)
  container.addEventListener('pointermove', invalidate, { passive: true })
  invalidate()

  return {
    get tier() {
      return controller.tier
    },
    set(next: Partial<GlassGroupOptions>) {
      options = { ...options, ...next }
      controller.set({ ...next, shadow: false })
      invalidate()
    },
    refresh() {
      controller.refresh()
      invalidate()
    },
    add,
    remove,
    destroy() {
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      mutation?.disconnect()
      container.removeEventListener('transitionrun', invalidate, true)
      container.removeEventListener('animationstart', invalidate, true)
      container.removeEventListener('pointermove', invalidate)
      for (const item of items) delete item.dataset.liquidglassGroupItem
      items.clear()
      controller.destroy()
      if (originalGroup === null) delete container.dataset.liquidglassGroup
      else container.setAttribute('data-liquidglass-group', originalGroup)
    },
  }
}
