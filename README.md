# Smart Food Delivery Agent

Agent Based Modeling, Assignment 1 (group). University of Central Punjab.

| Member | Registration No. |
|---|---|
| Ch Hamza Younas | L1F23BSAI0089 |
| Rida | L1F23BSAI0091 |
| Muhammad Abdullah | L1F23BSAI0063 |

Seven single-agent architectures solve the same delivery problem: Simple Reflex, Model-Based Reflex, Goal-Based, Utility-Based, Learning, Hierarchical and Contextual.

## What is where

| Folder | Contents |
|---|---|
| `report/` | The report as Word (`.docx`) and PDF |
| `code/` | Python code: `environment.py`, `agents.py`, `main.py` |
| `results/` | Program output for the three test cases (`.txt` and `.json`) |
| `diagrams/` | Architecture diagram for each agent (PNG) |
| `simulation/` | Interactive simulation; open `index.html` |
| `tools/` | Scripts that rebuild the diagrams and report, and check that the simulation matches the Python code |

## Run the code

Python 3.8 or newer, no extra packages.

```
cd code
python main.py            # result tables
python main.py --details  # tables + every agent's reasoning
```

## Open the simulation

Double-click `simulation/index.html` (Chrome or Edge). It works offline. Choose a situation and an agent, then press **Run delivery**.

## Results at a glance

| Agent | Test 1 | Test 2 | Test 3 | On time |
|---|---|---|---|---|
| Simple Reflex | A 10.0 | B 10.4 | B 24.5 (late) | 2/3 |
| Model-Based Reflex | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Goal-Based | A 10.0 | A 19.2 | B 24.5 (late) | 2/3 |
| Utility-Based | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Learning | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Hierarchical | A 10.0 | B 10.4 | C 14.4 | 3/3 |
| Contextual | A 10.0 | B 10.4 | C 14.4 | 3/3 |

Most suitable: the **Utility-Based Agent** (see Section 7 of the report).

## Rebuild (optional)

```
python code/main.py
node tools/check_parity.js
python tools/export_diagrams.py
python tools/build_report.py      # needs python-docx, Pillow, Microsoft Word for the PDF
```

To fill in the section and instructor name on the title page, edit `TITLE_INFO` at the top of `tools/build_report.py` and run it again, or edit the Word file directly.
