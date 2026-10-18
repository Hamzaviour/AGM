"""
Draw the architecture diagram of every agent, plus the route map, as PNG files
in ../diagrams/.   Needs matplotlib:  pip install matplotlib
"""

import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "diagrams")
sys.path.insert(0, os.path.join(HERE, "..", "code"))
from environment import ROUTES, base_minutes, route_km  # noqa: E402

PINK, ENV, SENS, ACT, INNER, MEM = "#e21b70", "#dfe9f5", "#fde6ef", "#e3f4e6", "#fff4d6", "#ece6f7"


def box(ax, x, y, w, h, text, color, bold=False, size=10, tag=None, edge="#333"):
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle="round,pad=0.02,rounding_size=0.12",
                                fc=color, ec=edge, lw=1.3))
    if tag:
        ax.text(x, y + h / 2 - 0.2, tag, ha="center", va="center", fontsize=8.6, weight="bold", color="#222")
        ax.text(x, y - 0.12, text, ha="center", va="center", fontsize=size, linespacing=1.3)
    else:
        ax.text(x, y, text, ha="center", va="center", fontsize=size, weight="bold" if bold else "normal",
                linespacing=1.3)


def arrow(ax, a, b, text=None, rad=0.0, dx=0.0, dy=0.17):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle="-|>", mutation_scale=16, lw=1.4, color="#333",
                                 connectionstyle="arc3,rad=%s" % rad))
    if text:
        ax.text((a[0] + b[0]) / 2 + dx, (a[1] + b[1]) / 2 + dy, text, ha="center", fontsize=8.6,
                color="#444", style="italic")


# Positions of the four parts every architecture shares.
IN, DEC, ACTN, ENVB = (1.45, 2.7), (4.95, 2.7), (8.35, 2.7), (11.05, 2.7)
COMP = 4.85  # height of the architecture-specific components


def skeleton(title, subtitle, decision, action="ride route\nA, B or C"):
    """Input / Perception -> Decision Process -> Action -> Environment, plus the
    feedback loop from the environment back to the sensors."""
    fig, ax = plt.subplots(figsize=(12.6, 6.6), dpi=150)
    ax.set_xlim(0, 12.4); ax.set_ylim(0, 6.6); ax.axis("off")
    ax.text(0.15, 6.32, title, fontsize=16, weight="bold", color=PINK)
    ax.text(0.15, 5.98, subtitle, fontsize=10, color="#555")
    box(ax, IN[0], IN[1], 2.3, 1.55, "eyes + rider app:\nclock, weather, traffic,\nclosures, deadline", SENS,
        tag="INPUT / PERCEPTION")
    box(ax, DEC[0], DEC[1], 3.3, 1.55, decision, INNER, tag="DECISION PROCESS", edge=PINK)
    box(ax, ACTN[0], ACTN[1], 2.1, 1.55, action, ACT, tag="ACTION")
    box(ax, ENVB[0], ENVB[1], 2.1, 1.55, "Johar Town roads\nCheezious -> UCP\nA, B, C, traffic,\nrain, flooding", ENV,
        tag="ENVIRONMENT")
    arrow(ax, (IN[0] + 1.17, IN[1]), (DEC[0] - 1.67, DEC[1]), "percept")
    arrow(ax, (DEC[0] + 1.67, DEC[1]), (ACTN[0] - 1.07, ACTN[1]), "chosen\nroute", dy=0.12)
    arrow(ax, (ACTN[0] + 1.07, ACTN[1]), (ENVB[0] - 1.07, ENVB[1]))
    # feedback loop: environment -> new percept
    y = 1.05
    ax.plot([ENVB[0], ENVB[0], IN[0], IN[0]], [ENVB[1] - 0.8, y, y, IN[1] - 0.95], color="#888", lw=1.3, ls="--")
    ax.add_patch(FancyArrowPatch((IN[0], IN[1] - 0.95), (IN[0], IN[1] - 0.8), arrowstyle="-|>",
                                 mutation_scale=14, color="#888"))
    ax.text((IN[0] + ENVB[0]) / 2, y - 0.25, "the world changes; the rider perceives the new state (next percept)",
            ha="center", fontsize=8.6, color="#666", style="italic")
    return fig, ax


def note(ax, text):
    ax.text(6.2, 0.25, text, ha="center", fontsize=9, color="#7a2048",
            bbox=dict(boxstyle="round,pad=0.35", fc="#fdf0f5", ec="#f2b6cd"))


def comp(ax, x, text, tag, w=2.7, h=1.25, y=COMP):
    box(ax, x, y, w, h, text, MEM, tag=tag)


