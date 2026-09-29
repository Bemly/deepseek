import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, fbm2, WATER_Y, canvasTexture, glowPointMaterial, bakeStatic, clamp01 } from '../util.js'
import { woodTexture } from '../textures.js'
import { createWhales } from '../whales.js'
import { createParticles } from '../particles.js'
import { mountainRing, shoreRock, shoreRockMaterial } from '../landscape.js'
import {
  createLightRig, beamMaterial, beamGeometry, createBuildingMaterial, updateBuildingUniforms, instancedBuildings,
  curvedRoofGeometry, pagoda, mistBank,
} from '../kit.js'
import { createTree, forestSprites, meadow, scatterOnTop } from '../trees.js'

// 主题：和风群 —— 樱花满开的月夜湖畔
// 近景：严岛式海上大鸟居 + 桧木舞台（朱红高栏、提灯、石灯笼）、太鼓、野点伞与团子、太鼓桥、樱花树
// 中景：湖岸町屋（约 2500 户）、天守阁、五重塔、蜿蜒上山的千本鸟居、山顶神社、樱花林
// 远景：月下的富士山、山脊剪影；湖面漂着灯笼流し，花瓣一直在落。

const MOON = [0.42, 0.3, -1]
const shoreZ = (x) => -3600 + 300 * Math.sin(x / 2100) + 1800 * Math.pow(Math.min(1, Math.abs(x) / 12000), 2)
function groundY(x, z) {
  const d = shoreZ(x) - z
  if (d < 0) return WATER_Y - 8 - Math.min(40, -d * 0.2)
  const hills = 900 * Math.pow(fbm2(x / 4200 + 7, z / 4200 + 2, 4), 2.2) * Math.min(1, d / 2500)
  return WATER_Y + Math.min(1, d / 100) * 14 + d * 0.02 + hills
}

// ---------- 贴图 ----------
function taikoFace() {
  return canvasTexture(512, 512, (g, w) => {
    g.fillStyle = '#efe2c4'
    g.fillRect(0, 0, w, w)
    const c = w / 2
    // 三つ巴
    const cols = ['#1d1d1d', '#b3261e', '#1d1d1d']
    for (let k = 0; k < 3; k++) {
      g.save(); g.translate(c, c); g.rotate((k / 3) * Math.PI * 2)
      g.fillStyle = cols[k]
      g.beginPath(); g.arc(0, -70, 70, 0, Math.PI * 2); g.fill()
      g.beginPath(); g.moveTo(-70, -70); g.bezierCurveTo(-90, 40, 40, 110, 150, 20); g.bezierCurveTo(60, 60, 0, 30, 0, -70); g.fill()
      g.restore()
    }
    g.strokeStyle = '#3a2a1a'
    g.lineWidth = 16
    g.beginPath(); g.arc(c, c, 246, 0, Math.PI * 2); g.stroke()
  })
}

function plaqueTexture(text) {
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#1a1a1a'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#d8a84e'
    g.lineWidth = 12
    g.strokeRect(10, 10, w - 20, h - 20)
    g.font = '900 150px "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif SC", serif'
    g.fillStyle = '#f0c96a'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    ;[...text].forEach((ch, i) => g.fillText(ch, w / 2, h * (0.3 + i * 0.4)))
  })
}

function chochinTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(80,40,20,0.35)'
    g.lineWidth = 3
    for (let y = 16; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
    g.fillStyle = '#b3261e'
    g.font = '900 120px "Noto Serif JP", "Hiragino Mincho ProN", "Noto Serif SC", serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('祭', w / 2, h / 2)
  })
}

// 鸟居的几何（单位尺寸：宽约 1.6、高约 1.3），用于大鸟居以外的千本鸟居
function toriiGeometry() {
  const parts = []
  for (const s of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.045, 0.055, 1.1, 8).translate(s * 0.5, 0.55, 0))
  const kasagi = new THREE.BoxGeometry(1.5, 0.08, 0.12)
  const kp = kasagi.attributes.position
  for (let i = 0; i < kp.count; i++) kp.setY(i, kp.getY(i) + 0.08 * Math.pow(Math.abs(kp.getX(i)) / 0.75, 3))
  parts.push(kasagi.translate(0, 1.15, 0))
  parts.push(new THREE.BoxGeometry(1.2, 0.06, 0.07).translate(0, 0.92, 0))
  return mergeGeometries(parts.map((g) => (g.deleteAttribute('uv'), g.toNonIndexed())))
}

