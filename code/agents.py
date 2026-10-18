"""
Seven agent architectures for the same delivery problem.

Every agent receives the same percept (see environment.make_percept) and must
return one route: "A", "B" or "C", together with the reasoning it used.
"""

import heapq

from environment import (ROUTES, ROUTE_IDS, EDGES, DEADLINE_MIN, FLOOD_RAIN_MIN,
                         TRAINING_DAYS, Noise, base_minutes, is_rush, rain_minutes,
                         trip_minutes)


def open_routes(percept):
    return [r for r in ROUTE_IDS if not percept["closed"][r]]


class Agent:
    name = "Agent"
    key = "agent"

    def reset(self):
        pass

    def decide(self, percept):
        raise NotImplementedError


# ---------------------------------------------------------------------------
# 1. Simple Reflex: condition-action rules on the current percept only.
# ---------------------------------------------------------------------------
class SimpleReflexAgent(Agent):
    name = "Simple Reflex"
    key = "simple_reflex"

    RULES = [
        ("Khayaban-e-Jinnah is closed", lambda p: p["closed"]["A"], "B"),
        ("Khayaban-e-Jinnah is jammed", lambda p: p["traffic"]["A"] == "heavy", "B"),
        ("the road ahead is clear", lambda p: True, "A"),
    ]

    def decide(self, percept):
        for condition, test, action in self.RULES:
            if test(percept):
                return action, ["Rule fired: IF %s THEN take route %s." % (condition, action),
                                "No memory: earlier percepts are ignored."]


# ---------------------------------------------------------------------------
# 2. Model-Based Reflex: rules + internal state built from the percept history.
# ---------------------------------------------------------------------------
class ModelBasedReflexAgent(Agent):
    name = "Model-Based Reflex"
    key = "model_based"

    def reset(self):
        self.state = {}

    def update_state(self, percept):
        rain = rain_minutes(percept)
        self.state = {
            "rain_minutes": rain,
            "A_blocked": percept["closed"]["A"] or percept["traffic"]["A"] == "heavy",
            # world model: the canal underpass floods after long rain
            "B_flooded": rain >= FLOOD_RAIN_MIN,
            "B_blocked": percept["closed"]["B"] or percept["traffic"]["B"] == "heavy",
        }

    def decide(self, percept):
        self.update_state(percept)
        s = self.state
        why = ["Internal state: raining for %d min, A blocked=%s, underpass flooded (believed)=%s."
               % (s["rain_minutes"], s["A_blocked"], s["B_flooded"])]
        if not s["A_blocked"]:
            route = "A"
            why.append("Rule: main road is fine -> take A.")
        elif not s["B_flooded"] and not s["B_blocked"]:
            route = "B"
            why.append("Rule: A blocked and canal road believed dry -> take B.")
        else:
            route = "C"
            why.append("Rule: A blocked and underpass believed flooded -> take C.")
        return route, why


# ---------------------------------------------------------------------------
# 3. Goal-Based: searches the road map for a path that reaches the goal (UCP).
#    Uniform-cost search on distance; it only cares that the goal is reached.
# ---------------------------------------------------------------------------
class GoalBasedAgent(Agent):
    name = "Goal-Based"
    key = "goal_based"

    def search(self, percept):
        graph = {}
        for a, b, km, route in EDGES:
            if percept["closed"][route]:
                continue
            graph.setdefault(a, []).append((b, km, route))
        frontier = [(0.0, "CHZ", [], None)]
        seen = set()
        while frontier:
            cost, node, path, route = heapq.heappop(frontier)
            if node == "UCP":
                return route, path, round(cost, 2)
            if node in seen:
                continue
            seen.add(node)
            for nxt, km, r in graph.get(node, []):
                if nxt not in seen:
                    heapq.heappush(frontier, (cost + km, nxt, path + [nxt], r))
        return None, [], None

    def decide(self, percept):
        route, path, km = self.search(percept)
        closed = [r for r in ROUTE_IDS if percept["closed"][r]]
        why = ["Goal: reach UCP. Closed roads removed from the map: %s."
               % (", ".join(closed) if closed else "none"),
               "Uniform-cost search found CHZ -> %s (%.2f km) on route %s."
               % (" -> ".join(path), km, route),
               "Traffic and weather are not part of the goal test, so they are ignored."]
        return route, why


# ---------------------------------------------------------------------------
# 4. Utility-Based: expected utility over uncertain outcomes.
# ---------------------------------------------------------------------------
class UtilityBasedAgent(Agent):
    name = "Utility-Based"
    key = "utility_based"

    W_ON_TIME, W_TIME, W_RISK = 100.0, 2.0, 15.0

    @staticmethod
    def flood_probability(rain):
        if rain == 0:
            return 0.0
        return 0.85 if rain >= FLOOD_RAIN_MIN else 0.30

    def outcomes(self, route, percept):
        """List of (probability, minutes) for a route."""
        t = base_minutes(route)
        if percept["traffic"][route] == "heavy":
            t += ROUTES[route]["jam_delay"]
        p = self.flood_probability(rain_minutes(percept)) if ROUTES[route]["flood_delay"] else 0.0
        if p == 0.0:
            return [(1.0, round(t, 1))], 0.0
        return [(1 - p, round(t, 1)), (p, round(t + ROUTES[route]["flood_delay"], 1))], p

    def utility(self, route, percept):
        outs, risk = self.outcomes(route, percept)
        expected = sum(p * t for p, t in outs)
        p_on_time = sum(p for p, t in outs if t <= DEADLINE_MIN)
        u = self.W_ON_TIME * p_on_time - self.W_TIME * expected - self.W_RISK * risk
        return round(u, 2), round(expected, 2), round(p_on_time, 2)

    def decide(self, percept):
        why = ["U = 100*P(on time) - 2*E[minutes] - 15*P(flood)"]
        best, best_u = None, None
        for r in open_routes(percept):
            u, e, pot = self.utility(r, percept)
            why.append("Route %s: E[t]=%.1f min, P(on time)=%.2f, U=%.1f" % (r, e, pot, u))
            if best_u is None or u > best_u:
                best, best_u = r, u
        why.append("Highest utility -> route %s." % best)
        return best, why


