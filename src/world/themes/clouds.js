import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, GLSL_NOISE, canvasTexture, glowPointMaterial, bakeStatic } from '../util.js'
import { createWhales } from '../whales.js'
import { createParticles } from '../particles.js'
import {
  createLightRig, beamMaterial, beamGeometry, floatingIslandGeometry, islandCrystals, cloudCluster, waterfallMaterial, mistBank, billboardClouds,
} from '../kit.js'
import { forestSprites, createTree, meadow, scatterOnTop } from '../trees.js'

// 主题：梦幻云层群 —— 日落后的云海之上
// 近景：浮空的白大理石圆台（星图镶金）、金色光环门（灯像港湾的灯泡墙一样跟节奏）、水晶尖柱、
//       往镜头方向一级级飘着的台阶、金竖琴、会转的浑天仪、小瀑布坠入云海
// 中景：二十多座浮空岛（白塔蓝顶、树、瀑布）、天空城、热气球
// 远景：金粉色落日、积雨云塔、彩虹、无边的云海

const CLOUD_Y = -70
const SUN = [-0.2, 0.07, -1]

function starMapTexture() {
  const R = rng(4)
  return canvasTexture(1024, 1024, (g, w) => {
    const c = w / 2
    const grd = g.createRadialGradient(c, c, 50, c, c, c)
    grd.addColorStop(0, '#c9c3dc')
    grd.addColorStop(1, '#aeb0cc')
    g.fillStyle = grd
    g.fillRect(0, 0, w, w)
    g.strokeStyle = '#c9a052'
    for (const [r, lw] of [[500, 10], [470, 3], [330, 5], [180, 3]]) {
      g.lineWidth = lw
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke()
    }
    // 八芒星
    g.lineWidth = 4
    g.beginPath()
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2
      const r = i % 2 ? 150 : 470
      i ? g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r) : g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r)
    }
    g.closePath()
    g.stroke()
    // 星座连线
    g.fillStyle = '#c9a052'
    for (let k = 0; k < 7; k++) {
      const a0 = R() * Math.PI * 2, r0 = 200 + R() * 240
      let px = c + Math.cos(a0) * r0, py = c + Math.sin(a0) * r0
      for (let j = 0; j < 5; j++) {
        const nx = px + (R() - 0.5) * 120, ny = py + (R() - 0.5) * 120
        g.lineWidth = 1.5
        g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke()
        g.beginPath(); g.arc(nx, ny, 5, 0, Math.PI * 2); g.fill()
        px = nx; py = ny
      }
    }
    // 鲸
    g.fillStyle = '#b8903e'
    g.save(); g.translate(c, c + 6); g.scale(3.2, 3.2)
    g.beginPath(); g.moveTo(-30, 0); g.bezierCurveTo(-30, -22, 10, -26, 26, -8); g.bezierCurveTo(34, 2, 40, -2, 46, -14)
    g.bezierCurveTo(48, -2, 44, 8, 36, 10); g.bezierCurveTo(18, 24, -30, 22, -30, 0); g.fill()
    g.restore()
  })
}

// 白塔的贴图：石墙 + 拱窗（自发光贴图只亮窗）
function towerTextures() {
  const R = rng(12)
  const draw = (lit) => (g, w, h) => {
    g.fillStyle = lit ? '#000' : '#eeeaf4'
    g.fillRect(0, 0, w, h)
    if (!lit) {
      g.strokeStyle = 'rgba(150,140,170,0.25)'
      for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
    }
    for (let y = 20; y < h - 20; y += 64) for (let x = 12; x < w - 12; x += 48) {
      const on = R() < 0.6
      g.fillStyle = lit ? (on ? '#ffb45e' : '#000') : '#2a2f4a'
      g.beginPath()
      g.moveTo(x, y + 40); g.lineTo(x, y + 12); g.arc(x + 11, y + 12, 11, Math.PI, 0); g.lineTo(x + 22, y + 40); g.closePath()
      g.fill()
    }
  }
  return {
    map: canvasTexture(256, 512, draw(false), { repeat: true }),
    emissive: canvasTexture(256, 512, draw(true), { repeat: true }),
  }
}

