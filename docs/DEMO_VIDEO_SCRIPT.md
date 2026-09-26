# Demo Video — RackIQ

File: [`docs/media/rackiq_demo.mp4`](media/rackiq_demo.mp4) — 59 seconds, 1440×900, captioned, no audio.

A real, click-driven screen recording of the live hosted demo (https://rackiq-copilot.web.app):
Chrome is driven by [`scripts/record_demo_video.js`](../scripts/record_demo_video.js) (Puppeteer +
the DevTools screencast). Every scene is an actual hover, click, scroll or drag in the app; the script
injects a visible cursor, click ripples and caption bar because headless Chrome draws no pointer.

The story is the fastest path from a failure signal to a fix you can trust:

| Time | Action on screen | Caption |
|---|---|---|
| 0:00 | Command Center loads | 100 racks · 800 servers · 4,000 parts, scored for 72-hour failure risk |
| 0:03 | Hover rack C18, slot 1 → tooltip with per-part risk | Hover any slot for its live telemetry and risk |
| 0:06 | Click the rack → rack elevation opens | Click the rack → its 8 servers × 5 parts open on the right |
| 0:08 | Click the red DIMM cell → asset page | Click the failing DIMM → the fix, in two clicks from the floor |
| 0:11 | Risk gauge and SHAP drivers | C18-S1-DIMM · 100% risk within 72 h |
| 0:14 | Scroll to the safety step | Safety first: this rack is serving a DR failover |
| 0:17 | Scroll to the fix with part and stock | Proven fix: used 125×, held 98% of the time |
| 0:20 | Scroll to the flagged reseat | Reseating held only 34% → flagged "do not repeat" |
| 0:23 | Click a citation → source excerpt expands | Every step cites its source ticket or RCA |
| 0:26 | Click "inventory →", then the 64GB DIMM SKU | Stock vs reorder point vs predicted demand; at-risk servers needing it |
| 0:33 | Maintenance: hover a risk-matrix bubble | Work ranked by risk × criticality × spare parts |
| 0:36 | Click a copilot suggestion → ranked answers | Ask the copilot — answers ranked by the fixes that held |
| 0:42 | Operations: drag the failure-risk axis | Drag any axis to filter 800 servers |
| 0:48 | Command Center: click Thermal, hover a hot rack | A failing cooling unit over racks C/D 11–15 |
| 0:56 | Closing card | Live demo URL, repository, team |

To re-record (requires Node, Google Chrome and ffmpeg; `npm i puppeteer-core` in a scratch folder):

```bash
node scripts/record_demo_video.js        # writes rec/f*.jpg + rec/frames.txt (frame timings)
ffmpeg -f concat -safe 0 -i rec/frames.txt -vf "fps=30,format=yuv420p" -c:v libx264 -crf 21 demo.mp4
```
