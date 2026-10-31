'use client'

import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type PropsWithChildren,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import type * as React from 'react'
import {
  createGlass,
  createGlassGroup,
  type GlassController,
  type GlassGroupController,
  type GlassGroupOptions,
  type GlassOptions,
} from './index'

interface GroupContextValue {
  inGroup: boolean
  controller: GlassGroupController | null
}

const GroupContext = createContext<GroupContextValue>({ inGroup: false, controller: null })
const glassOptionNames = new Set([
  'radius', 'bezel', 'thickness', 'ior', 'profile', 'dispersion', 'frost', 'saturation', 'brightness',
  'tint', 'specular', 'lightAngle', 'shadow', 'interactive', 'source', 'mode',
])

function optionChanged(first: unknown, second: unknown, key: string): boolean {
  if (key === 'source') return first !== second
  if (key === 'interactive' && first && second && typeof first === 'object' && typeof second === 'object') {
    const left = first as Record<string, unknown>
    const right = second as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    return [...keys].some((name) => !Object.is(left[name], right[name]))
  }
  return !Object.is(first, second)
}

function changedOptions(first: GlassOptions, second: GlassOptions): Partial<GlassOptions> {
  const changed: Record<string, unknown> = {}
  for (const key of glassOptionNames) {
    if (optionChanged(first[key as keyof GlassOptions], second[key as keyof GlassOptions], key)) {
      changed[key] = second[key as keyof GlassOptions]
    }
  }
  return changed as Partial<GlassOptions>
}

function optionsEqual(first: GlassOptions, second: GlassOptions): boolean {
  return Object.keys(changedOptions(first, second)).length === 0
}

function changedGroupOptions(first: GlassGroupOptions, second: GlassGroupOptions): Partial<GlassGroupOptions> {
  return {
    ...changedOptions(first, second),
    ...(first.blend === second.blend ? {} : { blend: second.blend }),
  }
}

function groupOptionsEqual(first: GlassGroupOptions, second: GlassGroupOptions): boolean {
  return optionsEqual(first, second) && first.blend === second.blend
}

export type GlassProps = GlassOptions & {
  as?: ElementType
  className?: string
  style?: React.CSSProperties
  children?: ReactNode
  [key: string]: unknown
}

export interface GlassGroupProps extends GlassOptions, PropsWithChildren {
  as?: ElementType
  className?: string
  style?: React.CSSProperties
  blend?: number
  [key: string]: unknown
}

export function useGlass<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options: GlassOptions = {},
): RefObject<GlassController | null> {
  const controller = useRef<GlassController | null>(null)
  const previousOptions = useRef(options)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    controller.current = createGlass(element, options)
    previousOptions.current = options
    return () => {
      controller.current?.destroy()
      controller.current = null
    }
  }, [ref])
  useEffect(() => {
    if (!optionsEqual(previousOptions.current, options)) {
      controller.current?.set(changedOptions(previousOptions.current, options))
      previousOptions.current = options
    }
  }, [options])
  return controller
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as { current: T | null }).current = value
}

const GlassImpl = forwardRef<HTMLElement, GlassProps>(function Glass(
  { as = 'div', children, className, style, ...options },
  forwardedRef,
) {
  const host = useRef<HTMLElement | null>(null)
  const groupContext = useContext(GroupContext)
  const group = groupContext.controller
  const controller = useRef<GlassController | null>(null)
  const elementOptions = options as GlassOptions
  const previousOptions = useRef(elementOptions)
  const domProps = Object.fromEntries(Object.entries(options).filter(([key]) => !glassOptionNames.has(key)))
  useEffect(() => {
    const element = host.current
    if (!element) return
    if (groupContext.inGroup) {
      if (!group) return
      const originalTier = element.getAttribute('data-lg-tier')
      group.add(element)
      element.dataset.lgTier = group.tier
      return () => {
        group.remove(element)
        if (originalTier === null) delete element.dataset.lgTier
        else element.setAttribute('data-lg-tier', originalTier)
      }
    }
    const originalTier = element.getAttribute('data-lg-tier')
    controller.current = createGlass(element, elementOptions)
    previousOptions.current = elementOptions
    element.dataset.lgTier = controller.current.tier
    return () => {
      controller.current?.destroy()
      controller.current = null
      if (originalTier === null) delete element.dataset.lgTier
      else element.setAttribute('data-lg-tier', originalTier)
    }
  }, [groupContext.inGroup, group])
  useEffect(() => {
    if (!optionsEqual(previousOptions.current, elementOptions)) {
      controller.current?.set(changedOptions(previousOptions.current, elementOptions))
      previousOptions.current = elementOptions
      if (host.current) host.current.dataset.lgTier = group?.tier ?? controller.current?.tier ?? 'material'
    }
  }, [elementOptions])
  useEffect(() => {
    if (groupContext.inGroup && group && host.current) host.current.dataset.lgTier = group.tier
  }, [group, groupContext.inGroup])
  const hostStyle: React.CSSProperties = {
    ...(typeof elementOptions.radius === 'number' ? { borderRadius: elementOptions.radius } : {}),
    ...(style as React.CSSProperties | undefined),
  }
  return createElement(as as ElementType, {
    ...domProps,
    ref: (element: HTMLElement | null) => {
      host.current = element
      assignRef(forwardedRef, element)
    },
    className: ['liquid-glass', className].filter(Boolean).join(' '),
    style: hostStyle,
    children,
  })
})

export const Glass = GlassImpl as <T extends ElementType = 'div'>(
  props: GlassProps & { as?: T; ref?: Ref<HTMLElement> },
) => ReactNode

const GlassGroupImpl = forwardRef<HTMLElement, GlassGroupProps>(function GlassGroup(
  { as = 'div', children, className, style, blend = 18, ...options },
  forwardedRef,
) {
  const host = useRef<HTMLElement | null>(null)
  const [controller, setController] = useState<GlassGroupController | null>(null)
  const groupOptions = { ...Object.fromEntries(Object.entries(options).filter(([key]) => glassOptionNames.has(key))), blend } as GlassOptions & { blend: number }
  const domProps = Object.fromEntries(Object.entries(options).filter(([key]) => !glassOptionNames.has(key)))
  const previousOptions = useRef(groupOptions as GlassGroupOptions)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const nextController = createGlassGroup(element, groupOptions)
    setController(nextController)
    previousOptions.current = groupOptions
    const originalTier = element.getAttribute('data-lg-tier')
    element.dataset.lgTier = nextController.tier
    return () => {
      nextController.destroy()
      setController(null)
      if (originalTier === null) delete element.dataset.lgTier
      else element.setAttribute('data-lg-tier', originalTier)
    }
  }, [])
  useEffect(() => {
    if (controller && !groupOptionsEqual(previousOptions.current, groupOptions)) {
      controller.set(changedGroupOptions(previousOptions.current, groupOptions))
      previousOptions.current = groupOptions as GlassGroupOptions
      if (host.current) host.current.dataset.lgTier = controller.tier
    }
  }, [controller, groupOptions])
  return createElement(
    as as ElementType,
    {
      ...domProps,
      ref: (element: HTMLElement | null) => {
        host.current = element
        assignRef(forwardedRef, element)
      },
      className: ['liquid-glass-group', className].filter(Boolean).join(' '),
      style: style as React.CSSProperties | undefined,
    },
    createElement(GroupContext.Provider, { value: { inGroup: true, controller } }, children as ReactNode),
  )
})

export const GlassGroup = GlassGroupImpl as <T extends ElementType = 'div'>(
  props: GlassGroupProps & { as?: T; ref?: Ref<HTMLElement> },
) => ReactNode