// 云海：极坐标网格（近处密、远处疏），顶点按"积云顶"噪声真正起伏（有体积和地平线上的轮廓），
// 片元用同一个场的梯度打光：鼓包迎光面亮、沟里是紫色阴影，背光处有透亮的边
const SEA_FIELD = /* glsl */ `
  vec2 hash22s(vec2 p) { return vec2(hash12(p), hash12(p + 17.31)); }
  // Worley F1（平方距离）→ 圆顶：一格一个鼓包，格与格之间是折痕
  float dome(vec2 p) {
    p += vec2(fbm(p * 0.37), fbm(p * 0.37 + 9.2)) * 0.9; // 扭曲一下，别像绗缝枕头那样整齐
    vec2 i = floor(p), f = fract(p);
    float d = 8.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 r = g + 0.15 + 0.7 * hash22s(i + g) - f;
        d = min(d, dot(r, r));
      }
    // 高低变化用连续的低频噪声（逐格随机高度会在格子边界上断成台阶）
    return sqrt(max(0.0, 1.0 - d * 1.1)) * (0.55 + 0.6 * fbm(p * 0.21 + 3.3));
  }
  // 积云顶：大鼓包上长中鼓包、中鼓包上长小鼓包（花椰菜），远处逐级淡掉避免闪烁
  float seaField(vec2 p, float t, float dist) {
    vec2 q = p * 0.0011 + vec2(t * 0.004, t * 0.002);
    float big = dome(q) * 0.6 + fbm(q * 0.4) * 0.4;
    float mid = dome(q * 3.1 + 5.1);
    float sm = dome(q * 9.0 + 1.7);
    float fm = exp(-dist / 16000.0), fs = exp(-dist / 4500.0);
    return big * 0.62 + (mid - 0.5) * 0.26 * fm + (sm - 0.5) * 0.12 * fs + 0.19 * (1.0 - fm);
  }
  float seaAmp(vec2 p) {
    float d = length(p);
    return 190.0 * (1.0 - smoothstep(8000.0, 60000.0, d)) + 30.0;
  }
`
function cloudSeaGeometry() {
  const radial = 512, rings = 360
  const pos = [], idx = []
  for (let i = 0; i <= rings; i++) {
    const u = i / rings
    const r = i === 0 ? 0 : 60 * Math.pow(80000 / 60, u)
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2 + (i % 2) * (Math.PI / radial)
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r)
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial
      const a = i * radial + j, b = i * radial + j1, c = (i + 1) * radial + j, d = (i + 1) * radial + j1
      idx.push(a, b, c, b, d, c)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 90000)
  return g
}

function cloudSeaMaterial() {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(...SUN).normalize() },
      uLit: { value: new THREE.Color(1.0, 0.7, 0.56) },
      uShade: { value: new THREE.Color(0.2, 0.16, 0.36) },
      uGlow: { value: 0 },
      uHush: { value: 0 },
    },
  ])
  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW;
      varying float vH;
      #include <fog_pars_vertex>
      ${GLSL_NOISE}
      ${SEA_FIELD}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vH = seaField(wp.xz, uTime, length(cameraPosition.xz - wp.xz));
        wp.y += (vH - 0.5) * seaAmp(wp.xz);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGlow, uHush;
      uniform vec3 uSun, uLit, uShade;
      varying vec3 vW;
      varying float vH;
      #include <fog_pars_fragment>
      ${GLSL_NOISE}
      ${SEA_FIELD}
      void main() {
        vec2 p = vW.xz;
        float dist = length(cameraPosition - vW);
        float e = 4.0 + dist * 0.002;
        float h0 = seaField(p, uTime, dist);
        float hx = seaField(p + vec2(e, 0.0), uTime, dist), hz = seaField(p + vec2(0.0, e), uTime, dist);
        float amp = seaAmp(p);
        vec3 N = normalize(vec3(-(hx - h0) * amp / e, 1.0, -(hz - h0) * amp / e));
        float ndl = dot(N, uSun);
        // 云的"透光"：迎光面亮，背光面仍有散射；折痕和沟底更暗（自遮挡）
        float lightAmt = smoothstep(-0.45, 0.75, ndl) * 0.8 + smoothstep(0.35, 0.8, h0) * 0.3;
        vec3 col = mix(uShade, uLit, clamp(lightAmt, 0.0, 1.0));
        col *= 0.62 + 0.45 * smoothstep(0.2, 0.75, h0);
        // 蓬松的细碎明暗
        float fine = fbm(p * 0.03 + uTime * 0.02);
        col *= 0.92 + 0.16 * fine * exp(-dist / 2500.0);
        // 背光时鼓包轮廓上的银边
        vec3 V = normalize(cameraPosition - vW);
        float back = pow(max(dot(-V, uSun), 0.0), 8.0);
        float edge = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        col += uLit * back * edge * 0.9;
        // 云里透出来的粉紫微光（跟着 state.sea）
        float pockets = smoothstep(0.55, 0.9, fbm(p * 0.0025 + uTime * 0.01));
        col += vec3(1.0, 0.45, 0.85) * pockets * uGlow * 0.35 * exp(-dist / 6000.0);
        col *= 1.0 - 0.3 * uHush;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

// 浮空岛上的奇幻建筑：几座白塔（锥形尖顶）+ 小圆顶 + 树
function islandTown(R, r, mats, lights, endpoints, spots = 5) {
  const g = new THREE.Group()
  for (let k = 0; k < spots; k++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r * 0.55
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    const tr = r * (0.05 + R() * 0.05)
    const th = tr * (3 + R() * 6)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr * 1.08, th, 16), mats.tower)
    body.position.set(x, th / 2, z)
    g.add(body)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(tr * 1.35, tr * 3.2, 16), R() < 0.6 ? mats.roofBlue : mats.roofViolet)
    roof.position.set(x, th + tr * 1.6, z)
    g.add(roof)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(tr * 1.12, tr * 0.08, 6, 24), mats.gold)
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, th, z)
    g.add(ring)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(tr * 0.12, tr * 1.2, 8), mats.gold)
    tip.position.set(x, th + tr * 3.8, z)
    g.add(tip)
    lights.push([new THREE.Vector3(x, th + tr * 0.4, z), tr * 1.6, [1.0, 0.7, 0.4]])
    if (k === 0) endpoints.push({ local: new THREE.Vector3(x, th + tr * 4.4, z) })
  }
  for (let k = 0; k < 2; k++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r * 0.5
    const dr = r * (0.08 + R() * 0.06)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(dr, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.dome)
    dome.position.set(Math.cos(a) * d, dr * 0.6, Math.sin(a) * d)
    g.add(dome)
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(dr, dr, dr * 0.6, 20), mats.tower)
    drum.position.set(Math.cos(a) * d, dr * 0.3, Math.sin(a) * d)
    g.add(drum)
  }
  // 树：手绘剪影精灵（阔叶 + 柏），跟着岛一起浮动
  const nT = Math.round(14 + r / 18)
  const list = []
  for (let k = 0; k < nT; k++) {
    const a = R() * Math.PI * 2, d = r * (0.25 + R() * 0.62)
    list.push({ pos: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), size: r * (0.07 + R() * 0.06), kind: R() < 0.7 ? 'broadleaf' : 'cypress' })
  }
  g.add(forestSprites(list, { tint: [1.15, 0.95, 0.9] }))
  return g
}

