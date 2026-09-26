# Demo Video — RackIQ (v2)

File: [`docs/media/rackiq_demo.mp4`](media/rackiq_demo.mp4) — 56 seconds, 1280×800, captioned, no audio.
Built from screenshots of the live hosted demo (https://rackiq-copilot.web.app) with ffmpeg
(slow zoom / pan per scene, caption bar per scene).

| Time | Scene | Caption |
|---|---|---|
| 0:00–0:03 | Title card | RackIQ — 100 racks · 800 servers · 4,000 components · 12 months of incidents |
| 0:03–0:10 | Command Center, health mode | 3D data hall · every slot coloured by predicted health · context beacons |
| 0:10–0:16 | Command Center, thermal mode (zoom on rows C–D) | A failing CRAC unit — racks C/D 11–15 running hot |
| 0:16–0:23 | Operations | Rack radar, 800-server parallel coordinates, PUE, model drift & latency |
| 0:23–0:30 | Maintenance (copilot answering "is a reseat enough?") | Risk × criticality × spare parts; fixes ranked by how often they held |
| 0:30–0:39 | Asset C18-S1-DIMM, panning down the action plan | DR-failover safety step · fix with live stock · "do not repeat" the reseat |
| 0:39–0:45 | Event Log | 12-month radial incident clock + 7-day MELT event stream |
| 0:45–0:52 | Inventory | Which spares run out before the predicted failures arrive |
| 0:52–0:56 | Closing card | Live demo URL, repository, team |

## Optional voiceover (≈130 words, fits 56 s)

> Data-center hardware fails at the worst time — mid-migration, mid-backup, mid-failover. RackIQ
> watches 4,000 components across a 100-rack hall and predicts which will fail in the next 72 hours.
> Switch the same floor to thermal and a failing cooling unit jumps out. Operations shows power,
> thermal, network and the health of our own models. Maintenance ranks work by risk, criticality and
> whether the spare part is on the shelf, and the copilot answers from twelve months of incidents,
> ranking fixes by how often they actually held. Open a component: safety step first because this rack
> is in DR failover, then the proven fix with live stock, and a warning not to repeat the reseat that
> failed 66% of the time. Every step is cited.

To regenerate: capture pages with a headless browser at 1440×900, then assemble segments with ffmpeg
(`zoompan` for stills, time-based `crop` for the pan, `overlay` for captions, `concat` to join).
