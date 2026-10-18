"""
Delivery environment for the Smart Food Delivery Agent.

A foodpanda rider picks up an order at Cheezious (Johar Town, Lahore) and must
deliver it to the University of Central Punjab (UCP), Khayaban-e-Jinnah.
There are three ways to get there:

    A  Khayaban-e-Jinnah Road   - the direct main road (shortest)
    B  Canal Bank Road          - fast road, but it dips through an underpass
                                  that floods after long rain
    C  Johar Town inner streets - the longest way, slow but rarely blocked

The rider chooses a route once, at the restaurant, and then rides it.
The environment then works out how long the trip really took.

The same model is written in JavaScript in simulation/model.js so the 3D
simulation and this program give identical answers (tools/check_parity.js).
"""

RESTAURANT = "Cheezious, Johar Town"
CUSTOMER = "University of Central Punjab (UCP), Khayaban-e-Jinnah"
DEADLINE_MIN = 20.0          # normal order: reach UCP within 20 minutes of pickup
URGENT_DEADLINE_MIN = 15.0   # urgent order: within 15 minutes

RUSH_START, RUSH_END = 17 * 60, 20 * 60     # evening rush hour, minutes after midnight
FLOOD_RAIN_MIN = 30                         # underpass floods after 30 min of rain

# ---------------------------------------------------------------------------
# Road map. Nodes are places, edges are road sections with length in km.
# ---------------------------------------------------------------------------
NODES = {
    "CHZ": "Cheezious (pickup)",
    "A1": "Jinnah signal chowk",
    "B1": "Canal Bank Road entry",
    "B2": "Canal underpass",
    "C1": "Block G inner street",
    "C2": "Maulana Shaukat Ali Road",
    "UCP": "UCP main gate (drop-off)",
}

# (from, to, km, route letter)
EDGES = [
    ("CHZ", "A1", 1.50, "A"), ("A1", "UCP", 1.50, "A"),
    ("CHZ", "B1", 0.90, "B"), ("B1", "B2", 1.35, "B"), ("B2", "UCP", 1.00, "B"),
    ("CHZ", "C1", 1.20, "C"), ("C1", "C2", 1.70, "C"), ("C2", "UCP", 1.30, "C"),
]

ROUTES = {
    "A": {"name": "Khayaban-e-Jinnah Road", "path": ["CHZ", "A1", "UCP"],
          "speed_kmh": 18.0, "jam_delay": 9.2, "flood_delay": 0.0,
          "hazard": "signal chowk queue"},
    "B": {"name": "Canal Bank Road (underpass)", "path": ["CHZ", "B1", "B2", "UCP"],
          "speed_kmh": 18.75, "jam_delay": 6.0, "flood_delay": 14.1,
          "hazard": "underpass flooding"},
    "C": {"name": "Johar Town inner streets", "path": ["CHZ", "C1", "C2", "UCP"],
          "speed_kmh": 17.5, "jam_delay": 3.0, "flood_delay": 0.0,
          "hazard": "none"},
}
ROUTE_IDS = ["A", "B", "C"]


def route_km(route):
    path = ROUTES[route]["path"]
    total = 0.0
    for a, b, km, _ in EDGES:
        for i in range(len(path) - 1):
            if (a, b) == (path[i], path[i + 1]):
                total += km
    return round(total, 2)


def base_minutes(route):
    """Free-flow riding time on a route."""
    return round(route_km(route) / ROUTES[route]["speed_kmh"] * 60, 1)


