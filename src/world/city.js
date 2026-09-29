import * as THREE from 'three'
import { rng, WATER_Y, canvasTexture } from './util.js'
import { createBuildingMaterial, updateBuildingUniforms } from './kit.js'

// 霓虹海湾城市（中远景）：
// - ~1200 栋楼用一个 InstancedMesh，窗户/霓虹/被"调用"击中的闪光全在 shader 里
// - 地标：深海尖塔（中景细节）、巨幅广告屏大楼、楼顶霓虹招牌
// - 远处更粗糙：只是更暗更稀的盒子，靠雾吃掉

export const coastZ = (x) => -6300 + 2600 * Math.pow(Math.min(1, Math.abs(x) / 15000), 2) + 380 * Math.sin(x / 2300) + 160 * Math.sin(x / 830 + 1.3)
export const GROUND_Y = WATER_Y + 12 // 滨海步道比海面高约 1m，也避免远处海面与地面深度打架
const CITY_X = 16000

const NEON = [
  new THREE.Color(0.1, 0.75, 1.0), // 青
  new THREE.Color(1.0, 0.25, 0.7), // 洋红
  new THREE.Color(0.55, 0.35, 1.0), // 紫
  new THREE.Color(1.0, 0.62, 0.25), // 琥珀
  new THREE.Color(0.25, 0.45, 1.0), // 深海蓝
]

function neonSignTexture(text, color, { font = '700 150px "Monoton", "Pacifico", "Arial Black", sans-serif', w = 1024, h = 256 } = {}) {
  return canvasTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h)
    g.font = font
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.shadowColor = color
    for (const [blur, lw, a] of [[40, 16, 0.35], [18, 9, 0.6], [6, 5, 1]]) {
      g.shadowBlur = blur
      g.globalAlpha = a
      g.strokeStyle = color
      g.lineWidth = lw
      g.strokeText(text, w / 2, h / 2)
    }
    g.globalAlpha = 1
    g.shadowBlur = 8
    g.lineWidth = 2.5
    g.strokeStyle = '#ffffff'
    g.strokeText(text, w / 2, h / 2)
  })
}

