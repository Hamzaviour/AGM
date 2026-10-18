/*
 * Simulation controller: scene setup, scenario visuals, agent decisions
 * (from model.js), rider animation, HUD, race mode, minimap and cameras.
 */
(function () {
  "use strict";
  const DM = window.DeliveryModel;
  const SEC_PER_MIN = 2;                       // 1 simulated minute = 2 s at 1x
  const $ = (id) => document.getElementById(id);

  const AGENT_INFO = {
    simple_reflex: "Condition-action rules on the current percept only. No memory, no model.",
    model_based: "Rules plus an internal state built from earlier percepts (how long it has been raining).",
    goal_based: "Searches the road map for the shortest path that reaches UCP. Ignores traffic and weather.",
    utility_based: "Weighs on-time probability, expected minutes and flood risk; picks the highest expected utility.",
    learning: "Learned how long each route takes in each context from 54 training trips (Q-values).",
    hierarchical: "Strategic layer sets constraints, tactical layer picks the route, operational layer rides.",
    contextual: "Recognises the context (normal, rush hour, monsoon) and switches to that context's policy.",
  };
  const RACE_COLORS = [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0xe21b70, 0x6a4c93, 0x00c2c7];
  const hex = (c) => "#" + c.toString(16).padStart(6, "0");

  // ------------------------------------------------------------ renderer
  const canvas = $("scene");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch (e) {
    $("nogl").hidden = false;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x5d6a3c, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 10, far: 600 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const W = World.build(scene);
  const paths = {};
  for (const r of DM.ROUTE_IDS) paths[r] = new World.Path(World.ROUTE_PATHS[r], 0);

  // closure barriers for custom situations on B and C
  const barriers = { B: World.makeBarrier("ROAD CLOSED"), C: World.makeBarrier("ROAD CLOSED") };
  barriers.B.position.set(-138, 0, -28); barriers.B.rotation.y = -1.15;
  barriers.C.position.set(-150, 0, 22); barriers.C.rotation.y = Math.PI / 2;
  for (const b of Object.values(barriers)) { b.visible = false; scene.add(b); }

  // ------------------------------------------------------------- state
  const S = {
    scenario: null, agentIdx: 0, race: false, speed: 1, cam: "chase",
    phase: "idle",        // idle | thinking | riding | done
    riders: [],           // {mesh, route, timeline, outcome, agent, color, ...}
    follow: 0, simMin: 0, thinkT: 0, reasonQueue: [], lightning: 0,
  };

  // --------------------------------------------------------- scenarios
  function customScenario() {
    const time = $("cTime").value, rain = +$("cRain").value;
    const st = (r) => ({ traffic: $("c" + r + "jam").checked ? "heavy" : "light",
      closed: $("c" + r + "closed").checked, flooded: r === "B" && $("cBflood").checked });
    return {
      id: "custom", title: "Custom situation",
      story: "Your own mix of time, rain, jams, closures and flooding.",
      order_time: time, weather: rain ? "rain" : "clear",
      rain_since: rain ? DM.toClock(DM.fromClock(time) - rain) : null,
      state: { A: st("A"), B: st("B"), C: st("C") },
    };
  }
  function currentScenario() {
    const v = $("scenario").value;
    return v === "custom" ? customScenario() : DM.SCENARIOS.find((s) => String(s.id) === v);
  }

  // ------------------------------------------------------- environment
  function skyTexture(top, bottom) {
    const c = document.createElement("canvas");
    c.width = 2; c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top); grad.addColorStop(1, bottom);
    g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function applyEnvironment(sc) {
    const t = DM.fromClock(sc.order_time);
    const rain = sc.weather === "rain";
    const evening = t >= 17 * 60 && t < 19 * 60 + 30;
    const night = t >= 19 * 60 + 30 || t < 6 * 60;
    let top, bottom, fog, sunCol, sunI, hemiI, sunPos;
    if (night) { top = "#05070f"; bottom = "#1b2238"; fog = 0x121726; sunCol = 0x8fa8ff; sunI = 0.25; hemiI = 0.25; sunPos = [80, 160, 60]; }
    else if (evening) { top = "#33406b"; bottom = "#f79d5c"; fog = 0xd99a72; sunCol = 0xffb070; sunI = 1.3; hemiI = 0.45; sunPos = [-260, 60, -40]; }
    else { top = "#4f8fdc"; bottom = "#cfe4f5"; fog = 0xcfe0ee; sunCol = 0xfff4e0; sunI = 1.8; hemiI = 0.65; sunPos = [120, 220, 80]; }
    if (rain) { top = night ? "#05070c" : "#4a525d"; bottom = night ? "#141821" : "#8e98a3"; fog = night ? 0x111419 : 0x8a939c; sunI *= 0.35; hemiI *= 0.9; }
    scene.background = skyTexture(top, bottom);
    scene.fog = new THREE.Fog(fog, rain ? 70 : 140, rain ? 330 : 560);
    S.fogNear = scene.fog.near; S.fogFar = scene.fog.far;
    sun.color.setHex(sunCol); sun.intensity = sunI; hemi.intensity = hemiI;
    S.sunOffset = new THREE.Vector3(...sunPos);
    renderer.toneMappingExposure = night ? 1.1 : rain ? 0.95 : 1.0;
    const lampsOn = night || evening || rain;
    for (const l of W.lamps) { l.material.emissive.setHex(lampsOn ? 0xffd27a : 0x000000); l.material.emissiveIntensity = 1.2; }
    for (const m of W.materials.signs || []) { m.emissive.copy(m.color); m.emissiveIntensity = lampsOn ? 0.45 : 0; }
    W.materials.road.roughness = rain ? 0.35 : 0.92;
    W.materials.road.metalness = rain ? 0.25 : 0;
    W.materials.road.color.setHex(rain ? 0xb8bcc4 : 0xffffff);
    W.rain.mesh.visible = rain;
    W.fallenTree.visible = sc.state.A.closed;
    W.flood.visible = sc.state.B.flooded;
    barriers.B.visible = sc.state.B.closed;
    barriers.C.visible = sc.state.C.closed;
    W.traffic.populate(sc.state);
    S.rain = rain;
  }

  // ---------------------------------------------------------- timeline
  /** Spread the model's trip time along the route: base time by distance,
      jam and flood delays inside their hazard zones. Total = model minutes. */
  function buildTimeline(route, sc) {
    const path = paths[route];
    const st = sc.state[route];
    const base = DM.baseMinutes(route);
    const kmPerUnit = DM.routeKm(route) / path.length;
    const zones = World.ZONES[route];
    const step = 0.5, n = Math.ceil(path.length / step);
    const p = new THREE.Vector3();
    const segs = [];
    let jamLen = 0, floodLen = 0;
    for (let i = 0; i < n; i++) {
      const s0 = i * step, s1 = Math.min(path.length, s0 + step);
      path.at((s0 + s1) / 2, p);
      const jam = st.traffic === "heavy" && zones.jam(p.x, p.z);
      const flood = st.flooded && zones.flood(p.x, p.z);
      if (jam) jamLen += s1 - s0;
      if (flood) floodLen += s1 - s0;
      segs.push({ s0, s1, jam, flood });
    }
    const jamD = st.traffic === "heavy" ? DM.ROUTES[route].jam_delay : 0;
    const floodD = st.flooded ? DM.ROUTES[route].flood_delay : 0;
    const T = [0], Sx = [0], kind = [];
    for (const g of segs) {
      const len = g.s1 - g.s0;
      let m = base * len / path.length;
      if (g.jam) m += jamD * len / jamLen;
      if (g.flood) m += floodD * len / floodLen;
      T.push(T[T.length - 1] + m); Sx.push(g.s1);
      kind.push(g.flood ? "flood" : g.jam ? "jam" : "free");
    }
    return { T, S: Sx, kind, total: T[T.length - 1], kmPerUnit, path };
  }
  function sampleTimeline(tl, m) {
    if (m <= 0) return { s: 0, i: 0 };
    if (m >= tl.total) return { s: tl.path.length, i: tl.kind.length - 1 };
    let lo = 0, hi = tl.T.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tl.T[mid] <= m) lo = mid; else hi = mid; }
    const f = (m - tl.T[lo]) / (tl.T[hi] - tl.T[lo]);
    return { s: tl.S[lo] + (tl.S[hi] - tl.S[lo]) * f, i: lo };
  }

  function roadName(route, x, z) {
    if (Math.abs(x - World.CHZ_DOOR[0]) < 14 && z < -4) return "Leaving Cheezious";
    if (Math.abs(x - World.UCP_GATE[0]) < 14 && z < -4) return "UCP main gate";
    if (Math.abs(z) < 3) return "Khayaban-e-Jinnah Road";
    if (route === "B") return z < -60 ? (x > 15 && x < 65 ? "Canal underpass" : "Canal Bank Road") : "Link road to Canal Bank Road";
    if (route === "C") return z > 90 ? "Maulana Shaukat Ali Road" : "Johar Town inner streets (Block G)";
    return DM.ROUTES[route].name;
  }

  // ------------------------------------------------------------ riders
  function clearRiders() {
    for (const r of S.riders) { scene.remove(r.mesh); if (r.tag) scene.remove(r.tag); if (r.bag) scene.remove(r.bag); }
    S.riders = [];
  }
  function placeAtDoor(mesh, k) {
    mesh.position.set(World.CHZ_DOOR[0] + (k || 0) * 2.2 - 6, 0, World.CHZ_DOOR[1]);
    mesh.rotation.y = 0;
  }
  function spawnRiders(sc) {
    clearRiders();
    const percept = DM.makePercept(sc);
    const agents = S.race ? DM.ALL_AGENTS.map((C) => new C()) : [new DM.ALL_AGENTS[S.agentIdx]()];
    const byRoute = {};
    agents.forEach((agent, k) => {
      agent.reset();
      const [route, why] = agent.decide(JSON.parse(JSON.stringify(percept)));
      const outcome = route ? DM.execute(route, sc) : { route: null, minutes: null, on_time: false, note: "no open route" };
      const color = S.race ? RACE_COLORS[k] : null;
      const mesh = World.makeRider(color);
      mesh.userData.cape.visible = sc.weather === "rain";
      placeAtDoor(mesh, S.race ? k : 3);
      scene.add(mesh);
      let tag = null;
      if (S.race) {
        tag = World.textSprite(agent.name, { scale: 0.06, accent: hex(color) });
        scene.add(tag);
      }
      const ok = route && outcome.minutes !== null;
      const rr = { agent, route, why, outcome, mesh, tag, color, idx: k,
        timeline: ok ? buildTimeline(route, sc) : null, arrived: false, s: 0, lean: 0, speed: 0 };
      if (ok) { byRoute[route] = byRoute[route] || []; byRoute[route].push(rr); }
      S.riders.push(rr);
    });
    // side-by-side offsets for riders sharing a route
    for (const list of Object.values(byRoute))
      list.forEach((r, j) => { r.spread = (j - (list.length - 1) / 2) * 1.3; });
  }

  const tmpP = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpL = new THREE.Vector3();
  function poseRider(r, dt) {
    const tl = r.timeline;
    const { s, i } = sampleTimeline(tl, S.simMin);
    const ds = s - r.s;
    r.s = s;
    const path = tl.path;
    path.at(s, tmpP);
    path.smoothDir(s, tmpD);
    // keep left; filter between lanes in a jam; fade the offset in/out near the ends
    const onMain = Math.abs(tmpP.z) < 3 && Math.abs(tmpP.x) < 172;
    const onCanal = Math.abs(tmpP.z + 70) < 1;
    const zoneKind = tl.kind[Math.min(i, tl.kind.length - 1)];
    const RL = World.RIDER_LANE;
    let lane = onMain ? (zoneKind === "jam" ? RL.jam : RL.main) : onCanal ? RL.canal : RL.street;
    lane += r.spread || 0;
    const fade = Math.min(1, s / 14, (path.length - s) / 14);
    tmpL.set(tmpD.z, 0, -tmpD.x).multiplyScalar(lane * Math.max(0, fade));
    r.mesh.position.set(tmpP.x + tmpL.x, 0, tmpP.z + tmpL.z);
    const yaw = Math.atan2(-tmpD.z, tmpD.x);
    // lean into turns
    const ahead = path.smoothDir(s + 6, new THREE.Vector3());
    const turn = Math.atan2(tmpD.x * ahead.z - tmpD.z * ahead.x, tmpD.x * ahead.x + tmpD.z * ahead.z);
    r.lean += (THREE.MathUtils.clamp(-turn * 0.9, -0.35, 0.35) - r.lean) * Math.min(1, dt * 4);
    r.mesh.rotation.set(0, yaw, 0);
    r.mesh.userData.bike.rotation.x = r.lean;
    // wading: bob in the flood
    r.mesh.userData.bike.position.y = zoneKind === "flood" ? Math.sin(performance.now() / 180 + r.idx) * 0.08 : 0;
    for (const w of r.mesh.userData.wheels) w.rotation.z -= ds / 0.45;
    // instantaneous speed in km/h from the timeline
    const segMin = tl.T[i + 1] - tl.T[i];
    const segKm = (tl.S[i + 1] - tl.S[i]) * tl.kmPerUnit;
    const kmh = segMin > 0 ? segKm / segMin * 60 : 0;
    r.speed += (kmh - r.speed) * Math.min(1, dt * 3);
    r.zone = zoneKind;
    if (r.tag) r.tag.position.set(r.mesh.position.x, S.cam === "top" ? 31 : 6.2, r.mesh.position.z);
    if (zoneKind === "flood" && S.speed > 0) splash(r.mesh.position);
  }

  // splashes in the flood
  const splashGeo = new THREE.SphereGeometry(0.12, 5, 4);
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xc9d6dc, transparent: true, opacity: 0.8 });
  const drops = [];
  function splash(pos) {
    if (drops.length > 160 || Math.random() > 0.5) return;
    const m = new THREE.Mesh(splashGeo, splashMat);
    m.position.set(pos.x + (Math.random() - 0.5), 1.0, pos.z + (Math.random() - 0.5));
    m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4);
    scene.add(m); drops.push(m);
  }
  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.userData.v.y -= 15 * dt;
      d.position.addScaledVector(d.userData.v, dt);
      if (d.position.y < 0.9) { scene.remove(d); drops.splice(i, 1); }
    }
  }

  // ----------------------------------------------------------- UI text
  function chip(text, cls) { return `<span class="chip ${cls || ""}">${text}</span>`; }
  function showPercept(sc) {
    const p = DM.makePercept(sc);
    const rainMin = DM.rainMinutes(p);
    const traffic = DM.ROUTE_IDS.map((r) => chip(r + " " + p.traffic[r], p.traffic[r])).join("");
    const closed = DM.ROUTE_IDS.filter((r) => p.closed[r]);
    const hist = p.history.map((h) => h.time + " " + (h.weather === "rain" ? "rain" : "clear")).join(", ");
    const hiddenFlood = sc.state.B.flooded
      ? "Hidden from the rider: the Canal underpass on route B is flooded (+14.1 min)."
      : "Hidden from the rider: the Canal underpass is dry.";
    $("percept").innerHTML = `<dl class="percept">
      <dt>Clock</dt><dd>${p.time}${DM.isRush(p.time) ? " " + chip("rush hour", "heavy") : ""}</dd>
      <dt>Weather</dt><dd>${p.weather === "rain" ? "Raining" + (rainMin ? ` (for ${rainMin} min)` : "") : "Clear"}</dd>
      <dt>Traffic app</dt><dd>${traffic}</dd>
      <dt>Closures</dt><dd>${closed.length ? closed.map((r) => chip(r + " closed", "closed")).join("") : "none seen"}</dd>
      <dt>Deadline</dt><dd>${p.deadline} min, by ${DM.toClock(DM.fromClock(p.time) + p.deadline)}</dd>
      <dt>Memory</dt><dd style="font-size:12px;color:var(--muted)">${hist}</dd>
      <div class="hidden-truth">${hiddenFlood}</div></dl>`;
  }
  function showStory(sc) {
    $("story").textContent = sc.story;
  }
  function setStatus(t) { $("hStatus").textContent = t; }
  function toast(text, ms) {
    const el = $("toast");
    el.textContent = text; el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, ms || 2600);
  }

  function renderRace() {
    const rows = S.riders.map((r, k) => {
      const o = r.outcome;
      let status;
      if (!r.timeline) status = '<span class="late">failed</span>';
      else if (r.arrived) status = `<span class="${o.on_time ? "ok" : "late"}">${o.minutes.toFixed(1)} min${o.on_time ? "" : " late"}</span>`;
      else if (S.phase === "riding") status = Math.round(Math.min(1, S.simMin / r.timeline.total) * 100) + "%";
      else status = "&ndash;";
      return `<tr data-i="${k}" class="${k === S.follow ? "sel" : ""}"><td><span class="sw" style="background:${hex(r.color)}"></span>${r.agent.name}</td>
        <td class="r${(r.route || "").toLowerCase()}">${r.route || "&ndash;"}</td><td>${status}</td></tr>`;
    }).join("");
    $("race").innerHTML = `<tr><th>Agent</th><th>Route</th><th>Result</th></tr>` + rows;
  }

  function showOutcome(r) {
    const o = r.outcome;
    const box = $("outcome");
    if (!r.timeline) {
      box.innerHTML = `<div class="outcome-card"><div class="badge late">&times;</div><div><b>Not delivered</b><p>${o.note}</p></div></div>`;
    } else {
      const arrive = DM.toClock(Math.round(DM.fromClock(S.scenario.order_time) + o.minutes));
      const diff = o.minutes - DM.DEADLINE_MIN;
      box.innerHTML = `<div class="outcome-card"><div class="badge ${o.on_time ? "ok" : "late"}">${o.on_time ? "&#10003;" : "!"}</div>
        <div><b>Route ${o.route} &middot; ${o.minutes.toFixed(1)} min &middot; ${o.on_time ? "on time" : "LATE by " + diff.toFixed(1) + " min"}</b>
        <p>Handed over at about ${arrive}. ${o.note.charAt(0).toUpperCase() + o.note.slice(1)}.</p></div></div>`;
    }
    $("outcomeBox").hidden = false;
  }

  // ------------------------------------------------------------- flow
  function resetSim() {
    S.scenario = currentScenario();
    S.race = $("agent").value === "race";
    S.agentIdx = S.race ? 0 : +$("agent").value;
    S.phase = "idle"; S.simMin = 0; S.follow = 0;
    applyEnvironment(S.scenario);
    showStory(S.scenario);
    showPercept(S.scenario);
    spawnRiders(S.scenario);
    $("reasoning").innerHTML = "";
    $("outcomeBox").hidden = true;
    $("raceBox").hidden = !S.race;
    if (S.race) renderRace();
    highlightRoutes(null);
    $("btnRun").disabled = false;
    $("btnRun").innerHTML = "&#9654; Run delivery";
    $("hClock").textContent = S.scenario.order_time;
    $("hDue").textContent = DM.toClock(DM.fromClock(S.scenario.order_time) + DM.DEADLINE_MIN);
    $("hElapsed").textContent = "0.0 min";
    $("hSpeed").textContent = "0 km/h";
    $("hRoad").textContent = "Waiting at Cheezious";
    $("hBar").style.width = "0"; $("hBar").classList.remove("late");
    setStatus(S.race ? "Seven riders wait at Cheezious. Press Run to send them all out at once."
                     : "Order #" + (4100 + (S.scenario.id === "custom" ? 9 : S.scenario.id)) + " is packed and waiting at Cheezious. Press Run delivery.");
    $("agentInfo").textContent = S.race ? "All seven agents decide on the same percept and ride at the same time."
      : AGENT_INFO[new DM.ALL_AGENTS[S.agentIdx]().key];
    updateDeadlineMarker();
  }

  function updateDeadlineMarker() {
    const maxMin = Math.max(DM.DEADLINE_MIN + 6, ...S.riders.filter((r) => r.timeline).map((r) => r.timeline.total + 1));
    S.scaleMax = maxMin;
    $("hDeadline").style.left = (DM.DEADLINE_MIN / maxMin * 100) + "%";
  }

  function highlightRoutes(route) {
    for (const r of DM.ROUTE_IDS) {
      const o = W.overlays[r];
      const used = route === null || (Array.isArray(route) ? route.includes(r) : route === r);
      o.mat.opacity = used ? (route === null ? 0.5 : 0.85) : 0.12;
    }
  }

  function run() {
    if (S.phase === "riding" || S.phase === "thinking") return;
    if (S.phase === "done") resetSim();
    S.phase = "thinking"; S.thinkT = 0;
    if (window.innerWidth < 760 && !$("controls").classList.contains("collapsed")) $("controls").querySelector(".collapse").click();
    $("btnRun").disabled = true;
    $("btnRun").textContent = S.race ? "Racing…" : "Delivering…";
    const lead = S.riders[0];
    const lines = S.race
      ? S.riders.map((r) => `${r.agent.name}: route ${r.route || "none"}. ${r.why[r.why.length - 1]}`)
      : lead.why.slice();
    S.reasonQueue = lines.map((t, k) => ({ t, final: !S.race && k === lines.length - 1 }));
    $("reasoning").innerHTML = "";
    setStatus(S.race ? "All agents are reading the percept…" : lead.agent.name + " agent is thinking…");
  }

  function startRiding() {
    S.phase = "riding"; S.simMin = 0;
    const routes = [...new Set(S.riders.filter((r) => r.timeline).map((r) => r.route))];
    highlightRoutes(routes);
    if (!S.race) {
      const r = S.riders[0];
      if (!r.timeline) {
        S.phase = "done";
        showOutcome(r);
        setStatus("No open route: the order cannot be delivered.");
        $("btnRun").disabled = false; $("btnRun").innerHTML = "&#8635; Run again";
        return;
      }
      toast(`${r.agent.name} chose route ${r.route}: ${DM.ROUTES[r.route].name}`);
    } else {
      toast("Race started: 7 riders leave Cheezious");
      if (S.cam === "chase") setCam("top");
    }
  }

  function finish() {
    S.phase = "done";
    $("btnRun").disabled = false;
    $("btnRun").innerHTML = "&#8635; Run again";
    if (!S.race) {
      const r = S.riders[0];
      showOutcome(r);
      setStatus(r.outcome.on_time ? "Delivered on time. The customer rates the rider 5 stars."
                                  : `Delivered late (${r.outcome.minutes.toFixed(1)} min). The customer is not happy.`);
    } else {
      const ok = S.riders.filter((r) => r.outcome.on_time).length;
      setStatus(`Race finished: ${ok} of 7 agents delivered on time.`);
      renderRace();
    }
  }

  // hand-over bag animation
  function handOver(r) {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.4), new THREE.MeshStandardMaterial({ color: 0xffc20e }));
    bag.position.copy(r.mesh.position).add(new THREE.Vector3(0, 2.2, 0));
    bag.userData = { t: 0, from: bag.position.clone(), to: W.customer.position.clone().add(new THREE.Vector3(0, 1.6, 0)) };
    scene.add(bag);
    r.bag = bag;
  }
  function updateBags(dt) {
    for (const r of S.riders) if (r.bag && r.bag.userData.t < 1) {
      const u = r.bag.userData;
      u.t = Math.min(1, u.t + dt * 0.8);
      r.bag.position.lerpVectors(u.from, u.to, u.t);
      r.bag.position.y += Math.sin(u.t * Math.PI) * 2;
    }
  }

  // ------------------------------------------------------------ camera
  const orbit = { theta: -0.9, phi: 0.95, radius: 90, target: new THREE.Vector3(), dragging: false };
  function setCam(mode) {
    S.cam = mode;
    for (const b of $("camSeg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.cam === mode);
  }
  const camPos = new THREE.Vector3(-230, 60, 60), camLook = new THREE.Vector3(-185, 0, -13);
  function updateCamera(dt) {
    const r = S.riders[S.follow] || S.riders[0];
    const focus = r ? r.mesh.position : new THREE.Vector3(World.CHZ_DOOR[0], 0, World.CHZ_DOOR[1]);
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    if (S.cam === "chase") {
      const yaw = r ? r.mesh.rotation.y : 0;
      const fwd = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const idle = S.phase === "idle" || S.phase === "thinking";
      if (idle) {
        // establishing shot: Cheezious, the rider and the road towards UCP
        wantPos.set(focus.x - 14, 15, focus.z + 34);
        wantLook.set(focus.x + 24, 2, focus.z - 6);
      } else {
        wantPos.copy(focus).addScaledVector(fwd, -15).add(new THREE.Vector3(0, 7.5, 0));
        wantLook.copy(focus).addScaledVector(fwd, 10).add(new THREE.Vector3(0, 1.5, 0));
      }
    } else if (S.cam === "top") {
      wantPos.set(0, 300, 175); wantLook.set(0, 0, 5);
      wantPos.y = window.innerWidth < 760 ? 520 : 300;
    } else {
      orbit.target.lerp(S.phase === "idle" ? new THREE.Vector3(0, 0, 0) : focus, Math.min(1, dt * 3));
      wantLook.copy(orbit.target);
      wantPos.set(
        orbit.target.x + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
        orbit.target.y + orbit.radius * Math.cos(orbit.phi),
        orbit.target.z + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta));
      camPos.copy(wantPos); camLook.copy(wantLook);
    }
    const k = S.snapCam ? 1 : Math.min(1, dt * (S.cam === "chase" ? 3.2 : 2));
    S.snapCam = false;
    camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (scene.fog) {
      // the map view looks from high up: push the fog back so the routes stay visible
      scene.fog.near = S.cam === "top" ? 500 : S.fogNear;
      scene.fog.far = S.cam === "top" ? 1100 : S.fogFar;
    }
    // shadows follow the camera focus
    const c = S.cam === "top" ? new THREE.Vector3(0, 0, 0) : camLook;
    sun.target.position.copy(c);
    sun.position.copy(c).add(S.sunOffset || new THREE.Vector3(120, 220, 80));
    const half = S.cam === "top" ? 260 : 110;
    if (sun.shadow.camera.right !== half) {
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
      sun.shadow.camera.updateProjectionMatrix();
    }
  }

  // pointer orbit (drag) + zoom (wheel / pinch)
  const pointers = new Map();
  let pinch0 = 0;
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (S.cam !== "orbit") {
      // grabbing the scene switches to orbit, starting from the current view
      const off = camera.position.clone().sub(camLook);
      orbit.radius = THREE.MathUtils.clamp(off.length(), 15, 420);
      orbit.phi = Math.acos(THREE.MathUtils.clamp(off.y / off.length(), -1, 1));
      orbit.theta = Math.atan2(off.z, off.x);
      orbit.target.copy(camLook);
      setCam("orbit");
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      orbit.theta += (cur.x - prev.x) * 0.006;
      orbit.phi = THREE.MathUtils.clamp(orbit.phi - (cur.y - prev.y) * 0.005, 0.15, 1.45);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0) orbit.radius = THREE.MathUtils.clamp(orbit.radius * pinch0 / d, 15, 420);
      pinch0 = d;
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = 0; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (S.cam !== "orbit") canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 99 })), up({ pointerId: 99 });
    orbit.radius = THREE.MathUtils.clamp(orbit.radius * (1 + Math.sign(e.deltaY) * 0.1), 15, 420);
  }, { passive: false });

  // ----------------------------------------------------------- minimap
  const mm = $("minimap"), mg = mm.getContext("2d");
  const MB = { x0: -265, x1: 265, z0: -125, z1: 140 };
  function mmXY(x, z) {
    const w = mm.width, h = mm.height;
    return [(x - MB.x0) / (MB.x1 - MB.x0) * w, (z - MB.z0) / (MB.z1 - MB.z0) * h];
  }
  function drawMinimap() {
    const w = mm.width, h = mm.height;
    mg.clearRect(0, 0, w, h);
    mg.fillStyle = "#2c4a5a"; const [, cz] = mmXY(0, -86); mg.fillRect(0, cz - 3, w, 6);
    mg.lineCap = "round"; mg.lineJoin = "round";
    for (const [pts, width] of World.ROADS) {
      mg.strokeStyle = "#4b5160"; mg.lineWidth = Math.max(2, width / 4);
      mg.beginPath();
      pts.forEach((p, i) => { const [x, y] = mmXY(p[0], p[1]); i ? mg.lineTo(x, y) : mg.moveTo(x, y); });
      mg.stroke();
    }
    for (const r of DM.ROUTE_IDS) {
      const used = S.phase === "idle" || S.riders.some((q) => q.route === r);
      mg.strokeStyle = hex(World.ROUTE_COLORS[r]); mg.globalAlpha = used ? 0.95 : 0.25; mg.lineWidth = 3;
      mg.beginPath();
      World.ROUTE_PATHS[r].forEach((p, i) => { const [x, y] = mmXY(p[0], p[1]); i ? mg.lineTo(x, y) : mg.moveTo(x, y); });
      mg.stroke();
      mg.globalAlpha = 1;
    }
    const mark = (x, z, col, label) => {
      const [px, py] = mmXY(x, z);
      mg.fillStyle = col; mg.beginPath(); mg.arc(px, py, 5, 0, Math.PI * 2); mg.fill();
      mg.fillStyle = "#fff"; mg.font = "bold 10px Segoe UI, Arial"; mg.fillText(label, px - 18, py - 8);
    };
    mark(World.CHZ_DOOR[0], World.CHZ_DOOR[1], "#ffc20e", "Cheezious");
    mark(World.UCP_GATE[0], World.UCP_GATE[1], "#e21b70", "UCP");
    if (S.scenario && S.scenario.state.A.closed) { const [x, y] = mmXY(-128, 0); mg.fillStyle = "#ff4d4d"; mg.fillRect(x - 3, y - 6, 6, 12); }
    if (S.scenario && S.scenario.state.B.flooded) { const [x, y] = mmXY(40, -70); mg.fillStyle = "#4fa3ff"; mg.beginPath(); mg.arc(x, y, 6, 0, 7); mg.fill(); }
    if (S.scenario && S.scenario.state.A.traffic === "heavy") { const [x, y] = mmXY(-55, 0); mg.fillStyle = "rgba(255,80,80,.8)"; mg.fillRect(x - 28, y - 3, 60, 6); }
    mg.font = "bold 10px Segoe UI, Arial";
    [["A", -60, 12], ["B", -40, -60], ["C", 0, 110]].forEach(([t, x, z]) => {
      const [px, py] = mmXY(x, z); mg.fillStyle = hex(World.ROUTE_COLORS[t]); mg.fillText(t, px, py);
    });
    for (const r of S.riders) {
      const [px, py] = mmXY(r.mesh.position.x, r.mesh.position.z);
      mg.fillStyle = r.color ? hex(r.color) : "#e21b70";
      mg.strokeStyle = "#fff"; mg.lineWidth = 1.5;
      mg.beginPath(); mg.arc(px, py, 4, 0, Math.PI * 2); mg.fill(); mg.stroke();
    }
  }

  // ------------------------------------------------------------ results
  function buildResultsTable() {
    const rows = DM.runAll();
    const cell = (t) => `<span class="r${t.route.toLowerCase()}">${t.route}</span> ${t.minutes.toFixed(1)}${t.on_time ? "" : ' <span class="late">(late)</span>'}`;
    let html = `<table class="results"><tr><th>Agent</th><th>Test 1</th><th>Test 2</th><th>Test 3</th><th>On time</th><th>Total min</th></tr>`;
    for (const r of rows) {
      const onTime = r.tests.filter((t) => t.on_time).length;
      const total = r.tests.reduce((s, t) => s + t.minutes, 0);
      html += `<tr class="${r.key === "utility_based" ? "best" : ""}"><td>${r.agent}</td>${r.tests.map((t) => `<td>${cell(t)}</td>`).join("")}<td>${onTime}/3</td><td>${total.toFixed(1)}</td></tr>`;
    }
    html += `</table><p class="hint">Highlighted: the Utility-Based agent, chosen as most suitable in the report (Section 7).</p>`;
    $("tableWrap").innerHTML = html;
  }

  // -------------------------------------------------------------- loop
  let last = performance.now(), signalT = 0, flagT = 0;
  const tmpW = new THREE.Vector3();
  const fadeLabels = W.labels.slice();
  for (const g of [W.fallenTree, W.flood, barriers.B, barriers.C])
    g.traverse((o) => { if (o.isSprite) fadeLabels.push(o); });
  const flagPos = W.materials.flag.geometry.attributes.position;
  const flagBase = flagPos.array.slice();
  function frame(now) {
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dt = realDt * (S.phase === "riding" ? S.speed : 1);

    // traffic signal cycle at Jinnah chowk
    signalT = (signalT + dt) % 16;
    const phase = signalT < 8 ? "ew" : signalT < 9.5 ? "amber" : signalT < 15 ? "ns" : "amber2";
    for (const h of W.signals) {
      const green = h.axis === "ns" ? phase === "ew" : phase === "ns";
      const amber = phase.startsWith("amber");
      h.lights[0].emissiveIntensity = !green && !amber ? 2.2 : 0.05;
      h.lights[1].emissiveIntensity = amber ? 2.2 : 0.05;
      h.lights[2].emissiveIntensity = green && !amber ? 2.2 : 0.05;
    }
    W.traffic.update(dt, phase === "ew" ? "ew" : phase === "ns" ? "ns" : "none");
    W.rain.update(realDt, camLook);
    updateDrops(realDt);
    updateBags(realDt);

    // flood ripples
    if (W.flood.visible) for (const r of W.flood.userData.ripples) {
      r.userData.t = (r.userData.t + realDt * 0.9) % 1;
      r.scale.setScalar(0.5 + r.userData.t * 3);
      r.material.opacity = 0.7 * (1 - r.userData.t);
    }
    // flag wave
    flagT += realDt;
    for (let i = 0; i < flagPos.count; i++) {
      const x = flagBase[i * 3];
      flagPos.array[i * 3 + 2] = flagBase[i * 3 + 2] + Math.sin(flagT * 4 + x * 1.5) * 0.25 * (x + 2.5) / 5;
    }
    flagPos.needsUpdate = true;

    // lightning in rain
    if (S.rain) {
      if (Math.random() < realDt * 0.06) S.lightning = 0.25;
      S.lightning = Math.max(0, S.lightning - realDt);
      hemi.intensity = (S.baseHemi = S.baseHemi || hemi.intensity) + (S.lightning > 0.12 ? 1.6 : 0);
    } else if (S.baseHemi) { hemi.intensity = S.baseHemi; S.baseHemi = 0; }

    if (S.phase === "thinking") {
      S.thinkT += realDt;
      const per = S.race ? 0.45 : 0.9;
      const shown = $("reasoning").children.length;
      if (S.reasonQueue.length && S.thinkT > per * (shown + 1)) {
        const item = S.reasonQueue.shift();
        const li = document.createElement("li");
        li.textContent = item.t;
        if (item.final) li.classList.add("final");
        $("reasoning").appendChild(li);
        requestAnimationFrame(() => li.classList.add("show"));
      }
      if (!S.reasonQueue.length && S.thinkT > per * (shown + 1) + 0.6) startRiding();
    }

    if (S.phase === "riding") {
      S.simMin += dt / SEC_PER_MIN;
      let allDone = true;
      for (const r of S.riders) {
        if (!r.timeline) continue;
        poseRider(r, realDt);
        if (!r.arrived && S.simMin >= r.timeline.total) {
          r.arrived = true;
          handOver(r);
          if (S.race) { renderRace(); toast(`${r.agent.name} delivered in ${r.outcome.minutes.toFixed(1)} min`, 1800); }
        }
        if (!r.arrived) allDone = false;
      }
      const f = S.riders[S.follow] || S.riders[0];
      const shownMin = f && f.timeline ? Math.min(S.simMin, f.timeline.total) : S.simMin;
      $("hClock").textContent = DM.toClock(Math.floor(DM.fromClock(S.scenario.order_time) + shownMin));
      $("hElapsed").textContent = shownMin.toFixed(1) + " min";
      if (f && f.timeline) {
        $("hSpeed").textContent = (f.arrived ? 0 : Math.round(f.speed)) + " km/h";
        $("hRoad").textContent = (S.race ? f.agent.name + " · " : "") +
          (f.arrived ? "Delivered at UCP gate" : roadName(f.route, f.mesh.position.x, f.mesh.position.z));
        if (!f.arrived) {
          setStatus(f.zone === "jam" ? "Crawling through the jam at Jinnah signal chowk…"
            : f.zone === "flood" ? "Underpass flooded! Pushing the bike through knee-deep water…"
            : shownMin > DM.DEADLINE_MIN ? "Past the 20-minute deadline…"
            : S.race ? "Riders on the road. Click a row in the race table to follow that rider."
            : "Riding route " + f.route + " · " + DM.ROUTES[f.route].name);
        }
      }
      $("hBar").style.width = Math.min(100, shownMin / S.scaleMax * 100) + "%";
      $("hBar").classList.toggle("late", shownMin > DM.DEADLINE_MIN);
      if (S.race && Math.floor(S.simMin * 2) !== S.lastRaceTick) { S.lastRaceTick = Math.floor(S.simMin * 2); renderRace(); }
      if (allDone && S.riders.every((r) => !r.bag || r.bag.userData.t >= 1)) finish();
    }

    updateCamera(realDt);
    // labels fade out when the camera gets close, so they never cover the view
    for (const l of fadeLabels) {
      const d = l.getWorldPosition(tmpW).distanceTo(camera.position);
      l.material.opacity = THREE.MathUtils.clamp((d - 30) / 60, 0, 1);
    }
    drawMinimap();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 760 ? 68 : 55;
    camera.updateProjectionMatrix();
  }

  // ----------------------------------------------------------- wiring
  const agentSel = $("agent");
  DM.ALL_AGENTS.forEach((C, i) => {
    const o = document.createElement("option");
    o.value = i; o.textContent = new C().name + " agent";
    agentSel.appendChild(o);
  });
  const raceOpt = document.createElement("option");
  raceOpt.value = "race"; raceOpt.textContent = "All agents (race)";
  agentSel.appendChild(raceOpt);
  agentSel.value = "3";

  $("scenario").addEventListener("change", () => {
    $("customBox").hidden = $("scenario").value !== "custom";
    resetSim();
  });
  $("customBox").addEventListener("change", resetSim);
  agentSel.addEventListener("change", resetSim);
  $("btnRun").addEventListener("click", run);
  $("btnReset").addEventListener("click", resetSim);
  $("speedSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.speed = +b.dataset.speed;
    for (const x of $("speedSeg").querySelectorAll("button")) x.classList.toggle("on", x === b);
  });
  $("camSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.cam === "orbit") { orbit.target.copy(camLook); }
    setCam(b.dataset.cam);
  });
  $("tRoutes").addEventListener("change", (e) => { for (const r of DM.ROUTE_IDS) W.overlays[r].group.visible = e.target.checked; });
  $("tLabels").addEventListener("change", (e) => { for (const l of W.labels) l.visible = e.target.checked; });
  $("race").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-i]"); if (!tr) return;
    S.follow = +tr.dataset.i; renderRace();
    if (S.cam === "top") setCam("chase");
  });
  $("btnTable").addEventListener("click", () => { buildResultsTable(); $("dlgTable").showModal(); });
  $("btnHelp").addEventListener("click", () => $("dlgHelp").showModal());
  document.querySelectorAll(".collapse").forEach((b) => b.addEventListener("click", () => {
    const p = $(b.dataset.target);
    p.classList.toggle("collapsed");
    b.innerHTML = p.classList.contains("collapsed") ? "+" : "&minus;";
  }));
  const infoBtn = $("btnInfo");
  if (infoBtn) infoBtn.addEventListener("click", () => {
    document.body.classList.toggle("show-info");
    infoBtn.textContent = document.body.classList.contains("show-info") ? "Controls" : "Details";
  });
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); run(); }
    if (["Digit1", "Digit2", "Digit3"].includes(e.code)) { $("scenario").value = e.code.slice(-1); $("customBox").hidden = true; resetSim(); }
    if (e.code === "KeyC") setCam({ chase: "top", top: "orbit", orbit: "chase" }[S.cam]);
  });
  window.addEventListener("resize", resize);

  // deep links: ?test=3&agent=race&cam=top&speed=4&autorun=1
  const q = new URLSearchParams(location.search);
  if (q.get("test")) $("scenario").value = q.get("test");
  if (q.get("agent")) agentSel.value = q.get("agent");
  if (q.get("speed")) { S.speed = +q.get("speed"); for (const x of $("speedSeg").querySelectorAll("button")) x.classList.toggle("on", x.dataset.speed === q.get("speed")); }
  $("customBox").hidden = $("scenario").value !== "custom";

  resize();
  resetSim();
  if (q.get("cam")) setCam(q.get("cam"));
  if (q.get("autorun")) setTimeout(run, 300);
  /** Debug/testing hook: jump to a simulated minute of the current run. */
  function skipTo(min) {
    if (S.phase === "idle") run();
    if (S.phase === "thinking") {
      while (S.reasonQueue.length) {
        const item = S.reasonQueue.shift();
        const li = document.createElement("li");
        li.textContent = item.t; li.className = "show" + (item.final ? " final" : "");
        $("reasoning").appendChild(li);
      }
      startRiding();
    }
    S.simMin = min;
    S.snapCam = true;
  }
  window.__sim = { S, run, resetSim, setCam, skipTo };
  requestAnimationFrame(frame);
})();
