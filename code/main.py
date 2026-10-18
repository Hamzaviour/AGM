"""
Run all seven agents on the three test situations and print the results.

    python main.py            # result tables
    python main.py --details  # tables + every agent's reasoning

The output is also written to ../results/results.txt and ../results/results.json.
"""

import json
import os
import sys

from agents import ALL_AGENTS
from environment import (CUSTOMER, DEADLINE_MIN, RESTAURANT, ROUTE_IDS, ROUTES, deadline_of,
                         SCENARIOS, base_minutes, execute, make_percept, route_km)

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "..", "results")


def run():
    rows = []
    for cls in ALL_AGENTS:
        agent = cls()
        row = {"agent": agent.name, "key": agent.key, "tests": []}
        for sc in SCENARIOS:
            agent.reset()
            route, why = agent.decide(make_percept(sc))
            outcome = execute(route, sc)
            row["tests"].append({"test": sc["id"], "route": route,
                                 "minutes": outcome["minutes"],
                                 "on_time": outcome["on_time"],
                                 "note": outcome["note"], "reasoning": why})
        row["on_time"] = sum(t["on_time"] for t in row["tests"])
        row["total_minutes"] = round(sum(t["minutes"] for t in row["tests"]), 1)
        rows.append(row)
    return rows


def cell(t):
    late = "" if t["on_time"] else " (late)"
    return "%s %.1f%s" % (t["route"], t["minutes"], late)


def report(rows, details=False):
    out = []
    w = out.append
    w("SMART FOOD DELIVERY AGENT - %s -> %s" % (RESTAURANT, CUSTOMER))
    w("Deadline: %.0f minutes from pickup (urgent orders: 15 minutes)" % DEADLINE_MIN)
    w("")
    w("Routes")
    for r in ROUTE_IDS:
        w("  %s  %-30s %.2f km, %.1f min free-flow" % (r, ROUTES[r]["name"], route_km(r), base_minutes(r)))
    w("")
    w("Test situations")
    for sc in SCENARIOS:
        w("  Test %d  %-30s deadline %2.0f min. %s" % (sc["id"], sc["title"], deadline_of(sc), sc["story"]))
    w("")
    header = "%-20s | %-15s | %-15s | %-15s | %-7s | %s" % (
        "Agent", "Test 1", "Test 2", "Test 3", "On time", "Total min")
    w(header)
    w("-" * len(header))
    for row in rows:
        w("%-20s | %-15s | %-15s | %-15s | %d/3     | %.1f" % (
            row["agent"], cell(row["tests"][0]), cell(row["tests"][1]),
            cell(row["tests"][2]), row["on_time"], row["total_minutes"]))
    w("")
    w("Cell = chosen route and real delivery time in minutes.")
    if details:
        for row in rows:
            w("")
            w("=" * 70)
            w(row["agent"])
            for t in row["tests"]:
                w("  Test %d -> route %s, %.1f min, %s, %s" % (
                    t["test"], t["route"], t["minutes"],
                    "on time" if t["on_time"] else "LATE", t["note"]))
                for line in t["reasoning"]:
                    w("      " + line)
    return "\n".join(out)


def main():
    rows = run()
    details = "--details" in sys.argv
    print(report(rows, details))
    os.makedirs(RESULTS, exist_ok=True)
    with open(os.path.join(RESULTS, "results.txt"), "w", encoding="utf-8") as f:
        f.write(report(rows, details=True) + "\n")
    with open(os.path.join(RESULTS, "results.json"), "w", encoding="utf-8") as f:
        json.dump({"deadline": DEADLINE_MIN,
                   "scenarios": [{"id": s["id"], "title": s["title"], "story": s["story"],
                                  "deadline": deadline_of(s)} for s in SCENARIOS],
                   "agents": rows}, f, indent=2)


if __name__ == "__main__":
    main()