export function createCity({ screens }) {
  const root = new THREE.Group()
  root.name = 'city'
  const R = rng(20260929)

  // ---------- 地面与海堤 ----------
  const shape = new THREE.Shape()
  const xs = []
  for (let x = -26000; x <= 26000; x += 250) xs.push(x)
  shape.moveTo(xs[0], -coastZ(xs[0]))
  for (const x of xs) shape.lineTo(x, -coastZ(x))
  shape.lineTo(26000, 40000)
  shape.lineTo(-26000, 40000)
  const land = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2).translate(0, GROUND_Y, 0),
    new THREE.MeshStandardMaterial({ color: 0x06080f, roughness: 0.95 }),
  )
  root.add(land)

  // 海堤立面 + 滨海步道路灯
  const wallPts = []
  const lampPos = []
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const z = coastZ(x)
    wallPts.push(new THREE.Vector3(x, 0, z))
    if (Math.abs(x) < 17000) for (let k = 0; k < 4; k++) lampPos.push(x + k * 62, GROUND_Y + 22, coastZ(x + k * 62) + 6)
  }
  {
    const pos = []
    for (let i = 0; i < wallPts.length - 1; i++) {
      const a = wallPts[i], b = wallPts[i + 1]
      pos.push(a.x, WATER_Y - 4, a.z, b.x, WATER_Y - 4, b.z, b.x, GROUND_Y, b.z, a.x, WATER_Y - 4, a.z, b.x, GROUND_Y, b.z, a.x, GROUND_Y, a.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x0b0f1a, roughness: 0.8, side: THREE.DoubleSide })))
  }

  // ---------- 楼群 ----------
  const slots = []
  const cellMid = 400
  for (let gx = -CITY_X; gx < CITY_X; gx += cellMid) {
    const cz = coastZ(gx + cellMid / 2)
    for (let gz = cz - 180; gz > cz - 9500; gz -= cellMid) {
      const depth = cz - gz
      if (R() > 0.7 - depth / 25000) continue
      const x = gx + R() * cellMid * 0.3 + cellMid * 0.35
      const z = gz - R() * cellMid * 0.3
      const downtown = Math.exp(-Math.pow((x - 600) / 5200, 2)) * Math.exp(-Math.pow((z + 8600) / 3800, 2))
      const water = Math.exp(-depth / 900)
      const w = 140 + R() * 220
      const d = 140 + R() * 220
      const h = (110 + Math.pow(R(), 2.2) * (380 + 2800 * downtown)) * (1 - 0.45 * water)
      slots.push({ x, z, w, d, h, far: false })
    }
  }
  // 远景：更远更稀的一圈
  for (let i = 0; i < 700; i++) {
    const a = -Math.PI * 0.5 + (R() - 0.5) * Math.PI * 0.95
    const dist = 17000 + R() * 9000
    const x = Math.sin(a) * dist * 1.25
    const z = -Math.cos(a) * dist
    if (z > coastZ(x) - 9000) continue
    const w = 250 + R() * 450
    slots.push({ x, z, w, d: w * (0.7 + R() * 0.6), h: 200 + Math.pow(R(), 2) * 1800, far: true })
  }

  // 广告屏大楼作为一个固定实例
  const billboard = { x: -2700, z: -7050, w: 520, d: 380, h: 2100, far: false, fixed: true }
  slots.push(billboard)

  const count = slots.length
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const aSeed = new Float32Array(count)
  const aNeon = new Float32Array(count * 3)
  const aFlash = new Float32Array(count)
  const aDensity = new Float32Array(count)
  const mat = createBuildingMaterial({ extentX: CITY_X })
  const mesh = new THREE.InstancedMesh(boxGeo, mat, count)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  slots.forEach((s, i) => {
    const rot = s.fixed ? 0.28 : (R() - 0.5) * 0.25
    q.setFromAxisAngle(up, rot)
    m4.compose(new THREE.Vector3(s.x, GROUND_Y, s.z), q, new THREE.Vector3(s.w, s.h, s.d))
    mesh.setMatrixAt(i, m4)
    aSeed[i] = R() * 100
    const c = NEON[Math.floor(R() * NEON.length)]
    aNeon.set([c.r, c.g, c.b], i * 3)
    aDensity[i] = s.far ? 0.15 + R() * 0.25 : 0.18 + R() * 0.4
    s.index = i
  })
  boxGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1))
  boxGeo.setAttribute('aNeon', new THREE.InstancedBufferAttribute(aNeon, 3))
  const flashAttr = new THREE.InstancedBufferAttribute(aFlash, 1)
  flashAttr.setUsage(THREE.DynamicDrawUsage)
  boxGeo.setAttribute('aFlash', flashAttr)
  boxGeo.setAttribute('aDensity', new THREE.InstancedBufferAttribute(aDensity, 1))
  mesh.frustumCulled = false
  root.add(mesh)

  // ---------- 航空障碍灯（高楼顶上闪红灯）----------
  const aviation = []
  for (const s of slots) if (s.h > 800) aviation.push(s.x, GROUND_Y + s.h + 8, s.z, Math.random())
  const avGeo = new THREE.BufferGeometry()
  const avPos = new Float32Array((aviation.length / 4) * 3)
  const avPhase = new Float32Array(aviation.length / 4)
  for (let i = 0; i < aviation.length / 4; i++) {
    avPos.set(aviation.slice(i * 4, i * 4 + 3), i * 3)
    avPhase[i] = aviation[i * 4 + 3]
  }
  avGeo.setAttribute('position', new THREE.BufferAttribute(avPos, 3))
  avGeo.setAttribute('aPhase', new THREE.BufferAttribute(avPhase, 1))
  const avMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAlive: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      varying float vOn;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vOn = step(fract(uTime * 0.6 + aPhase), 0.18);
        gl_PointSize = clamp(90000.0 / -mv.z, 2.0, 14.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlive;
      varying float vOn;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(vec3(1.0, 0.1, 0.08) * a * a * (0.25 + vOn * 2.5) * uAlive, 1.0);
      }
    `,
  })
  root.add(new THREE.Points(avGeo, avMat))

  // 滨海步道路灯
  const lampGeo = new THREE.BufferGeometry()
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3))
  const lampMat = new THREE.PointsMaterial({ color: new THREE.Color(1.0, 0.72, 0.4).multiplyScalar(2.2), size: 3.2, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  root.add(new THREE.Points(lampGeo, lampMat))

  // ---------- 地标：深海尖塔 ----------
  const spire = new THREE.Group()
  spire.position.set(700, GROUND_Y, -7900)
  const spireMat = new THREE.MeshStandardMaterial({ color: 0x0b1224, metalness: 0.85, roughness: 0.32, envMapIntensity: 0.6 })
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.85, 1.0).multiplyScalar(3) })
  const spireRings = []
  const edgePos = []
  let y = 0
  for (let i = 0; i < 11; i++) {
    const r0 = 260 * Math.pow(0.86, i)
    const r1 = 260 * Math.pow(0.86, i + 1)
    const hh = 320 - i * 12
    const rot = 0
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, hh, 8, 1), spireMat)
    seg.position.y = y + hh / 2
    seg.rotation.y = rot
    spire.add(seg)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r1 * 1.04, 3.2 + r1 * 0.012, 6, 48), ringMat.clone())
    ring.rotation.x = Math.PI / 2
    ring.position.y = y + hh
    spire.add(ring)
    spireRings.push(ring)
    // 八棱柱的棱线做成竖向灯条
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rot
      const e = 1.012
      edgePos.push(Math.sin(a) * r0 * e, y, Math.cos(a) * r0 * e, Math.sin(a) * r1 * e, y + hh, Math.cos(a) * r1 * e)
    }
    y += hh
  }
  const edgeGeo = new THREE.BufferGeometry()
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.3, 0.5, 1.0).multiplyScalar(2) })
  spire.add(new THREE.LineSegments(edgeGeo, edgeMat))
  const needle = new THREE.Mesh(new THREE.ConeGeometry(18, 700, 8), spireMat)
  needle.position.y = y + 350
  spire.add(needle)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) }))
  beacon.position.y = y + 720
  spire.add(beacon)
  const spireTop = new THREE.Vector3(700, GROUND_Y + y + 720, -7900)
  root.add(spire)

  // ---------- 地标：巨幅广告屏 ----------
  const screenMat = new THREE.MeshBasicMaterial({ map: screens.texture, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: true })
  const screenW = 480, screenH = 270
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), screenMat)
  const bbRot = 0.28
  const nrm = new THREE.Vector3(Math.sin(bbRot), 0, Math.cos(bbRot))
  screen.position.set(billboard.x, GROUND_Y + 1450, billboard.z).addScaledVector(nrm, billboard.d / 2 + 3)
  screen.rotation.y = bbRot
  root.add(screen)
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(screenW + 24, screenH + 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.6, 1.4) }))
  frame.position.copy(screen.position).addScaledVector(nrm, -1)
  frame.rotation.y = bbRot
  root.add(frame)

  // ---------- 楼顶霓虹招牌 ----------
  const signDefs = [
    ['DEEP SEA JAZZ', '#29c8ff', 1],
    ['TOOL CALL', '#ff3fae', 2],
    ['JSON BAR', '#ffa640', 3],
    ['HONEY 24H', '#b36bff', 4],
    ['白饭', '#29c8ff', 5, '700 180px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'],
    ['LET ME GO', '#ff3fae', 6],
  ]
  // 选靠近海岸、朝向舞台、高度适中的楼放招牌
  const candidates = slots
    .filter((s) => !s.far && !s.fixed && s.h > 260 && s.h < 1100 && Math.abs(s.x) < 7000 && s.z > coastZ(s.x) - 2200)
    .sort((a, b) => a.x - b.x)
  const signs = []
  signDefs.forEach(([text, color, seed, font], i) => {
    const s = candidates[Math.floor(((i + 0.5) / signDefs.length) * candidates.length)]
    if (!s) return
    const tex = neonSignTexture(text, color, font ? { font } : undefined)
    const sw = Math.max(s.w * 1.2, 360)
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sw / 4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2, 2, 2), side: THREE.DoubleSide }),
    )
    m.position.set(s.x, GROUND_Y + s.h + sw / 8 + 10, s.z)
    m.lookAt(0, m.position.y * 0.7, 0)
    m.userData.seed = seed
    root.add(m)
    signs.push(m)
  })

  // ---------- endpoint：给工具调用光束的落点 ----------
  const endpoints = slots
    .filter((s) => !s.far && !s.fixed && s.h > 600 && Math.abs(s.x) < 9000)
    .map((s) => ({ pos: new THREE.Vector3(s.x, GROUND_Y + s.h, s.z), index: s.index }))
  // 打乱顺序，保证相邻两次调用落在不同地方
  for (let i = endpoints.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1))
    ;[endpoints[i], endpoints[j]] = [endpoints[j], endpoints[i]]
  }
  endpoints.length = Math.min(endpoints.length, 48)
  endpoints.push({ pos: spireTop.clone(), index: -1, spire: true })
  endpoints.push({ pos: new THREE.Vector3(billboard.x, GROUND_Y + billboard.h, billboard.z), index: billboard.index })

  const flashTouched = new Set()
  let spireFlash = 0

  return {
    object: root,
    endpoints,
    beginFlash() {
      for (const i of flashTouched) aFlash[i] = 0
      flashTouched.clear()
      spireFlash = 0
    },
    addFlash(ep, v) {
      if (ep.index >= 0) {
        aFlash[ep.index] = Math.max(aFlash[ep.index], v)
        flashTouched.add(ep.index)
      } else spireFlash = Math.max(spireFlash, v)
    },
    update(state) {
      flashAttr.needsUpdate = true
      updateBuildingUniforms(mat, state)
      avMat.uniforms.uTime.value = state.t
      const alive = 1 - state.fall
      lampMat.opacity = 0.3 + 0.7 * Math.min(1, state.city * 1.5) * alive
      // 尖塔光环：自下而上流动 + 节拍
      spireRings.forEach((r, i) => {
        const wave = 0.5 + 0.5 * Math.sin(state.t * 3 - i * 0.8)
        const k = (0.25 + state.neon * (0.6 + 0.8 * wave) + state.pulse * 0.8 + spireFlash * 3) * alive
        r.material.color.setRGB(0.2 * k * 3, 0.85 * k * 3, 1.0 * k * 3)
      })
      const bk = (1.5 + 5 * (0.5 + 0.5 * Math.sin(state.t * 4)) + spireFlash * 20) * (0.3 + 0.7 * alive)
      beacon.material.color.setRGB(bk, bk * 0.9, bk)
      const sk = (0.4 + 2.0 * Math.min(1, state.city * 1.3)) * (1 - state.fall * 0.9)
      screenMat.color.setRGB(sk, sk, sk)
      frame.material.color.setRGB(0.2 * sk * state.neon, 0.6 * sk * state.neon, 1.4 * sk * state.neon)
      // 招牌：按顺序点亮，启动时闪几下
      signs.forEach((m, i) => {
        const on = state.neon > 0.12 + i * 0.06 ? 1 : 0
        const flick = state.neon < 0.95 && Math.sin(state.t * 40 + i * 7) > 0.6 ? 0.3 : 1
        const glitch = state.glitch > 0.3 && Math.sin(state.t * 57 + i) > 0 ? 0.1 : 1
        const k = on * flick * glitch * (1.4 + state.pulse * 0.8) * state.neon * (1 - state.fall)
        m.material.color.setRGB(k, k, k)
      })
    },
  }
}