export function createCloudsTheme() {
  const root = new THREE.Group()
  root.name = 'theme:clouds'
  const R = rng(3333)

  // ---------- 材质 ----------
  const marble = new THREE.MeshPhysicalMaterial({ color: 0xdcd6e6, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.5 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0b45a, metalness: 1, roughness: 0.25 })
  const crystal = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.8, emissive: 0x3a7aff, emissiveIntensity: 0.6, clearcoat: 1 })
  const tt = towerTextures()
  tt.map.repeat.set(3, 3)
  tt.emissive.repeat.set(3, 3)
  const mats = {
    tower: new THREE.MeshStandardMaterial({ map: tt.map, emissiveMap: tt.emissive, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.7 }),
    roofBlue: new THREE.MeshStandardMaterial({ color: 0x3a5fc8, roughness: 0.45, metalness: 0.2 }),
    roofViolet: new THREE.MeshStandardMaterial({ color: 0x7a5ad0, roughness: 0.45, metalness: 0.2 }),
    gold,
    dome: new THREE.MeshStandardMaterial({ color: 0xe8c56a, metalness: 0.8, roughness: 0.3 }),
    tree: new THREE.MeshStandardMaterial({ color: 0x5f9a5a, roughness: 0.85, flatShading: true }),
  }
  const islandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  const fallMat = waterfallMaterial([1.0, 0.92, 0.95])

  // ---------- 近景：浮空圆台 ----------
  const stage = new THREE.Group()
  const CZ = -8
  {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 2.4, 96), [marble, new THREE.MeshStandardMaterial({ map: starMapTexture(), roughness: 0.62 }), marble])
    top.position.set(0, -1.2, CZ)
    top.receiveShadow = true
    stage.add(top)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(42.2, 0.6, 12, 160), gold)
    rim.rotation.x = Math.PI / 2
    rim.position.set(0, -0.1, CZ)
    stage.add(rim)
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(42, 38, 5, 96, 1, true), marble)
    skirt.position.set(0, -4.9, CZ)
    stage.add(skirt)
    const islandGeo = floatingIslandGeometry({ r: 64, depth: 1.3, seed: 9.1, lobes: 3, top: [0.1, 0.2, 0.07], rock: [0.62, 0.55, 0.62], bottom: [0.3, 0.26, 0.4] })
    const island = new THREE.Mesh(islandGeo, islandMat)
    island.position.set(0, -7, CZ)
    island.receiveShadow = true
    stage.add(island)
    // 圆台外圈的草地和野花
    const grass = meadow(scatterOnTop(islandGeo, { count: 9000, minUp: 0.8, seed: 21 }).filter((p) => Math.hypot(p.pos.x, p.pos.z) > 42.5), { size: 2.6, seed: 22, tint: [1.45, 1.55, 1.3], flowers: [0.45, 0.2, 0.25, 0.1] })
    grass.position.copy(island.position)
    stage.add(grass)
    // 岩壁和底部长出的发光水晶
    const cr = islandCrystals(islandGeo, { count: 14, size: 1.3, material: crystal, seed: 5, below: 8 })
    cr.position.copy(island.position)
    stage.add(cr)
    // 小瀑布：从岛沿垂下
    {
      const a = 2.1
      const er = islandGeo.userData.edgeR(a) * 1.02
      const f = new THREE.Mesh(new THREE.PlaneGeometry(6, 90).translate(0, -45, 0), fallMat)
      f.position.set(Math.cos(a) * er, -6.5, CZ + Math.sin(a) * er)
      f.lookAt(f.position.x * 2, f.position.y, (f.position.z - CZ) * 2 + CZ)
      stage.add(f)
    }
    // 飘浮台阶（向镜头方向一级级往下）
    for (let k = 0; k < 10; k++) {
      const z = 44 + k * 10
      const y = -1.5 - k * 2.6
      const step = new THREE.Mesh(new THREE.BoxGeometry(14 - k * 0.3, 1.4, 7), marble)
      step.position.set(Math.sin(k * 0.5) * 3, y, z)
      step.receiveShadow = true
      stage.add(step)
      const trim = new THREE.Mesh(new THREE.BoxGeometry(14.2 - k * 0.3, 0.3, 7.2), gold)
      trim.position.set(Math.sin(k * 0.5) * 3, y + 0.7, z)
      stage.add(trim)
    }
    // 两棵淡紫花树，种在圆台外圈的草地上
    for (const [x, z, sd] of [[-45, 18, 11], [43, 13, 12]]) {
      const tr = createTree('sakura', { seed: sd, height: 34, tint: [0.9, 0.84, 1.1], glow: 0.08 })
      tr.position.set(x, -7 + islandGeo.userData.topAt(x, z) - 0.8, CZ + z)
      tr.rotation.y = sd
      stage.add(tr)
    }
    // 两根水晶尖柱
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0, 4.5, 56, 6).translate(0, 28, 0), crystal)
      c.position.set(s * 38, 0, CZ - 16)
      stage.add(c)
      const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 2.5, 6), gold)
      base.position.set(s * 38, 1.25, CZ - 16)
      stage.add(base)
    }
    // 金竖琴（左）
    const harp = new THREE.Group()
    const frameCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 12, 0), new THREE.Vector3(3, 17, 0), new THREE.Vector3(8, 15, 0), new THREE.Vector3(10, 11, 0), new THREE.Vector3(8, 2, 0), new THREE.Vector3(0, 0, 0)])
    harp.add(new THREE.Mesh(new THREE.TubeGeometry(frameCurve, 80, 0.45, 8), gold))
    for (let k = 1; k < 12; k++) {
      const x = k * 0.72
      const topY = frameCurve.getPoint(0.2 + (k / 12) * 0.35).y
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, topY - 1.2, 4), new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0x806030 }))
      s.position.set(x, 1 + (topY - 1.2) / 2, 0)
      harp.add(s)
    }
    harp.position.set(-30, 0, 4)
    harp.rotation.y = 0.9
    stage.add(harp)
    // 浑天仪（右，会转）
    const arm = new THREE.Group()
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 8, 16), marble)
    ped.position.y = 4
    arm.add(ped)
    const rings = new THREE.Group()
    rings.position.y = 14
    for (let k = 0; k < 4; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5 - k * 0.4, 0.18, 8, 64), gold)
      ring.rotation.set(k * 0.6, k * 0.9, k * 0.3)
      rings.add(ring)
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.3, 0.6) }))
    rings.add(orb)
    arm.add(rings)
    arm.position.set(30, 0, 2)
    arm.userData.dynamic = true
    stage.add(arm)
    stage.userData.rings = rings
  }

  // 光环门：竖立的金环 + 一圈星灯
  const haloStars = []
  const halo = new THREE.Group()
  {
    const HZ = CZ - 20, HY = 33
    const outer = new THREE.Mesh(new THREE.TorusGeometry(31, 1.3, 16, 160), gold)
    outer.position.set(0, HY, HZ)
    halo.add(outer)
    const inner = new THREE.Mesh(new THREE.TorusGeometry(27, 0.5, 8, 160), gold)
    inner.position.set(0, HY, HZ)
    halo.add(inner)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.5), gold)
      spoke.position.set(Math.cos(a) * 29, HY + Math.sin(a) * 29, HZ)
      spoke.rotation.z = a + Math.PI / 2
      halo.add(spoke)
    }
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2
      haloStars.push(new THREE.Vector3(Math.cos(a) * 29, HY + Math.sin(a) * 29, HZ + 1.2))
    }
    // 底座（环的下缘嵌在两块金色托座里）
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 5), gold)
      b.position.set(s * 9, 2.5, HZ)
      halo.add(b)
    }
    stage.add(halo)
  }
  const starMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), haloStars.length)
  haloStars.forEach((p, i) => {
    starMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z))
    starMesh.setColorAt(i, new THREE.Color(1, 0.8, 0.5))
  })
  stage.add(starMesh)
  const hsGeo = new THREE.BufferGeometry()
  hsGeo.setAttribute('position', new THREE.Float32BufferAttribute(haloStars.flatMap((p) => p.toArray()), 3))
  hsGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(haloStars.map(() => 4), 1))
  const hsCol = new Float32Array(haloStars.length * 3)
  const hsA = new Float32Array(haloStars.length)
  hsGeo.setAttribute('aColor', new THREE.BufferAttribute(hsCol, 3))
  hsGeo.setAttribute('aAlpha', new THREE.BufferAttribute(hsA, 1))
  stage.add(new THREE.Points(hsGeo, glowPointMaterial({ size: 1, maxSize: 50 })))

  // 近处的云团（舞台下面、台阶旁）
  let puffs
  {
    const blobs = []
    const addCluster = (cx, cy, cz, sc, n = 10) => {
      for (const b of cloudCluster(R, { count: n, spread: 1.6, height: 0.5, flat: 0.8 })) blobs.push({ p: b.pos.clone().multiplyScalar(sc).add(new THREE.Vector3(cx, cy, cz)), r: b.r * sc })
    }
    addCluster(0, -26, CZ, 30, 18)
    for (let k = 0; k < 10; k++) addCluster(Math.sin(k * 0.5) * 3, -6 - k * 2.6, 44 + k * 10, 5, 5)
    for (let k = 0; k < 16; k++) {
      const a = R() * Math.PI * 2, d = 90 + R() * 400
      addCluster(Math.sin(a) * d, CLOUD_Y + 10 + R() * 40, Math.cos(a) * d + CZ, 25 + R() * 45, 8)
    }
    puffs = billboardClouds(blobs.map((b) => ({ pos: b.p, size: b.r * 2.8, flat: 0.72 })), { lit: [1.12, 0.86, 0.8], shade: [0.36, 0.3, 0.56], rim: [1.2, 0.72, 0.5], sunDir: SUN, opacity: 0.95 })
    puffs.mesh.renderOrder = 2
    root.add(puffs.mesh)
  }
  bakeStatic(stage)
  root.add(stage)

  // 夕阳光柱（从天空城那边斜射过来）
  const beams = []
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(beamGeometry(60, 700, 9000), beamMaterial([1.0, 0.75, 0.55], 0.05))
    m.position.set(-2400 + i * 1100, 2600, -9000)
    m.rotation.set(-1.25 - i * 0.03, 0, 0.12 * (i - 2))
    m.frustumCulled = false
    root.add(m)
    beams.push(m)
  }

  const rig = createLightRig({
    key: { color: 0xffd8d0, intensity: 5200, pos: [30, 70, 85], target: [0, 8, 0] },
    spots: [{ color: 0xff8ad0, intensity: 2600, pos: [-38, 55, -10] }, { color: 0x8ab8ff, intensity: 2600, pos: [38, 55, -10] }],
    rim: { color: 0xffb070, intensity: 14000, pos: [-10, 30, -90], target: [0, 12, 0] },
    points: [{ color: 0xffc080, intensity: 25, pos: [30, 14, 2] }, { color: 0x9ad0ff, intensity: 25, pos: [-38, 20, -24] }],
  })
  root.add(rig.group)

  // ---------- 云海 ----------
  const seaMat = cloudSeaMaterial()
  const sea = new THREE.Mesh(cloudSeaGeometry(), seaMat)
  sea.frustumCulled = false
  sea.position.y = CLOUD_Y
  root.add(sea)

  // ---------- 浮空岛群 + 天空城 ----------
  const lights = []
  const endpoints = []
  const floaters = []
  const falls = []
  const addIsland = (x, y, z, r, towers) => {
    const g = new THREE.Group()
    const geo = floatingIslandGeometry({ r, depth: 1.3, seed: x * 0.001 + z * 0.0003, lobes: 2 + Math.floor(R() * 3), top: [0.42, 0.62, 0.38], rock: [0.62, 0.52, 0.55], bottom: [0.36, 0.3, 0.45] })
    g.add(new THREE.Mesh(geo, islandMat))
    const epIdx = endpoints.length
    g.add(islandTown(R, r, mats, lights, endpoints, towers))
    for (let k = epIdx; k < endpoints.length; k++) endpoints[k].pos = endpoints[k].local.clone().add(new THREE.Vector3(x, y, z))
    if (R() < 0.75) {
      const fw = r * (0.08 + R() * 0.08)
      const fh = y - CLOUD_Y + r * 0.2
      const f = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), fallMat)
      const a = Math.atan2(-z, -x) + (R() - 0.5)
      const er = geo.userData.edgeR(a) * 1.02
      f.position.set(Math.cos(a) * er, -fh / 2 - r * 0.02, Math.sin(a) * er)
      f.lookAt(new THREE.Vector3(-x, f.position.y, -z))
      g.add(f)
      falls.push(f)
    }
    g.position.set(x, y, z)
    root.add(g)
    floaters.push({ g, y, phase: R() * 6 })
    for (let k = 0; k < 6; k++) lights.push([new THREE.Vector3(x + (R() - 0.5) * r, y + r * 0.05, z + (R() - 0.5) * r), r * 0.08, [1.0, 0.75, 0.45]])
    return g
  }
  const defs = []
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI * 0.6 + R() * Math.PI * 1.2
    const d = 1400 + Math.pow(R(), 0.8) * 14000
    const x = Math.sin(a) * d * 1.2, z = -Math.cos(a) * d - 600
    if (Math.abs(x) < 900 && z > -3000) continue
    if (Math.hypot(x, z + 8000) < 3400) continue
    defs.push([x, 100 + R() * 2600 * (d / 15000 + 0.2), z, 180 + R() * 900 * (d / 15000 + 0.3), 3 + Math.floor(R() * 5)])
  }
  for (const d of defs) addIsland(...d)
  // 天空城：大岛 + 一群高塔 + 中央主塔
  {
    const cx = 0, cy = 900, cz = -8000, r = 2600
    const g = addIsland(cx, cy, cz, r, 0)
    const castle = new THREE.Group()
    const ring = []
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      ring.push([Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, 200 + (k % 3) * 160])
    }
    for (let k = 0; k < 10; k++) {
      const a = R() * Math.PI * 2, d = r * (0.12 + R() * 0.2)
      ring.push([Math.cos(a) * d, Math.sin(a) * d, 500 + R() * 700])
    }
    ring.push([0, 0, 2100])
    ring.forEach(([x, z, h], k) => {
      const tr = k === ring.length - 1 ? 150 : 45 + R() * 50
      const body = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr * 1.1, h, 24), mats.tower)
      body.position.set(x, h / 2, z)
      castle.add(body)
      const roof = new THREE.Mesh(new THREE.ConeGeometry(tr * 1.4, tr * 3.6, 24), k % 2 ? mats.roofBlue : mats.roofViolet)
      roof.position.set(x, h + tr * 1.8, z)
      castle.add(roof)
      const band = new THREE.Mesh(new THREE.TorusGeometry(tr * 1.12, tr * 0.08, 6, 32), gold)
      band.rotation.x = Math.PI / 2
      band.position.set(x, h, z)
      castle.add(band)
      lights.push([new THREE.Vector3(cx + x, cy + h * 0.6, cz + z), tr * 1.2, [1.0, 0.72, 0.42]])
      if (k === ring.length - 1 || k % 5 === 0) endpoints.push({ pos: new THREE.Vector3(cx + x, cy + h + tr * 3.6, cz + z) })
    })
    // 城墙
    for (let k = 0; k < 16; k++) {
      const [x0, z0] = ring[k], [x1, z1] = ring[(k + 1) % 16]
      const len = Math.hypot(x1 - x0, z1 - z0)
      const w = new THREE.Mesh(new THREE.BoxGeometry(len, 140, 40), mats.tower)
      w.position.set((x0 + x1) / 2, 70, (z0 + z1) / 2)
      w.rotation.y = -Math.atan2(z1 - z0, x1 - x0)
      castle.add(w)
    }
    g.add(castle)
  }
  // 热气球
  const balloons = []
  {
    const env = new THREE.LatheGeometry([[0, -1.1], [0.35, -0.95], [0.85, -0.3], [1.0, 0.25], [0.85, 0.75], [0.45, 1.0], [0, 1.05]].map(([x, y]) => new THREE.Vector2(x, y)), 24)
    const stripeTex = canvasTexture(512, 64, (g, w, h) => {
      const cols = ['#ff7aa8', '#ffe07a', '#8ad8ff', '#ffffff', '#b89aff', '#ffb070']
      for (let i = 0; i < 12; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect((i * w) / 12, 0, w / 12 + 1, h) }
    })
    const envMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: stripeTex, emissiveIntensity: 0.12 })
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.9 })
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Group()
      const e = new THREE.Mesh(env, envMat)
      b.add(e)
      const basket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.35), basketMat)
      basket.position.y = -1.6
      b.add(basket)
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5) }))
      flame.position.y = -1.25
      b.add(flame)
      const s = 40 + R() * 60
      b.scale.setScalar(s)
      const a = -Math.PI * 0.5 + R() * Math.PI, d = 600 + R() * 6000
      b.position.set(Math.sin(a) * d, 200 + R() * 1500, -Math.cos(a) * d - 300)
      root.add(b)
      balloons.push({ b, y: b.position.y, phase: R() * 6 })
    }
  }
  // 积雨云塔（远处，被夕阳照亮）
  let towers
  {
    const blobs = []
    for (let c = 0; c < 22; c++) {
      const a = -Math.PI * 0.8 + R() * Math.PI * 1.6
      const d = 16000 + R() * 16000
      const cx = Math.sin(a) * d * 1.2, cz = -Math.cos(a) * d - 2000
      const H = 3000 + R() * 7000
      const W = 1800 + R() * 2500
      for (let k = 0; k < 70; k++) {
        const t = Math.pow(R(), 0.8)
        const rr = W * (1 - t * 0.5) * (0.35 + R() * 0.4)
        const ang = R() * Math.PI * 2, dd = Math.sqrt(R()) * W * (1 - t * 0.45)
        blobs.push({ pos: new THREE.Vector3(cx + Math.cos(ang) * dd, CLOUD_Y + t * H, cz + Math.sin(ang) * dd * 0.7), size: rr * 2.6, flat: 0.8 })
      }
    }
    towers = billboardClouds(blobs, { lit: [1.2, 0.8, 0.62], shade: [0.3, 0.25, 0.48], rim: [1.3, 0.62, 0.4], sunDir: SUN, opacity: 1 })
    towers.mesh.renderOrder = 1
    root.add(towers.mesh)
  }
  // 彩虹
  const rainbow = new THREE.Mesh(
    new THREE.TorusGeometry(11000, 420, 16, 160, Math.PI),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uAmt: { value: 0.35 } },
      vertexShader: /* glsl */ `
        varying vec3 vL;
        void main() { vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAmt;
        varying vec3 vL;
        vec3 spectrum(float x) { return clamp(vec3(abs(x * 6.0 - 3.0) - 1.0, 2.0 - abs(x * 6.0 - 2.0), 2.0 - abs(x * 6.0 - 4.0)), 0.0, 1.0); }
        void main() {
          float r = length(vL.xy);
          float u = clamp((r - 10580.0) / 840.0, 0.0, 1.0);
          float edge = smoothstep(0.0, 0.2, u) * smoothstep(1.0, 0.8, u);
          float foot = smoothstep(0.0, 2500.0, vL.y);
          gl_FragColor = vec4(spectrum(1.0 - u) * edge * foot * uAmt, 1.0);
        }
      `,
    }),
  )
  rainbow.position.set(3000, CLOUD_Y, -14000)
  rainbow.frustumCulled = false
  root.add(rainbow)
  const mist = mistBank(
    Array.from({ length: 160 }, () => {
      const a = -Math.PI * 0.7 + R() * Math.PI * 1.4, d = 3000 + R() * 20000
      return { pos: new THREE.Vector3(Math.sin(a) * d * 1.2, CLOUD_Y + 60 + R() * 300, -Math.cos(a) * d - 1000), size: 2500 + R() * 3500, alpha: 0.1 + R() * 0.1 }
    }),
    { color: [1.0, 0.8, 0.85], maxPx: 360 },
  )
  root.add(mist)

  // 岛上的灯
  const lampGeo = new THREE.BufferGeometry()
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lights.flatMap(([p]) => p.toArray()), 3))
  lampGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(lights.map(([, s]) => s), 1))
  lampGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(lights.flatMap(([, , c]) => c.map((v) => v * 1.3)), 3))
  lampGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(lights.map(() => 1), 1))
  const lampMat = glowPointMaterial({ size: 1, maxSize: 40 })
  root.add(new THREE.Points(lampGeo, lampMat))

  // ---------- 鲸 + 粒子 ----------
  const whales = createWhales({ floorY: CLOUD_Y, back: [0.12, 0.2, 0.55], belly: [0.95, 0.8, 0.95], rim: [1.0, 0.7, 0.55], splashColor: [1.2, 1.05, 1.1], moonDir: SUN })
  root.add(whales.object)
  const particles = createParticles({
    seed: 404,
    endpoints,
    emitter: new THREE.Vector3(0, 64, CZ - 20),
    lanterns: { mode: 'air', kind: 'sky', count: 220, colors: [[1.0, 0.65, 0.35, 0.8], [1.0, 0.5, 0.75, 0.2]], floorY: -20, radius: [60, 2200], height: 2400, scale: 1.8, glow: 0.55 },
    ambient: { kind: 'sparkle', count: 360, color: [1.0, 0.85, 0.55], color2: [0.8, 0.9, 1.0], floorY: -10, height: 70, radius: [15, 160], base: 0.7, gain: 0.3 },
    dust: { a: [1.0, 0.85, 0.7], b: [0.85, 0.9, 1.0] },
    glyphs: { chars: ['☆', '♪', '♡', '✦', '☁', '✧', '♫', '☾'], font: '700 96px "Noto Sans Symbols 2", "Segoe UI Symbol", "Apple Symbols", "DejaVu Sans", sans-serif', colors: [[1.0, 0.85, 0.5], [1.0, 0.6, 0.85], [0.7, 0.85, 1.0]] },
    packets: { colors: [[1.0, 0.9, 0.6], [1.0, 0.6, 0.85]], arc: 0.3 },
    fireworks: { palette: [[1.0, 0.7, 0.85], [0.7, 0.85, 1.0], [1.0, 0.95, 0.7], [0.8, 0.7, 1.0], [0.7, 1.0, 0.9]], zone: (h) => [-4500 + h(1) * 9000, 2600 + h(3) * 1500, -6500 + h(2) * 3000] },
  })
  root.add(particles.object)

  const tmpC = new THREE.Color()
  const rings = stage.userData.rings
  return {
    name: 'clouds',
    label: '梦幻云层',
    root,
    ocean: null,
    accent: [1.4, 1.1, 0.8],
    exposure: 0.9,
    sky: {
      zenith: [0.04, 0.06, 0.22], mid: [0.22, 0.18, 0.42], horizon: [0.85, 0.46, 0.4], below: [0.4, 0.3, 0.4],
      glowLow: [1.0, 0.45, 0.25], glowHigh: [0.6, 0.35, 0.5], glowDir: SUN, glowAmt: 0.9,
      stars: 0.25, milky: 0.1, meteors: 0.4,
      orbDir: SUN, orbSize: 0.9988, orbColor: [1.0, 0.78, 0.5], orbBright: 5, orbHalo: [1.0, 0.55, 0.3], orbHaloAmt: 1.2, orbKind: 1,
      cloudAmt: 0.7, cloudBase: [0.35, 0.27, 0.42], cloudLit: [1.0, 0.6, 0.4], cloudScale: 1.1, cloudLow: 0.48,
    },
    fog: { color: [0.46, 0.34, 0.44], density: 0.000022 },
    hemi: { sky: 0xa890d8, ground: 0x4a3858, intensity: 0.9 },
    moon: { color: 0xffc8a0, intensity: 1.3, dir: SUN },
    env: {
      top: [0.25, 0.25, 0.6],
      horizon: [1.2, 0.7, 0.6],
      glow: [1.0, 0.5, 0.3],
      panels: [
        [[3, 2.2, 1.8], [0, 60, 70], [60, 20]],
        [[1.6, 1.8, 3.0], [-70, 30, -30], [30, 50]],
        [[3.0, 1.4, 2.2], [70, 25, -40], [30, 40]],
        [[3.0, 1.8, 1.2], [0, 20, -90], [80, 30]],
      ],
    },
    update(state, camera) {
      const t = state.t
      const hush = state.hush
      const alive = 1 - state.fall * 0.85
      if (camera) {
        puffs.update(camera, t)
        towers.update(camera, t)
      }
      // 光环星灯
      const n = haloStars.length
      for (let i = 0; i < n; i++) {
        let v
        if (state.bulbMode === 'fill') v = state.bulbFill * 1.05 > (i + 0.5) / n ? 1.0 : 0.05
        else if (state.bulbMode === 'chase') v = 0.4 + 1.0 * Math.pow(0.5 + 0.5 * Math.sin((i / n) * Math.PI * 8 - t * 5), 4) + state.pulse * 0.5
        else if (state.bulbMode === 'walk') v = 0.3 + 1.2 * Math.exp(-Math.abs(((i - Math.floor(state.beat) * 3) % n + n) % n - 0) * 0.5)
        else if (state.bulbMode === 'blink') v = Math.sin(i * 91.7 + Math.floor(t * 12) * 13.1) > 0.2 ? 1.2 : 0.02
        else v = 0.7 + 0.3 * Math.sin(t * 2 + i * 0.4)
        v = v * (1 - 0.6 * hush) * alive + state.finaleFlash + state.recoverFlash * 0.6
        starMesh.setColorAt(i, tmpC.setRGB(2.4 * v, 1.8 * v, 1.1 * v))
        hsCol.set([1.0 * 0.45, 0.8 * 0.45, 0.5 * 0.45], i * 3)
        hsA[i] = Math.min(1, v * 0.6)
      }
      starMesh.instanceColor.needsUpdate = true
      hsGeo.attributes.aColor.needsUpdate = true
      hsGeo.attributes.aAlpha.needsUpdate = true
      halo.rotation.z = 0
      rings.rotation.y = t * 0.4
      rings.rotation.x = Math.sin(t * 0.3) * 0.3
      mats.tower.emissiveIntensity = (0.2 + 1.3 * state.city) * alive
      lampMat.uniforms.uFade.value = (0.3 + 0.7 * Math.min(1, state.city * 1.2)) * alive
      seaMat.uniforms.uTime.value = t
      seaMat.uniforms.uGlow.value = state.sea
      seaMat.uniforms.uHush.value = hush
      puffs.material.uniforms.uGlow.value = 0.04 * state.pulse
      fallMat.uniforms.uTime.value = t
      mist.material.uniforms.uTime.value = t
      rainbow.material.uniforms.uAmt.value = 0.18 + 0.3 * state.neon * alive
      floaters.forEach((f) => (f.g.position.y = f.y + Math.sin(t * 0.2 + f.phase) * 30))
      balloons.forEach((b) => {
        b.b.position.y = b.y + Math.sin(t * 0.15 + b.phase) * 60
        b.b.rotation.y = t * 0.05 + b.phase
      })
      const phase = (Math.PI * state.beat) / 2
      beams.forEach((b, i) => (b.material.uniforms.uInt.value = (0.5 + 0.6 * state.beams + 0.3 * Math.sin(t * 0.5 + i)) * (1 - 0.7 * hush) * alive))
      rig.key.intensity = rig.base.key * state.stage
      rig.spots.forEach((s, i) => {
        s.intensity = rig.base.spots[i] * state.beams * (0.6 + 0.6 * state.pulse) * (1 - 0.9 * hush) * alive
        s.target.position.set(Math.sin(phase + i * 2) * 14 * state.swing, 0, 0)
      })
      rig.rim.intensity = rig.base.rim * (1 - 0.4 * hush)
      whales.update(state)
      particles.update(state)
    },
    setPixelRatio(pr) {
      particles.setPixelRatio(pr)
      mist.material.uniforms.uPixelRatio.value = pr
    },
  }
}
