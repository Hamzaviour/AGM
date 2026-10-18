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


def box(ax, x, y, w, h, text, color, bold=False, size=10.5):
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle="round,pad=0.02,rounding_size=0.12",
                                fc=color, ec="#333", lw=1.2))
    ax.text(x, y, text, ha="center", va="center", fontsize=size, weight="bold" if bold else "normal", wrap=True)


def arrow(ax, a, b, text=None, rad=0.0):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle="-|>", mutation_scale=16, lw=1.4, color="#333",
                                 connectionstyle="arc3,rad=%s" % rad))
    if text:
        ax.text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.18, text, ha="center", fontsize=9, color="#444", style="italic")


def frame(title, subtitle):
    fig, ax = plt.subplots(figsize=(11, 6.2), dpi=150)
    ax.set_xlim(0, 11); ax.set_ylim(0, 6.2); ax.axis("off")
    ax.text(0.2, 5.9, title, fontsize=16, weight="bold", color=PINK)
    ax.text(0.2, 5.55, subtitle, fontsize=10, color="#555")
    # environment column + sensors/actuators shared by all diagrams
    box(ax, 1.3, 2.7, 2.0, 4.2, "ENVIRONMENT\n\nJohar Town roads\nCheezious -> UCP\n\nRoutes A, B, C\ntraffic, rain,\nclosures, flooding", ENV, bold=False)
    box(ax, 3.7, 4.4, 1.7, 0.8, "Sensors\n(eyes, rider app)", SENS)
    box(ax, 3.7, 1.0, 1.7, 0.8, "Actuators\n(ride route X)", ACT)
    arrow(ax, (2.3, 4.4), (2.85, 4.4), "percept")
    arrow(ax, (2.85, 1.0), (2.3, 1.0), "action")
    return fig, ax


