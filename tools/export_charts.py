"""
Draw the result charts and the reasoning-trace visuals used in the report,
as PNG files in ../diagrams/.   Needs matplotlib:  pip install matplotlib

    python code/main.py              # writes results/results.json first
    python tools/export_charts.py
"""

import json
import os
import sys
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "diagrams")
sys.path.insert(0, os.path.join(ROOT, "code"))
from agents import LearningAgent, UtilityBasedAgent  # noqa: E402
from environment import (DEADLINE_MIN, ROUTE_IDS, SCENARIOS, make_percept,  # noqa: E402
                         rain_minutes)

# Route colours (colourblind-checked: blue, aqua, orange) and status colours.
ROUTE = {"A": "#2a78d6", "B": "#1baf7a", "C": "#eb6834"}
GOOD, CRITICAL = "#0ca30c", "#d03b3b"
INK, MUTED, GRID, SURFACE = "#1f1f1e", "#6b6a64", "#e4e3de", "#fcfcfb"
PINK = "#e21b70"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10, "text.color": INK,
    "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.spines.top": False, "axes.spines.right": False, "figure.facecolor": "white",
})


def load():
    with open(os.path.join(ROOT, "results", "results.json"), encoding="utf-8") as f:
        return json.load(f)


def save(fig, name):
    os.makedirs(OUT, exist_ok=True)
    fig.savefig(os.path.join(OUT, name), bbox_inches="tight", facecolor="white", dpi=160)
    plt.close(fig)
    print("wrote diagrams/" + name)


def route_legend(ax, loc="lower right"):
    from matplotlib.patches import Patch
    names = {"A": "A  Khayaban-e-Jinnah", "B": "B  Canal Bank Rd", "C": "C  Inner streets"}
    ax.legend(handles=[Patch(color=ROUTE[r], label=names[r]) for r in ROUTE_IDS],
              loc=loc, frameon=False, fontsize=8.5, title="Route chosen", title_fontsize=8.5)


# --------------------------------------------------------------- comparison
def chart_times(res):
    """Small multiples: one panel per test, bar = delivery minutes, colour = route."""
    agents = [a["agent"] for a in res["agents"]]
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.6), sharey=True)
    for k, ax in enumerate(axes):
        sc = res["scenarios"][k]
        ys = list(range(len(agents)))[::-1]
        for y, a in zip(ys, res["agents"]):
            t = a["tests"][k]
            ax.barh(y, t["minutes"], height=0.62, color=ROUTE[t["route"]], edgecolor="white", linewidth=2)
            label = "%s  %.1f" % (t["route"], t["minutes"]) + ("" if t["on_time"] else "  LATE")
            ax.text(t["minutes"] + 0.4, y, label, va="center", fontsize=8.5,
                    color=CRITICAL if not t["on_time"] else INK, weight="bold" if not t["on_time"] else "normal")
        ax.axvline(DEADLINE_MIN, color=INK, lw=1.2, ls=(0, (4, 3)))
        ax.set_ylim(-1.1, len(agents) - 0.4)
        ax.text(DEADLINE_MIN + 0.4, -0.85, "deadline 20 min", fontsize=8, color=MUTED, ha="left")
        ax.set_xlim(0, 31)
        ax.set_title("Test %d: %s" % (sc["id"], sc["title"]), fontsize=11, loc="left", color=INK)
        ax.set_xlabel("delivery time (min)")
        ax.grid(axis="x", color=GRID, lw=0.8); ax.set_axisbelow(True)
        ax.tick_params(left=False)
    axes[0].set_yticks(list(range(len(agents)))[::-1]); axes[0].set_yticklabels(agents)
    fig.suptitle("Delivery time of every agent in every situation", x=0.01, ha="left", fontsize=13, color=PINK, weight="bold")
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    from matplotlib.patches import Patch
    names = {"A": "Route A  Khayaban-e-Jinnah", "B": "Route B  Canal Bank Rd", "C": "Route C  Inner streets"}
    fig.legend(handles=[Patch(color=ROUTE[r], label=names[r]) for r in ROUTE_IDS], loc="lower center",
               ncol=3, frameon=False, fontsize=9)
    save(fig, "cmp_times.png")


