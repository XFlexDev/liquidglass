import { createGlass, createGlassGroup, parseGlassOptions, type GlassController, type GlassGroupController } from './index'

const HTMLElementBase = typeof HTMLElement === 'undefined' ? class {} as typeof HTMLElement : HTMLElement
const optionAttributes = [
  'radius', 'bezel', 'thickness', 'ior', 'profile', 'dispersion', 'frost', 'saturation', 'brightness',
  'tint', 'specular', 'light-angle', 'shadow', 'interactive', 'source', 'mode',
]

function optionsFromAttributes(element: Element): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const name of optionAttributes) {
    if (!element.hasAttribute(name)) continue
    const raw = element.getAttribute(name) ?? ''
    const key = name === 'light-angle' ? 'lightAngle' : name
    if (['radius', 'bezel', 'thickness', 'ior', 'dispersion', 'frost', 'saturation', 'brightness', 'specular', 'light-angle'].includes(name)) {
      input[key] = raw === 'auto' ? raw : Number(raw)
    } else if (name === 'shadow') {
      input.shadow = raw === '' || raw === 'true' ? true : raw === 'false' ? false : raw
    } else if (name === 'interactive') {
      input.interactive = raw === '' || raw === 'true'
        ? true
        : raw === 'false'
          ? false
          : Object.fromEntries(raw.split(',').map((keyPart) => [keyPart.trim(), true]))
    } else {
      input[key] = raw
    }
  }
  return parseGlassOptions(input)
}

export class LiquidGlassElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return optionAttributes
  }

  private controller: GlassController | null = null
  private group: LiquidGlassGroupElement | null = null

  connectedCallback(): void {
    if (this.controller || this.group) return
    this.classList.add('liquid-glass')
    const groupParent = this.parentElement?.closest('liquid-glass-group')
    if (groupParent instanceof LiquidGlassGroupElement) {
      this.group = groupParent
      groupParent.addGlassItem(this)
      return
    }
    this.controller = createGlass(this, optionsFromAttributes(this))
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected) return
    if (this.group) return
    this.controller?.set(optionsFromAttributes(this))
    if (name === 'source') this.controller?.refresh()
  }

  disconnectedCallback(): void {
    this.group?.removeGlassItem(this)
    this.group = null
    this.controller?.destroy()
    this.controller = null
  }
}

export class LiquidGlassGroupElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['blend', ...optionAttributes]
  }

  private controller: GlassGroupController | null = null

  connectedCallback(): void {
    if (this.controller) return
    this.classList.add('liquid-glass-group')
    this.controller = createGlassGroup(this, {
      ...optionsFromAttributes(this),
      blend: Number(this.getAttribute('blend') ?? 18),
    })
    for (const item of this.querySelectorAll<LiquidGlassElement>('liquid-glass')) this.addGlassItem(item)
  }

  attributeChangedCallback(): void {
    if (!this.isConnected) return
    this.controller?.set({
      ...optionsFromAttributes(this),
      blend: Number(this.getAttribute('blend') ?? 18),
    })
  }

  addGlassItem(item: HTMLElement): void {
    this.controller?.add(item)
  }

  removeGlassItem(item: HTMLElement): void {
    this.controller?.remove(item)
  }

  disconnectedCallback(): void {
    this.controller?.destroy()
    this.controller = null
  }
}

export function defineGlassElements(registry?: CustomElementRegistry): void {
  const target = registry ?? (typeof customElements === 'undefined' ? undefined : customElements)
  if (!target) return
  if (!target.get('liquid-glass-group')) target.define('liquid-glass-group', LiquidGlassGroupElement)
  if (!target.get('liquid-glass')) target.define('liquid-glass', LiquidGlassElement)
}

if (typeof customElements !== 'undefined') defineGlassElements()
