import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, fbm2, WATER_Y, glowPointMaterial, smooth } from './util.js'
import { coastZ } from './city.js'

// 地貌（远景粗糙、中景适度）：
// - 远山两层剪影（只在城市那一侧），靠雾做空气透视
// - 海湾右侧的岬角岛 + 跨海大桥（桥灯、主缆灯链、车流）
// - 舞台左前方的灯塔礁石，旋转光柱扫过整个海湾

export function mountainRing({ radius, spread, height, seed, color, topColor, sector }) {
  const N = 900
  const pos = []
  const col = []
  const c0 = new THREE.Color(color)
  const c1 = new THREE.Color(topColor)
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2
    // a = 0 指向 -Z（城市方向）
    const dx = Math.sin(a), dz = -Math.cos(a)
    const toward = Math.cos(a) // 1 = 正对城市
    const mask = THREE.MathUtils.smoothstep(toward, sector, sector + 0.35)
    const n = fbm2(a * 6 + seed, seed * 0.37, 6)
    const ridge = Math.pow(Math.abs(fbm2(a * 14 + seed * 2, 3.1, 4) - 0.5) * 2, 0.7)
    const h = (0.25 + 0.75 * n + 0.35 * ridge) * height * mask + 20
    const r = radius + (n - 0.5) * spread
    pos.push(dx * r, WATER_Y - 30, dz * r, dx * (r - spread * 0.2), WATER_Y + h, dz * (r - spread * 0.2))
    col.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b)
  }
  const idx = []
  for (let i = 0; i < N; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true }))
}