def chart_matrix(res):
    """Agents x tests grid: cell colour = route chosen, text = minutes and on-time mark."""
    agents = res["agents"]
    fig, ax = plt.subplots(figsize=(9.5, 4.8))
    ax.set_xlim(0, 3); ax.set_ylim(0, len(agents)); ax.invert_yaxis(); ax.axis("off")
    for i, a in enumerate(agents):
        ax.text(-0.05, i + 0.5, a["agent"], ha="right", va="center", fontsize=10)
        for k, t in enumerate(a["tests"]):
            ax.add_patch(FancyBboxPatch((k + 0.04, i + 0.07), 0.92, 0.86, boxstyle="round,pad=0,rounding_size=0.06",
                                        fc=ROUTE[t["route"]], ec="white", lw=2))
            mark = "on time" if t["on_time"] else "LATE"
            ax.text(k + 0.5, i + 0.42, "Route %s   %.1f min" % (t["route"], t["minutes"]), ha="center", va="center",
                    color="white", fontsize=10, weight="bold")
            ax.text(k + 0.5, i + 0.72, mark, ha="center", va="center", fontsize=8.5,
                    color="white", weight="bold",
                    bbox=dict(boxstyle="round,pad=0.2", fc=GOOD if t["on_time"] else CRITICAL, ec="none"))
    for k, sc in enumerate(res["scenarios"]):
        ax.text(k + 0.5, -0.2, "Test %d\n%s" % (sc["id"], sc["title"]), ha="center", va="bottom", fontsize=10, weight="bold")
    ax.text(3.0, len(agents) + 0.35, "Best possible: A 10.0 | B 10.4 | C 14.4", ha="right", fontsize=8.5, color=MUTED)
    fig.suptitle("Which route each agent chose", x=0.01, ha="left", fontsize=13, color=PINK, weight="bold", y=1.04)
    save(fig, "cmp_matrix.png")


def chart_summary(res):
    """Two panels with their own axes: on-time deliveries and total minutes."""
    agents = [a["agent"] for a in res["agents"]][::-1]
    on_time = [a["on_time"] for a in res["agents"]][::-1]
    total = [a["total_minutes"] for a in res["agents"]][::-1]
    best = [a == "Utility-Based" for a in agents]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 3.9), sharey=True)
    for ax, vals, fmt, title, xmax in ((ax1, on_time, "%d / 3", "Orders delivered on time", 3.6),
                                       (ax2, total, "%.1f min", "Total delivery time, all 3 tests (lower is better)", 62)):
        ax.barh(range(len(agents)), vals, height=0.6, color=[PINK if b else "#2a78d6" for b in best],
                edgecolor="white", linewidth=2)
        for y, v in enumerate(vals):
            ax.text(v + xmax * 0.012, y, fmt % v, va="center", fontsize=9)
        ax.set_xlim(0, xmax); ax.set_title(title, loc="left", fontsize=11)
        ax.grid(axis="x", color=GRID, lw=0.8); ax.set_axisbelow(True); ax.tick_params(left=False)
    ax1.set_yticks(range(len(agents))); ax1.set_yticklabels(agents)
    ax1.set_xticks([0, 1, 2, 3])
    ax2.axvline(34.8, color=MUTED, lw=1, ls=(0, (4, 3)))
    ax2.text(34.8, len(agents) - 0.45, "best possible 34.8", fontsize=8, color=MUTED, ha="center")
    fig.text(0.01, -0.03, "Pink = Utility-Based, the agent chosen as most suitable.", fontsize=8.5, color=MUTED)
    fig.tight_layout()
    save(fig, "cmp_summary.png")


def chart_utility():
    """Utility of every route in every test, as computed by the Utility-Based agent."""
    agent = UtilityBasedAgent()
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6), sharey=True)
    for ax, sc in zip(axes, SCENARIOS):
        p = make_percept(sc)
        for x, r in enumerate(ROUTE_IDS):
            if p["closed"][r]:
                ax.text(x, 4, "closed", ha="center", fontsize=9, color=MUTED)
                continue
            u, e, pot = agent.utility(r, p)
            ax.bar(x, u, width=0.6, color=ROUTE[r], edgecolor="white", linewidth=2)
            ax.text(x, u + (3 if u >= 0 else -9), "%.1f" % u, ha="center", fontsize=9)
        ax.axhline(0, color=MUTED, lw=0.8)
        ax.set_xlim(-0.5, 2.5)
        ax.set_xticks(range(3)); ax.set_xticklabels(["Route " + r for r in ROUTE_IDS])
        ax.set_title("Test %d: %s" % (sc["id"], sc["title"]), loc="left", fontsize=10.5)
        ax.grid(axis="y", color=GRID, lw=0.8); ax.set_axisbelow(True); ax.tick_params(bottom=False)
    axes[0].set_ylabel("utility U")
    axes[0].set_ylim(-55, 95)
    fig.suptitle("Utility-Based agent: U = 100 P(on time) - 2 E[min] - 15 P(flood); tallest bar wins",
                 x=0.01, ha="left", fontsize=11.5, color=PINK, weight="bold")
    fig.tight_layout()
    save(fig, "chart_utility.png")