def to_clock(minutes):
    return "%02d:%02d" % (minutes // 60, minutes % 60)


def from_clock(text):
    h, m = text.split(":")
    return int(h) * 60 + int(m)


# ---------------------------------------------------------------------------
# Test situations. "state" is the true world; the agent only sees the percept.
# ---------------------------------------------------------------------------
SCENARIOS = [
    {
        "id": 1,
        "title": "Normal traffic, good weather",
        "story": "Clear sky at 1 pm. All three roads are moving normally.",
        "order_time": "13:00",
        "weather": "clear",
        "rain_since": None,
        "state": {
            "A": {"traffic": "light", "closed": False, "flooded": False},
            "B": {"traffic": "light", "closed": False, "flooded": False},
            "C": {"traffic": "light", "closed": False, "flooded": False},
        },
    },
    {
        "id": 2,
        "title": "Heavy traffic, several routes",
        "story": "6:10 pm rush hour. Khayaban-e-Jinnah is jammed at the Jinnah signal "
                 "chowk and the inner streets are also heavy. All three routes are open.",
        "order_time": "18:10",
        "weather": "clear",
        "rain_since": None,
        "state": {
            "A": {"traffic": "heavy", "closed": False, "flooded": False},
            "B": {"traffic": "light", "closed": False, "flooded": False},
            "C": {"traffic": "heavy", "closed": False, "flooded": False},
        },
    },
    {
        "id": 3,
        "title": "Heavy traffic, rain, urgent",
        "story": "It has rained since 12:15 and Khayaban-e-Jinnah is jammed. The order "
                 "is urgent: it must reach UCP in 15 minutes. The Canal underpass is "
                 "under water, which the traffic app does not show.",
        "order_time": "13:00",
        "weather": "rain",
        "rain_since": "12:15",
        "deadline": URGENT_DEADLINE_MIN,
        "state": {
            "A": {"traffic": "heavy", "closed": False, "flooded": False},
            "B": {"traffic": "light", "closed": False, "flooded": True},
            "C": {"traffic": "light", "closed": False, "flooded": False},
        },
    },
]


def deadline_of(scenario):
    return scenario.get("deadline", DEADLINE_MIN)


def percept_history(scenario):
    """Percepts the rider received earlier the same shift (oldest first).
    Only agents with memory make use of them."""
    order = from_clock(scenario["order_time"])
    history = []
    for minutes_before in (60, 45, 30, 15):
        t = order - minutes_before
        raining = (scenario["rain_since"] is not None
                   and t >= from_clock(scenario["rain_since"]))
        history.append({"time": to_clock(t), "weather": "rain" if raining else "clear"})
    return history


def make_percept(scenario):
    """What the rider can observe at the restaurant door.

    - the clock and the weather
    - live traffic for every route (from the rider app)
    - the order's deadline and priority (normal or urgent)
    - closures: Khayaban-e-Jinnah starts right outside Cheezious, so a closure
      there is seen directly; the app also lists reported closures
    Flooding of the underpass is NOT part of the percept: it is 2 km away and
    the app does not report it.
    """
    state = scenario["state"]
    return {
        "time": scenario["order_time"],
        "weather": scenario["weather"],
        "traffic": {r: state[r]["traffic"] for r in ROUTE_IDS},
        "closed": {r: state[r]["closed"] for r in ROUTE_IDS},
        "deadline": deadline_of(scenario),
        "priority": "urgent" if deadline_of(scenario) < DEADLINE_MIN else "normal",
        "history": percept_history(scenario),
    }


def rain_minutes(percept):
    """How long it has been raining, worked out from the percept sequence."""
    if percept["weather"] != "rain":
        return 0
    now = from_clock(percept["time"])
    start = now
    for p in reversed(percept["history"]):
        if p["weather"] == "rain":
            start = from_clock(p["time"])
        else:
            break
    return now - start


def is_rush(clock):
    t = from_clock(clock)
    return RUSH_START <= t < RUSH_END


def trip_minutes(route, state):
    """True riding time of a route in the given world state (None if impossible)."""
    s = state[route]
    if s["closed"]:
        return None
    t = base_minutes(route)
    if s["traffic"] == "heavy":
        t += ROUTES[route]["jam_delay"]
    if s["flooded"]:
        t += ROUTES[route]["flood_delay"]
    return round(t, 1)


def execute(route, scenario):
    """Rider rides the chosen route. Returns the outcome of the delivery."""
    minutes = trip_minutes(route, scenario["state"])
    if minutes is None:
        return {"route": route, "minutes": None, "on_time": False,
                "note": "route closed, order not delivered"}
    s = scenario["state"][route]
    notes = []
    if s["traffic"] == "heavy":
        notes.append("stuck in traffic at %s" % ROUTES[route]["hazard"])
    if s["flooded"]:
        notes.append("waded through flooded underpass")
    return {"route": route, "minutes": minutes, "on_time": minutes <= deadline_of(scenario),
            "note": "; ".join(notes) if notes else "smooth ride"}


# ---------------------------------------------------------------------------
# Training days for the Learning agent. These are NOT the test situations.
# ---------------------------------------------------------------------------
TRAINING_DAYS = [
    {"time": "12:30", "weather": "clear", "rain_since": None,
     "state": {"A": {"traffic": "light", "closed": False, "flooded": False},
               "B": {"traffic": "light", "closed": False, "flooded": False},
               "C": {"traffic": "light", "closed": False, "flooded": False}}},
    {"time": "15:00", "weather": "clear", "rain_since": None,
     "state": {"A": {"traffic": "light", "closed": False, "flooded": False},
               "B": {"traffic": "light", "closed": False, "flooded": False},
               "C": {"traffic": "light", "closed": False, "flooded": False}}},
    {"time": "17:45", "weather": "clear", "rain_since": None,
     "state": {"A": {"traffic": "heavy", "closed": False, "flooded": False},
               "B": {"traffic": "light", "closed": False, "flooded": False},
               "C": {"traffic": "light", "closed": False, "flooded": False}}},
    {"time": "19:00", "weather": "clear", "rain_since": None,
     "state": {"A": {"traffic": "heavy", "closed": False, "flooded": False},
               "B": {"traffic": "light", "closed": False, "flooded": False},
               "C": {"traffic": "heavy", "closed": False, "flooded": False}}},
    {"time": "14:00", "weather": "rain", "rain_since": "13:00",
     "state": {"A": {"traffic": "heavy", "closed": False, "flooded": False},
               "B": {"traffic": "light", "closed": False, "flooded": True},
               "C": {"traffic": "light", "closed": False, "flooded": False}}},
    {"time": "11:30", "weather": "rain", "rain_since": "10:40",
     "state": {"A": {"traffic": "heavy", "closed": False, "flooded": False},
               "B": {"traffic": "light", "closed": False, "flooded": True},
               "C": {"traffic": "light", "closed": False, "flooded": False}}},
]


class Noise:
    """Small repeatable noise (Park-Miller generator), identical in JavaScript."""

    def __init__(self, seed=42):
        self.x = seed

    def next(self):
        self.x = (self.x * 16807) % 2147483647
        return self.x / 2147483647.0

    def minutes(self, spread=1.0):
        return (self.next() - 0.5) * spread
