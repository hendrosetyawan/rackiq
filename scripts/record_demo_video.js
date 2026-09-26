// Records a real, click-driven walkthrough of the live RackIQ site via the Chrome
// DevTools screencast. A fake cursor + click ripple + caption bar are injected
// into the page because headless Chrome draws no pointer.
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const BASE = 'https://rackiq-copilot.web.app'
const OUT = path.join(__dirname, 'rec')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms > 100 ? ms * 0.76 : ms))

const OVERLAY = `
(() => {
  const init = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = \`
      #__cur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:none}
      .__rip{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #22d3ee;z-index:2147483646;pointer-events:none;animation:__rip .55s ease-out forwards}
      @keyframes __rip{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}
      #__cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;background:rgba(6,10,22,.92);
        border:1px solid rgba(34,211,238,.45);border-left:4px solid #22d3ee;border-radius:10px;padding:11px 20px;max-width:1000px;
        font:600 19px Inter,Arial,sans-serif;color:#e2e8f0;box-shadow:0 10px 40px rgba(0,0,0,.55);opacity:0;transition:opacity .25s}
      #__cap small{display:block;font-weight:400;font-size:14px;color:#9fb0cc;margin-top:3px}
      #__step{position:fixed;right:22px;top:14px;z-index:2147483645;pointer-events:none;font:600 12px 'JetBrains Mono',monospace;color:#22d3ee;
        background:rgba(6,10,22,.85);border:1px solid rgba(34,211,238,.4);border-radius:999px;padding:4px 10px;opacity:0;transition:opacity .25s}\`;
    document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L9 21z" fill="#fff" stroke="#05080f" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
    const step = document.createElement('div'); step.id = '__step'; document.body.appendChild(step);
    window.addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    window.addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    window.__cap = (t, s) => { cap.innerHTML = t + (s ? '<small>' + s + '</small>' : ''); cap.style.opacity = t ? 1 : 0; };
    window.__step = (t) => { step.textContent = t; step.style.opacity = t ? 1 : 0; };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();`

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    args: ['--window-size=1440,900'],
  })
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(OVERLAY)
  let mx = 720, my = 450

  const cdp = await page.target().createCDPSession()
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    try { await cdp.send('Page.screencastFrameAck', { sessionId }) } catch (e) {}
  })

  const cap = (t, s) => page.evaluate((t, s) => window.__cap && window.__cap(t, s), t, s || '')
  const step = (t) => page.evaluate((t) => window.__step && window.__step(t), t)
  async function move(x, y, ms = 650) {
    const n = Math.max(8, Math.round((ms * 0.78) / 16))
    const x0 = mx, y0 = my
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
      await sleep(16)
    }
    mx = x; my = y
  }
  async function center(selector) {
    const el = await page.waitForSelector(selector, { visible: true, timeout: 20000 })
    const b = await el.boundingBox()
    return [b.x + b.width / 2, b.y + b.height / 2]
  }
  async function byText(tag, text) {
    const h = await page.waitForFunction((tag, text) => [...document.querySelectorAll(tag)].find((e) => e.textContent.includes(text) && e.offsetParent !== null), { timeout: 20000 }, tag, text)
    return h.asElement()
  }
  async function clickAt(x, y, ms) { await move(x, y, ms); await sleep(140); await page.mouse.down(); await sleep(70); await page.mouse.up() }
  async function clickSel(sel, ms) { const [x, y] = await center(sel); await clickAt(x, y, ms) }
  async function clickText(tag, text, ms) { const el = await byText(tag, text); const b = await el.boundingBox(); await clickAt(b.x + Math.min(b.width / 2, 120), b.y + b.height / 2, ms) }
  async function smoothScrollTo(el, block = 'center') {
    await page.evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), el, block)
    await sleep(900)
  }

  // ---------------------------------------------------------------- start
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-slot="C18-S1"]', { timeout: 30000 })
  await sleep(1200)
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 })
  const t0 = Date.now()
  await page.mouse.move(mx, my)

  // 1. Command Center
  await step('1 · Command Center')
  await cap('100 racks · 800 servers · 4,000 parts, scored for 72-hour failure risk', 'Red = predicted to fail · beacons = racks in migration / backup / DR failover')
  await sleep(1700)
  // 2. hover the failing slot on rack C18
  await cap('Hover any slot for its live telemetry and risk', 'Rack C18, slot 1 — database server on a DR-failover rack')
  const [sx, sy] = await center('[data-slot="C18-S1"]')
  await move(sx, sy, 900)
  await sleep(1800)
  // 3. click the rack
  await cap('Click the rack → its 8 servers × 5 parts open on the right')
  await clickAt(sx, sy, 200)
  await sleep(1300)
  // 4. click the failing DIMM cell
  const [dx, dy] = await center('[data-asset="C18-S1-DIMM"]')
  await move(dx, dy, 850)
  await cap('Click the failing DIMM → the fix, in two clicks from the floor')
  await sleep(1000)
  await clickAt(dx, dy, 150)

  // 5. asset page
  await step('2 · Cited action plan')
  await page.waitForFunction(() => document.body.textContent.includes('Action plan') && document.querySelectorAll('.step').length > 2, { timeout: 30000 })
  await sleep(600)
  await cap('C18-S1-DIMM · 100% risk within 72 h', 'SHAP shows why: correctable ECC errors climbing fast')
  const [shx, shy] = await center('.grid .panel svg')
  await move(1150, 180, 900)
  await sleep(1700)
  // safety step
  let el = await byText('.step', 'disaster-recovery')
  await smoothScrollTo(el)
  let b = await el.boundingBox()
  await move(b.x + 260, b.y + b.height / 2, 600)
  await cap('Safety first: this rack is serving a DR failover', 'The plan changes the sequence — coordinate the runbook before touching hardware')
  await sleep(2300)
  // proven fix + stock
  el = await byText('.step', 'Used 12')
  await smoothScrollTo(el)
  b = await el.boundingBox()
  await move(b.x + 300, b.y + b.height - 30, 600)
  await cap('Proven fix from our own history: used 125×, held 98% of the time', 'Spare part, bin and live stock shown right on the step')
  await sleep(2500)
  // do not repeat
  el = await byText('.step', 'DO NOT REPEAT')
  await smoothScrollTo(el)
  b = await el.boundingBox()
  await move(b.x + 320, b.y + b.height - 38, 600)
  await cap('Reseating held only 34% → flagged "do not repeat"', 'No wasted second visit')
  await sleep(2300)
  // evidence: expand a citation
  el = await byText('.step', 'email')
  await smoothScrollTo(el)
  b = await el.boundingBox()
  await cap('Every step cites its source — click to read the original ticket or RCA')
  await clickAt(b.x + 120, b.y + b.height / 2, 650)
  await sleep(2300)

  // 6. jump to the spare part
  el = await byText('a', 'inventory')
  await smoothScrollTo(el)
  b = await el.boundingBox()
  await cap('Jump to the part in the warehouse')
  await clickAt(b.x + b.width / 2, b.y + b.height / 2, 700)
  await step('3 · Spare part')
  await page.waitForSelector('[data-sku="MEM-DDR5-64G-4800"]', { visible: true, timeout: 30000 })
  await sleep(700)
  await clickSel('[data-sku="MEM-DDR5-64G-4800"]', 850)
  await cap('64GB DIMM: stock vs reorder point vs predicted demand', '12-month stock history and every at-risk server that needs this part')
  await sleep(1400)
  const [lx, ly] = await center('.tbl .click')
  await move(lx, ly, 800)
  await sleep(1600)

  // 7. maintenance + copilot
  await clickSel('a[href="/maintenance"]', 800)
  await step('4 · Maintenance & copilot')
  await page.waitForSelector('[data-asset]', { visible: true, timeout: 30000 })
  await sleep(500)
  await cap('Work ranked by risk × criticality × spare parts', 'Red ring = part short in the warehouse')
  const top = await page.evaluate(() => { const c = [...document.querySelectorAll('circle[data-asset]')].sort((a, b) => b.r.baseVal.value - a.r.baseVal.value)[0]; const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
  await move(top[0], top[1], 800)
  await sleep(1500)
  await cap('Ask the copilot — answers ranked by the fixes that actually held')
  await clickText('button', 'reseat enough', 900)
  await sleep(700)
  el = await byText('.step', 'durable')
  b = await el.boundingBox()
  await move(b.x + 220, b.y + 20, 700)
  await sleep(2400)

  // 8. operations brush
  await clickSel('a[href="/operations"]', 800)
  await step('5 · Operations')
  await page.waitForSelector('[data-dim="max_risk"]', { visible: true, timeout: 30000 })
  await sleep(600)
  const ax = await page.evaluate(() => { const r = document.querySelector('[data-dim="max_risk"]').getBoundingClientRect(); return [r.x + r.width - 4, r.y, r.height] })
  await cap('Drag any axis to filter 800 servers', 'Here: only servers with high failure risk')
  await move(ax[0], ax[1] + 34, 800)
  await page.mouse.down()
  await move(ax[0], ax[1] + ax[2] * 0.42, 700)
  await page.mouse.up()
  await sleep(2300)

  // 9. thermal view
  await clickSel('a[href="/"]', 800)
  await step('6 · Thermal view')
  await page.waitForSelector('[data-slot="C18-S1"]', { visible: true, timeout: 30000 })
  await sleep(400)
  await clickText('button', 'Thermal', 800)
  await cap('Same floor, thermal lens: a failing cooling unit over racks C/D 11–15')
  await sleep(1000)
  const [hx, hy] = await center('[data-slot="C13-S5"]')
  await move(hx, hy, 900)
  await sleep(2200)
  await cap('')
  await step('')
  await sleep(300)

  await cdp.send('Page.stopScreencast')
  const dur = (Date.now() - t0) / 1000
  frames.forEach((f, i) => fs.writeFileSync(path.join(OUT, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')))
  const tEnd = frames.length ? frames[frames.length - 1].t + 0.3 : 0
  const lines = frames.map((f, i) => `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? tEnd) - f.t)).toFixed(4)}`)
  lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`)
  fs.writeFileSync(path.join(OUT, 'frames.txt'), lines.join('\n'))
  console.log(`frames=${frames.length} wall=${dur.toFixed(1)}s span=${(tEnd - frames[0].t).toFixed(1)}s`)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