def chart_learning():
    """Learned average minutes per context and route (Q = -minutes)."""
    agent = LearningAgent(); agent.train()
    contexts = ["normal", "rush", "rain"]
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6), sharey=True)
    for ax, ctx in zip(axes, contexts):
        for x, r in enumerate(ROUTE_IDS):
            q = agent.q.get((ctx, r))
            ax.bar(x, -q, width=0.6, color=ROUTE[r], edgecolor="white", linewidth=2)
            ax.text(x, -q - 0.6, "%.1f" % -q, ha="center", va="top", fontsize=9, color="white", weight="bold")
        ax.axhline(DEADLINE_MIN, color=INK, lw=1, ls=(0, (4, 3)))
        ax.text(2.45, DEADLINE_MIN + 0.4, "deadline", ha="right", fontsize=8, color=MUTED)
        ax.set_xticks(range(3)); ax.set_xticklabels(["Route " + r for r in ROUTE_IDS])
        ax.set_title("Context: %s" % ctx, loc="left", fontsize=10.5)
        ax.grid(axis="y", color=GRID, lw=0.8); ax.set_axisbelow(True); ax.tick_params(bottom=False)
    axes[0].set_ylabel("learned minutes (-Q)")
    axes[0].set_ylim(0, 28)
    fig.suptitle("Learning agent: average minutes learned from 54 training trips; shortest open bar wins",
                 x=0.01, ha="left", fontsize=11.5, color=PINK, weight="bold")
    fig.tight_layout()
    save(fig, "chart_learning.png")


# ------------------------------------------------------------ reasoning traces
def percept_summary(sc):
    p = make_percept(sc)
    rain = rain_minutes(p)
    weather = "rain for %d min" % rain if p["weather"] == "rain" else "clear"
    traffic = " ".join("%s:%s" % (r, p["traffic"][r]) for r in ROUTE_IDS)
    closed = ", ".join(r for r in ROUTE_IDS if p["closed"][r]) or "none"
    return "PERCEPT  %s, %s\ntraffic  %s\nclosed: %s" % (p["time"], weather, traffic, closed)


def trace(agent_row, res):
    """One figure per agent: three columns (tests), each a top-down flow from
    percept through every reasoning step to the decision and the outcome."""
    cols = len(res["scenarios"])
    wrap = 40
    tests = agent_row["tests"]

    def box_h(text):
        n = sum(len(textwrap.wrap(p, wrap)) or 1 for p in text.split("\n"))
        return n * 0.28 + 0.3

    heights = []
    for sc, t in zip(SCENARIOS, tests):
        boxes = [percept_summary(sc)] + t["reasoning"] + ["DECISION", "OUTCOME\nnote"]
        heights.append(sum(box_h(b) for b in boxes) + 0.3 * (len(boxes) - 1))
    H = max(heights) + 1.0
    fig = plt.figure(figsize=(13, H * 0.62 + 0.5))
    ax = fig.add_axes([0.0, 0.0, 1.0, H * 0.62 / (H * 0.62 + 0.5)])
    ax.set_xlim(0, cols * 4.3); ax.set_ylim(0, H); ax.axis("off")

    def boxed(x, y_top, text, fc, ec, color=INK, bold=False, w=3.9):
        lines = []
        for para in text.split("\n"):
            lines += textwrap.wrap(para, wrap) or [""]
        h = len(lines) * 0.28 + 0.3
        ax.add_patch(FancyBboxPatch((x - w / 2, y_top - h), w, h, boxstyle="round,pad=0.02,rounding_size=0.12",
                                    fc=fc, ec=ec, lw=1.1))
        ax.text(x, y_top - h / 2, "\n".join(lines), ha="center", va="center", fontsize=8.6, color=color,
                weight="bold" if bold else "normal", linespacing=1.25)
        return y_top - h

    def arrow(x, y0, y1):
        ax.annotate("", (x, y1), (x, y0), arrowprops=dict(arrowstyle="-|>", color=MUTED, lw=1.2))

    for k, (sc, t) in enumerate(zip(SCENARIOS, tests)):
        x = 2.15 + k * 4.3
        ax.text(x, H - 0.25, "Test %d: %s" % (sc["id"], sc["title"]), ha="center", va="top", fontsize=10.5, weight="bold")
        y = boxed(x, H - 0.75, percept_summary(sc), "#f1f0ec", GRID)
        for step in t["reasoning"]:
            arrow(x, y, y - 0.3); y -= 0.3
            y = boxed(x, y, step, "#fff7e0", "#e8d9a8")
        arrow(x, y, y - 0.3); y -= 0.3
        y = boxed(x, y, "DECISION: ride route %s" % t["route"], ROUTE[t["route"]], ROUTE[t["route"]], "white", True)
        arrow(x, y, y - 0.3); y -= 0.3
        status = ("ON TIME" if t["on_time"] else "LATE by %.1f min" % (t["minutes"] - DEADLINE_MIN))
        boxed(x, y, "%s  -  %.1f min\n%s" % (status, t["minutes"], t["note"]),
              GOOD if t["on_time"] else CRITICAL, GOOD if t["on_time"] else CRITICAL, "white", True)
    fig.suptitle("%s agent: reasoning in each situation" % agent_row["agent"], x=0.01, ha="left",
                 fontsize=13, color=PINK, weight="bold")
    save(fig, "trace_%s.png" % agent_row["key"])


if __name__ == "__main__":
    res = load()
    chart_times(res); chart_matrix(res); chart_summary(res); chart_utility(); chart_learning()
    for row in res["agents"]:
        trace(row, res)