export function rock(radius, seed, flat = 0.55, detail = 3) {
  const g = new THREE.IcosahedronGeometry(radius, detail)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = fbm2(v.x / radius * 1.7 + seed, v.z / radius * 1.7 + v.y / radius, 5)
    v.multiplyScalar(0.7 + n * 0.6)
    v.y *= v.y > 0 ? flat : 0.3
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

// 近景岩石：高细分（three 的 detail 是线性细分，48 ≈ 4.6 万面）、平滑着色；分层岩脊 + 顶部青苔 + 水线附近湿暗（顶点色）。
// waterline = 岩石局部坐标里的水面高度。geometry.userData.top = 中心附近的顶面高度（放树用）
export function shoreRock(radius, seed, { flat = 0.45, detail = 48, waterline = 1, stone = [0.34, 0.32, 0.3], moss = [0.16, 0.24, 0.11], wet = [0.06, 0.06, 0.07], mossy = 1 } = {}) {
  let g = new THREE.IcosahedronGeometry(radius, detail)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  g = mergeVertices(g)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    const n = fbm2(v.x * 1.6 + seed, v.z * 1.6 + v.y * 1.3, 6)
    const ridge = 1 - Math.abs(fbm2(v.x * 3.1 - seed, v.z * 3.1 + v.y * 2.2, 5) * 2 - 1)
    let r = radius * (0.7 + n * 0.55 + ridge * 0.12)
    v.multiplyScalar(r)
    v.y *= v.y > 0 ? flat : 0.35
    // 水平岩层：一级级小台阶
    const s = (v.y / radius) * 7 + seed
    const f = s - Math.floor(s)
    r = 1 + 0.035 * smooth((f - 0.65) / 0.25)
    v.x *= r
    v.z *= r
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  const nrm = g.attributes.normal
  const col = new Float32Array(p.count * 3)
  let top = -Infinity
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    if (Math.hypot(x, z) < radius * 0.18) top = Math.max(top, y)
    const ny = nrm.getY(i)
    const grain = fbm2(x * 0.35 + seed, z * 0.35 + y * 0.5, 4)
    const crev = fbm2(x * 0.9 - seed, y * 0.9 + z * 0.4, 3)
    const shade = (0.75 + grain * 0.5) * (0.7 + 0.3 * smooth(crev * 1.6 - 0.2))
    const mossAmt = mossy * smooth((ny - 0.5) / 0.35) * smooth((y - waterline - 0.8) / 2.5) * (0.55 + 0.45 * grain)
    const wetAmt = 1 - smooth((y - waterline + 0.6) / 2.2)
    for (let k = 0; k < 3; k++) {
      let c = stone[k] * shade
      c += (moss[k] * (0.8 + grain * 0.4) - c) * mossAmt
      c += (wet[k] - c) * wetAmt * 0.85
      col[i * 3 + k] = c
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.userData.top = top
  return g
}

export function shoreRockMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
}

export function createLandscape() {
  const root = new THREE.Group()
  root.name = 'landscape'
  const R = rng(777)

  // ---------- 远山 ----------
  root.add(mountainRing({ radius: 40000, spread: 5000, height: 6000, seed: 3.3, color: 0x04060d, topColor: 0x0b1226, sector: -0.2 }))
  root.add(mountainRing({ radius: 31000, spread: 3000, height: 3000, seed: 8.1, color: 0x03050a, topColor: 0x080d1c, sector: 0.1 }))
  // 舞台背后（+Z 方向）远海上的低矮岛屿剪影
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.92, flatShading: true })
  for (const [x, z, r] of [[-9000, 17000, 2600], [13000, 21000, 3400], [4000, 26000, 2200], [-20000, 9000, 3000]]) {
    const m = new THREE.Mesh(rock(r, x * 0.001, 0.35, 2), rockMat)
    m.position.set(x, WATER_Y - 20, z)
    root.add(m)
  }

  // ---------- 右侧岬角岛 ----------
  const capeMat = new THREE.MeshStandardMaterial({ color: 0x0b0f18, roughness: 0.95, flatShading: true })
  const cape = new THREE.Mesh(rock(2600, 4.2, 0.28, 4), capeMat)
  cape.position.set(12600, WATER_Y - 30, -600)
  cape.scale.set(1.3, 1, 0.9)
  root.add(cape)
  // 岛上零星的灯
  {
    const pos = [], size = [], color = [], alpha = []
    for (let i = 0; i < 90; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 2200
      const x = 12600 + Math.cos(a) * r * 1.3, z = -600 + Math.sin(a) * r * 0.9
      pos.push(x, WATER_Y + 60 + R() * 160 * (1 - r / 2200), z)
      size.push(14 + R() * 10)
      const w = R() < 0.8
      color.push(w ? 1.0 : 0.4, w ? 0.7 : 0.8, w ? 0.4 : 1.0)
      alpha.push(1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3))
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alpha, 1))
    root.add(new THREE.Points(g, glowPointMaterial({ size: 1.4 })))
  }

  // ---------- 跨海大桥 ----------
  const bridge = new THREE.Group()
  const A = new THREE.Vector3(3900, 0, coastZ(3900) + 80)
  const B = new THREE.Vector3(11200, 0, -900)
  const span = B.clone().sub(A)
  const L = span.length()
  const dir = span.clone().normalize()
  const side = new THREE.Vector3(-dir.z, 0, dir.x)
  const deckY = WATER_Y + 170
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a2233, metalness: 0.4, roughness: 0.55 })
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L, 14, 96), steel)
  deck.position.copy(A).addScaledVector(span, 0.5).setY(deckY)
  deck.rotation.y = -Math.atan2(dir.z, dir.x)
  bridge.add(deck)
  const at = (f, lat = 0, y = 0) => A.clone().addScaledVector(span, f).addScaledVector(side, lat).setY(y)
  const pylonH = 1150
  const pylons = [0.28, 0.72]
  for (const f of pylons) {
    for (const lat of [-56, 56]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(34, pylonH, 34), steel)
      leg.position.copy(at(f, lat, WATER_Y + pylonH / 2))
      leg.rotation.y = deck.rotation.y
      bridge.add(leg)
    }
    for (const hh of [deckY - WATER_Y - 30, 620, 1100]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 30, 140), steel)
      beam.position.copy(at(f, 0, WATER_Y + hh))
      beam.rotation.y = deck.rotation.y
      bridge.add(beam)
    }
  }
  // 主缆：锚点 → 塔顶 → 下垂 → 塔顶 → 锚点
  const cableLights = []
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x2a3446, metalness: 0.6, roughness: 0.4 })
  const hangerPos = []
  for (const lat of [-50, 50]) {
    const pts = []
    const topY = WATER_Y + pylonH - 10
    const f0 = pylons[0], f1 = pylons[1]
    for (let i = 0; i <= 120; i++) {
      const f = i / 120
      let y
      if (f < f0) y = THREE.MathUtils.lerp(deckY + 10, topY, Math.pow(f / f0, 1.4))
      else if (f > f1) y = THREE.MathUtils.lerp(deckY + 10, topY, Math.pow((1 - f) / (1 - f1), 1.4))
      else {
        const k = (f - f0) / (f1 - f0)
        y = deckY + 60 + (topY - deckY - 60) * Math.pow(2 * k - 1, 2)
      }
      pts.push(at(f, lat, y))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    bridge.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 4, 6), cableMat))
    for (let i = 0; i <= 160; i++) cableLights.push(curve.getPoint(i / 160))
    for (let i = 2; i < 120; i += 2) {
      const p = pts[i]
      hangerPos.push(p.x, p.y, p.z, p.x, deckY + 7, p.z)
    }
  }
  const hg = new THREE.BufferGeometry()
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hangerPos, 3))
  bridge.add(new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0x3a4a66, transparent: true, opacity: 0.6 })))

  // 桥灯：主缆灯链（白）+ 桥面路灯（暖）+ 塔顶红灯
  const lights = { pos: [], size: [], color: [], alpha: [] }
  const addLight = (p, s, c) => {
    lights.pos.push(p.x, p.y, p.z)
    lights.size.push(s)
    lights.color.push(c[0], c[1], c[2])
    lights.alpha.push(1)
  }
  for (const p of cableLights) addLight(p, 18, [0.9, 0.95, 1.2])
  for (let i = 0; i <= 110; i++) for (const lat of [-46, 46]) addLight(at(i / 110, lat, deckY + 26), 22, [1.4, 0.9, 0.5])
  for (const f of pylons) for (const lat of [-56, 56]) addLight(at(f, lat, WATER_Y + pylonH + 12), 40, [2.0, 0.2, 0.15])
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lights.pos, 3))
  lg.setAttribute('aSize', new THREE.Float32BufferAttribute(lights.size, 1))
  lg.setAttribute('aColor', new THREE.Float32BufferAttribute(lights.color, 3))
  lg.setAttribute('aAlpha', new THREE.Float32BufferAttribute(lights.alpha, 1))
  const bridgeLightMat = glowPointMaterial({ size: 1.2 })
  bridge.add(new THREE.Points(lg, bridgeLightMat))

  // 车流：两个方向，白色车头灯 / 红色尾灯
  const CARS = 420
  const cp = new Float32Array(CARS * 3)
  const cT = new Float32Array(CARS)
  const cLane = new Float32Array(CARS)
  for (let i = 0; i < CARS; i++) {
    cT[i] = R()
    cLane[i] = (i % 4) - 1.5
  }
  const carGeo = new THREE.BufferGeometry()
  carGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3))
  carGeo.setAttribute('aT', new THREE.BufferAttribute(cT, 1))
  carGeo.setAttribute('aLane', new THREE.BufferAttribute(cLane, 1))
  const carMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uA: { value: A.clone().setY(deckY + 12) }, uSpan: { value: span }, uSide: { value: side }, uAmount: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aT;
      attribute float aLane;
      uniform float uTime, uAmount;
      uniform vec3 uA, uSpan, uSide;
      varying vec3 vCol;
      varying float vOn;
      void main() {
        float dirSign = aLane > 0.0 ? 1.0 : -1.0;
        float f = fract(aT + uTime * 0.018 * dirSign * (0.8 + 0.4 * fract(aT * 17.0)));
        vec3 p = uA + uSpan * f + uSide * aLane * 18.0;
        vOn = step(fract(aT * 31.7), uAmount);
        vCol = dirSign > 0.0 ? vec3(1.6, 1.5, 1.3) : vec3(1.8, 0.15, 0.1);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(9000.0 / -mv.z, 1.0, 10.0) * vOn;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(vCol * a * a, 1.0);
      }
    `,
  })
  const cars = new THREE.Points(carGeo, carMat)
  cars.frustumCulled = false
  bridge.add(cars)
  root.add(bridge)

  // ---------- 灯塔礁 ----------
  const LH = new THREE.Vector3(-1900, WATER_Y, -520)
  const reef = new THREE.Group()
  reef.position.copy(LH)
  const reefMat = new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.9, flatShading: true })
  const bigRock = new THREE.Mesh(rock(150, 1.7, 0.55, 3), reefMat)
  bigRock.scale.set(1.4, 1, 1.1)
  reef.add(bigRock)
  for (let i = 0; i < 9; i++) {
    const r = new THREE.Mesh(rock(18 + R() * 45, i * 3.1, 0.7, 2), reefMat)
    const a = R() * Math.PI * 2
    r.position.set(Math.cos(a) * (170 + R() * 120), 0, Math.sin(a) * (140 + R() * 100))
    reef.add(r)
  }
  // 塔身：红白条纹车削体
  const prof = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    prof.push(new THREE.Vector2(20 - 7 * t, 70 + t * 250))
  }
  const towerGeo = new THREE.LatheGeometry(prof, 24)
  const tc = []
  const tp = towerGeo.attributes.position
  for (let i = 0; i < tp.count; i++) {
    const band = Math.floor((tp.getY(i) - 70) / 50) % 2
    band ? tc.push(0.6, 0.05, 0.06) : tc.push(0.85, 0.85, 0.82)
  }
  towerGeo.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3))
  const tower = new THREE.Mesh(towerGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }))
  reef.add(tower)
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 5, 24), new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness: 0.6, roughness: 0.4 }))
  gallery.position.y = 322
  reef.add(gallery)
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 2.2) }))
  lantern.position.y = 337
  reef.add(lantern)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x401010, roughness: 0.5 }))
  cap.position.y = 349
  reef.add(cap)
  // 双向光柱
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uInt: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vAlong = uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uInt;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float fade = pow(vAlong, 2.5);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * edge * fade * 0.22 * uInt, 1.0);
      }
    `,
  })
  const beamGroup = new THREE.Group()
  beamGroup.position.y = 337
  for (const s of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(6, 240, 2800, 24, 1, true).translate(0, -1400, 0), beamMat)
    cone.rotation.z = (s * Math.PI) / 2
    cone.rotation.x = 0.03
    beamGroup.add(cone)
  }
  reef.add(beamGroup)
  root.add(reef)

  return {
    object: root,
    lighthouse: LH.clone().setY(WATER_Y + 337),
    update(state) {
      carMat.uniforms.uTime.value = state.t
      carMat.uniforms.uAmount.value = state.traffic * (1 - state.fall)
      bridgeLightMat.uniforms.uFade.value = (0.35 + 0.65 * Math.min(1, state.city * 1.4)) * (1 - 0.85 * state.fall)
      beamGroup.rotation.y = state.t * 0.55
      beamMat.uniforms.uInt.value = 1 - 0.5 * state.hush
    },
  }
}
