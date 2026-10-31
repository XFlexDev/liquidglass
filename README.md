# liquidglass

Cross-browser liquid-glass surfaces for vanilla JavaScript, custom elements, CSS, and React. The package has no runtime dependencies; React is an optional peer dependency.

## Install

```sh
npm install liquidglass
```

## Vanilla JavaScript

```ts
import { createGlass } from 'liquidglass'
import 'liquidglass/css'

const glass = createGlass(document.querySelector('.panel')!, {
  radius: 'auto',
  bezel: 'auto',
  thickness: 24,
  interactive: { press: true, stretch: true, light: true },
})

glass.set({ tint: 'rgba(255,255,255,.08)' })
glass.destroy()
```

`createGlass` returns a controller with a resolved `tier` (`refract`, `source`, `element`, or `material`), `set`, `refresh`, and `destroy`. The `auto` mode selects the strongest supported tier for each glass. `source` mode accepts an image, video, canvas, element with a CSS background image, or a selector.

## Custom elements

```html
<link rel="stylesheet" href="node_modules/liquidglass/dist/liquidglass.css" />
<liquid-glass radius="auto" bezel="auto" interactive="press,light">Open</liquid-glass>

<liquid-glass-group blend="18">
  <liquid-glass>First</liquid-glass>
  <liquid-glass>Second</liquid-glass>
</liquid-glass-group>
<script type="module">
  import 'liquidglass/element'
</script>
```

## React

```tsx
'use client'

import { Glass, GlassGroup } from 'liquidglass/react'
import 'liquidglass/css'

export function Controls() {
  return (
    <GlassGroup as="nav" blend={18}>
      <Glass as="button" interactive={{ press: true }}>Home</Glass>
      <Glass as="button">Library</Glass>
    </GlassGroup>
  )
}
```

`Glass` accepts an `as` element type and forwards ordinary DOM props and refs. `useGlass(ref, options)` is available for existing elements.

## Browser tiers

- **refract** — Blink's live backdrop filter with an analytical SVG displacement map.
- **source** — WebGL refraction of a supplied image, video, canvas, or CSS background image.
- **element** — Gecko's `-moz-element()` source layer for an arbitrary DOM source.
- **material** — backdrop blur, saturation, tint, and a masked edge lens; used as the server-rendered and no-JavaScript appearance.

Every controller restores the host's original inline style and removes its injected layers, observers, and filters on `destroy()`. Keep transforms on the host when using interaction; avoid animating host `opacity` or `filter`, since those properties create backdrop roots and can change what the glass samples.

Import `liquidglass/css` to style server-rendered and no-JavaScript markup before enhancement. The package also provides ESM, CommonJS, declarations, and `dist/liquidglass.global.js` (the `window.LiquidGlass` bundle).

## Development

```sh
npm install
npm test
npm run build
npx tsc --noEmit
npx playwright install chromium firefox webkit
node scripts/shots.mjs
```

## Credits

Ideas and implementation techniques were informed by [liquid-glass-react](https://github.com/rdev/liquid-glass-react), [liquid-glass-js / vitrio](https://github.com/eamonliu/vitrio), [liquidGL](https://github.com/cubiq/liquidGL), [liquid-glass](https://github.com/shuding/liquid-glass), and the [Liquid Glass in the Browser](https://kube.io/blog/liquid-glass-css/) article.

## License

MIT
