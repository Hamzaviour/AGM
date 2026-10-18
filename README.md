# Smart Food Delivery Agent

Agent Based Modeling, Assignment 1 (group). University of Central Punjab.

| Member | Registration No. |
|---|---|
| Ch Hamza Younas | L1F23BSAI0089 |
| Rida | L1F23BSAI0091 |
| Muhammad Abdullah | L1F23BSAI0063 |

A foodpanda-style rider picks up an order at **Cheezious, Johar Town** and must hand it over at the **University of Central Punjab (UCP)** main gate within 20 minutes (15 minutes for an urgent order). Seven single-agent architectures solve the same delivery problem: Simple Reflex, Model-Based Reflex, Goal-Based, Utility-Based, Learning, Hierarchical and Contextual.

The three destinations (routes) from Cheezious to UCP:

| Route | Road | Distance | Free-flow time | Risk |
|---|---|---|---|---|
| A | Khayaban-e-Jinnah Road | 3.00 km | 10.0 min | Jams at the Jinnah signal chowk in rush hour |
| B | Canal Bank Road (underpass) | 3.25 km | 10.4 min | The underpass floods after 30 min of rain (not shown on the rider app) |
| C | Johar Town inner streets | 4.20 km | 14.4 min | Longest, rarely blocked |

## What is where

| Folder | Contents |
|---|---|
| `report/` | The report as Word (`.docx`) and PDF, with the cover page and UCP logo in `report/assets/` |
| `code/` | Python code: `environment.py`, `agents.py` (all seven agents), `main.py` |
| `results/` | Program output for the three test cases (`.txt` and `.json`) |
| `diagrams/` | Architecture diagram and reasoning trace for each agent, result charts, the route map, and simulation screenshots (PNG) |
| `simulation/` | Interactive 3D simulation; open `index.html` |
| `tools/` | Scripts that rebuild the diagrams and report, and check that the simulation matches the Python code |

## Run the code

Python 3.8 or newer, no extra packages.

```
cd code
python main.py            # result tables
python main.py --details  # tables + every agent's reasoning
```

## Open the simulation

Double-click `simulation/index.html` (Chrome, Edge or Firefox). It works offline because Three.js is included in `simulation/vendor/`. Choose a situation and an agent, then press **Run delivery**.

- **Test 1 to 3** match the report. **Custom situation** lets you set the time, rain, jams, closures and flooding yourself.
- **All agents (race)** sends all seven riders out at once, with a live leaderboard.
- Cameras: Chase, Map (top view) and Orbit (drag to rotate, scroll or pinch to zoom). Speeds: 1x, 2x, 4x and 8x. One simulated minute takes 2 seconds at 1x.
- Keyboard: Space = run, 1/2/3 = test, C = switch camera.
- Link options: `?test=3&agent=race&cam=top&speed=4&autorun=1` (agent is `0` to `6` or `race`).

The map is schematic, not to scale. Traffic keeps left, as in Pakistan.

## Deploy on Vercel

The repository deploys as a static site. Nothing needs to be built. `vercel.json` redirects `/` to `/simulation/`.

**Dashboard:** on vercel.com choose *Add New → Project*, import this GitHub repository and set *Framework Preset* to **Other**. Leave the build and output settings empty, then press **Deploy**.

**CLI:**

```
npm i -g vercel
vercel          # first time: log in and link the project
vercel --prod
```

## Results at a glance

| Agent | Test 1 | Test 2 | Test 3 | On time |
|---|---|---|---|---|
| Simple Reflex | A 10.0 | B 10.4 | B 24.5 (late) | 2/3 |
| Model-Based Reflex | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Goal-Based | A 10.0 | A 19.2 | A 19.2 (late) | 2/3 |
| Utility-Based | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Learning | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Hierarchical | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Contextual | A 10.0 | B 10.4 | C 14.4 | 3/3 |

The three test situations from the brief:

1. **Normal traffic and good weather** (deadline 20 min).
2. **Heavy traffic with multiple available routes**: A jammed, C heavy, B clear; all routes open (deadline 20 min).
3. **Heavy traffic, rain and an urgent delivery**: rain for 45 min, A jammed, the B underpass flooded (not visible to the rider), urgent deadline of 15 min.

Most suitable: the **Utility-Based Agent** (see Section 7 of the report).

## Rebuild (optional)

```
python code/main.py
node tools/check_parity.js
python tools/export_diagrams.py   # needs matplotlib
python tools/export_charts.py     # result charts + reasoning traces, needs matplotlib
python tools/build_report.py      # needs python-docx, Pillow; PDF via LibreOffice or Microsoft Word
```

Section (AG2), instructor and date are set in `TITLE_INFO` at the top of `tools/build_report.py`. The cover image is `report/assets/cover.png`.
