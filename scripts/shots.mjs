import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { chromium, firefox, webkit } from 'playwright'

const root = resolve(new URL('..', import.meta.url).pathname)
const artifactDir = resolve(homedir(), 'lg-shots')
await mkdir(artifactDir, { recursive: true })
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
}
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = resolve(root, `.${pathname}`)
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path')
    const body = await readFile(file)
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const address = server.address()
const url = `http://127.0.0.1:${address.port}/test/visual.html`
const browsers = { chromium, firefox, webkit }
let failed = false

async function checkNeutralCenter(browser) {
  const page = await browser.newPage({ viewport: { width: 320, height: 160 }, deviceScaleFactor: 1 })
  try {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.setContent(`<!doctype html>
      <html><head><style>
        html, body { width: 320px; height: 160px; margin: 0; overflow: hidden; }
        body { background: #fff; }
        #grid { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, #000 0 1px, transparent 1px 20px), repeating-linear-gradient(90deg, #000 0 1px, transparent 1px 20px); }
        #pill { position: absolute; left: 10px; top: 20px; width: 300px; height: 120px; border-radius: 60px; }
      </style></head><body><div id="grid"></div><div id="pill"></div></body></html>`)
    const baseline = await page.screenshot()
    const tier = await page.evaluate(async () => {
      const { createGlass } = await import('/dist/index.js')
      const controller = createGlass(document.querySelector('#pill'), {
        frost: 0,
        saturation: 1,
        brightness: 1,
        tint: 'transparent',
        specular: 0,
        shadow: false,
      })
      return controller.tier
    })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const refracted = await page.screenshot()
    const comparison = await page.evaluate(async ({ before, after }) => {
      const decode = (data) => new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = `data:image/png;base64,${data}`
      })
      const [baselineImage, refractedImage] = await Promise.all([decode(before), decode(after)])
      const canvas = document.createElement('canvas')
      canvas.width = baselineImage.width
      canvas.height = baselineImage.height
      const context = canvas.getContext('2d')
      context.drawImage(baselineImage, 0, 0)
      const baselinePixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(refractedImage, 0, 0)
      const refractedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let changed = 0
      let maxDifference = 0
      let total = 0
      for (let y = 65; y < 95; y++) {
        for (let x = 60; x < 260; x++) {
          const index = (y * canvas.width + x) * 4
          const difference = Math.max(
            Math.abs(baselinePixels[index] - refractedPixels[index]),
            Math.abs(baselinePixels[index + 1] - refractedPixels[index + 1]),
            Math.abs(baselinePixels[index + 2] - refractedPixels[index + 2]),
          )
          if (difference > 2) changed++
          maxDifference = Math.max(maxDifference, difference)
          total++
        }
      }
      return { changed, total, maxDifference }
    }, {
      before: baseline.toString('base64'),
      after: refracted.toString('base64'),
    })
    const changedRatio = comparison.changed / comparison.total
    console.log(`[chromium] neutral center tier=${tier} pixels changed=${comparison.changed}/${comparison.total} maxDelta=${comparison.maxDifference}`)
    if (tier !== 'refract' || changedRatio > 0.01) throw new Error(`Center pixel alignment failed (${changedRatio})`)
  } finally {
    await page.close()
  }
}

for (const [name, engine] of Object.entries(browsers)) {
  let browser
  try {
    browser = await engine.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[${name}] browser: ${message.text()}`)
    })
    page.on('pageerror', (error) => console.error(`[${name}] page error: ${error.message}`))
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => typeof window.glassTiers === 'function')
    await page.waitForTimeout(700)
    if (name === 'firefox') {
      await page.screenshot({ path: resolve(artifactDir, 'firefox-moz-probe.png'), clip: { x: 0, y: 0, width: 40, height: 20 } })
      console.log(`[firefox] -moz-element CSS support: ${await page.evaluate(() => CSS.supports('background', '-moz-element(#moz-probe-source)'))}`)
    }
    await page.evaluate(() => document.querySelectorAll('#moz-probe-source, #moz-probe-target').forEach((element) => element.remove()))
    const tiers = await page.evaluate(() => window.glassTiers())
    const shot = resolve(artifactDir, `${name}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    console.log(`[${name}] tiers ${JSON.stringify(tiers)}`)
    console.log(`[${name}] screenshot ${shot}`)
    if (name === 'chromium') await checkNeutralCenter(browser)
    if (Object.values(tiers).some((tier) => !['refract', 'source', 'element', 'material'].includes(tier))) failed = true
    await browser.close()
  } catch (error) {
    failed = true
    console.error(`[${name}] failed: ${error instanceof Error ? error.stack : error}`)
    await browser?.close().catch(() => {})
  }
}
await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
if (failed) process.exitCode = 1