export function createJapanTheme() {
  const root = new THREE.Group()
  root.name = 'theme:japan'
  const R = rng(2222)

  // ---------- 材质 ----------
  const hinokiTex = woodTexture()
  const hinoki = new THREE.MeshPhysicalMaterial({ map: hinokiTex, color: 0xf2dcb8, roughness: 0.62, clearcoat: 0.08, clearcoatRoughness: 0.6 })
  const vermilion = new THREE.MeshStandardMaterial({ color: 0xc8321e, roughness: 0.5 })
  const blackLac = new THREE.MeshPhysicalMaterial({ color: 0x111012, roughness: 0.3, clearcoat: 0.8 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a84e, metalness: 1, roughness: 0.3 })
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a877f, roughness: 0.9 })
  const roofCu = new THREE.MeshStandardMaterial({ color: 0x2c3a38, roughness: 0.6, metalness: 0.3 })
  const roofTile = new THREE.MeshStandardMaterial({ color: 0x1e2026, roughness: 0.8 })
  const plaster = new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.8, emissive: 0x2a3550, emissiveIntensity: 0.6 })
  const lanternFire = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.3, 0.55) })

  // ---------- 近景：桧木舞台 ----------
  const stage = new THREE.Group()
  const X0 = -35, X1 = 35, Z0 = -44, Z1 = 28
  {
    const W = X1 - X0, D = Z1 - Z0
    // 桧木地板（沿 x 方向的木板）
    const n = Math.floor(D / 2.6)
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), hinoki, n)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      planks.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(0, -0.4, Z0 + (i + 0.5) * (D / n)), q, new THREE.Vector3(D / n - 0.12, 0.8, W)))
      const v = 0.85 + R() * 0.15
      planks.setColorAt(i, c.setRGB(v, v * 0.97, v * 0.92))
    }
    planks.receiveShadow = true
    stage.add(planks)
    const under = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, D), new THREE.MeshStandardMaterial({ color: 0x1a120c }))
    under.position.set(0, -1.1, (Z0 + Z1) / 2)
    stage.add(under)
    // 黑漆边梁
    for (const [x, z, w, d] of [[0, Z0, W + 1.6, 1.6], [0, Z1, W + 1.6, 1.6], [X0, (Z0 + Z1) / 2, 1.6, D], [X1, (Z0 + Z1) / 2, 1.6, D]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), blackLac)
      b.position.set(x, -1.0, z)
      stage.add(b)
    }
    // 下面的朱红柱子（插进水里）
    for (let x = X0; x <= X1; x += 14) for (let z = Z0; z <= Z1; z += 12) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 10, 10), vermilion)
      p.position.set(x, -6.5, z)
      stage.add(p)
    }
    // 朱红高栏（左右后三边）
    const rail = (ax, az, bx, bz) => {
      const a = new THREE.Vector3(ax, 0, az), b = new THREE.Vector3(bx, 0, bz)
      const len = a.distanceTo(b)
      const n2 = Math.round(len / 6)
      for (let k = 0; k <= n2; k++) {
        const p = a.clone().lerp(b, k / n2)
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), vermilion)
        post.position.set(p.x, 2.5, p.z)
        stage.add(post)
        if (k === 0 || k === n2) {
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10).scale(1, 1.4, 1), gold)
          cap.position.set(p.x, 5.8, p.z)
          stage.add(cap)
        }
      }
      for (const [y, h] of [[4.6, 0.5], [2.4, 0.35]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.45), vermilion)
        bar.position.set((ax + bx) / 2, y, (az + bz) / 2)
        bar.rotation.y = -Math.atan2(bz - az, bx - ax)
        stage.add(bar)
      }
    }
    rail(X0 + 0.5, Z0 + 0.5, X1 - 0.5, Z0 + 0.5)
    rail(X0 + 0.5, Z0 + 0.5, X0 + 0.5, Z1 - 0.5)
    rail(X1 - 0.5, Z0 + 0.5, X1 - 0.5, Z1 - 0.5)
    rail(X0 + 0.5, Z1 - 0.5, -8, Z1 - 0.5)
    rail(8, Z1 - 0.5, X1 - 0.5, Z1 - 0.5)
    // 中心的白砂圆 + 金边（角色站位）
    const circle = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.95 }))
    circle.rotation.x = -Math.PI / 2
    circle.position.y = 0.03
    circle.receiveShadow = true
    stage.add(circle)
    for (let k = 0; k < 5; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2 + k * 1.6, 0.08, 4, 64), new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 1 }))
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.06
      stage.add(ring)
    }
    const goldRing = new THREE.Mesh(new THREE.TorusGeometry(9.1, 0.2, 8, 96), gold)
    goldRing.rotation.x = Math.PI / 2
    goldRing.position.y = 0.06
    stage.add(goldRing)
  }

  // 太鼓桥（朱红拱桥，伸向镜头）
  {
    const bz0 = Z1, bz1 = Z1 + 90, W = 11
    const arch = (z) => {
      const u = (z - bz0) / (bz1 - bz0)
      return -1 + 11 * Math.sin(u * Math.PI)
    }
    const n = 40
    for (let i = 0; i < n; i++) {
      const z = bz0 + ((i + 0.5) / n) * (bz1 - bz0)
      const dz = (bz1 - bz0) / n
      const slope = (arch(z + 0.5) - arch(z - 0.5))
      const plank = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, dz + 0.15), hinoki)
      plank.position.set(0, arch(z) - 0.3, z)
      plank.rotation.x = -Math.atan(slope)
      plank.receiveShadow = true
      stage.add(plank)
    }
    const side = (s) => {
      const pts = []
      for (let i = 0; i <= 40; i++) {
        const z = bz0 + (i / 40) * (bz1 - bz0)
        pts.push(new THREE.Vector3(s * (W / 2 + 0.3), arch(z) + 4.2, z))
      }
      stage.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.3, 6), vermilion))
      const pts2 = pts.map((p) => p.clone().setY(p.y - 2.0))
      stage.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 60, 0.2, 6), vermilion))
      for (let i = 0; i <= 10; i++) {
        const z = bz0 + (i / 10) * (bz1 - bz0)
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.7), vermilion)
        post.position.set(s * (W / 2 + 0.3), arch(z) + 2, z)
        stage.add(post)
        if (i === 0 || i === 10 || i === 5) {
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.65, 10, 8).scale(1, 1.4, 1), gold)
          cap.position.set(s * (W / 2 + 0.3), arch(z) + 5, z)
          stage.add(cap)
        }
      }
      // 桥下的弧形梁
      const beam = []
      for (let i = 0; i <= 40; i++) {
        const z = bz0 + (i / 40) * (bz1 - bz0)
        beam.push(new THREE.Vector3(s * (W / 2 - 0.3), arch(z) - 1.6, z))
      }
      stage.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(beam), 60, 0.9, 6), vermilion))
    }
    side(-1)
    side(1)
    const path = new THREE.Mesh(new THREE.BoxGeometry(W, 1, 90), stone)
    path.position.set(0, -1.5, bz1 + 45)
    stage.add(path)
  }

  // 大鸟居（两根主柱 + 四根稚児柱，立在水里）
  const TZ = -64
  const toriiLights = []
  {
    const tg = new THREE.Group()
    const H = 58, halfW = 19
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.3, H + 8, 20), vermilion)
      p.position.set(s * halfW, H / 2 - 4, TZ)
      tg.add(p)
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.2, 3, 20), blackLac)
      base.position.set(s * halfW, WATER_Y + 1, TZ)
      tg.add(base)
      for (const dz of [-9, 9]) {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 30, 12), vermilion)
        sp.position.set(s * halfW, 9, TZ + dz)
        tg.add(sp)
        const brace = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 18), vermilion)
        brace.position.set(s * halfW, 20, TZ)
        tg.add(brace)
      }
    }
    // 笠木：黑色上沿、两端上翘
    const kasagi = new THREE.BoxGeometry(62, 3.2, 5, 40, 1, 1)
    const kp = kasagi.attributes.position
    for (let i = 0; i < kp.count; i++) kp.setY(i, kp.getY(i) + 3.2 * Math.pow(Math.abs(kp.getX(i)) / 31, 3))
    kasagi.computeVertexNormals()
    const k1 = new THREE.Mesh(kasagi, blackLac)
    k1.position.set(0, H + 1.8, TZ)
    tg.add(k1)
    const shimaki = new THREE.Mesh(kasagi.clone().scale(0.97, 0.9, 0.9), vermilion)
    shimaki.position.set(0, H - 1.2, TZ)
    tg.add(shimaki)
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(50, 2.6, 2.6), vermilion)
    nuki.position.set(0, H - 12, TZ)
    tg.add(nuki)
    const gaku = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 8.4), new THREE.MeshStandardMaterial({ map: plaqueTexture('鯨宮'), roughness: 0.4, emissive: 0xffffff, emissiveMap: plaqueTexture('鯨宮'), emissiveIntensity: 0.4 }))
    gaku.position.set(0, H - 5.8, TZ + 1.6)
    tg.add(gaku)
    const gakuFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 10, 2), vermilion)
    gakuFrame.position.set(0, H - 6, TZ)
    tg.add(gakuFrame)
    // 注连绳 + 纸垂
    const rope = new THREE.CatmullRomCurve3([new THREE.Vector3(-halfW + 2.5, H - 15, TZ + 1.8), new THREE.Vector3(0, H - 18.5, TZ + 1.8), new THREE.Vector3(halfW - 2.5, H - 15, TZ + 1.8)])
    tg.add(new THREE.Mesh(new THREE.TubeGeometry(rope, 40, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0xc9b27a, roughness: 1 })))
    const shideMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, emissive: 0x333344 })
    for (let k = 1; k < 6; k++) {
      const p = rope.getPoint(k / 6)
      const shide = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4.5), shideMat)
      shide.position.set(p.x, p.y - 2.8, p.z + 0.3)
      shide.rotation.z = (k % 2 ? 1 : -1) * 0.08
      tg.add(shide)
    }
    stage.add(tg)
    toriiLights.push(new THREE.Vector3(-halfW, WATER_Y + 3, TZ + 5), new THREE.Vector3(halfW, WATER_Y + 3, TZ + 5))
  }

  // 提灯：沿高栏挂一圈（像港湾的灯泡墙一样跟节奏）
  const chochin = []
  {
    for (let x = X0 + 4; x <= X1 - 4; x += 5.5) chochin.push(new THREE.Vector3(x, 7.4, Z0 + 0.5))
    for (let z = Z0 + 6; z <= Z1 - 6; z += 6) for (const x of [X0 + 0.5, X1 - 0.5]) chochin.push(new THREE.Vector3(x, 7.4, z))
    const body = new THREE.SphereGeometry(1, 16, 12).scale(0.85, 1.15, 0.85)
    const tex = chochinTexture()
    const im = new THREE.InstancedMesh(body, new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }), chochin.length)
    chochin.forEach((p, i) => {
      im.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-p.x, 10 - p.z)), new THREE.Vector3(1, 1, 1)))
      im.setColorAt(i, new THREE.Color(1, 0.7, 0.4))
    })
    stage.add(im)
    const caps = new THREE.InstancedMesh(mergeGeometries([new THREE.CylinderGeometry(0.55, 0.55, 0.3, 12).translate(0, 1.2, 0).toNonIndexed(), new THREE.CylinderGeometry(0.55, 0.55, 0.3, 12).translate(0, -1.2, 0).toNonIndexed(), new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4).translate(0, 2.1, 0).toNonIndexed()]), blackLac, chochin.length)
    chochin.forEach((p, i) => caps.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)))
    stage.add(caps)
    chochin.mesh = im
  }
  const chGeo = new THREE.BufferGeometry()
  chGeo.setAttribute('position', new THREE.Float32BufferAttribute(chochin.flatMap((p) => p.toArray()), 3))
  chGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(chochin.map(() => 6), 1))
  const chCol = new Float32Array(chochin.length * 3)
  const chA = new Float32Array(chochin.length)
  chGeo.setAttribute('aColor', new THREE.BufferAttribute(chCol, 3))
  chGeo.setAttribute('aAlpha', new THREE.BufferAttribute(chA, 1))
  stage.add(new THREE.Points(chGeo, glowPointMaterial({ size: 1, maxSize: 60 })))

  // 石灯笼 × 4
  const toro = (x, z, s = 1) => {
    const g = new THREE.Group()
    const L = (pts, seg = 8) => new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a * s, b * s)), seg)
    g.add(new THREE.Mesh(L([[0, 0], [2.4, 0], [2.4, 0.8], [1.2, 1.2], [0.8, 1.4], [0, 1.4]], 6), stone))
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7 * s, 0.8 * s, 5 * s, 12), stone)
    pole.position.y = 3.9 * s
    g.add(pole)
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(2.2 * s, 1.5 * s, 1 * s, 6), stone)
    tray.position.y = 6.9 * s
    g.add(tray)
    const fire = new THREE.Mesh(new THREE.BoxGeometry(2.2 * s, 2.2 * s, 2.2 * s), lanternFire)
    fire.position.y = 8.5 * s
    g.add(fire)
    for (const r of [0, Math.PI / 2]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.8 * s, 2.6 * s, 0.6 * s), stone)
      frame.position.y = 8.5 * s
      frame.rotation.y = r
      g.add(frame)
    }
    const roofG = new THREE.Mesh(new THREE.ConeGeometry(3.4 * s, 1.8 * s, 6), stone)
    roofG.position.y = 10.6 * s
    g.add(roofG)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.6 * s, 10, 8).scale(1, 1.4, 1), stone)
    tip.position.y = 11.9 * s
    g.add(tip)
    g.position.set(x, 0, z)
    stage.add(g)
    toriiLights.push(new THREE.Vector3(x, 8.5 * s, z))
  }
  toro(-30, 22, 1)
  toro(30, 22, 1)
  toro(-30, -38, 1)
  toro(30, -38, 1)

  // 太鼓（左）、野点伞 + 缘台 + 团子（右）
  {
    const taiko = new THREE.Group()
    const drum = new THREE.Mesh(new THREE.LatheGeometry([[0, -3.2], [3.4, -3.2], [4.0, -1.5], [4.2, 0], [4.0, 1.5], [3.4, 3.2], [0, 3.2]].map(([x, y]) => new THREE.Vector2(x, y)), 32), new THREE.MeshPhysicalMaterial({ color: 0x7a1a12, roughness: 0.35, clearcoat: 0.7 }))
    drum.rotation.z = Math.PI / 2
    drum.position.y = 9
    taiko.add(drum)
    const faceMat = new THREE.MeshStandardMaterial({ map: taikoFace(), roughness: 0.7 })
    for (const s of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(3.35, 32), faceMat)
      face.position.set(s * 3.22, 9, 0)
      face.rotation.y = (s * Math.PI) / 2
      taiko.add(face)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        const tack = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), gold)
        tack.position.set(s * 3.1, 9 + Math.sin(a) * 3.45, Math.cos(a) * 3.45)
        taiko.add(tack)
      }
    }
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 10, 0.8), blackLac)
      leg.position.set(s * 2, 5, 0)
      leg.rotation.z = s * 0.35
      taiko.add(leg)
      const legB = leg.clone()
      legB.rotation.z = -s * 0.35
      legB.position.x = s * 2
      taiko.add(legB)
    }
    taiko.position.set(-25, 0, -8)
    taiko.rotation.y = 0.5
    stage.add(taiko)

    const tea = new THREE.Group()
    const bench = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 4.5), new THREE.MeshStandardMaterial({ color: 0xa8321e, roughness: 0.95 }))
    bench.position.y = 4.6
    tea.add(bench)
    for (const [x, z] of [[-5.5, -1.8], [5.5, -1.8], [-5.5, 1.8], [5.5, 1.8]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, 0.6), hinoki)
      l.position.set(x, 2.1, z)
      tea.add(l)
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 22, 8), hinoki)
    pole.position.set(0, 11, -2.6)
    tea.add(pole)
    const kasa = new THREE.Mesh(new THREE.ConeGeometry(12, 4, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xc02a1e, roughness: 0.8, side: THREE.DoubleSide }))
    kasa.position.set(0, 21.5, -2.6)
    tea.add(kasa)
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 12.5, 3), hinoki)
      rib.position.set(Math.cos(a) * 6, 21.1, -2.6 + Math.sin(a) * 6)
      rib.rotation.set(0, -a, Math.PI / 2 - 0.32)
      rib.rotation.order = 'YZX'
      tea.add(rib)
    }
    // 团子三串 + 茶碗
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.6, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4 }))
    plate.position.set(-2, 5.1, 0.4)
    tea.add(plate)
    const dangoCols = [0xf6b3c8, 0xf7f3ea, 0x8fbf7a]
    for (let k = 0; k < 3; k++) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 4), hinoki)
      stick.rotation.z = Math.PI / 2
      stick.position.set(-2, 5.55, -0.4 + k * 0.8)
      tea.add(stick)
      for (let j = 0; j < 3; j++) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshStandardMaterial({ color: dangoCols[j], roughness: 0.6 }))
        ball.position.set(-2.9 + j * 0.9, 5.6, -0.4 + k * 0.8)
        tea.add(ball)
      }
    }
    const cup = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.7, 0], [0.9, 0.4], [1.0, 1.2], [0.92, 1.2], [0.8, 0.5], [0, 0.45]].map(([x, y]) => new THREE.Vector2(x, y)), 20), new THREE.MeshStandardMaterial({ color: 0x3c5a3a, roughness: 0.4 }))
    cup.position.set(2.5, 5, 0.2)
    tea.add(cup)
    tea.position.set(26, 0, 4)
    tea.rotation.y = -0.6
    stage.add(tea)
  }

  // 樱花树（舞台两侧的小岩岛上 + 背后一棵大的）
  const trees = []
  const isleMat = shoreRockMaterial()
  for (const [x, z, h, type, sd] of [[-58, -18, 46, 'sakura', 3], [60, -24, 50, 'sakura', 7], [-84, -74, 64, 'sakura', 11], [88, -66, 56, 'sakura', 13], [-50, 30, 30, 'pine', 5], [54, 34, 26, 'pine', 9]]) {
    const geo = shoreRock(14 + h * 0.22, sd * 1.7, { flat: 0.32, waterline: 1 })
    const isle = new THREE.Mesh(geo, isleMat)
    isle.position.set(x, WATER_Y - 1, z)
    isle.rotation.y = sd
    isle.receiveShadow = true
    stage.add(isle)
    // 岩顶的苔草
    const moss = meadow(scatterOnTop(geo, { count: 700, minUp: 0.7, minY: 3, seed: sd }), { size: 2.2, seed: sd + 1, tint: [0.7, 0.8, 0.75], flowers: [0.7, 0.2, 0.1, 0] })
    moss.position.copy(isle.position)
    moss.rotation.y = isle.rotation.y
    stage.add(moss)
    const tr = createTree(type, { seed: sd, height: h, glow: type === 'sakura' ? 0.22 : 0 })
    tr.position.set(x, WATER_Y - 1 + geo.userData.top - 0.6, z)
    tr.rotation.y = sd * 2.1
    stage.add(tr)
    trees.push(tr)
  }

  bakeStatic(stage)
  root.add(stage)

  // 月光光柱
  const beams = []
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(beamGeometry(2, 20, 140), beamMaterial(i ? [0.8, 0.85, 1.0] : [1.0, 0.7, 0.85], 0.2))
    m.position.set((i - 0.5) * 40, 110, -50)
    m.frustumCulled = false
    root.add(m)
    beams.push(m)
  }

  const rig = createLightRig({
    key: { color: 0xdfe4ff, intensity: 9000, pos: [-30, 70, 85], target: [0, 8, 0] },
    spots: [{ color: 0xff7aa8, intensity: 4500, pos: [-38, 50, -10] }, { color: 0xffb070, intensity: 4500, pos: [38, 50, -10] }],
    rim: { color: 0xb8c4ff, intensity: 8000, pos: [0, 60, -80] },
    points: [{ color: 0xff9a4a, intensity: 30, pos: [-30, 9, 22] }, { color: 0xff9a4a, intensity: 30, pos: [30, 9, 22] }],
  })
  root.add(rig.group)

  // ---------- 中景 ----------
  const town = new THREE.Group()
  {
    const geo = new THREE.PlaneGeometry(44000, 32000, 240, 180).rotateX(-Math.PI / 2)
    const p = geo.attributes.position
    const col = []
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i) - 16000 - 1500
      p.setZ(i, z)
      const y = groundY(x, z)
      p.setY(i, y)
      const t = clamp01((y - WATER_Y) / 900)
      col.push(0.03 + t * 0.03, 0.035 + t * 0.03, 0.045 + t * 0.03)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.computeVertexNormals()
    town.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })))
    // 石砌护岸 + 岸边灯
  }
  const endpoints = []
  const lamps = []
  // 町屋
  const houseMat = createBuildingMaterial({
    extentX: 11000, base: [0.03, 0.02, 0.016], top: [0.02, 0.02, 0.025], grid: [18, 26], win: [0.1, 0.9, 0.15, 0.88],
    warm: [1.0, 0.62, 0.3], cool: [1.0, 0.8, 0.55], winGain: 2.4, lattice: 0.7, neonMix: [0, 0, 0], flash: [1.0, 0.6, 0.8], glass: [0.015, 0.01, 0.008],
  })
  const houses = []
  const roofSlots = [[], []]
  const ASP = [1.3, 2.0]
  for (let x = -10500; x < 10500; x += 150) {
    const zs = shoreZ(x)
    for (let z = zs - 120; z > zs - 5200; z -= 150) {
      const depth = zs - z
      if (R() > 0.82 - depth / 9000) continue
      const px = x + (R() - 0.5) * 50, pz = z + (R() - 0.5) * 50
      const y = groundY(px, pz)
      if (y > WATER_Y + 500) continue
      if (Math.hypot(px + 1800, pz + 6500) < 900) continue // 天守
      const ai = R() < 0.6 ? 1 : 0
      const s = 60 + R() * 40
      const h = depth < 600 && R() < 0.2 ? 70 + R() * 30 : 34 + R() * 20
      const rot = (R() - 0.5) * 0.1 + (R() < 0.3 ? Math.PI / 2 : 0)
      houses.push({ x: px, y, z: pz, w: s * ASP[ai] * 0.86, d: s * 0.86, h, rot })
      roofSlots[ai].push({ x: px, y: y + h, z: pz, s, rot })
    }
  }
  const houseSet = instancedBuildings(houses, houseMat, R, { neon: [[1, 0.5, 0.6]], density: [0.35, 0.85] })
  town.add(houseSet.mesh)
  ASP.forEach((asp, ai) => {
    const geo = curvedRoofGeometry({ w: asp, d: 1, rise: 1, overhang: 0.16, curl: 0.12, sag: 1.35, thick: 0.05, segs: 10 })
    const im = new THREE.InstancedMesh(geo, roofTile, roofSlots[ai].length)
    roofSlots[ai].forEach((r, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(r.x, r.y, r.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rot), new THREE.Vector3(r.s, r.s * 0.38, r.s))))
    im.frustumCulled = false
    town.add(im)
  })
  houses.filter((h) => h.h > 70).slice(0, 24).forEach((h) => endpoints.push({ pos: new THREE.Vector3(h.x, h.y + h.h + 30, h.z), index: h.index }))
  // 岸边石灯
  for (let x = -10000; x < 10000; x += 120) lamps.push([new THREE.Vector3(x, groundY(x, shoreZ(x) - 30) + 14, shoreZ(x) - 30), 16, [1.0, 0.6, 0.3]])

  // 天守阁：石垣 + 五层
  {
    const cx = -1800, cz = -6500
    const y0 = groundY(cx, cz)
    const castle = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(260, 360, 200, 4, 1), stone)
    base.rotation.y = Math.PI / 4
    base.position.y = 100
    castle.add(base)
    let y = 200, w = 420, d = 340
    for (let k = 0; k < 5; k++) {
      const h = k === 0 ? 120 : 90
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plaster)
      body.position.y = y + h / 2
      castle.add(body)
      // 黑色窗格带
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 2, h * 0.22, d + 2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: new THREE.Color(1.0, 0.6, 0.3), emissiveIntensity: 0.25 }))
      band.position.y = y + h * 0.55
      castle.add(band)
      const roof = new THREE.Mesh(curvedRoofGeometry({ w, d, rise: d * (k === 4 ? 0.45 : 0.2), overhang: 0.18, curl: 0.25, sag: 1.4, thick: 6 }), roofCu)
      roof.position.y = y + h
      castle.add(roof)
      // 千鸟破风（每边中间一个小三角山墙）
      if (k < 4) for (const s of [-1, 1]) {
        const gable = new THREE.Mesh(curvedRoofGeometry({ w: w * 0.3, d: 40, rise: 50, overhang: 0.1, curl: 0.2, sag: 1.2, thick: 5 }), roofCu)
        gable.position.set(0, y + h + 4, s * d * 0.52)
        castle.add(gable)
      }
      y += h + d * (k === 4 ? 0.45 : 0.12)
      w *= 0.8
      d *= 0.8
    }
    for (const s of [-1, 1]) {
      const fish = new THREE.Mesh(new THREE.ConeGeometry(12, 50, 8), gold)
      fish.position.set(s * w * 0.55, y - 5, 0)
      fish.rotation.z = s * 0.4
      castle.add(fish)
    }
    castle.position.set(cx, y0, cz)
    town.add(castle)
    endpoints.push({ pos: new THREE.Vector3(cx, y0 + y, cz), index: -1 })
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      lamps.push([new THREE.Vector3(cx + Math.cos(a) * 380, y0 + 10, cz + Math.sin(a) * 380), 60, [0.8, 0.85, 1.0]])
    }
  }
  // 五重塔
  {
    const x = 2400, z = -5300
    const p = pagoda({ tiers: 5, baseW: 150, tierH: 110, taper: 0.9, rise: 0.22, curl: 0.18, overhang: 0.36, wallMat: new THREE.MeshStandardMaterial({ color: 0x8e2a1c, roughness: 0.7, emissive: 0x401008, emissiveIntensity: 0.5 }), roofMat: roofTile, colMat: vermilion, trimMat: stone, finialMat: gold })
    const y = groundY(x, z)
    p.group.position.set(x, y, z)
    town.add(p.group)
    for (const c of p.corners) lamps.push([c.clone().add(p.group.position), 24, [1.0, 0.65, 0.35]])
    endpoints.push({ pos: p.top.clone().add(p.group.position), index: -1 })
  }
  // 千本鸟居：沿山路蜿蜒而上
  {
    const pts = []
    for (let i = 0; i <= 12; i++) {
      const u = i / 12
      const x = 3600 + u * 4200 + Math.sin(u * 9) * 500
      const z = -4300 - u * 5200 + Math.cos(u * 7) * 400
      pts.push(new THREE.Vector3(x, 0, z))
    }
    const path = new THREE.CatmullRomCurve3(pts)
    const L = path.getLength()
    const N = Math.floor(L / 22)
    const geo = toriiGeometry()
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8401e, roughness: 0.5, emissive: 0x6a1a08, emissiveIntensity: 0.8 })
    const im = new THREE.InstancedMesh(geo, mat, N)
    let top = null
    for (let i = 0; i < N; i++) {
      const u = i / N
      const p = path.getPointAt(u)
      const tan = path.getTangentAt(u)
      const y = groundY(p.x, p.z) + 400 * u
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tan.x, tan.z) + Math.PI / 2)
      im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(34, 34, 34)))
      if (i % 6 === 0) lamps.push([new THREE.Vector3(p.x, y + 14, p.z), 22, [1.0, 0.5, 0.2]])
      top = new THREE.Vector3(p.x, y, p.z)
    }
    town.add(im)
    // 山顶神社（小拜殿）
    const shrine = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(160, 60, 110), new THREE.MeshStandardMaterial({ color: 0x8e2a1c, roughness: 0.7, emissive: 0x5a1a08, emissiveIntensity: 0.6 }))
    body.position.y = 30
    shrine.add(body)
    const roof = new THREE.Mesh(curvedRoofGeometry({ w: 160, d: 110, rise: 60, overhang: 0.25, curl: 0.2, sag: 1.4, thick: 5 }), roofCu)
    roof.position.y = 60
    shrine.add(roof)
    shrine.position.copy(top).add(new THREE.Vector3(80, 0, -80))
    town.add(shrine)
    endpoints.push({ pos: shrine.position.clone().add(new THREE.Vector3(0, 140, 0)), index: -1 })
    lamps.push([shrine.position.clone().add(new THREE.Vector3(0, 40, 60)), 60, [1.0, 0.55, 0.25]])
  }
  // 樱花林：山坡上成片的樱、松、柏（手绘剪影精灵，远看像真的树林）
  const forestList = []
  for (let i = 0; i < 16000; i++) {
    const x = -12000 + R() * 24000
    const zs = shoreZ(x)
    const z = zs - 150 - Math.pow(R(), 0.8) * 9500
    const y = groundY(x, z)
    const onHill = y > WATER_Y + 100 || R() < 0.3
    if (!onHill) continue
    if (fbm2(x / 1500, z / 1500, 3) < 0.44) continue
    const k = R()
    forestList.push({ pos: new THREE.Vector3(x, y - 4, z), size: 50 + R() * 50, kind: k < 0.6 ? 'sakura' : k < 0.85 ? 'pine' : 'cypress' })
  }
  const forest = forestSprites(forestList, { tint: [0.55, 0.5, 0.62], glow: 0.35, glowColor: [0.9, 0.45, 0.65] })
  root.add(forest)
  bakeStatic(town)
  root.add(town)

  // 灯（岸边、塔檐、千本鸟居、天守投光）
  const lampGeo = new THREE.BufferGeometry()
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap(([p]) => p.toArray()), 3))
  lampGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(lamps.map(([, s]) => s), 1))
  lampGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(lamps.flatMap(([, , c]) => c.map((v) => v * 1.6)), 3))
  lampGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(lamps.map(() => 1), 1))
  const lampMat = glowPointMaterial({ size: 1, maxSize: 40 })
  root.add(new THREE.Points(lampGeo, lampMat))
  const nearGeo = new THREE.BufferGeometry()
  nearGeo.setAttribute('position', new THREE.Float32BufferAttribute(toriiLights.flatMap((p) => p.toArray()), 3))
  nearGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(toriiLights.map(() => 10), 1))
  nearGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(toriiLights.flatMap(() => [1.0, 0.6, 0.3]), 3))
  nearGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(toriiLights.map(() => 0.8), 1))
  root.add(new THREE.Points(nearGeo, glowPointMaterial({ size: 1, maxSize: 60 })))

  // ---------- 远景：富士山 + 山脊 ----------
  {
    // 富士山：细分的旋转体 + 放射状冲沟起伏；雪线沿冲沟向下拉出一道道雪痕，边缘柔和过渡
    const prof = []
    for (let i = 0; i <= 120; i++) {
      const u = i / 120
      const r = 17000 * Math.pow(1 - u, 1.6) + 900 * (1 - u)
      prof.push(new THREE.Vector2(Math.max(r, 700), u * 8200))
    }
    prof.push(new THREE.Vector2(0, 8150))
    const geo = new THREE.LatheGeometry(prof, 360)
    const p = geo.attributes.position
    const col = []
    const L = new THREE.Vector3(...MOON).normalize()
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const a = Math.atan2(z, x)
      const rr = Math.hypot(x, z)
      const u = y / 8200
      // 冲沟：高频的放射状沟脊，越往山腰越深
      const gully = Math.pow(Math.abs(Math.sin(a * 23 + fbm2(a * 3, u * 4, 3) * 4)), 3)
      const ridge = 1 - gully
      const k = 1 - 0.018 * gully * Math.sin(Math.PI * Math.min(1, u * 1.15))
      if (rr > 1) { x *= k; z *= k; p.setX(i, x); p.setZ(i, z) }
      const snowLine = 5000 + 650 * Math.sin(a * 5 + 1) + 500 * fbm2(a * 6, 1.3, 4) - 2600 * Math.pow(gully, 6) * (0.4 + 0.6 * fbm2(a * 11, 7.7, 3))
      const snow = THREE.MathUtils.smoothstep(y, snowLine - 160, snowLine + 160)
      // 朝向月光的一面亮
      const nx = x / Math.max(rr, 1), nz = z / Math.max(rr, 1)
      const lit = Math.max(0, nx * L.x * 0.85 + nz * L.z * 0.85 + 0.45) * (0.85 + 0.15 * ridge)
      const base = [0.045 + lit * 0.04, 0.045 + lit * 0.04, 0.085 + lit * 0.06].map((c) => c * (0.8 + 0.4 * u))
      const sn = [0.42 + lit * 0.42, 0.45 + lit * 0.4, 0.6 + lit * 0.32]
      col.push(...base.map((c, j) => c + (sn[j] - c) * snow))
    }
    geo.computeVertexNormals()
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const fuji = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }))
    fuji.position.set(-6000, WATER_Y - 200, -36000)
    root.add(fuji)
    root.add(mountainRing({ radius: 24000, spread: 4000, height: 2200, seed: 4.4, color: 0x06070d, topColor: 0x121428, sector: -0.3 }))
    root.add(mountainRing({ radius: 16000, spread: 2500, height: 1300, seed: 9.3, color: 0x05060a, topColor: 0x0e1020, sector: 0.2 }))
  }
  const mistBlobs = []
  for (let c = 0; c < 30; c++) {
    const a = -Math.PI * 0.7 + R() * Math.PI * 1.4
    const d = 7000 + R() * 16000
    const cx = Math.sin(a) * d * 1.2, cz = -Math.cos(a) * d - 2500, cy = 300 + R() * 900
    for (let k = 0; k < 8; k++) mistBlobs.push({ pos: new THREE.Vector3(cx + (k - 4) * 700, cy + (R() - 0.5) * 150, cz), size: 1400 + R() * 1600, alpha: 0.1 + R() * 0.08 })
  }
  const mist = mistBank(mistBlobs, { color: [0.6, 0.52, 0.7], maxPx: 320 })
  root.add(mist)

  // ---------- 鲸 + 粒子 ----------
  const whales = createWhales({ back: [0.05, 0.07, 0.28], belly: [0.7, 0.62, 0.95], rim: [1.0, 0.55, 0.8], splashColor: [1.0, 0.75, 0.9], moonDir: MOON })
  root.add(whales.object)
  const particles = createParticles({
    seed: 303,
    endpoints,
    emitter: new THREE.Vector3(0, 62, TZ),
    flash: { beginFlash: () => houseSet.beginFlash(), addFlash: (ep, v) => houseSet.addFlash(ep.index, v) },
    lanterns: { mode: 'water', kind: 'box', count: 300, colors: [[1.0, 0.62, 0.3, 0.75], [1.0, 0.4, 0.55, 0.25]], radius: [80, 1500], scale: 1.2 },
    ambient: { kind: 'petal', count: 900, color: [1.0, 0.72, 0.84], color2: [1.0, 0.9, 0.94], floorY: -4, height: 110, radius: [0, 150], base: 0.9, gain: 0.1, size: 1.6 },
    dust: { a: [1.0, 0.8, 0.9], b: [0.8, 0.85, 1.0] },
    glyphs: { chars: ['桜', '月', '夢', '祭', '花', '鯨', '♪', '☆'], font: '900 88px "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif SC", serif', colors: [[1.0, 0.65, 0.8], [1.0, 0.85, 0.5], [0.7, 0.85, 1.0]] },
    packets: { colors: [[1.0, 0.7, 0.85], [0.75, 0.9, 1.0]], arc: 0.26 },
    fireworks: { palette: [[1.0, 0.75, 0.35], [1.0, 0.45, 0.7], [1.0, 0.95, 0.85], [0.5, 1.0, 0.7], [0.7, 0.6, 1.0]], zone: (h) => [-4000 + h(1) * 8000, 1300 + h(3) * 1200, -2600 + h(2) * 1000] },
  })
  root.add(particles.object)

  const tmpC = new THREE.Color()
  return {
    name: 'japan',
    label: '和风群',
    root,
    accent: [1.4, 0.6, 0.95],
    exposure: 1.0,
    sky: {
      zenith: [0.008, 0.01, 0.035], mid: [0.035, 0.028, 0.09], horizon: [0.22, 0.1, 0.2], below: [0.03, 0.025, 0.05],
      glowLow: [0.5, 0.18, 0.3], glowHigh: [0.2, 0.12, 0.3], glowAmt: 1.0,
      stars: 0.9, milky: 0.8,
      orbDir: MOON, orbSize: 0.9985, orbColor: [1.0, 0.94, 0.95], orbBright: 1.9, orbHalo: [0.75, 0.6, 0.85], orbHaloAmt: 1.0,
      cloudAmt: 0.45, cloudBase: [0.06, 0.04, 0.09], cloudLit: [0.5, 0.42, 0.55], cloudScale: 1.3,
    },
    ocean: {
      deep: [0.008, 0.008, 0.025], near: [0.04, 0.02, 0.035], bio: [1.0, 0.45, 0.7], sparkle: [1.0, 0.8, 0.9],
      spec: [0.95, 0.9, 1.0], ring: [1.0, 0.45, 0.55], lightDir: MOON, waves: 0.55,
    },
    fog: { color: [0.06, 0.04, 0.085], density: 0.000052 },
    hemi: { sky: 0x4a3a6a, ground: 0x0c080e, intensity: 1.1 },
    moon: { color: 0xe8e4ff, intensity: 1.1, dir: MOON },
    env: {
      top: [0.02, 0.015, 0.05],
      horizon: [0.2, 0.08, 0.16],
      glow: [0.5, 0.2, 0.35],
      panels: [
        [[2.4, 1.8, 2.2], [0, 60, 70], [60, 20]],
        [[2.6, 0.6, 1.2], [-70, 30, -30], [30, 50]],
        [[2.4, 1.2, 0.5], [70, 25, -40], [30, 40]],
        [[1.4, 1.4, 2.0], [0, 90, -20], [80, 30]],
      ],
    },
    update(state) {
      const t = state.t
      const hush = state.hush
      const alive = 1 - state.fall * 0.85
      updateBuildingUniforms(houseMat, state)
      // 提灯
      const n = chochin.length
      for (let i = 0; i < n; i++) {
        let v
        if (state.bulbMode === 'fill') v = state.bulbFill * 1.05 > (i + 0.5) / n ? 1.0 : 0.08
        else if (state.bulbMode === 'chase') v = 0.6 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(i * 0.8 - t * 6), 3) + state.pulse * 0.5
        else if (state.bulbMode === 'walk') v = 0.5 + (Math.floor(state.beat) % n === i ? 1 : 0)
        else if (state.bulbMode === 'blink') v = Math.sin(i * 91.7 + Math.floor(t * 12) * 13.1) > 0.2 ? 1.1 : 0.05
        else v = 0.85 + 0.15 * Math.sin(t * 1.5 + i)
        v = v * (1 - 0.6 * hush) * alive + state.finaleFlash + state.recoverFlash * 0.6
        chochin.mesh.setColorAt(i, tmpC.setRGB(1.3 * v, 0.85 * v, 0.55 * v))
        chCol.set([1.0 * 0.4, 0.6 * 0.4, 0.3 * 0.4], i * 3)
        chA[i] = Math.min(1, v * 0.5)
      }
      chochin.mesh.instanceColor.needsUpdate = true
      chGeo.attributes.aColor.needsUpdate = true
      chGeo.attributes.aAlpha.needsUpdate = true
      lanternFire.color.setRGB(2.2 * alive, 1.3 * alive, 0.55 * alive)
      lampMat.uniforms.uFade.value = (0.3 + 0.7 * Math.min(1, state.city * 1.2 + state.neon * 0.3)) * alive
      forest.material.uniforms.uGlow.value = (0.25 + 0.25 * state.neon + 0.15 * state.pulse) * alive
      const phase = (Math.PI * state.beat) / 2
      beams.forEach((b, i) => {
        b.rotation.set(-0.45, 0, (i - 0.5) * 0.3 + (i ? -1 : 1) * state.swing * 0.2 * Math.cos(phase + i))
        b.material.uniforms.uInt.value = (0.3 + 0.8 * state.beams) * (1 - 0.8 * hush) * alive
      })
      rig.key.intensity = rig.base.key * state.stage
      rig.spots.forEach((s, i) => {
        s.intensity = rig.base.spots[i] * state.beams * (0.6 + 0.6 * state.pulse) * (1 - 0.9 * hush) * alive
        s.target.position.set(Math.sin(phase + i * 2) * 14 * state.swing, 0, 0)
      })
      rig.rim.intensity = rig.base.rim * (1 - 0.5 * hush)
      mist.material.uniforms.uTime.value = t
      whales.update(state)
      particles.update(state)
    },
    setPixelRatio(pr) {
      particles.setPixelRatio(pr)
      mist.material.uniforms.uPixelRatio.value = pr
      forest.material.uniforms.uPixelRatio.value = pr
    },
  }
}
