/*
 * Delivery environment + the seven agents, written to match code/environment.py
 * and code/agents.py line for line. tools/check_parity.js runs this file in
 * Node and compares every decision, time and reasoning line with the Python output.
 */
(function (root) {
  "use strict";

  const RESTAURANT = "Cheezious, Johar Town";
  const CUSTOMER = "University of Central Punjab (UCP), Khayaban-e-Jinnah";
  const DEADLINE_MIN = 20.0;
  const URGENT_DEADLINE_MIN = 15.0;
  const RUSH_START = 17 * 60, RUSH_END = 20 * 60;
  const FLOOD_RAIN_MIN = 30;

  const NODES = {
    CHZ: "Cheezious (pickup)",
    A1: "Jinnah signal chowk",
    B1: "Canal Bank Road entry",
    B2: "Canal underpass",
    C1: "Block G inner street",
    C2: "Maulana Shaukat Ali Road",
    UCP: "UCP main gate (drop-off)",
  };

  const EDGES = [
    ["CHZ", "A1", 1.50, "A"], ["A1", "UCP", 1.50, "A"],
    ["CHZ", "B1", 0.90, "B"], ["B1", "B2", 1.35, "B"], ["B2", "UCP", 1.00, "B"],
    ["CHZ", "C1", 1.20, "C"], ["C1", "C2", 1.70, "C"], ["C2", "UCP", 1.30, "C"],
  ];

  const ROUTES = {
    A: { name: "Khayaban-e-Jinnah Road", path: ["CHZ", "A1", "UCP"], speed_kmh: 18.0,
         jam_delay: 9.2, flood_delay: 0.0, hazard: "signal chowk queue" },
    B: { name: "Canal Bank Road (underpass)", path: ["CHZ", "B1", "B2", "UCP"], speed_kmh: 18.75,
         jam_delay: 6.0, flood_delay: 14.1, hazard: "underpass flooding" },
    C: { name: "Johar Town inner streets", path: ["CHZ", "C1", "C2", "UCP"], speed_kmh: 17.5,
         jam_delay: 3.0, flood_delay: 0.0, hazard: "none" },
  };
  const ROUTE_IDS = ["A", "B", "C"];

  function round(x, d) {
    const f = Math.pow(10, d);
    return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * f) / f;
  }
  const f1 = (x) => round(x, 1).toFixed(1);
  const f2 = (x) => round(x, 2).toFixed(2);
  const pyBool = (b) => (b ? "True" : "False");

  function routeKm(route) {
    const path = ROUTES[route].path;
    let total = 0;
    for (const [a, b, km] of EDGES)
      for (let i = 0; i < path.length - 1; i++)
        if (a === path[i] && b === path[i + 1]) total += km;
    return round(total, 2);
  }
  const baseMinutes = (route) => round(routeKm(route) / ROUTES[route].speed_kmh * 60, 1);

  const pad = (n) => String(n).padStart(2, "0");
  const toClock = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const fromClock = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  const clearState = () => ({
    A: { traffic: "light", closed: false, flooded: false },
    B: { traffic: "light", closed: false, flooded: false },
    C: { traffic: "light", closed: false, flooded: false },
  });

  const SCENARIOS = [
    { id: 1, title: "Normal traffic, good weather",
      story: "Clear sky at 1 pm. All three roads are moving normally.",
      order_time: "13:00", weather: "clear", rain_since: null, state: clearState() },
    { id: 2, title: "Heavy traffic, several routes",
      story: "6:10 pm rush hour. Khayaban-e-Jinnah is jammed at the Jinnah signal " +
             "chowk and the inner streets are also heavy. All three routes are open.",
      order_time: "18:10", weather: "clear", rain_since: null,
      state: Object.assign(clearState(), {
        A: { traffic: "heavy", closed: false, flooded: false },
        C: { traffic: "heavy", closed: false, flooded: false } }) },
    { id: 3, title: "Heavy traffic, rain, urgent",
      story: "It has rained since 12:15 and Khayaban-e-Jinnah is jammed. The order " +
             "is urgent: it must reach UCP in 15 minutes. The Canal underpass is " +
             "under water, which the traffic app does not show.",
      order_time: "13:00", weather: "rain", rain_since: "12:15", deadline: URGENT_DEADLINE_MIN,
      state: Object.assign(clearState(), {
        A: { traffic: "heavy", closed: false, flooded: false },
        B: { traffic: "light", closed: false, flooded: true } }) },
  ];

  const deadlineOf = (sc) => (sc.deadline !== undefined ? sc.deadline : DEADLINE_MIN);

  function perceptHistory(sc) {
    const order = fromClock(sc.order_time);
    return [60, 45, 30, 15].map((before) => {
      const t = order - before;
      const raining = sc.rain_since !== null && t >= fromClock(sc.rain_since);
      return { time: toClock(t), weather: raining ? "rain" : "clear" };
    });
  }

  function makePercept(sc) {
    const s = sc.state, traffic = {}, closed = {};
    for (const r of ROUTE_IDS) { traffic[r] = s[r].traffic; closed[r] = s[r].closed; }
    return { time: sc.order_time, weather: sc.weather, traffic, closed,
             deadline: deadlineOf(sc), priority: deadlineOf(sc) < DEADLINE_MIN ? "urgent" : "normal",
             history: perceptHistory(sc) };
  }

  function rainMinutes(p) {
    if (p.weather !== "rain") return 0;
    const now = fromClock(p.time);
    let start = now;
    for (let i = p.history.length - 1; i >= 0; i--) {
      if (p.history[i].weather === "rain") start = fromClock(p.history[i].time);
      else break;
    }
    return now - start;
  }

  const isRush = (clock) => { const t = fromClock(clock); return t >= RUSH_START && t < RUSH_END; };

  function tripMinutes(route, state) {
    const s = state[route];
    if (s.closed) return null;
    let t = baseMinutes(route);
    if (s.traffic === "heavy") t += ROUTES[route].jam_delay;
    if (s.flooded) t += ROUTES[route].flood_delay;
    return round(t, 1);
  }

  function execute(route, sc) {
    const minutes = tripMinutes(route, sc.state);
    if (minutes === null)
      return { route, minutes: null, on_time: false, note: "route closed, order not delivered" };
    const s = sc.state[route], notes = [];
    if (s.traffic === "heavy") notes.push("stuck in traffic at " + ROUTES[route].hazard);
    if (s.flooded) notes.push("waded through flooded underpass");
    return { route, minutes, on_time: minutes <= deadlineOf(sc),
             note: notes.length ? notes.join("; ") : "smooth ride" };
  }

  const TD = (time, weather, rain_since, A, B, C) => ({ time, weather, rain_since,
    state: { A: { traffic: A, closed: false, flooded: false },
             B: { traffic: "light", closed: false, flooded: B },
             C: { traffic: C, closed: false, flooded: false } } });
  const TRAINING_DAYS = [
    TD("12:30", "clear", null, "light", false, "light"),
    TD("15:00", "clear", null, "light", false, "light"),
    TD("17:45", "clear", null, "heavy", false, "light"),
    TD("19:00", "clear", null, "heavy", false, "heavy"),
    TD("14:00", "rain", "13:00", "heavy", true, "light"),
    TD("11:30", "rain", "10:40", "heavy", true, "light"),
  ];

  class Noise {
    constructor(seed) { this.x = seed; }
    next() { this.x = (this.x * 16807) % 2147483647; return this.x / 2147483647; }
    minutes(spread) { return (this.next() - 0.5) * spread; }
  }

  const openRoutes = (p) => ROUTE_IDS.filter((r) => !p.closed[r]);

  /* ----------------------------------------------------------------- agents */
  class SimpleReflexAgent {
    constructor() { this.name = "Simple Reflex"; this.key = "simple_reflex"; }
    reset() {}
    decide(p) {
      const rules = [
        ["Khayaban-e-Jinnah is closed", () => p.closed.A, "B"],
        ["Khayaban-e-Jinnah is jammed", () => p.traffic.A === "heavy", "B"],
        ["the road ahead is clear", () => true, "A"],
      ];
      for (const [cond, test, action] of rules)
        if (test()) return [action, ["Rule fired: IF " + cond + " THEN take route " + action + ".",
                                     "No memory: earlier percepts are ignored."]];
    }
  }

  class ModelBasedReflexAgent {
    constructor() { this.name = "Model-Based Reflex"; this.key = "model_based"; this.state = {}; }
    reset() { this.state = {}; }
    updateState(p) {
      const rain = rainMinutes(p);
      this.state = {
        rain_minutes: rain,
        A_blocked: p.closed.A || p.traffic.A === "heavy",
        B_flooded: rain >= FLOOD_RAIN_MIN,
        B_blocked: p.closed.B || p.traffic.B === "heavy",
      };
    }
    decide(p) {
      this.updateState(p);
      const s = this.state;
      const why = ["Internal state: raining for " + s.rain_minutes + " min, A blocked=" + pyBool(s.A_blocked) +
                   ", underpass flooded (believed)=" + pyBool(s.B_flooded) + "."];
      let route;
      if (!s.A_blocked) { route = "A"; why.push("Rule: main road is fine -> take A."); }
      else if (!s.B_flooded && !s.B_blocked) { route = "B"; why.push("Rule: A blocked and canal road believed dry -> take B."); }
      else { route = "C"; why.push("Rule: A blocked and underpass believed flooded -> take C."); }
      return [route, why];
    }
  }

  class GoalBasedAgent {
    constructor() { this.name = "Goal-Based"; this.key = "goal_based"; }
    reset() {}
    search(p) {
      const graph = {};
      for (const [a, b, km, route] of EDGES) {
        if (p.closed[route]) continue;
        (graph[a] = graph[a] || []).push([b, km, route]);
      }
      // uniform-cost search (tiny graph: a sorted array is the priority queue)
      const frontier = [[0, "CHZ", [], null]];
      const seen = new Set();
      while (frontier.length) {
        frontier.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
        const [cost, node, path, route] = frontier.shift();
        if (node === "UCP") return [route, path, round(cost, 2)];
        if (seen.has(node)) continue;
        seen.add(node);
        for (const [nxt, km, r] of graph[node] || [])
          if (!seen.has(nxt)) frontier.push([cost + km, nxt, path.concat([nxt]), r]);
      }
      return [null, [], null];
    }
    decide(p) {
      const [route, path, km] = this.search(p);
      const closed = ROUTE_IDS.filter((r) => p.closed[r]);
      return [route, [
        "Goal: reach UCP. Closed roads removed from the map: " + (closed.length ? closed.join(", ") : "none") + ".",
        "Uniform-cost search found CHZ -> " + path.join(" -> ") + " (" + f2(km) + " km) on route " + route + ".",
        "Traffic and weather are not part of the goal test, so they are ignored.",
      ]];
    }
  }

  class UtilityBasedAgent {
    constructor() { this.name = "Utility-Based"; this.key = "utility_based";
                    this.W_ON_TIME = 100; this.W_TIME = 2; this.W_RISK = 15; }
    reset() {}
    static floodProbability(rain) { if (rain === 0) return 0; return rain >= FLOOD_RAIN_MIN ? 0.85 : 0.30; }
    outcomes(route, p) {
      let t = baseMinutes(route);
      if (p.traffic[route] === "heavy") t += ROUTES[route].jam_delay;
      const pf = ROUTES[route].flood_delay ? UtilityBasedAgent.floodProbability(rainMinutes(p)) : 0;
      if (pf === 0) return [[[1, round(t, 1)]], 0];
      return [[[1 - pf, round(t, 1)], [pf, round(t + ROUTES[route].flood_delay, 1)]], pf];
    }
    utility(route, p) {
      const [outs, risk] = this.outcomes(route, p);
      const expected = outs.reduce((s, [pr, t]) => s + pr * t, 0);
      const pOnTime = outs.reduce((s, [pr, t]) => s + (t <= p.deadline ? pr : 0), 0);
      const u = this.W_ON_TIME * pOnTime - this.W_TIME * expected - this.W_RISK * risk;
      return [round(u, 2), round(expected, 2), round(pOnTime, 2)];
    }
    decide(p) {
      const why = ["U = 100*P(on time) - 2*E[minutes] - 15*P(flood)"];
      let best = null, bestU = null;
      for (const r of openRoutes(p)) {
        const [u, e, pot] = this.utility(r, p);
        why.push("Route " + r + ": E[t]=" + f1(e) + " min, P(on time)=" + f2(pot) + ", U=" + f1(u));
        if (bestU === null || u > bestU) { best = r; bestU = u; }
      }
      why.push("Highest utility -> route " + best + ".");
      return [best, why];
    }
  }

  class LearningAgent {
    constructor() { this.name = "Learning"; this.key = "learning"; this.q = {}; this.n = {}; this.trained = false; }
    reset() {}
    static context(p) { if (p.weather === "rain") return "rain"; return isRush(p.time) ? "rush" : "normal"; }
    train() {
      const noise = new Noise(42);
      this.q = {}; this.n = {};
      for (let round_ = 0; round_ < 3; round_++)
        for (const day of TRAINING_DAYS) {
          const ctx = day.weather === "rain" ? "rain" : (isRush(day.time) ? "rush" : "normal");
          for (const r of ROUTE_IDS) {
            const t = tripMinutes(r, day.state);
            if (t === null) continue;
            const reward = -(t + noise.minutes(1.0));
            const k = ctx + "|" + r;
            this.n[k] = (this.n[k] || 0) + 1;
            const old = this.q[k] || 0;
            this.q[k] = old + (reward - old) / this.n[k];
          }
        }
      this.trained = true;
    }
    decide(p) {
      if (!this.trained) this.train();
      const ctx = LearningAgent.context(p);
      const trips = Object.values(this.n).reduce((a, b) => a + b, 0);
      const why = ["Context recognised: " + ctx + ". Learned from " + trips + " training trips."];
      let best = null, bestQ = null;
      for (const r of openRoutes(p)) {
        const q = this.q[ctx + "|" + r];
        if (q === undefined) continue;
        why.push("Q(" + ctx + ", " + r + ") = " + f1(q) + "  (about " + f1(-q) + " min)");
        if (bestQ === null || q > bestQ) { best = r; bestQ = q; }
      }
      why.push("Exploit best learned value -> route " + best + ".");
      return [best, why];
    }
  }

  class HierarchicalAgent {
    constructor() { this.name = "Hierarchical"; this.key = "hierarchical"; }
    reset() {}
    strategic(p) {
      return { deadline: p.deadline, priority: p.priority, avoid_congestion: true,
               avoid_flood_prone: rainMinutes(p) >= FLOOD_RAIN_MIN, wet: p.weather === "rain" };
    }
    tactical(p, sub) {
      let cands = openRoutes(p).filter((r) =>
        !(sub.avoid_congestion && p.traffic[r] === "heavy") &&
        !(sub.avoid_flood_prone && ROUTES[r].flood_delay > 0) &&
        !(baseMinutes(r) > sub.deadline));
      if (!cands.length) cands = openRoutes(p);
      let best = cands[0];
      for (const r of cands) if (baseMinutes(r) < baseMinutes(best)) best = r;
      return [best, cands];
    }
    operational(route, sub) {
      const speed = ROUTES[route].speed_kmh * (sub.wet ? 0.8 : 1.0);
      return "limit speed to " + Math.round(speed) + " km/h on wet patches, stop at red signals, keep the food box level";
    }
    decide(p) {
      const sub = this.strategic(p);
      const [route, cands] = this.tactical(p, sub);
      return [route, [
        "Strategic layer, subgoals: arrive within " + Math.round(sub.deadline) + " min (" + sub.priority +
          " order), avoid congestion, " + (sub.avoid_flood_prone ? "avoid flood-prone roads" : "flood risk low") + ".",
        "Tactical layer: routes meeting the subgoals: " + cands.join(", ") + "; fastest is " + route + ".",
        "Operational layer: " + this.operational(route, sub) + ".",
      ]];
    }
  }

  class ContextualAgent {
    constructor() { this.name = "Contextual"; this.key = "contextual"; }
    reset() {}
    static classify(p) {
      if (p.weather === "rain") return "monsoon";
      if (isRush(p.time) || p.traffic.A === "heavy") return "rush hour";
      return "normal";
    }
    decide(p) {
      const POLICIES = { "normal": ["A", "B", "C"], "rush hour": ["B", "C", "A"], "monsoon": ["C", "A", "B"] };
      const ctx = ContextualAgent.classify(p);
      const order = POLICIES[ctx];
      const route = order.find((r) => !p.closed[r]);
      return [route, [
        "Context: " + ctx + " (time " + p.time + ", weather " + p.weather + ").",
        "Policy for " + ctx + ": preference " + order.join(" > ") + ".",
        "First open route in the policy -> " + route + ".",
      ]];
    }
  }

  const ALL_AGENTS = [SimpleReflexAgent, ModelBasedReflexAgent, GoalBasedAgent,
    UtilityBasedAgent, LearningAgent, HierarchicalAgent, ContextualAgent];

  /** Run every agent on every scenario; same shape as results/results.json. */
  function runAll(scenarios) {
    return ALL_AGENTS.map((Cls) => {
      const agent = new Cls();
      const tests = (scenarios || SCENARIOS).map((sc) => {
        agent.reset();
        const [route, why] = agent.decide(makePercept(sc));
        const o = execute(route, sc);
        return { test: sc.id, route, minutes: o.minutes, on_time: o.on_time, note: o.note, reasoning: why };
      });
      return { agent: agent.name, key: agent.key, tests };
    });
  }

  const api = { RESTAURANT, CUSTOMER, DEADLINE_MIN, URGENT_DEADLINE_MIN, deadlineOf, FLOOD_RAIN_MIN, NODES, EDGES, ROUTES, ROUTE_IDS,
    SCENARIOS, TRAINING_DAYS, routeKm, baseMinutes, makePercept, rainMinutes, tripMinutes, execute,
    isRush, toClock, fromClock, ALL_AGENTS, runAll };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DeliveryModel = api;
})(this);