# ---------------------------------------------------------------------------
# 5. Learning: learns the value of each route per context from past trips.
# ---------------------------------------------------------------------------
class LearningAgent(Agent):
    name = "Learning"
    key = "learning"

    ROUNDS = 3

    def __init__(self):
        self.q = {}
        self.n = {}
        self.trained = False

    @staticmethod
    def context(percept):
        if percept["weather"] == "rain":
            return "rain"
        return "rush" if is_rush(percept["time"]) else "normal"

    def train(self):
        """Ride every route on every training day a few times (exploration),
        keeping the running average of -minutes as the Q value."""
        noise = Noise(42)
        self.q, self.n = {}, {}
        for _ in range(self.ROUNDS):
            for day in TRAINING_DAYS:
                ctx = "rain" if day["weather"] == "rain" else ("rush" if is_rush(day["time"]) else "normal")
                for r in ROUTE_IDS:
                    t = trip_minutes(r, day["state"])
                    if t is None:
                        continue
                    reward = -(t + noise.minutes(1.0))
                    k = (ctx, r)
                    self.n[k] = self.n.get(k, 0) + 1
                    old = self.q.get(k, 0.0)
                    self.q[k] = old + (reward - old) / self.n[k]
        self.trained = True

    def decide(self, percept):
        if not self.trained:
            self.train()
        ctx = self.context(percept)
        why = ["Context recognised: %s. Learned from %d training trips."
               % (ctx, sum(self.n.values()))]
        best, best_q = None, None
        for r in open_routes(percept):
            q = self.q.get((ctx, r))
            if q is None:
                continue
            why.append("Q(%s, %s) = %.1f  (about %.1f min)" % (ctx, r, q, -q))
            if best_q is None or q > best_q:
                best, best_q = r, q
        why.append("Exploit best learned value -> route %s." % best)
        return best, why


# ---------------------------------------------------------------------------
# 6. Hierarchical: strategic -> tactical -> operational layers.
# ---------------------------------------------------------------------------
class HierarchicalAgent(Agent):
    name = "Hierarchical"
    key = "hierarchical"

    def strategic(self, percept):
        rain = rain_minutes(percept)
        return {"avoid_congestion": True,
                "avoid_flood_prone": rain >= FLOOD_RAIN_MIN,
                "mode": "safe" if percept["weather"] == "rain" else "fast"}

    def tactical(self, percept, plan):
        candidates = []
        for r in open_routes(percept):
            if plan["avoid_congestion"] and percept["traffic"][r] == "heavy":
                continue
            if plan["avoid_flood_prone"] and ROUTES[r]["flood_delay"] > 0:
                continue
            candidates.append(r)
        if not candidates:
            candidates = open_routes(percept)
        return min(candidates, key=base_minutes), candidates

    def operational(self, route, plan):
        speed = ROUTES[route]["speed_kmh"] * (0.8 if plan["mode"] == "safe" else 1.0)
        return "limit speed to %.0f km/h on bad patches, stop at red signals, keep the food box level" % speed

    def decide(self, percept):
        plan = self.strategic(percept)
        route, candidates = self.tactical(percept, plan)
        return route, [
            "Strategic layer: mode=%s, avoid congestion=%s, avoid flood-prone=%s."
            % (plan["mode"], plan["avoid_congestion"], plan["avoid_flood_prone"]),
            "Tactical layer: allowed routes %s, fastest of them is %s."
            % (", ".join(candidates), route),
            "Operational layer: %s." % self.operational(route, plan),
        ]


# ---------------------------------------------------------------------------
# 7. Contextual: recognises the situation and switches to a matching policy.
# ---------------------------------------------------------------------------
class ContextualAgent(Agent):
    name = "Contextual"
    key = "contextual"

    POLICIES = {
        "normal": ["A", "B", "C"],       # shortest first
        "rush hour": ["B", "C", "A"],    # keep off the main road
        "monsoon": ["C", "A", "B"],      # keep out of the underpass
    }

    @staticmethod
    def classify(percept):
        if percept["weather"] == "rain":
            return "monsoon"
        if is_rush(percept["time"]) or percept["traffic"]["A"] == "heavy":
            return "rush hour"
        return "normal"

    def decide(self, percept):
        ctx = self.classify(percept)
        order = self.POLICIES[ctx]
        route = next(r for r in order if not percept["closed"][r])
        return route, ["Context: %s (time %s, weather %s)." % (ctx, percept["time"], percept["weather"]),
                       "Policy for %s: preference %s." % (ctx, " > ".join(order)),
                       "First open route in the policy -> %s." % route]


ALL_AGENTS = [SimpleReflexAgent, ModelBasedReflexAgent, GoalBasedAgent,
              UtilityBasedAgent, LearningAgent, HierarchicalAgent, ContextualAgent]