def save(fig, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", os.path.relpath(path, os.path.join(HERE, "..")))


def simple_reflex():
    fig, ax = frame("1. Simple Reflex Agent", "Acts on the current percept only, using condition-action rules.")
    box(ax, 6.6, 4.4, 3.4, 0.8, "What the world is like now\n(A closed? A jammed?)", INNER)
    box(ax, 6.6, 2.6, 3.4, 1.4, "Condition-action rules\nIF A closed THEN B\nIF A jammed THEN B\nELSE A", INNER)
    box(ax, 6.6, 1.0, 3.4, 0.8, "What action to do now", INNER)
    arrow(ax, (4.55, 4.4), (4.9, 4.4)); arrow(ax, (6.6, 4.0), (6.6, 3.3)); arrow(ax, (6.6, 1.9), (6.6, 1.4))
    arrow(ax, (4.9, 1.0), (4.55, 1.0))
    ax.text(9.0, 2.6, "No memory:\nit cannot know the\nunderpass is flooded", fontsize=9.5, color="#a33", va="center")
    save(fig, "1_simple_reflex.png")


def model_based():
    fig, ax = frame("2. Model-Based Reflex Agent", "Keeps an internal state, updated from the percept history and a model of how the world works.")
    box(ax, 6.0, 4.4, 2.2, 0.8, "Update state", INNER)
    box(ax, 9.1, 4.4, 2.6, 1.3, "Internal state\nrain minutes = 45\nA blocked = True\nB flooded? = True", MEM)
    box(ax, 9.1, 2.6, 2.6, 1.0, "World model\nrain >= 30 min ->\nunderpass floods", MEM)
    box(ax, 6.0, 2.6, 2.2, 1.0, "Condition-action\nrules", INNER)
    box(ax, 6.0, 1.0, 2.2, 0.8, "Action", INNER)
    arrow(ax, (4.55, 4.4), (4.9, 4.4)); arrow(ax, (7.1, 4.4), (7.8, 4.4))
    arrow(ax, (9.1, 3.1), (9.1, 3.75), rad=0); arrow(ax, (7.8, 2.6), (7.1, 2.6))
    arrow(ax, (6.0, 2.1), (6.0, 1.4)); arrow(ax, (4.9, 1.0), (4.55, 1.0))
    save(fig, "2_model_based_reflex.png")


def goal_based():
    fig, ax = frame("3. Goal-Based Agent", "Searches the road graph for a sequence of roads that reaches the goal.")
    box(ax, 6.0, 4.4, 2.2, 0.8, "State: at Cheezious\nclosed roads removed", INNER)
    box(ax, 9.1, 4.4, 2.6, 0.8, "Goal: be at UCP gate", MEM)
    box(ax, 6.0, 2.6, 2.2, 1.1, "Uniform-cost\nsearch (distance)\nCHZ -> A1 -> UCP", INNER)
    box(ax, 9.1, 2.6, 2.6, 1.1, "Road map\n7 nodes, 8 edges\n(km per edge)", MEM)
    box(ax, 6.0, 1.0, 2.2, 0.8, "Follow the path", INNER)
    arrow(ax, (4.55, 4.4), (4.9, 4.4)); arrow(ax, (9.1, 4.0), (7.1, 3.0)); arrow(ax, (7.8, 2.6), (7.1, 2.6))
    arrow(ax, (6.0, 4.0), (6.0, 3.15)); arrow(ax, (6.0, 2.05), (6.0, 1.4)); arrow(ax, (4.9, 1.0), (4.55, 1.0))
    ax.text(8.0, 1.0, "Any path that reaches UCP\nsatisfies the goal: traffic\nand weather are ignored", fontsize=9.5, color="#a33", va="center")
    save(fig, "3_goal_based.png")


def utility_based():
    fig, ax = frame("4. Utility-Based Agent", "Predicts the outcomes of every route and picks the highest expected utility.")
    box(ax, 6.0, 4.4, 2.2, 0.8, "State + model\n(P(flood | rain))", INNER)
    box(ax, 6.0, 3.05, 2.2, 0.9, "What happens if\nI ride A / B / C?\n(outcomes, probs)", INNER)
    box(ax, 9.1, 3.05, 2.6, 1.2, "Utility\nU = 100 P(on time)\n- 2 E[min]\n- 15 P(flood)", MEM)
    box(ax, 6.0, 1.75, 2.2, 0.8, "argmax E[U]", INNER)
    box(ax, 9.1, 1.0, 2.6, 0.8, "Test 3: U(B) = -42.5\nU(C) = 71.2 -> C", "#f4f4f4", size=9.5)
    arrow(ax, (4.55, 4.4), (4.9, 4.4)); arrow(ax, (6.0, 4.0), (6.0, 3.5)); arrow(ax, (7.8, 3.05), (7.1, 3.05))
    arrow(ax, (6.0, 2.6), (6.0, 2.15)); arrow(ax, (6.0, 1.35), (4.55, 1.0))
    save(fig, "4_utility_based.png")


def learning():
    fig, ax = frame("5. Learning Agent", "Improves its route values from experience (54 training trips, running-average Q-values).")
    box(ax, 6.0, 4.4, 2.2, 0.8, "Critic\nreward = -minutes", INNER)
    box(ax, 9.1, 4.4, 2.6, 0.8, "Performance standard\n(deliver fast, on time)", MEM)
    box(ax, 6.0, 2.9, 2.2, 0.9, "Learning element\nQ(ctx, r) +=\n(R - Q) / n", INNER)
    box(ax, 9.1, 2.9, 2.6, 0.9, "Problem generator\n(try every route\nin training)", MEM)
    box(ax, 6.0, 1.4, 2.2, 0.9, "Performance element\npick max Q(ctx, r)", INNER)
    arrow(ax, (4.55, 4.4), (4.9, 4.4)); arrow(ax, (7.8, 4.4), (7.1, 4.4))
    arrow(ax, (6.0, 4.0), (6.0, 3.35), "feedback"); arrow(ax, (6.0, 2.45), (6.0, 1.85), "changes")
    arrow(ax, (7.8, 2.9), (7.1, 2.9)); arrow(ax, (4.9, 1.2), (4.55, 1.0))
    save(fig, "5_learning.png")


def hierarchical():
    fig, ax = frame("6. Hierarchical Agent", "Three layers: each one sets the problem for the layer below.")
    box(ax, 7.0, 4.4, 4.2, 0.8, "Strategic layer: deadline, mode (fast / safe),\navoid congestion, avoid flood-prone roads", INNER)
    box(ax, 7.0, 2.9, 4.2, 0.8, "Tactical layer: allowed routes ->\nfastest allowed route", MEM)
    box(ax, 7.0, 1.4, 4.2, 0.8, "Operational layer: speed limit, signals,\nkeep the food box level", ACT)
    arrow(ax, (4.55, 4.4), (4.9, 4.4)); arrow(ax, (7.0, 4.0), (7.0, 3.3), "constraints")
    arrow(ax, (7.0, 2.5), (7.0, 1.8), "route"); arrow(ax, (4.9, 1.2), (4.55, 1.0))
    save(fig, "6_hierarchical.png")


def contextual():
    fig, ax = frame("7. Contextual Agent", "Recognises the situation first, then applies the policy made for that context.")
    box(ax, 6.0, 4.4, 2.2, 0.8, "Context classifier\n(time, weather, A traffic)", INNER)
    box(ax, 9.1, 4.4, 2.6, 0.8, "normal | rush hour\n| monsoon", MEM)
    box(ax, 6.0, 2.7, 2.2, 1.3, "Policy library\nnormal: A > B > C\nrush: B > C > A\nmonsoon: C > A > B", MEM)
    box(ax, 6.0, 1.0, 2.2, 0.8, "First open route", INNER)
    arrow(ax, (4.55, 4.4), (4.9, 4.4)); arrow(ax, (7.1, 4.4), (7.8, 4.4)); arrow(ax, (9.1, 4.0), (7.1, 3.0))
    arrow(ax, (6.0, 2.05), (6.0, 1.4)); arrow(ax, (4.9, 1.0), (4.55, 1.0))
    save(fig, "7_contextual.png")


def route_map():
    fig, ax = plt.subplots(figsize=(11, 6.4), dpi=150)
    ax.set_aspect("equal"); ax.axis("off")
    paths = {
        "A": [(-185, 13), (-174, 0), (0, 0), (174, 0), (190, 11)],
        "B": [(-185, 13), (-174, 0), (-150, 0), (-132, 40), (-110, 70), (40, 70), (118, 70), (140, 40), (150, 0), (174, 0), (190, 11)],
        "C": [(-185, 13), (-174, 0), (-150, 0), (-150, -55), (-75, -55), (-75, -95), (75, -95), (75, -55), (150, -55), (150, 0), (174, 0), (190, 11)],
    }
    colors = {"A": "#2f80ed", "B": "#27ae60", "C": "#f2994a"}
    ax.fill_between([-260, 260], 80, 92, color="#9fc6d6")
    ax.text(-250, 84, "Lahore Canal", fontsize=9, color="#1c4b5d")
    for r, pts in paths.items():
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color=colors[r], lw=6 if r == "A" else 4.5, solid_capstyle="round", alpha=0.9,
                label="Route %s: %s, %.2f km, %.1f min" % (r, ROUTES[r]["name"], route_km(r), base_minutes(r)))
    ax.plot([-185], [13], "o", ms=16, color="#ffc20e", mec="#333"); ax.text(-210, 26, "Cheezious\n(pickup)", fontsize=10, weight="bold")
    ax.plot([190], [11], "o", ms=16, color=PINK, mec="#333"); ax.text(176, 26, "UCP gate\n(drop-off)", fontsize=10, weight="bold")
    ax.annotate("Jinnah signal chowk\n(jams in rush hour)", (0, 0), (-20, -30), fontsize=9, arrowprops=dict(arrowstyle="->"))
    ax.annotate("Canal underpass\n(floods after 30 min rain)", (40, 70), (60, 40), fontsize=9, arrowprops=dict(arrowstyle="->"))
    ax.annotate("Fallen tree in Test 3", (-128, 0), (-125, 20), fontsize=9, color="#a33", arrowprops=dict(arrowstyle="->", color="#a33"))
    ax.text(-72, -88, "Block G / Maulana Shaukat Ali Rd", fontsize=9, color="#7a4a10")
    ax.set_xlim(-262, 262); ax.set_ylim(-110, 100)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, 0.0), ncol=1, frameon=False, fontsize=10)
    ax.set_title("Road map: Cheezious, Johar Town -> University of Central Punjab (schematic)", fontsize=13, color=PINK, weight="bold")
    save(fig, "0_route_map.png")


if __name__ == "__main__":
    route_map()
    simple_reflex(); model_based(); goal_based(); utility_based(); learning(); hierarchical(); contextual()
