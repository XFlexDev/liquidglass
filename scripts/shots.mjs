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
