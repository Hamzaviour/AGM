/*
 * 3D world: a schematic Johar Town, Lahore, between Cheezious and UCP.
 * Not to scale: distances follow the road map in model.js, the scene is
 * compressed so the whole trip fits on screen. 1 unit is about 10 m.
 * Traffic keeps LEFT, as in Pakistan.
 */
(function () {
  "use strict";
  const V = (x, z, y) => new THREE.Vector3(x, y || 0, z);

  // ---------------------------------------------------------------- layout
  const CHZ_DOOR = [-185, -13];  // where the rider waits at Cheezious
  const UCP_GATE = [190, -11];   // drop-off at the UCP main gate

  const ROUTE_PATHS = {
    A: [CHZ_DOOR, [-174, 0], [0, 0], [174, 0], UCP_GATE],
    B: [CHZ_DOOR, [-174, 0], [-150, 0], [-132, -40], [-110, -70], [40, -70], [118, -70], [140, -40], [150, 0], [174, 0], UCP_GATE],
    C: [CHZ_DOOR, [-174, 0], [-150, 0], [-150, 55], [-75, 55], [-75, 95], [75, 95], [75, 55], [150, 55], [150, 0], [174, 0], UCP_GATE],
  };
  // map nodes (for labels / minimap); matches model.js NODES
  const NODE_POS = { CHZ: [-150, 0], A1: [0, 0], B1: [-110, -70], B2: [40, -70],
                     C1: [-75, 55], C2: [-75, 95], UCP: [150, 0] };

  // hazard zones, tested on a point of a route
  const ZONES = {
    A: { jam: (x, z) => z > -3 && z < 3 && x > -110 && x < 6, flood: () => false },
    B: { jam: (x, z) => z < -60 && x > -105 && x < 20, flood: (x, z) => z < -60 && x > 18 && x < 62 },
    C: { jam: (x, z) => z > 90 && x > -70 && x < 70, flood: () => false },
  };

  // roads to draw: [points, width, kind]
  const ROADS = [
    [[[-330, 0], [330, 0]], 16, "main"],                       // Khayaban-e-Jinnah (dual carriageway)
    [[[-330, -70], [330, -70]], 12, "canal"],                  // Canal Bank Road
    [[[-150, 0], [-132, -40], [-110, -70]], 10, "link"],
    [[[118, -70], [140, -40], [150, 0]], 10, "link"],
    [[[-150, 0], [-150, 55], [-75, 55], [-75, 95], [75, 95], [75, 55], [150, 55], [150, 0]], 8, "street"],
    [[[0, 0], [0, 170]], 10, "street"],                        // cross road at Jinnah chowk
    [[[0, 0], [0, -62]], 10, "street"],
    [[[-75, 95], [-75, 170]], 7, "street"],
    [[[75, 95], [75, 170]], 7, "street"],
    [[[-150, 55], [-240, 55]], 7, "street"],
    [[[150, 55], [240, 55]], 7, "street"],
    [[[-240, 120], [240, 120]], 7, "street"],
  ];

  // ------------------------------------------------------------- helpers
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  function canvasTexture(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  function textSprite(text, opts) {
    opts = opts || {};
    const font = opts.font || "bold 44px Segoe UI, Arial";
    const pad = 22;
    const meas = document.createElement("canvas").getContext("2d");
    meas.font = font;
    const w = Math.ceil(meas.measureText(text).width) + pad * 2;
    const h = 72;
    const tex = canvasTexture(w, h, (g) => {
      g.fillStyle = opts.bg || "rgba(20,20,28,0.82)";
      const r = 18;
      g.beginPath();
      g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r);
      g.fill();
      if (opts.accent) { g.fillStyle = opts.accent; g.fillRect(0, h - 8, w, 8); }
      g.font = font; g.fillStyle = opts.color || "#fff"; g.textBaseline = "middle";
      g.fillText(text, pad, h / 2 - 2);
    });
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: opts.depthTest !== false, transparent: true });
    const s = new THREE.Sprite(mat);
    const scale = opts.scale || 0.055;
    s.scale.set(w * scale, h * scale, 1);
    s.renderOrder = 10;
    return s;
  }

  function segDist(px, pz, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz;
    let t = L2 ? ((px - a[0]) * dx + (pz - a[1]) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx - px, z = a[1] + t * dz - pz;
    return Math.sqrt(x * x + z * z);
  }
  function distToRoads(x, z) {
    let best = 1e9;
    for (const [pts, w] of ROADS)
      for (let i = 0; i < pts.length - 1; i++)
        best = Math.min(best, segDist(x, z, pts[i], pts[i + 1]) - w / 2);
    return best;
  }

  /** Polyline with arc-length lookup. */
  class Path {
    constructor(points, y) {
      this.pts = points.map((p) => V(p[0], p[1], y || 0));
      this.cum = [0];
      for (let i = 1; i < this.pts.length; i++)
        this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
      this.length = this.cum[this.cum.length - 1];
    }
    at(s, out) {
      s = Math.max(0, Math.min(this.length, s));
      let i = 1;
      while (i < this.cum.length - 1 && this.cum[i] < s) i++;
      const a = this.pts[i - 1], b = this.pts[i];
      const seg = this.cum[i] - this.cum[i - 1] || 1;
      const t = (s - this.cum[i - 1]) / seg;
      out = out || new THREE.Vector3();
      out.set(a.x + (b.x - a.x) * t, a.y, a.z + (b.z - a.z) * t);
      return out;
    }
    dir(s, out) {
      s = Math.max(0, Math.min(this.length, s));
      let i = 1;
      while (i < this.cum.length - 1 && this.cum[i] < s) i++;
      out = out || new THREE.Vector3();
      return out.subVectors(this.pts[i], this.pts[i - 1]).normalize();
    }
    /** smoothed heading: average of direction slightly behind and ahead */
    smoothDir(s, out) {
      const a = this.dir(s - 4), b = this.dir(s + 4);
      out = out || new THREE.Vector3();
      return out.addVectors(a, b).normalize();
    }
  }

  // ----------------------------------------------------------- materials
  const M = {};
  function makeMaterials() {
    const asphalt = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = "#3a3c40"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const v = 45 + Math.floor(rnd() * 30);
        g.fillStyle = `rgb(${v},${v},${v + 3})`;
        g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
      }
    });
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    asphalt.repeat.set(0.08, 0.08);
    const grass = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = "#6f8a4a"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) {
        g.fillStyle = pick(["#7d9a52", "#64803f", "#8a9a5c", "#a39a6a", "#5d7a3c"]);
        g.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
    });
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(60, 60);
    const windows = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          g.fillStyle = rnd() < 0.25 ? "#ffe9a8" : "#5d6b78";
          g.fillRect(x * 32 + 7, y * 32 + 8, 18, 15);
          g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(x * 32 + 5, y * 32 + 23, 22, 3);
        }
    });
    windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
    M.windows = windows;

    M.road = new THREE.MeshStandardMaterial({ map: asphalt, color: 0xffffff, roughness: 0.92 });
    M.ground = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
    M.marking = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    M.yellow = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
    M.curb = new THREE.MeshStandardMaterial({ color: 0xbdb8ad, roughness: 0.9 });
    M.curbBlack = new THREE.MeshStandardMaterial({ color: 0x222222 });
    M.median = new THREE.MeshStandardMaterial({ color: 0x5f8a3a, roughness: 1 });
    M.water = new THREE.MeshStandardMaterial({ color: 0x3f6f7d, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.9 });
    M.flood = new THREE.MeshStandardMaterial({ color: 0x4f3f27, emissive: 0x000000, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.93 });
    M.concrete = new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.95 });
    M.trunk = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
    M.leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    M.pole = new THREE.MeshStandardMaterial({ color: 0x555b60, metalness: 0.4, roughness: 0.6 });
    M.lamp = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0x000000 });
    M.tank = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.6 });
    M.walls = ["#d9cdb4", "#c9b79a", "#e3dccd", "#b9775a", "#cfc4b0", "#a7a39c", "#d8c08f"].map((c) =>
      new THREE.MeshStandardMaterial({ color: c, map: windows, roughness: 0.9 }));
    M.roofs = ["#8f8a82", "#9c968c", "#7b7770"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  }

  // ------------------------------------------------------------- builders
  function flatBox(group, x1, z1, x2, z2, width, y, mat, h) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, h || 0.1, width), mat);
    m.position.set((x1 + x2) / 2, y + (h || 0.1) / 2, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  function buildRoads(group) {
    ROADS.forEach(([pts, w, kind], idx) => {
      const y = 0.01 + idx * 0.004;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
        flatBox(group, x1, z1, x2, z2, w, y, M.road);
        // sidewalks
        const len = Math.hypot(x2 - x1, z2 - z1);
        const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
        if (kind !== "street") {
          for (const side of [-1, 1]) {
            const o = (w / 2 + 1.4) * side;
            flatBox(group, x1 + nx * o, z1 + nz * o, x2 + nx * o, z2 + nz * o, 2.6, 0, M.curb, 0.35);
          }
        }
        // centre markings
        const dash = kind === "main" ? 0 : 6;
        if (kind === "main") {
          // dual carriageway: planted median with black/yellow kerb, broken at junctions
          const gaps = [[-160, -142], [-8, 8], [142, 160]];
          let start = x1;
          const segs = [];
          for (const [g1, g2] of gaps) { if (g1 > start) segs.push([start, g1]); start = g2; }
          segs.push([start, x2]);
          for (const [a, b] of segs) {
            if (b - a < 2) continue;
            flatBox(group, a, 0, b, 0, 2.2, 0, M.curbBlack, 0.3);
            flatBox(group, a, 0, b, 0, 1.6, 0.05, M.median, 0.4);
          }
          for (const lane of [-4.5, 4.5])
            for (let s = x1; s < x2; s += 10) flatBox(group, s, lane, s + 4, lane, 0.25, 0.12, M.marking);
        } else {
          for (let s = 0; s < len; s += dash * 2) {
            const e = Math.min(len, s + dash);
            flatBox(group, x1 + (x2 - x1) * s / len, z1 + (z2 - z1) * s / len,
                    x1 + (x2 - x1) * e / len, z1 + (z2 - z1) * e / len, 0.25, 0.12, kind === "canal" ? M.yellow : M.marking);
          }
        }
      }
      // round joints
      for (let i = 1; i < pts.length - 1; i++) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.1, 24), M.road);
        d.position.set(pts[i][0], y + 0.05, pts[i][1]);
        d.receiveShadow = true;
        group.add(d);
      }
    });
    // zebra crossings at the chowk
    for (const s of [-1, 1])
      for (let k = -6; k <= 6; k += 2) {
        flatBox(group, s * 11 - 1.2, k, s * 11 + 1.2, k, 1, 0.12, M.marking);
      }
  }

  function buildCanal(group) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(700, 12), M.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.6, -86);
    group.add(water);
    for (const z of [-79.5, -92.5]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(700, 1.4, 1.2), M.concrete);
      bank.position.set(0, -0.2, z);
      group.add(bank);
    }
    // bridge over the canal + canal road (makes the underpass at B2)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 54), M.concrete);
    deck.position.set(40, 7, -80);
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    for (const z of [-62, -78, -95]) for (const x of [34, 46]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7, 1.6), M.concrete);
      p.position.set(x, 3.5, z);
      p.castShadow = true;
      group.add(p);
    }
    for (const x of [33.5, 46.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 54), M.curb);
      rail.position.set(x, 8.4, -80);
      group.add(rail);
    }
    // underpass retaining walls with hazard paint
    const hazard = canvasTexture(64, 16, (g) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#111" : "#f2c230"; g.fillRect(i * 8, 0, 8, 16); }
    });
    hazard.wrapS = THREE.RepeatWrapping; hazard.repeat.set(10, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x9d9890, roughness: 1 });
    for (const z of [-63.2, -76.8]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(46, 1.4, 0.6), wallMat);
      wall.position.set(40, 0.7, z);
      group.add(wall);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(46, 0.3, 0.65), new THREE.MeshBasicMaterial({ map: hazard }));
      strip.position.set(40, 1.3, z);
      group.add(strip);
    }
  }

  const nearLandmark = (x, z, r) =>
    (x > -205 - r && x < -165 + r && z > -42 - r && z < -8 + r) ||     // Cheezious
    (x > 162 - r && x < 248 + r && z > -63 - r && z < -6 + r);         // UCP campus

  function addTree(list, x, z, scale) {
    list.push({ x, z, s: scale || 0.8 + rnd() * 0.7, c: pick([0x4f7a32, 0x5d8a3a, 0x3f6b2b, 0x6a8f3d, 0x55702f]) });
  }

  function buildTreesAndBuildings(group) {
    const trees = [];
    // rows of trees along the canal and the median of the main road
    for (let x = -320; x <= 320; x += 9) {
      if (x > 28 && x < 52) continue;
      addTree(trees, x + rnd() * 3, -98 + rnd() * 2);
      addTree(trees, x + rnd() * 3, -76.5 - rnd(), 0.7);
      if (Math.abs(x) > 14 && Math.abs(Math.abs(x) - 155) > 22) addTree(trees, x + 3, 0, 0.55);
    }
    // buildings
    const blocks = [];
    for (let i = 0; i < 900 && blocks.length < 190; i++) {
      const x = -300 + rnd() * 600, z = -170 + rnd() * 330;
      const w = 10 + rnd() * 14, d = 10 + rnd() * 14;
      const r = Math.hypot(w, d) / 2;
      if (z > -108 && z < -56) continue;                       // canal belt
      if (nearLandmark(x, z, r)) continue;
      if (distToRoads(x, z) < r + 4) continue;
      if (blocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r + 2)) continue;
      const residential = z > 40 && Math.abs(x) < 160;
      blocks.push({ x, z, w, d, r, h: residential ? 6 + rnd() * 7 : 8 + rnd() * 22 });
    }
    const roofIdx = [2];
    for (const b of blocks) {
      const wall = pick(M.walls);
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      // scale UVs so the window texture repeats every ~4 units
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        const fw = face < 2 ? b.d : b.w;
        uv.setXY(i, uv.getX(i) * fw / 8, uv.getY(i) * b.h / 8);
      }
      const roof = pick(M.roofs);
      const mesh = new THREE.Mesh(g, [wall, wall, roof, roof, wall, wall]);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      // rooftop water tanks: a Lahore classic
      const tanks = 1 + Math.floor(rnd() * 3);
      for (let t = 0; t < tanks; t++) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.8, 10), M.tank);
        tank.position.set(b.x + (rnd() - 0.5) * (b.w - 3), b.h + 0.9, b.z + (rnd() - 0.5) * (b.d - 3));
        group.add(tank);
      }
      if (rnd() < 0.5) {
        const sign = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.8, 1.6, 0.3),
          new THREE.MeshStandardMaterial({ color: pick([0xd9342b, 0x2a6fd6, 0x1f9d55, 0xf2a900, 0x8e44ad]), emissive: 0x000000 }));
        sign.position.set(b.x, 3.2, b.z + b.d / 2 + 0.2);
        group.add(sign);
        M.signs = M.signs || []; M.signs.push(sign.material);
      }
      for (let k = 0; k < 2; k++) if (rnd() < 0.5) addTree(trees, b.x + b.w / 2 + 3, b.z + (rnd() - 0.5) * b.d);
    }
    // trees in empty plots
    for (let i = 0; i < 260; i++) {
      const x = -300 + rnd() * 600, z = -170 + rnd() * 330;
      if (z > -105 && z < -60) continue;
      if (distToRoads(x, z) < 4) continue;
      if (blocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 2)) continue;
      if (nearLandmark(x, z, 2)) continue;
      addTree(trees, x, z);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 6), M.trunk, trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.8, 1), M.leaf, trees.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      sc.set(t.s, t.s, t.s); pos.set(t.x, 2 * t.s, t.z);
      trunk.setMatrixAt(i, m4.compose(pos, q, sc));
      sc.set(t.s * 1.1, t.s * 0.95, t.s * 1.1); pos.set(t.x, 5.2 * t.s, t.z);
      crown.setMatrixAt(i, m4.compose(pos, q, sc));
      crown.setColorAt(i, col.setHex(t.c));
    });
    trunk.castShadow = crown.castShadow = true;
    group.add(trunk, crown);
  }

  function buildStreetLights(group) {
    const lamps = [];
    const add = (x, z, rot) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 9, 6), M.pole);
      pole.position.set(x, 4.5, z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.15, 0.15), M.pole);
      arm.position.set(x + Math.cos(rot) * 1.2, 9, z + Math.sin(rot) * 1.2);
      arm.rotation.y = -rot;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.5), M.lamp);
      head.position.set(x + Math.cos(rot) * 2.4, 8.9, z + Math.sin(rot) * 2.4);
      group.add(pole, arm, head);
      lamps.push(head);
    };
    for (let x = -300; x <= 300; x += 30) { add(x, 0, Math.PI / 2); add(x, 0, -Math.PI / 2); }
    for (let x = -300; x <= 300; x += 34) add(x, -77, Math.PI / 2);
    return lamps;
  }

  function buildSignals(group) {
    const heads = [];
    const posts = [[-10, -10, 0], [10, 10, Math.PI], [10, -10, -Math.PI / 2], [-10, 10, Math.PI / 2]];
    for (const [x, z, rot] of posts) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 6), M.pole);
      pole.position.set(x, 3, z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), M.curbBlack);
      box.position.set(x, 6.4, z);
      box.rotation.y = rot;
      group.add(pole, box);
      const lights = ["#ff2a2a", "#ffbf1f", "#2aff5a"].map((c, i) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(c), emissiveIntensity: 0.05 });
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
        l.position.set(x, 7.2 - i * 0.75, z);
        l.translateOnAxis(new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)), 0.5);
        group.add(l);
        return mat;
      });
      heads.push({ lights, axis: Math.abs(Math.sin(rot)) > 0.5 ? "ns" : "ew" });
    }
    return heads;
  }

  function buildCheezious(group) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 26),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 }));
    body.position.y = 6; body.castShadow = body.receiveShadow = true;
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.6, 12, 26),
      new THREE.MeshStandardMaterial({ color: 0xffc20e, roughness: 0.5 }));
    front.position.set(11.2, 6, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 18),
      new THREE.MeshStandardMaterial({ color: 0x9fd3e6, metalness: 0.6, roughness: 0.1, emissive: 0x332200 }));
    glass.position.set(11.6, 3, 0);
    const signTex = canvasTexture(512, 128, (c, w, h) => {
      c.fillStyle = "#d7262e"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#ffc20e"; c.font = "bold 84px Arial Black, Arial"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("CHEEZIOUS", w / 2, h / 2 + 4);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(20, 5), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.25 }));
    sign.position.set(11.8, 9, 0); sign.rotation.y = Math.PI / 2;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0xd7262e }));
    awning.position.set(12.8, 5.8, 0); awning.rotation.z = 0.15;
    g.add(body, front, glass, sign, awning);
    // parking forecourt
    const lot = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 30), new THREE.MeshStandardMaterial({ color: 0x77736b }));
    lot.position.set(14.5, 0.06, 0); lot.receiveShadow = true;
    g.add(lot);
    g.position.set(-185, 0, -26);
    g.rotation.y = -Math.PI / 2;
    group.add(g);
    M.cheeziousSign = sign.material;
  }

  function buildUCP(group) {
    const g = new THREE.Group();
    const brick = new THREE.MeshStandardMaterial({ color: 0xb4583a, roughness: 0.9, map: M.windows });
    const mk = (w, h, d, x, z) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        uv.setXY(i, uv.getX(i) * (face < 2 ? d : w) / 7, uv.getY(i) * h / 7);
      }
      const m = new THREE.Mesh(geo, [brick, brick, M.roofs[0], M.roofs[0], brick, brick]);
      m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    mk(22, 26, 70, 30, 20);   // main block
    mk(18, 18, 16, 12, 50);   // east wing
    // lawn
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(30, 0.15, 64), new THREE.MeshStandardMaterial({ color: 0x4f8a35 }));
    lawn.position.set(6, 0.08, 20); lawn.receiveShadow = true;
    g.add(lawn);
    const drive = new THREE.Mesh(new THREE.BoxGeometry(22, 0.2, 9), new THREE.MeshStandardMaterial({ color: 0x8a857c }));
    drive.position.set(2, 0.1, 6); g.add(drive);
    // gate arch
    const gateMat = new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.6 });
    for (const z of [-1, 13]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 10, 2.4), gateMat);
      p.position.set(-6, 5, z); p.castShadow = true; g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 17), gateMat);
    beam.position.set(-6, 11, 6); beam.castShadow = true; g.add(beam);
    const tex = canvasTexture(1024, 160, (c, w, h) => {
      c.fillStyle = "#14325c"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff"; c.font = "bold 66px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("UNIVERSITY OF CENTRAL PUNJAB", w / 2, h / 2 + 4);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.5), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 }));
    sign.position.set(-7.4, 11, 6); sign.rotation.y = -Math.PI / 2;
    g.add(sign);
    // flag pole
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 16, 6), M.pole);
    fp.position.set(4, 8, -16); g.add(fp);
    const flagTex = canvasTexture(96, 64, (c) => {
      c.fillStyle = "#fff"; c.fillRect(0, 0, 24, 64);
      c.fillStyle = "#01411c"; c.fillRect(24, 0, 72, 64);
      c.fillStyle = "#fff"; c.beginPath(); c.arc(62, 32, 17, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#01411c"; c.beginPath(); c.arc(68, 28, 15, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(72, 22, 3.5, 0, Math.PI * 2); c.fill();
    });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.3, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.set(6.5, 14.3, -16); g.add(flag);
    M.flag = flag;
    g.position.set(184, 0, -19);
    g.rotation.y = Math.PI / 2;
    group.add(g);
  }

  function person(color, skin) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color }));
    body.position.y = 1.4;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshStandardMaterial({ color: skin || 0xc68e63 }));
    head.position.y = 2.65;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), new THREE.MeshStandardMaterial({ color: 0x2c3e50 }));
    legs.position.y = 0.45;
    body.castShadow = head.castShadow = true;
    g.add(body, head, legs);
    return g;
  }

  // ------------------------------------------------------------- vehicles
  function makeCar(color) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 2), paint);
    body.position.y = 0.95;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x1c2733, metalness: 0.7, roughness: 0.15 }));
    cab.position.set(-0.2, 1.9, 0);
    body.castShadow = cab.castShadow = true;
    g.add(body, cab);
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
    for (const [x, z] of [[1.4, 1], [1.4, -1], [-1.4, 1], [-1.4, -1]]) {
      const w = new THREE.Mesh(wheelGeo, M.curbBlack);
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z);
      g.add(w);
    }
    addLights(g, 2.21, 0.6, 0.95);
    return g;
  }
  function makeRickshaw() {
    const g = new THREE.Group();
    const green = new THREE.MeshStandardMaterial({ color: 0x1f8f4e, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 1.5), green);
    body.position.y = 1.2;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    roof.position.y = 2.3;
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 1.0), new THREE.MeshStandardMaterial({ color: 0xf2c230 }));
    front.position.set(1.6, 1.0, 0);
    body.castShadow = true;
    g.add(body, roof, front);
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10);
    for (const [x, z] of [[1.8, 0], [-0.9, 0.75], [-0.9, -0.75]]) {
      const w = new THREE.Mesh(wheelGeo, M.curbBlack);
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.35, z); g.add(w);
    }
    addLights(g, 2.0, 0.3, 1.0);
    return g;
  }
  function makeBus() {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(11, 3.2, 2.6), paint);
    body.position.y = 2.0; body.castShadow = true;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(10.2, 1.0, 2.65),
      new THREE.MeshStandardMaterial({ color: 0x1c2733, metalness: 0.6, roughness: 0.2 }));
    glass.position.y = 2.7;
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 2.2), glass.material);
    windscreen.position.set(5.52, 2.4, 0);
    g.add(glass, windscreen);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(11.05, 0.5, 2.65), new THREE.MeshStandardMaterial({ color: 0xd62b2b }));
    stripe.position.y = 1.0;
    g.add(body, stripe);
    for (const x of [3.6, -3.6]) for (const z of [1.2, -1.2]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 12), M.curbBlack);
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w);
    }
    addLights(g, 5.51, 1.0, 1.2);
    return g;
  }
  function makeBike(jacket) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.35), new THREE.MeshStandardMaterial({ color: 0xb22222 }));
    frame.position.y = 0.8;
    const r = person(jacket || 0x34495e);
    r.scale.setScalar(0.8); r.position.set(-0.1, 0.4, 0);
    g.add(frame, r);
    for (const x of [0.8, -0.8]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 6, 14), M.curbBlack);
      w.position.set(x, 0.45, 0); g.add(w);
    }
    addLights(g, 0.95, 0.0, 0.9, true);
    return g;
  }
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff6d8, emissiveIntensity: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.3 });
  function addLights(g, halfLen, zOff, y, single) {
    const zs = single ? [0] : [zOff, -zOff];
    for (const z of zs) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.4), headMat);
      h.position.set(halfLen, y, z);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.4), tailMat);
      t.position.set(-halfLen, y, z);
      g.add(h, t);
    }
  }

  // --------------------------------------------------------------- rider
  function pandaBoxTexture() {
    return canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = "#e21b70"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff";
      c.beginPath(); c.arc(128, 120, 70, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#e21b70";
      c.beginPath(); c.arc(72, 62, 26, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(184, 62, 26, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(100, 115, 16, 22, -0.4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(156, 115, 16, 22, 0.4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(128, 150, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.font = "bold 30px Arial"; c.textAlign = "center";
      c.fillText("DELIVERY", 128, 228);
    });
  }
  let boxTex = null;
  function makeRider(tagColor) {
    boxTex = boxTex || pandaBoxTexture();
    const pink = new THREE.MeshStandardMaterial({ color: 0xe21b70, roughness: 0.55 });
    const g = new THREE.Group();
    const bike = new THREE.Group();
    // motorbike (70cc style, very common for riders in Lahore)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 0.4), new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.4, roughness: 0.4 }));
    frame.position.set(0, 0.95, 0);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.55), new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.5, roughness: 0.3 }));
    tank.position.set(0.35, 1.25, 0);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.45), M.curbBlack);
    seat.position.set(-0.4, 1.3, 0);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.4), new THREE.MeshStandardMaterial({ color: 0x7f8c8d, metalness: 0.8, roughness: 0.3 }));
    engine.position.set(0.1, 0.6, 0);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), M.pole);
    fork.position.set(0.95, 1.05, 0); fork.rotation.z = 0.35;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), M.curbBlack);
    bar.position.set(0.75, 1.65, 0); bar.rotation.x = Math.PI / 2;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), headMat);
    lamp.position.set(1.05, 1.45, 0);
    bike.add(frame, tank, seat, engine, fork, bar, lamp);
    const wheels = [];
    for (const x of [1.15, -0.9]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.13, 8, 18), M.curbBlack);
      w.position.set(x, 0.5, 0);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8), M.pole);
      hub.rotation.x = Math.PI / 2; w.add(hub);
      for (let k = 0; k < 3; k++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.04, 0.04), M.pole);
        spoke.rotation.z = (k * Math.PI) / 3; w.add(spoke);
      }
      bike.add(w); wheels.push(w);
    }
    // rider: pink jacket, pink helmet
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.7, 4, 8), pink);
    torso.position.set(-0.25, 2.05, 0); torso.rotation.z = -0.25;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), new THREE.MeshStandardMaterial({ color: 0xe21b70, roughness: 0.25, metalness: 0.2 }));
    helmet.position.set(-0.05, 2.75, 0);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, -Math.PI / 2.4, Math.PI / 1.2, Math.PI / 3, Math.PI / 3.2),
      new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.1 }));
    visor.position.set(0.04, 2.73, 0); visor.rotation.y = Math.PI / 2;
    const armGeo = new THREE.CapsuleGeometry(0.11, 0.7, 3, 6);
    for (const z of [0.3, -0.3]) {
      const arm = new THREE.Mesh(armGeo, pink);
      arm.position.set(0.3, 1.9, z); arm.rotation.z = -1.1;
      bike.add(arm);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.7, 3, 6), new THREE.MeshStandardMaterial({ color: 0x22313f }));
      leg.position.set(0.0, 1.15, z * 1.1); leg.rotation.z = 1.3;
      bike.add(leg);
    }
    // delivery box with panda face
    const boxMats = [pink, pink, pink, pink, new THREE.MeshStandardMaterial({ map: boxTex }), new THREE.MeshStandardMaterial({ map: boxTex })];
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), boxMats);
    box.position.set(-0.95, 2.15, 0);
    // rain cape, only visible in rain
    const cape = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x2d3e50, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    cape.position.set(-0.25, 2.0, 0); cape.visible = false;
    bike.add(torso, helmet, visor, box, cape);
    bike.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(bike);
    if (tagColor) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 28), new THREE.MeshBasicMaterial({ color: tagColor, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
      // tall beacon so each racer is easy to spot from the map camera
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 26, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: tagColor, transparent: true, opacity: 0.45, depthWrite: false }));
      beacon.position.y = 16;
      g.add(ring, beacon);
    }
    g.userData = { bike, wheels, box, cape };
    return g;
  }

  // --------------------------------------------------------------- hazards
  function buildFallenTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 22, 8), M.trunk);
    trunk.rotation.x = Math.PI / 2; trunk.rotation.z = 0.25;
    trunk.position.set(0, 1.0, 0);
    g.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a6e2c, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 + rnd(), 1), leafMat);
      c.position.set((rnd() - 0.5) * 6, 1.5 + rnd() * 1.5, -8 + i * 2.6);
      c.castShadow = true;
      g.add(c);
    }
    const stripe = canvasTexture(128, 32, (c) => {
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#fff" : "#e8501c"; c.fillRect(i * 16, 0, 16, 32); }
    });
    for (const z of [-5, 0, 5]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 4), new THREE.MeshStandardMaterial({ map: stripe }));
      bar.position.set(-12, 1.3, z);
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.2), M.pole); l1.position.set(-12, 0.65, z - 1.6);
      const l2 = l1.clone(); l2.position.z = z + 1.6;
      g.add(bar, l1, l2);
    }
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a00 });
    for (let i = -3; i <= 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 10), coneMat);
      cone.position.set(-15, 0.5, i * 2);
      g.add(cone);
    }
    const label = textSprite("ROAD CLOSED - fallen tree", { bg: "rgba(200,40,20,0.9)", scale: 0.045 });
    label.position.set(-8, 8, 0);
    g.add(label);
    g.position.set(-128, 0, 0);
    return g;
  }

  function makeBarrier(text) {
    const g = new THREE.Group();
    const stripe = canvasTexture(128, 32, (c) => {
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#fff" : "#e8501c"; c.fillRect(i * 16, 0, 16, 32); }
    });
    const mat = new THREE.MeshStandardMaterial({ map: stripe });
    for (const z of [-3, 3]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 5), mat);
      bar.position.set(0, 1.3, z);
      g.add(bar);
      for (const dz of [-2, 2]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.2), M.pole);
        leg.position.set(0, 0.65, z + dz); g.add(leg);
      }
    }
    const label = textSprite(text, { bg: "rgba(200,40,20,0.9)", scale: 0.045 });
    label.position.set(0, 7, 0);
    g.add(label);
    return g;
  }

  function buildFlood() {
    const g = new THREE.Group();
    const water = new THREE.Mesh(new THREE.BoxGeometry(46, 1.1, 13.4), M.flood);
    water.position.set(40, 0.55, -70);
    g.add(water);
    // floating debris and rain ripples on the brown water
    const ripMat = new THREE.MeshBasicMaterial({ color: 0x9c8f74, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const ripples = [];
    for (let i = 0; i < 26; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 16), ripMat.clone());
      r.rotation.x = -Math.PI / 2;
      r.position.set(18 + rnd() * 44, 1.12, -76 + rnd() * 12);
      r.userData.t = rnd();
      g.add(r); ripples.push(r);
    }
    const junk = new THREE.MeshStandardMaterial({ color: 0x3b3326 });
    for (let i = 0; i < 6; i++) {
      const j = new THREE.Mesh(new THREE.BoxGeometry(0.8 + rnd(), 0.15, 0.3 + rnd() * 0.4), junk);
      j.position.set(20 + rnd() * 40, 1.12, -75 + rnd() * 10); j.rotation.y = rnd() * 3;
      g.add(j);
    }
    // stalled car in the water
    const stalled = makeCar(0x9aa3ad);
    stalled.position.set(52, 0, -66.5); stalled.rotation.y = Math.PI;
    g.add(stalled);
    g.userData.ripples = ripples;
    const label = textSprite("Underpass flooded", { bg: "rgba(30,80,140,0.92)", scale: 0.045 });
    label.position.set(40, 12, -70);
    g.add(label);
    return g;
  }

  // -------------------------------------------------------------- traffic
  class Traffic {
    constructor(scene) {
      this.scene = scene;
      this.items = [];
      this.paths = {
        main: new Path([[-330, 0], [330, 0]]),
        canal: new Path([[-330, -70], [330, -70]]),
        cross: new Path([[0, -62], [0, 170]]),
        inner: new Path([[-150, 0], [-150, 55], [-75, 55], [-75, 95], [75, 95], [75, 55], [150, 55], [150, 0]]),
      };
      this.tmp = new THREE.Vector3(); this.tmpD = new THREE.Vector3();
    }
    clear() { for (const it of this.items) this.scene.remove(it.mesh); this.items = []; }
    spawn(pathKey, kind, s, dir, lane, speed) {
      const colors = [0xf5f5f5, 0x2c3e50, 0xbdc3c7, 0x7f8c8d, 0x8e1b1b, 0x1f4e79, 0x111111, 0xd4c9a8];
      const mesh = kind === "bus" ? makeBus() : kind === "rickshaw" ? makeRickshaw()
                 : kind === "bike" ? makeBike(pick([0x34495e, 0x7f8c8d, 0x2c3e50, 0x8e44ad])) : makeCar(pick(colors));
      this.scene.add(mesh);
      const len = kind === "bus" ? 12 : kind === "bike" ? 2.6 : kind === "rickshaw" ? 3.6 : 5;
      this.items.push({ mesh, path: this.paths[pathKey], key: pathKey, s, dir, lane, speed, v: speed, len, wob: rnd() * 6 });
    }
    /** state: model scenario state (A/B/C with traffic level) */
    populate(state) {
      this.clear();
      seed = 99;
      const kinds = ["car", "car", "car", "rickshaw", "bike", "bike", "car", "bus"];
      const heavyA = state.A.traffic === "heavy" && !state.A.closed;
      // Khayaban-e-Jinnah: two lanes per direction
      const nMain = heavyA ? 0 : 26;
      for (let i = 0; i < nMain; i++)
        this.spawn("main", pick(kinds), rnd() * 660, rnd() < 0.5 ? 1 : -1, rnd() < 0.5 ? 2.6 : 5.4, 9 + rnd() * 6);
      if (heavyA) {
        // queue at the Jinnah signal chowk, both directions, plus free flow far away
        for (const dir of [1, -1]) for (const lane of [2.6, 5.4]) {
          let s = dir === 1 ? 330 - 6 : 330 + 6;
          for (let k = 0; k < 15; k++) {
            const kind = pick(kinds);
            this.spawn("main", kind, s, dir, lane, 0.5);
            s -= dir * (kind === "bus" ? 14 : 7 + rnd() * 2);
          }
        }
        for (let i = 0; i < 8; i++) this.spawn("main", pick(kinds), rnd() < 0.5 ? rnd() * 150 : 510 + rnd() * 150, rnd() < 0.5 ? 1 : -1, 2.6, 9 + rnd() * 4);
      }
      const nCanal = state.B.traffic === "heavy" ? 30 : 12;
      for (let i = 0; i < nCanal; i++)
        this.spawn("canal", pick(kinds), rnd() * 660, rnd() < 0.5 ? 1 : -1, 2.4, state.B.traffic === "heavy" ? 2 : 11 + rnd() * 5);
      for (let i = 0; i < 6; i++) this.spawn("cross", pick(["car", "bike", "rickshaw"]), rnd() * 230, rnd() < 0.5 ? 1 : -1, 2.5, 7 + rnd() * 4);
      const nInner = state.C.traffic === "heavy" ? 16 : 6;
      for (let i = 0; i < nInner; i++) this.spawn("inner", pick(["bike", "rickshaw", "car", "bike"]), rnd() * 520, rnd() < 0.5 ? 1 : -1, 1.4, state.C.traffic === "heavy" ? 1.5 : 6 + rnd() * 3);
      this.heavyA = heavyA;
      this.closedA = state.A.closed;
      this.flooded = state.B.flooded;
    }
    update(dt, signalPhase) {
      // car following per path/direction/lane
      const groups = {};
      for (const it of this.items) (groups[it.key + it.dir + it.lane] = groups[it.key + it.dir + it.lane] || []).push(it);
      for (const k in groups) {
        const g = groups[k].sort((a, b) => (b.s - a.s) * b.dir);
        for (let i = 0; i < g.length; i++) {
          const it = g[i];
          let target = it.speed;
          const p = it.path.at(it.s, this.tmp);
          // jam: crawl around the chowk
          if (it.key === "main" && this.heavyA && p.x > -115 && p.x < 115) target = 0.6 + Math.sin(it.wob += dt) * 0.4;
          // red light at the chowk for main-road traffic
          if (it.key === "main" && signalPhase !== "ew") {
            const stopX = it.dir === 1 ? -12 : 12;
            const dist = (stopX - p.x) * it.dir;
            if (dist > 0 && dist < 14) target = Math.min(target, Math.max(0, dist - 2));
          }
          if (it.key === "cross" && signalPhase !== "ns") {
            const stopZ = it.dir === 1 ? -12 : 12;
            const dist = (stopZ - p.z) * it.dir;
            if (dist > 0 && dist < 14) target = Math.min(target, Math.max(0, dist - 2));
          }
          // closed road: traffic turns back before the fallen tree
          if (it.key === "main" && this.closedA && Math.abs(p.x + 128) < 25) target = Math.min(target, 3);
          // flooded underpass: crawl through water
          if (it.key === "canal" && this.flooded && p.x > 15 && p.x < 65) target = Math.min(target, 1.5);
          if (i > 0) {
            const lead = g[i - 1];
            const gap = (lead.s - it.s) * it.dir - (lead.len + it.len) / 2;
            target = Math.min(target, Math.max(0, (gap - 1.5) * 1.2));
          }
          it.v += (target - it.v) * Math.min(1, dt * 2);
          it.s += it.v * dt * it.dir;
          if (it.s > it.path.length) { it.s = it.path.length; it.dir = -1; }
          if (it.s < 0) { it.s = 0; it.dir = 1; }
          if (it.key === "main" && this.closedA) {
            // vehicles do not pass through the closure
            const x = it.path.at(it.s, this.tmp).x;
            if (x > -145 && x < -112) it.dir = x < -128 ? -1 : 1, it.s += it.dir * 0.5;
          }
          const pos = it.path.at(it.s, this.tmp);
          const d = it.path.dir(it.s, this.tmpD).multiplyScalar(it.dir);
          // keep left: left of heading d is (d.z, -d.x)
          it.mesh.position.set(pos.x + d.z * it.lane, 0, pos.z - d.x * it.lane);
          it.mesh.rotation.y = Math.atan2(-d.z, d.x);
        }
      }
    }
  }

  // --------------------------------------------------------------- rain
  class Rain {
    constructor(scene) {
      const N = 7000;
      const pos = new Float32Array(N * 6);
      this.N = N; this.pos = pos;
      for (let i = 0; i < N; i++) this.reset(i, true, new THREE.Vector3());
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.55 }));
      this.mesh.frustumCulled = false;
      this.mesh.visible = false;
      scene.add(this.mesh);
    }
    reset(i, anyY, c) {
      const x = c.x + (Math.random() - 0.5) * 220, z = c.z + (Math.random() - 0.5) * 220;
      const y = anyY ? Math.random() * 90 : 90;
      const p = this.pos;
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + 0.3; p[i * 6 + 4] = y - 2.2; p[i * 6 + 5] = z;
    }
    update(dt, center) {
      if (!this.mesh.visible) return;
      const p = this.pos;
      for (let i = 0; i < this.N; i++) {
        p[i * 6 + 1] -= 70 * dt; p[i * 6 + 4] -= 70 * dt;
        p[i * 6] += 4 * dt; p[i * 6 + 3] += 4 * dt;
        if (p[i * 6 + 4] < 0) this.reset(i, false, center);
      }
      this.mesh.geometry.attributes.position.needsUpdate = true;
    }
  }

  // -------------------------------------------------------------- overlays
  const RIDER_LANE = { main: 7.0, jam: 4.0, canal: 4.4, street: 2.6 };
  /** Route polyline shifted to the left-hand riding lane (keep left). */
  function laneLine(points) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const p = points[i];
      const onMain = Math.abs(p[1]) < 0.5 && Math.abs(p[0]) <= 174 &&
        (i === 0 || Math.abs(points[i - 1][1]) < 0.5) && (i === points.length - 1 || Math.abs(points[i + 1][1]) < 0.5);
      const onCanal = Math.abs(p[1] + 70) < 0.5;
      const lane = i === 0 || i === points.length - 1 ? 0 : onMain ? RIDER_LANE.main : onCanal ? RIDER_LANE.canal : RIDER_LANE.street;
      out.push([p[0] + dz / L * lane, p[1] - dx / L * lane]);
    }
    return out;
  }
  const ROUTE_COLORS = { A: 0x2a78d6, B: 0x1baf7a, C: 0xeb6834 };
  function buildRouteOverlays(group) {
    const out = {};
    for (const r of ["A", "B", "C"]) {
      const pts = laneLine(ROUTE_PATHS[r]);
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: ROUTE_COLORS[r], transparent: true, opacity: 0.55, depthWrite: false });
      const yOff = { A: 0.16, B: 0.17, C: 0.18 }[r];
      for (let i = 0; i < pts.length - 1; i++) flatBox(g, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2.2, yOff, mat, 0.02);
      for (let i = 1; i < pts.length - 1; i++) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.02, 12), mat);
        d.position.set(pts[i][0], yOff + 0.01, pts[i][1]); g.add(d);
      }
      group.add(g);
      out[r] = { group: g, mat };
    }
    return out;
  }

  function buildLabels(group) {
    const labels = [];
    const add = (text, x, z, y, opts) => { const s = textSprite(text, opts); s.position.set(x, y, z); group.add(s); labels.push(s); return s; };
    add("Route A  ·  Khayaban-e-Jinnah Rd", -60, 8, 14, { accent: "#2a78d6" });
    add("Route B  ·  Canal Bank Rd", -40, -62, 14, { accent: "#1baf7a" });
    add("Route C  ·  Johar Town inner streets", 0, 103, 14, { accent: "#eb6834" });
    add("Jinnah signal chowk", 0, -14, 10, { scale: 0.045 });
    add("Canal underpass", 40, -55, 16, { scale: 0.045 });
    add("Lahore Canal", -200, -86, 6, { scale: 0.045, bg: "rgba(25,70,90,0.8)" });
    add("Block G", -112, 75, 9, { scale: 0.045 });
    add("Maulana Shaukat Ali Rd", 0, 88, 9, { scale: 0.045 });
    add("Cheezious (pickup)", -185, -30, 26, { accent: "#ffc20e", scale: 0.055 });
    add("UCP main gate (drop-off)", 204, -45, 36, { accent: "#e21b70", scale: 0.06 });
    return labels;
  }

  // ------------------------------------------------------------- public
  window.World = {
    ROUTE_PATHS, RIDER_LANE, NODE_POS, ZONES, ROUTE_COLORS, CHZ_DOOR, UCP_GATE, ROADS, Path,
    makeRider, textSprite, person, makeBarrier,
    build(scene) {
      makeMaterials();
      const root = new THREE.Group();
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), M.ground);
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
      root.add(ground);
      buildRoads(root);
      buildCanal(root);
      buildTreesAndBuildings(root);
      const lamps = buildStreetLights(root);
      const signals = buildSignals(root);
      buildCheezious(root);
      buildUCP(root);
      scene.add(root);

      // customer waiting at the gate, a few students around
      const customer = person(0x2e86de, 0xb07a52);
      customer.position.set(192, 0, -18);
      customer.rotation.y = -Math.PI / 2;
      scene.add(customer);
      for (let i = 0; i < 7; i++) {
        const p = person(pick([0x16a085, 0x8e44ad, 0xc0392b, 0xf39c12, 0x2c3e50, 0xecf0f1]), pick([0xc68e63, 0xa8734f, 0xd9a47a]));
        p.position.set(200 + rnd() * 14, 0, -20 - rnd() * 10);
        p.rotation.y = rnd() * 6;
        scene.add(p);
      }
      // staff at Cheezious door
      const staff = person(0xd7262e, 0xc68e63);
      staff.position.set(-178, 0, -16); staff.rotation.y = Math.PI;
      scene.add(staff);
      // other riders parked at Cheezious
      for (let i = 0; i < 3; i++) {
        const r = makeRider();
        r.position.set(-194 + i * 4, 0, -11); r.rotation.y = -Math.PI / 2;
        scene.add(r);
      }

      const fallenTree = buildFallenTree(); fallenTree.visible = false; scene.add(fallenTree);
      const flood = buildFlood(); flood.visible = false; scene.add(flood);
      const overlays = buildRouteOverlays(scene);
      const labels = buildLabels(scene);
      const traffic = new Traffic(scene);
      const rain = new Rain(scene);
      return { lamps, signals, fallenTree, flood, overlays, labels, traffic, rain, customer, materials: M };
    },
  };
})();