def save(fig, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", os.path.relpath(path, os.path.join(HERE, "..")))


def simple_reflex():
    fig, ax = skeleton("1. Simple Reflex Agent", "Acts on the current percept only. No memory and no model of the world.",
                       "match the current percept\nto the first rule that fires")
    comp(ax, DEC[0], "IF A closed   THEN B\nIF A jammed   THEN B\nOTHERWISE     A", "CONDITION-ACTION RULES", w=3.3)
    arrow(ax, (DEC[0], COMP - 0.63), (DEC[0], DEC[1] + 0.78))
    note(ax, "Test 3: sees the jam on A, rule fires -> B; it cannot know the underpass is flooded -> late")
    save(fig, "1_simple_reflex.png")


def model_based():
    fig, ax = skeleton("2. Model-Based Reflex Agent", "Keeps an internal state built from the percept history and a model of how the world works.",
                       "rules applied to the\ninternal state, not only\nthe current percept")
    comp(ax, 3.3, "rain for 45 min\nA blocked = True\nB flooded? = True", "INTERNAL STATE")
    comp(ax, 6.6, "rain >= 30 min ->\nunderpass floods", "WORLD MODEL")
    arrow(ax, (IN[0] + 0.5, IN[1] + 0.78), (3.3 - 0.9, COMP - 0.63), "update", dx=-0.35)
    arrow(ax, (6.6 - 1.35, COMP), (3.3 + 1.35, COMP))
    arrow(ax, (3.3 + 0.7, COMP - 0.63), (DEC[0] - 0.5, DEC[1] + 0.78))
    note(ax, "Test 3: remembers 45 min of rain -> believes B is flooded -> takes C (on time)")
    save(fig, "2_model_based_reflex.png")


def goal_based():
    fig, ax = skeleton("3. Goal-Based Agent", "Searches the road map for a sequence of roads that reaches the goal.",
                       "uniform-cost search\n(cost = distance)\nCHZ -> A1 -> UCP")
    comp(ax, 3.3, "be at the UCP gate", "GOAL")
    comp(ax, 6.6, "7 places, 8 road sections\n(km each), closed\nroads removed", "MAP / MODEL")
    arrow(ax, (3.3 + 0.7, COMP - 0.63), (DEC[0] - 0.5, DEC[1] + 0.78))
    arrow(ax, (6.6 - 0.7, COMP - 0.63), (DEC[0] + 0.5, DEC[1] + 0.78))
    note(ax, "Any path that reaches UCP meets the goal: traffic and weather are ignored -> A in Tests 2 and 3")
    save(fig, "3_goal_based.png")


def utility_based():
    fig, ax = skeleton("4. Utility-Based Agent", "Predicts the outcomes of every route and picks the highest expected utility.",
                       "for each route: outcomes\n+ probabilities -> E[U]\nchoose argmax E[U]")
    comp(ax, 3.3, "U = 100 P(on time)\n- 2 E[minutes]\n- 15 P(flood)", "UTILITY")
    comp(ax, 6.6, "P(flood) = 0.85 after\n30 min of rain; jam\nadds 9.2 min on A", "STATE + OUTCOME MODEL")
    arrow(ax, (3.3 + 0.7, COMP - 0.63), (DEC[0] - 0.5, DEC[1] + 0.78))
    arrow(ax, (6.6 - 0.7, COMP - 0.63), (DEC[0] + 0.5, DEC[1] + 0.78))
    note(ax, "Test 3: U(A) = -38.4, U(B) = -42.5, U(C) = 71.2 -> C (on time for the 15-minute deadline)")
    save(fig, "4_utility_based.png")


def learning():
    fig, ax = skeleton("5. Learning Agent", "Improves its route values from experience (54 training trips, running-average Q-values).",
                       "PERFORMANCE ELEMENT\npick route with best\nlearned Q(context, route)")
    comp(ax, 2.4, "try every route\nduring training", "PROBLEM GENERATOR", w=2.4)
    comp(ax, 5.3, "Q(ctx, r) += (R - Q) / n", "LEARNING ELEMENT", w=2.8)
    comp(ax, 8.35, "reward R = -minutes\nvs performance\nstandard (on time)", "CRITIC / FEEDBACK", w=2.6)
    arrow(ax, (ENVB[0] - 0.3, ENVB[1] + 0.78), (8.35 + 0.9, COMP - 0.63), "trip time", dx=0.55)
    arrow(ax, (8.35 - 1.3, COMP - 0.2), (5.3 + 1.4, COMP - 0.2), "feedback", dy=-0.32)
    arrow(ax, (5.3 - 0.2, COMP - 0.63), (DEC[0] + 0.1, DEC[1] + 0.78), "changes", dx=0.45)
    arrow(ax, (2.4 + 0.7, COMP - 0.63), (DEC[0] - 0.9, DEC[1] + 0.78), "explore", dx=-0.45)
    note(ax, "Learned: rain context -> B about 24.5 min, C about 14.3 min, so in Test 3 it takes C")
    save(fig, "5_learning.png")


def hierarchical():
    fig, ax = skeleton("6. Hierarchical Agent", "Splits the task into layers: the upper layer sets subgoals for the layer below.",
                       "TACTICAL LAYER\nkeep routes that meet\nthe subgoals; take fastest",
                       action="OPERATIONAL LAYER\nride it: speed,\nsignals, box level")
    comp(ax, DEC[0], "1. arrive within the deadline (15 min if urgent)\n2. avoid congested roads\n"
         "3. avoid flood-prone roads after 30 min rain", "STRATEGIC LAYER -> SUBGOALS", w=4.9, h=1.3)
    arrow(ax, (DEC[0], COMP - 0.66), (DEC[0], DEC[1] + 0.78), "subgoals", dx=0.5)
    note(ax, "Test 3: subgoals leave only route C -> C (on time)")
    save(fig, "6_hierarchical.png")


def contextual():
    fig, ax = skeleton("7. Contextual Agent", "Recognises the situation first, then applies the policy designed for that context.",
                       "apply the policy of the\nrecognised context: first\nopen route in its order")
    comp(ax, 3.3, "time, weather, traffic on A\n-> normal | rush hour\n| monsoon", "CONTEXT CLASSIFIER")
    comp(ax, 6.6, "normal:     A > B > C\nrush hour:  B > C > A\nmonsoon:    C > A > B", "POLICY LIBRARY")
    arrow(ax, (IN[0] + 0.5, IN[1] + 0.78), (3.3 - 0.9, COMP - 0.63), "percept", dx=-0.4)
    arrow(ax, (3.3 + 1.35, COMP), (6.6 - 1.35, COMP), "context")
    arrow(ax, (6.6 - 0.7, COMP - 0.63), (DEC[0] + 0.5, DEC[1] + 0.78), "policy", dx=0.4)
    note(ax, "Test 3: rain -> 'monsoon' context -> policy C > A > B -> C (on time)")
    save(fig, "7_contextual.png")


def route_map():
    fig, ax = plt.subplots(figsize=(11, 6.4), dpi=150)
    ax.set_aspect("equal"); ax.axis("off")
    paths = {
        "A": [(-185, 13), (-174, 0), (0, 0), (174, 0), (190, 11)],
        "B": [(-185, 13), (-174, 0), (-150, 0), (-132, 40), (-110, 70), (40, 70), (118, 70), (140, 40), (150, 0), (174, 0), (190, 11)],
        "C": [(-185, 13), (-174, 0), (-150, 0), (-150, -55), (-75, -55), (-75, -95), (75, -95), (75, -55), (150, -55), (150, 0), (174, 0), (190, 11)],
    }
    colors = {"A": "#2a78d6", "B": "#1baf7a", "C": "#eb6834"}
    ax.fill_between([-260, 260], 80, 92, color="#9fc6d6")
    ax.text(-250, 84, "Lahore Canal", fontsize=9, color="#1c4b5d")
    for r, pts in paths.items():
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color=colors[r], lw=6 if r == "A" else 4.5, solid_capstyle="round", alpha=0.9,
                label="Route %s: %s, %.2f km, %.1f min" % (r, ROUTES[r]["name"], route_km(r), base_minutes(r)))
    ax.plot([-185], [13], "o", ms=16, color="#ffc20e", mec="#333"); ax.text(-210, 26, "Cheezious\n(pickup)", fontsize=10, weight="bold")
    ax.plot([190], [11], "o", ms=16, color=PINK, mec="#333"); ax.text(176, 26, "UCP gate\n(drop-off)", fontsize=10, weight="bold")
    ax.annotate("Jinnah signal chowk\n(jams in Tests 2 and 3)", (0, 0), (-20, -30), fontsize=9, arrowprops=dict(arrowstyle="->"))
    ax.annotate("Canal underpass\n(floods after 30 min rain)", (40, 70), (60, 40), fontsize=9, arrowprops=dict(arrowstyle="->"))
    ax.text(-72, -88, "Block G / Maulana Shaukat Ali Rd", fontsize=9, color="#7a4a10")
    ax.set_xlim(-262, 262); ax.set_ylim(-110, 100)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, 0.0), ncol=1, frameon=False, fontsize=10)
    ax.set_title("Road map: Cheezious, Johar Town -> University of Central Punjab (schematic)", fontsize=13, color=PINK, weight="bold")
    save(fig, "0_route_map.png")


if __name__ == "__main__":
    route_map()
    simple_reflex(); model_based(); goal_based(); utility_based(); learning(); hierarchical(); contextual()
