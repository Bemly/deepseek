import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, fbm2, WATER_Y, canvasTexture, glowPointMaterial, bakeStatic, clamp01 } from '../util.js'
import { createWhales } from '../whales.js'
import { createParticles } from '../particles.js'
import { rock } from '../landscape.js'
import {
  createLightRig, beamMaterial, beamGeometry, createBuildingMaterial, updateBuildingUniforms, instancedBuildings,
  curvedRoofGeometry, roofRidgeGeometry, pagoda, floatingIslandGeometry, waterfallMaterial, mistBank,
} from '../kit.js'

// 主题：古风城群 —— 中秋月夜的临湖都城
// 近景：汉白玉八角露台 + "逍遥游"三间四柱牌坊，红灯笼，古琴、铜鼎、盆景松，荷花湖与石桥
// 中景：湖对岸的城墙与城楼、万家灯火（约 2000 户）、十七孔桥与湖心亭、临江楼阁、两座宝塔
// 远景：中轴线尽头的宫城、喀斯特群峰、浮空仙山与瀑布、满天孔明灯、金色大月亮
// "北冥有鱼，其名为鲲"——天上游的鲸在这里是鲲，镶金边。

const MOON = [0.22, 0.3, -1]
const shoreZ = (x) => -2700 + 260 * Math.sin(x / 2600) + 1600 * Math.pow(Math.min(1, Math.abs(x) / 14000), 2)
const wallZ = (x) => shoreZ(x) - 160
function groundY(x, z) {
  const d = shoreZ(x) - z
  if (d < 0) return WATER_Y - 8 - Math.min(40, -d * 0.2)
  const bank = Math.min(1, d / 120) * 16
  return WATER_Y + bank + d * 0.014 + 320 * fbm2(x / 5200 + 3, z / 5200, 3) * Math.min(1, d / 3000)
}

// ---------- 贴图 ----------
function stoneFloorTexture() {
  const R = rng(8)
  return canvasTexture(1024, 1024, (g, w, h) => {
    const n = 8, s = w / n
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 200 + Math.floor(R() * 26)
      g.fillStyle = `rgb(${v},${v - 6},${v - 16})`
      g.fillRect(i * s, j * s, s, s)
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(120,110,100,${R() * 0.08})`
        g.fillRect(i * s + R() * s, j * s + R() * s, 2 + R() * 10, 1 + R() * 3)
      }
    }
    g.strokeStyle = 'rgba(90,80,60,0.55)'
    g.lineWidth = 3
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.stroke()
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke()
    }
  }, { repeat: true })
}

function medallionTexture() {
  return canvasTexture(1024, 1024, (g, w) => {
    const c = w / 2
    const grd = g.createRadialGradient(c, c, 40, c, c, c)
    grd.addColorStop(0, '#8e1b1b')
    grd.addColorStop(1, '#5a0c10')
    g.fillStyle = grd
    g.fillRect(0, 0, w, w)
    g.strokeStyle = '#e2b25c'
    for (const [r, lw] of [[500, 10], [468, 3], [340, 6], [326, 2]]) {
      g.lineWidth = lw
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke()
    }
    // 回纹
    g.lineWidth = 4
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2
      g.save(); g.translate(c + Math.cos(a) * 486, c + Math.sin(a) * 486); g.rotate(a)
      g.strokeRect(-9, -9, 18, 18); g.strokeRect(-4, -4, 8, 8)
      g.restore()
    }
    const text = '北冥有鱼其名为鲲化而为鸟其名为鹏'
    g.font = '700 58px "Noto Serif SC", "Songti SC", "SimSun", serif'
    g.fillStyle = '#f1cf7c'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    ;[...text].forEach((ch, i) => {
      const a = (i / text.length) * Math.PI * 2 - Math.PI / 2
      g.save(); g.translate(c + Math.cos(a) * 404, c + Math.sin(a) * 404); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore()
    })
    // 海水江崖 + 鲲
    g.strokeStyle = '#f1cf7c'
    g.lineWidth = 5
    for (let k = 0; k < 5; k++) {
      g.beginPath()
      for (let x = -300; x <= 300; x += 6) g.lineTo(c + x, c + 170 + k * 22 + Math.sin(x / 26 + k) * 10)
      g.stroke()
    }
    g.fillStyle = '#f1cf7c'
    g.save(); g.translate(c, c + 10); g.scale(6, 6)
    g.beginPath(); g.moveTo(-30, 0); g.bezierCurveTo(-30, -22, 10, -26, 26, -8); g.bezierCurveTo(34, 2, 40, -2, 46, -14)
    g.bezierCurveTo(48, -2, 44, 8, 36, 10); g.bezierCurveTo(18, 24, -30, 22, -30, 0); g.fill()
    g.fillStyle = '#6a1016'; g.beginPath(); g.arc(-16, -4, 3, 0, Math.PI * 2); g.fill()
    g.restore()
    // 祥云
    for (const [x, y, s] of [[-210, -200, 1], [200, -230, 0.8], [-260, 40, 0.7], [250, 30, 0.75]]) {
      g.save(); g.translate(c + x, c + y); g.scale(s, s)
      for (const [dx, dy, r] of [[0, 0, 30], [34, -8, 24], [-32, -4, 22], [12, -30, 20]]) { g.beginPath(); g.arc(dx, dy, r, 0, Math.PI * 2); g.stroke() }
      g.restore()
    }
  })
}

function plaqueTexture(text) {
  return canvasTexture(1024, 384, (g, w, h) => {
    g.fillStyle = '#1b2f6b'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#e2b25c'
    g.lineWidth = 18
    g.strokeRect(14, 14, w - 28, h - 28)
    g.lineWidth = 4
    g.strokeRect(40, 40, w - 80, h - 80)
    g.font = '900 200px "Noto Serif SC", "Songti SC", "STKaiti", "KaiTi", serif'
    g.fillStyle = '#f3d27a'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = '#ffcf6a'
    g.shadowBlur = 16
    g.fillText(text, w / 2, h / 2 + 8)
  })
}

// 彩画梁枋：青绿底、金线、旋子
function paintedBeamTexture() {
  return canvasTexture(1024, 128, (g, w, h) => {
    g.fillStyle = '#1f5b58'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#23407a'
    for (let x = 0; x < w; x += 256) g.fillRect(x + 96, 0, 64, h)
    g.strokeStyle = '#e2b25c'
    g.lineWidth = 5
    g.strokeRect(4, 6, w - 8, h - 12)
    for (let x = 128; x < w; x += 256) {
      g.beginPath(); g.ellipse(x, h / 2, 44, 40, 0, 0, Math.PI * 2); g.stroke()
      g.beginPath(); g.ellipse(x, h / 2, 22, 20, 0, 0, Math.PI * 2); g.stroke()
    }
  }, { repeat: true })
}

// 木格窗 + 糊纸：白天是纸色，自发光贴图让窗纸透出暖光
function latticeTexture(emissive) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = emissive ? '#ffb45c' : '#e8d9b4'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = emissive ? '#000' : '#6a1e14'
    g.lineWidth = 10
    g.strokeRect(0, 0, w, h)
    g.lineWidth = 5
    for (let i = 1; i < 6; i++) {
      g.beginPath(); g.moveTo((i * w) / 6, 0); g.lineTo((i * w) / 6, h); g.stroke()
      g.beginPath(); g.moveTo(0, (i * h) / 6); g.lineTo(w, (i * h) / 6); g.stroke()
    }
  }, { repeat: true })
}

// 灯笼（红色椭球 + 上下金箍 + 流苏）
function lanternGeometry(r = 1) {
  const L = (pts, s = 16) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x * r, y * r)), s)
  return {
    body: new THREE.SphereGeometry(r, 16, 12).scale(1, 0.85, 1),
    caps: mergeGeometries([L([[0, 0.72], [0.45, 0.72], [0.45, 0.95], [0, 0.95]]), L([[0, -0.95], [0.45, -0.95], [0.45, -0.72], [0, -0.72]])]),
    tassel: new THREE.CylinderGeometry(0.12 * r, 0.3 * r, 1.1 * r, 8).translate(0, -1.5 * r, 0),
  }
}

// 中式殿阁：台基 + 柱 + 格窗墙 + 屋顶（可重檐）
function hall({ w, d, h, baseH = 0, tiers = 1, mats, rise = 0.42, curl = 0.42, ridge = true }) {
  const g = new THREE.Group()
  if (baseH > 0) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.18, baseH, d * 1.3), mats.stone)
    base.position.y = baseH / 2
    g.add(base)
  }
  let y = baseH
  let ww = w, dd = d, hh = h
  for (let t = 0; t < tiers; t++) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ww * 0.9, hh, dd * 0.8), mats.wall)
    wall.position.y = y + hh / 2
    g.add(wall)
    const cols = Math.max(2, Math.round(ww / (hh * 0.55)))
    for (let i = 0; i <= cols; i++) for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(hh * 0.045, hh * 0.05, hh, 8), mats.column)
      c.position.set(-ww * 0.46 + (i / cols) * ww * 0.92, y + hh / 2, sz * dd * 0.43)
      g.add(c)
    }
    const top = t === tiers - 1
    const rr = top ? dd * rise : dd * 0.14
    const roof = new THREE.Mesh(curvedRoofGeometry({ w: ww, d: dd, rise: rr, overhang: 0.2, curl, sag: 1.7, thick: dd * 0.03 }), mats.roof)
    roof.position.y = y + hh
    g.add(roof)
    if (ridge && top) {
      const rg = new THREE.Mesh(roofRidgeGeometry({ w: ww, d: dd, rise: rr, overhang: 0.2, r: dd * 0.02 }), mats.ridge ?? mats.roof)
      rg.position.y = y + hh
      g.add(rg)
    }
    y += hh + rr * (top ? 1 : 0.9)
    ww *= 0.78
    dd *= 0.8
    hh *= 0.62
  }
  g.userData.height = y
  return g
}

export function createAncientTheme() {
  const root = new THREE.Group()
  root.name = 'theme:ancient'
  const R = rng(1111)

  // ---------- 材质 ----------
  const marble = new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.6 })
  const floorMat = new THREE.MeshStandardMaterial({ map: stoneFloorTexture(), roughness: 0.6 })
  floorMat.map.repeat.set(3, 3)
  const redLacquer = new THREE.MeshPhysicalMaterial({ color: 0x9a1a14, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a84e, metalness: 1, roughness: 0.3 })
  const greenTile = new THREE.MeshStandardMaterial({ color: 0x1f6b52, roughness: 0.45, metalness: 0.1 })
  const yellowTile = new THREE.MeshStandardMaterial({ color: 0xc9951f, roughness: 0.42, metalness: 0.25 })
  const greyTile = new THREE.MeshStandardMaterial({ color: 0x23252c, roughness: 0.8 })
  const beamMat = new THREE.MeshStandardMaterial({ map: paintedBeamTexture(), roughness: 0.6 })
  beamMat.map.repeat.set(2.5, 1)
  const lanternRed = new THREE.MeshStandardMaterial({ color: 0x4a0606, emissive: new THREE.Color(1.0, 0.18, 0.06), emissiveIntensity: 0.8, roughness: 0.7 })
  const wallLit = new THREE.MeshStandardMaterial({ map: latticeTexture(false), emissiveMap: latticeTexture(true), emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.8 })
  wallLit.map.repeat.set(6, 2)
  wallLit.emissiveMap.repeat.set(6, 2)
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5b4a2a, metalness: 0.9, roughness: 0.45 })
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.55 })
  const brick = new THREE.MeshStandardMaterial({ color: 0x3b3a3c, roughness: 0.9 })
  const hallMats = { stone: marble, wall: wallLit, column: redLacquer, roof: yellowTile, ridge: gold }

  // ---------- 近景：八角汉白玉露台 ----------
  const stage = new THREE.Group()
  const CZ = -8
  {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(44, 44, 3, 8), [marble, floorMat, marble])
    top.rotation.y = Math.PI / 8
    top.position.set(0, -1.5, CZ)
    top.receiveShadow = true
    stage.add(top)
    const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(49.5, 50.5, 3.2, 8), marble)
    tier2.rotation.y = Math.PI / 8
    tier2.position.set(0, -4.4, CZ)
    stage.add(tier2)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(51, 53, 6, 8), new THREE.MeshStandardMaterial({ color: 0x8c8678, roughness: 0.9 }))
    base.rotation.y = Math.PI / 8
    base.position.set(0, -8.5, CZ)
    stage.add(base)
    const med = new THREE.Mesh(new THREE.CircleGeometry(9, 96), new THREE.MeshStandardMaterial({ map: medallionTexture(), roughness: 0.45, metalness: 0.2 }))
    med.rotation.x = -Math.PI / 2
    med.position.y = 0.03
    med.receiveShadow = true
    stage.add(med)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.1, 0.2, 8, 96), gold)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.05
    stage.add(ring)

    // 栏杆：望柱 + 栏板，沿八角边一圈，正前方留出台阶口
    const postGeo = mergeGeometries([new THREE.BoxGeometry(1.1, 5.2, 1.1).translate(0, 2.6, 0), new THREE.SphereGeometry(0.75, 10, 8).scale(1, 1.3, 1).translate(0, 5.9, 0)].map((g) => g.toNonIndexed()))
    const posts = [], panels = []
    const rv = 43.2
    for (let e = 0; e < 8; e++) {
      const a0 = (e / 8) * Math.PI * 2 + Math.PI / 8 + Math.PI / 8, a1 = a0 + Math.PI / 4
      const p0 = new THREE.Vector3(Math.sin(a0) * rv, 0, Math.cos(a0) * rv + CZ)
      const p1 = new THREE.Vector3(Math.sin(a1) * rv, 0, Math.cos(a1) * rv + CZ)
      const n = 6
      for (let k = 0; k <= n; k++) {
        const p = p0.clone().lerp(p1, k / n)
        const mid = p0.clone().lerp(p1, (k + 0.5) / n)
        const front = Math.abs(mid.x) < 9 && mid.z > 20
        if (!(front && Math.abs(p.x) < 7)) posts.push(p)
        if (k < n && !front) panels.push({ p: mid, rot: Math.atan2(p1.x - p0.x, p1.z - p0.z), len: p0.distanceTo(p1) / n })
      }
    }
    const pm = new THREE.InstancedMesh(postGeo, marble, posts.length)
    posts.forEach((p, i) => pm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 0, p.z)))
    pm.castShadow = true
    stage.add(pm)
    const panelGeo = mergeGeometries([
      new THREE.BoxGeometry(1, 0.5, 0.5).translate(0, 3.9, 0), // 扶手
      new THREE.BoxGeometry(1, 2.6, 0.35).translate(0, 1.7, 0), // 栏板
      new THREE.BoxGeometry(1, 0.3, 0.7).translate(0, 0.15, 0), // 地栿
    ].map((g) => g.toNonIndexed()))
    const pn = new THREE.InstancedMesh(panelGeo, marble, panels.length)
    panels.forEach((s, i) => pn.setMatrixAt(i, new THREE.Matrix4().compose(s.p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot + Math.PI / 2), new THREE.Vector3(s.len * 0.86, 1, 1))))
    pn.castShadow = true
    stage.add(pn)

    // 前方台阶 + 石桥
    for (let k = 0; k < 3; k++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(15, 1, 2.6), marble)
      st.position.set(0, -0.5 - k * 1.0, 41.5 + k * 2.6)
      st.receiveShadow = true
      stage.add(st)
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 150), marble)
    bridge.position.set(0, -3.6, 124)
    bridge.receiveShadow = true
    stage.add(bridge)
    const railPosts = []
    for (let z = 50; z < 198; z += 7) for (const s of [-1, 1]) railPosts.push(new THREE.Vector3(s * 6.6, -3, z))
    const rp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 3.4, 0.8).translate(0, 1.7, 0), marble, railPosts.length)
    railPosts.forEach((p, i) => rp.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)))
    stage.add(rp)
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 148), marble)
      rail.position.set(s * 6.6, -0.1, 124)
      stage.add(rail)
    }
    for (let z = 58; z < 198; z += 18) for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 9, 6), darkWood)
      pole.position.set(s * 6.6, 1.3, z)
      stage.add(pole)
    }
  }

  // 牌坊 "逍遥游"：三间四柱
  const lanternSlots = [] // 挂在牌坊和灯架上的灯笼（像港湾的灯泡墙一样跟节奏）
  {
    const PZ = -30
    const pf = new THREE.Group()
    const colH = { inner: 44, outer: 33 }
    for (const x of [-13, 13, -31, 31]) {
      const inner = Math.abs(x) < 20
      const h = inner ? colH.inner : colH.outer
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, h, 16), redLacquer)
      col.position.set(x, h / 2, PZ)
      pf.add(col)
      const drum = new THREE.Mesh(new THREE.BoxGeometry(5.2, 7, 5.2), marble)
      drum.position.set(x, 3.5, PZ)
      pf.add(drum)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 1.2, 16), gold)
      cap.position.set(x, 7.6, PZ)
      pf.add(cap)
    }
    const beam = (x0, x1, y, hgt) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, hgt, 2.4), beamMat)
      b.position.set((x0 + x1) / 2, y, PZ)
      pf.add(b)
    }
    beam(-15, 15, 31, 2.6)
    beam(-15, 15, 38.5, 2.2)
    beam(-33, -11, 23, 2.4)
    beam(11, 33, 23, 2.4)
    beam(-33, -11, 28, 1.8)
    beam(11, 33, 28, 1.8)
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.2), new THREE.MeshStandardMaterial({ map: plaqueTexture('逍遥游'), emissive: 0xffffff, emissiveMap: plaqueTexture('逍遥游'), emissiveIntensity: 0.35, roughness: 0.4 }))
    plaque.position.set(0, 34.7, PZ + 1.3)
    pf.add(plaque)
    // 斗拱层 + 屋顶
    const bracket = (x0, x1, y) => {
      const n = Math.round((x1 - x0) / 1.6)
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.2, 3.2), gold, n)
      for (let i = 0; i < n; i++) im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x0 + (i + 0.5) * ((x1 - x0) / n), y, PZ))
      pf.add(im)
    }
    bracket(-15, 15, 40.4)
    bracket(-33, -11, 29.8)
    bracket(11, 33, 29.8)
    const roofAt = (w, x, y) => {
      const r = new THREE.Mesh(curvedRoofGeometry({ w, d: 6, rise: 4.8, overhang: 0.22, curl: 0.6, sag: 1.6, thick: 0.35 }), greenTile)
      r.position.set(x, y, PZ)
      pf.add(r)
      const rg = new THREE.Mesh(roofRidgeGeometry({ w, d: 6, rise: 4.8, overhang: 0.22, r: 0.3 }), gold)
      rg.position.set(x, y, PZ)
      pf.add(rg)
    }
    roofAt(32, 0, 41)
    roofAt(24, -22, 30.4)
    roofAt(24, 22, 30.4)
    stage.add(pf)
    // 牌坊上挂的灯笼：中间两盏大的，梁下一排小的
    for (const x of [-8, 8]) lanternSlots.push({ pos: new THREE.Vector3(x, 26.5, PZ + 1.8), r: 2.2, group: 0 })
    for (let i = 0; i < 9; i++) lanternSlots.push({ pos: new THREE.Vector3(-12 + i * 3, 36.2, PZ + 1.8), r: 0.8, group: 1 })
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) lanternSlots.push({ pos: new THREE.Vector3(s * (14 + i * 3.4), 25.8, PZ + 1.8), r: 0.75, group: 1 })
  }

  // 宫灯 × 4（木杆 + 六角灯）
  for (const [x, z] of [[-24, 20], [24, 20], [-40, -14], [40, -14]]) {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 20, 8), redLacquer)
    pole.position.y = 10
    g.add(pole)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4), darkWood)
    arm.position.set(0, 19.5, 1.8)
    g.add(arm)
    lanternSlots.push({ pos: new THREE.Vector3(x, 16.8, z + 3.6), r: 1.6, group: 2, hex: true })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 1.4, 6), marble)
    base.position.y = 0.7
    g.add(base)
    g.position.set(x, 0, z)
    g.lookAt(0, 0, CZ)
    g.rotation.x = 0
    stage.add(g)
  }
  // 灯笼实例
  const lg = lanternGeometry(1)
  const hexBody = new THREE.CylinderGeometry(1, 1, 1.9, 6)
  const lanternMeshes = []
  {
    const normal = lanternSlots.filter((s) => !s.hex)
    const hexes = lanternSlots.filter((s) => s.hex)
    const mk = (geo, mat, list) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length)
      list.forEach((s, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(s.pos, new THREE.Quaternion(), new THREE.Vector3(s.r, s.r, s.r))))
      stage.add(im)
      return im
    }
    const bodies = mk(lg.body, new THREE.MeshBasicMaterial({ color: 0xffffff }), normal)
    for (let i = 0; i < normal.length; i++) bodies.setColorAt(i, new THREE.Color(1, 0.2, 0.06))
    mk(lg.caps, gold, normal)
    mk(lg.tassel, lanternRed, normal)
    const hx = mk(hexBody, new THREE.MeshBasicMaterial({ color: 0xffffff }), hexes)
    for (let i = 0; i < hexes.length; i++) hx.setColorAt(i, new THREE.Color(1, 0.55, 0.2))
    mk(new THREE.CylinderGeometry(1.25, 1.25, 0.25, 6).translate(0, 1.05, 0), gold, hexes)
    mk(new THREE.CylinderGeometry(1.25, 1.25, 0.25, 6).translate(0, -1.05, 0), gold, hexes)
    lanternMeshes.push({ mesh: bodies, list: normal, color: [1, 0.16, 0.05] }, { mesh: hx, list: hexes, color: [1, 0.45, 0.14] })
  }
  // 灯笼光晕
  const lhGeo = new THREE.BufferGeometry()
  lhGeo.setAttribute('position', new THREE.Float32BufferAttribute(lanternSlots.flatMap((s) => s.pos.toArray()), 3))
  lhGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(lanternSlots.map((s) => s.r * 7), 1))
  const lhCol = new Float32Array(lanternSlots.length * 3)
  const lhA = new Float32Array(lanternSlots.length)
  lhGeo.setAttribute('aColor', new THREE.BufferAttribute(lhCol, 3))
  lhGeo.setAttribute('aAlpha', new THREE.BufferAttribute(lhA, 1))
  stage.add(new THREE.Points(lhGeo, glowPointMaterial({ size: 1, maxSize: 80 })))

  // 道具：古琴 + 琴桌（左）、铜鼎（右）、盆景松（后两角）
  {
    const qin = new THREE.Group()
    const table = new THREE.Mesh(new THREE.BoxGeometry(12, 0.6, 4), darkWood)
    table.position.y = 6.2
    qin.add(table)
    for (const [x, z] of [[-5.4, -1.6], [5.4, -1.6], [-5.4, 1.6], [5.4, 1.6]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), darkWood)
      l.position.set(x, 3, z)
      qin.add(l)
    }
    const qs = new THREE.Shape()
    qs.moveTo(-5.2, -0.8); qs.lineTo(4.6, -0.9); qs.quadraticCurveTo(5.4, 0, 4.6, 0.9); qs.lineTo(-5.2, 0.8); qs.quadraticCurveTo(-5.6, 0, -5.2, -0.8)
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(qs, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2 }).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x1a0c08, roughness: 0.3, clearcoat: 0.8 }))
    body.position.y = 6.6
    qin.add(body)
    for (let k = 0; k < 7; k++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 10, 4), new THREE.MeshStandardMaterial({ color: 0xe8dcc0 }))
      s.rotation.z = Math.PI / 2
      s.position.set(-0.3, 7.15, -0.55 + k * 0.18)
      qin.add(s)
    }
    for (let k = 0; k < 13; k++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), gold)
      dot.position.set(-4.6 + k * 0.68, 7.08, -0.75)
      qin.add(dot)
    }
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.9, 20), new THREE.MeshStandardMaterial({ color: 0x3a2a6a, roughness: 0.9 }))
    cushion.position.set(0, 0.45, 4.5)
    qin.add(cushion)
    qin.position.set(-29, 0, 6)
    qin.rotation.y = 0.7
    stage.add(qin)

    const ding = new THREE.Group()
    const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [3.4, 0.2], [4.2, 2], [4.3, 4.8], [4.6, 5.2], [4.2, 5.3], [0, 5]].map(([x, y]) => new THREE.Vector2(x, y)), 32), bronze)
    bowl.position.y = 4.4
    ding.add(bowl)
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 5, 8), bronze)
      leg.position.set(Math.cos(a) * 2.6, 2.4, Math.sin(a) * 2.6)
      ding.add(leg)
    }
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.3, 6, 16, Math.PI), bronze)
      ear.position.set(s * 3.3, 9.8, 0)
      ding.add(ear)
    }
    ding.position.set(30, 0, 2)
    stage.add(ding)

    const pine = (x, z) => {
      const g = new THREE.Group()
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.4, 3, 24), new THREE.MeshPhysicalMaterial({ color: 0xe9eef7, roughness: 0.25, clearcoat: 1 }))
      pot.position.y = 1.5
      g.add(pot)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.1, 0.8, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c55a8, roughness: 0.4 }))
      band.position.y = 2.2
      g.add(band)
      const trunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 3, 0), new THREE.Vector3(1.2, 6, 0.4), new THREE.Vector3(-0.6, 9, -0.3), new THREE.Vector3(1.5, 12, 0.5)]), 20, 0.45, 6)
      g.add(new THREE.Mesh(trunk, new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.95 })))
      const needles = new THREE.MeshStandardMaterial({ color: 0x1f4a2a, roughness: 0.9 })
      for (const [px, py, pz, s] of [[2.4, 7.5, 0.6, 2.4], [-2, 10, 0, 2.1], [2.6, 12.3, 0.4, 2.3], [0.2, 13.4, 0, 1.6]]) {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(s * 1.5, s * 0.45, s), needles)
        pad.position.set(px, py, pz)
        g.add(pad)
      }
      g.position.set(x, 0, z)
      stage.add(g)
    }
    pine(-37, -24)
    pine(37, -24)
  }

  // 荷叶 + 荷花（舞台周围的水面）
  {
    const leafShape = new THREE.Shape()
    leafShape.absarc(0, 0, 1, 0.2, Math.PI * 2 - 0.2, false)
    leafShape.lineTo(0, 0)
    const leafGeo = new THREE.ShapeGeometry(leafShape, 16).rotateX(-Math.PI / 2)
    const N = 420
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x1f4d2a, roughness: 0.6, side: THREE.DoubleSide }), N)
    const flowers = []
    let n = 0
    for (let i = 0; i < 1400 && n < N; i++) {
      const a = R() * Math.PI * 2, r = 58 + Math.pow(R(), 1.5) * 260
      const x = Math.sin(a) * r, z = Math.cos(a) * r + CZ
      if (Math.abs(x) < 16 && z > 30) continue
      if (fbm2(x / 60, z / 60, 2) < 0.45) continue
      const s = 3 + R() * 5
      leaves.setMatrixAt(n++, new THREE.Matrix4().compose(new THREE.Vector3(x, WATER_Y + 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.15, R() * 6.28, (R() - 0.5) * 0.15)), new THREE.Vector3(s, 1, s)))
      if (R() < 0.18) flowers.push(new THREE.Vector3(x + (R() - 0.5) * s, WATER_Y + 2 + R() * 2, z + (R() - 0.5) * s))
    }
    leaves.count = n
    stage.add(leaves)
    const petal = new THREE.SphereGeometry(0.9, 8, 6).scale(0.5, 1.2, 0.25).translate(0, 1, 0)
    const parts = []
    for (let l = 0; l < 2; l++) for (let i = 0; i < 7; i++) {
      const g = petal.clone().rotateX(l ? 0.5 : 0.25).rotateY((i / 7) * Math.PI * 2 + l * 0.45)
      parts.push(g.toNonIndexed())
    }
    const flowerGeo = mergeGeometries(parts)
    const fm = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ color: 0xf2a6c0, emissive: 0x5a1a30, roughness: 0.5 }), flowers.length)
    flowers.forEach((p, i) => fm.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(1.2, 1.2, 1.2))))
    stage.add(fm)
  }

  bakeStatic(stage)
  root.add(stage)

  // ---------- 光柱：月光从牌坊后斜照下来，副歌时摆动 ----------
  const beams = []
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(beamGeometry(1.5, 16, 120), beamMaterial(i % 2 ? [1.0, 0.75, 0.4] : [1.0, 0.45, 0.25], 0.22))
    m.position.set((i - 1.5) * 18, 95, -45)
    m.frustumCulled = false
    root.add(m)
    beams.push(m)
  }

  // ---------- 灯光 ----------
  const rig = createLightRig({
    key: { color: 0xffd0a0, intensity: 8500, pos: [10, 70, 90], target: [0, 8, 0] },
    spots: [{ color: 0xff5a2a, intensity: 5000, pos: [-40, 55, -10] }, { color: 0xffb060, intensity: 5000, pos: [40, 55, -10] }],
    rim: { color: 0xa8b8ff, intensity: 8000, pos: [0, 60, -70] },
    points: [{ color: 0xff8a3a, intensity: 40, pos: [-24, 17, 23] }, { color: 0xff8a3a, intensity: 40, pos: [24, 17, 23] }],
  })
  root.add(rig.group)

  // ---------- 中景：地面、城墙、城楼、民居 ----------
  const city = new THREE.Group()
  {
    const gw = 44000, gd = 34000
    const geo = new THREE.PlaneGeometry(gw, gd, 220, 170).rotateX(-Math.PI / 2)
    const p = geo.attributes.position
    const col = []
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i) - 17000 - 1200
      p.setZ(i, z)
      const y = groundY(x, z)
      p.setY(i, y)
      const t = clamp01((y - WATER_Y) / 400)
      col.push(0.03 + t * 0.02, 0.028 + t * 0.03, 0.035 + t * 0.02)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.computeVertexNormals()
    city.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })))
  }
  // 城墙 + 垛口 + 墙头灯
  const wallLights = []
  {
    const segs = []
    const merlons = []
    const L = 200
    for (let x = -11600; x < 11600; x += L) {
      const xm = x + L / 2
      if ([-6000, 0, 6000].some((g) => Math.abs(xm - g) < 150)) continue
      const z0 = wallZ(x), z1 = wallZ(x + L)
      const y = Math.min(groundY(x, z0), groundY(x + L, z1))
      segs.push({ x: xm, z: (z0 + z1) / 2, y, rot: -Math.atan2(z1 - z0, L), len: Math.hypot(L, z1 - z0) })
      for (let k = 0; k < 10; k++) {
        const xx = x + (k + 0.5) * (L / 10)
        merlons.push(new THREE.Vector3(xx, y + 96, wallZ(xx) + 22))
      }
      for (let k = 0; k < 3; k++) wallLights.push(new THREE.Vector3(x + (k + 0.5) * (L / 3), y + 104, wallZ(x + (k + 0.5) * (L / 3)) + 26))
    }
    const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), brick, segs.length)
    segs.forEach((s, i) => wm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y - 30, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot), new THREE.Vector3(s.len + 2, 122, 52))))
    city.add(wm)
    const mm = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 12, 8), brick, merlons.length)
    merlons.forEach((p, i) => mm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)))
    city.add(mm)
  }
  // 城楼（三座城门）
  const endpoints = []
  for (const gx of [-6000, 0, 6000]) {
    const big = gx === 0
    const z = wallZ(gx), y = groundY(gx, z)
    const gate = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(big ? 520 : 380, 130, 150), brick)
    base.position.y = 65
    gate.add(base)
    const arch = new THREE.Mesh(new THREE.CircleGeometry(38, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x050302 }))
    arch.position.set(0, 50, 75.5)
    gate.add(arch)
    const archRect = new THREE.Mesh(new THREE.PlaneGeometry(76, 50), new THREE.MeshBasicMaterial({ color: 0x050302 }))
    archRect.position.set(0, 25, 75.5)
    gate.add(archRect)
    const h = hall({ w: big ? 400 : 280, d: 120, h: 70, tiers: 2, mats: { ...hallMats, roof: big ? yellowTile : greyTile } })
    h.position.y = 130
    gate.add(h)
    gate.position.set(gx, y - 10, z)
    city.add(gate)
    endpoints.push({ pos: new THREE.Vector3(gx, y + 120 + h.userData.height, z), index: -1 })
    for (let k = -3; k <= 3; k++) wallLights.push(new THREE.Vector3(gx + k * (big ? 55 : 38), y + 186, z + 90))
  }
  // 民居：墙体（带格窗的楼体材质）+ 三种长宽比的屋顶
  const houseMat = createBuildingMaterial({
    extentX: 12000, base: [0.035, 0.022, 0.018], top: [0.02, 0.02, 0.025], grid: [22, 30], win: [0.12, 0.88, 0.2, 0.86],
    warm: [1.0, 0.55, 0.22], cool: [1.0, 0.75, 0.42], winGain: 2.6, lattice: 0.45, neonMix: [0, 0, 0], flash: [1.0, 0.75, 0.3], glass: [0.02, 0.012, 0.008],
  })
  const houses = []
  const ASPECTS = [1, 1.5, 2.2]
  const roofSlots = [[], [], []]
  for (let x = -11200; x < 11200; x += 170) {
    const zw = wallZ(x)
    for (let z = zw - 260; z > -15000; z -= 170) {
      const depth = zw - z
      if (R() > 0.8 - depth / 40000) continue
      const px = x + (R() - 0.5) * 60, pz = z + (R() - 0.5) * 60
      if (Math.abs(px) < 1700 && pz < -5600 && pz > -10400) continue // 宫城
      if (Math.abs(px) < 110) continue // 中轴大街
      const ai = Math.floor(R() * 3)
      const s = 70 + R() * 50
      const tall = depth < 1400 && R() < 0.16
      const h = tall ? 90 + R() * 60 : 38 + R() * 26
      const y = groundY(px, pz)
      const rot = (R() - 0.5) * 0.12 + (R() < 0.5 ? 0 : Math.PI / 2)
      const w = s * ASPECTS[ai]
      houses.push({ x: px, y, z: pz, w: w * 0.86, d: s * 0.86, h, rot })
      roofSlots[ai].push({ x: px, y: y + h, z: pz, s, rot, rise: 0.4 + R() * 0.1 })
      if (tall) roofSlots[ai].push({ x: px, y: y + h * 0.52, z: pz, s: s * 1.08, rot, rise: 0.14 })
    }
  }
  const houseSet = instancedBuildings(houses, houseMat, R, { neon: [[1, 0.5, 0.2]], density: [0.4, 0.85] })
  city.add(houseSet.mesh)
  ASPECTS.forEach((asp, ai) => {
    const list = roofSlots[ai]
    const geo = curvedRoofGeometry({ w: asp, d: 1, rise: 1, overhang: 0.18, curl: 0.35, sag: 1.6, thick: 0.05, segs: 10 })
    const im = new THREE.InstancedMesh(geo, greyTile, list.length)
    list.forEach((r, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(r.x, r.y, r.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rot), new THREE.Vector3(r.s, r.s * r.rise, r.s))))
    im.frustumCulled = false
    city.add(im)
  })
  houses.filter((hh) => hh.h > 100).slice(0, 30).forEach((hh) => endpoints.push({ pos: new THREE.Vector3(hh.x, hh.y + hh.h + 40, hh.z), index: hh.index }))

  // 宫城：三层须弥座 + 重檐大殿 + 两侧配殿 + 前门
  {
    const pz = -8200, py = groundY(0, pz)
    const pal = new THREE.Group()
    let y = 0
    for (const [w, d] of [[2000, 1300], [1600, 1000], [1250, 760]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, 55, d), marble)
      t.position.y = y + 27.5
      pal.add(t)
      y += 55
    }
    const main = hall({ w: 900, d: 380, h: 170, tiers: 2, mats: hallMats, rise: 0.5 })
    main.position.y = y
    pal.add(main)
    for (const s of [-1, 1]) {
      const side = hall({ w: 420, d: 200, h: 110, tiers: 1, mats: hallMats })
      side.position.set(s * 760, 55, 300)
      pal.add(side)
    }
    const front = hall({ w: 620, d: 200, h: 120, baseH: 90, tiers: 2, mats: { ...hallMats, stone: brick } })
    front.position.set(0, 0, 1650)
    pal.add(front)
    pal.position.set(0, py, pz)
    city.add(pal)
    endpoints.push({ pos: new THREE.Vector3(0, py + y + main.userData.height, pz), index: -1 })
    // 宫墙
    const wallG = new THREE.MeshStandardMaterial({ color: 0x5a1612, roughness: 0.85 })
    for (const [x, z, w, d] of [[0, 900, 2600, 30], [0, -900, 2600, 30], [1300, 0, 30, 1800], [-1300, 0, 30, 1800]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 70, d), wallG)
      m.position.set(x, py + 35, pz + z)
      city.add(m)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 20, 10, d + 20), yellowTile)
      cap.position.set(x, py + 74, pz + z)
      city.add(cap)
    }
  }

  // 宝塔 × 3 + 临江楼阁
  const eaveLights = []
  const placePagoda = (x, z, opts) => {
    const p = pagoda(opts)
    const y = groundY(x, z)
    p.group.position.set(x, y, z)
    city.add(p.group)
    for (const c of p.corners) eaveLights.push(c.clone().add(p.group.position))
    endpoints.push({ pos: p.top.clone().add(p.group.position), index: -1 })
  }
  const pagodaBrick = new THREE.MeshStandardMaterial({ color: 0x6e5a44, roughness: 0.9 })
  placePagoda(-4300, -5600, { tiers: 9, baseW: 150, tierH: 95, taper: 0.9, rise: 0.22, curl: 0.3, overhang: 0.2, wallMat: pagodaBrick, roofMat: greyTile, trimMat: marble, finialMat: gold })
  placePagoda(4800, -6400, { tiers: 7, baseW: 130, tierH: 90, taper: 0.87, rise: 0.35, curl: 0.5, overhang: 0.32, wallMat: wallLit, roofMat: greyTile, colMat: redLacquer, trimMat: marble, finialMat: gold })
  placePagoda(-9200, -9800, { tiers: 5, baseW: 110, tierH: 80, taper: 0.88, rise: 0.35, curl: 0.5, overhang: 0.3, wallMat: wallLit, roofMat: greenTile, colMat: redLacquer, trimMat: marble, finialMat: gold })
  placePagoda(8200, -3900, { tiers: 4, baseW: 240, tierH: 90, taper: 0.82, rise: 0.4, curl: 0.55, overhang: 0.34, wallMat: wallLit, roofMat: yellowTile, colMat: redLacquer, trimMat: marble, finialMat: gold })

  // 十七孔桥 + 湖心亭
  {
    const bridge = new THREE.Group()
    const x0 = -5600, x1 = -2300, bz = -1500
    const n = 17
    const span = (x1 - x0) / n
    const hump = (x) => 34 + 70 * Math.sin(((x - x0) / (x1 - x0)) * Math.PI)
    for (let i = 0; i < n; i++) {
      const cx = x0 + (i + 0.5) * span
      const top = hump(cx)
      const arch = span * 0.36 * (0.7 + 0.3 * Math.sin(((cx - x0) / (x1 - x0)) * Math.PI))
      const pier = new THREE.Mesh(new THREE.BoxGeometry(span * 0.3, top + 12, 60), marble)
      pier.position.set(x0 + i * span, WATER_Y + (top + 12) / 2 - 12, bz)
      bridge.add(pier)
      const spandrel = new THREE.Mesh(new THREE.BoxGeometry(span, top - arch * 0.9, 60), marble)
      spandrel.position.set(cx, WATER_Y + arch * 0.9 + (top - arch * 0.9) / 2, bz)
      bridge.add(spandrel)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(arch, 3, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.7 }))
      ring.position.set(cx, WATER_Y, bz + 30.5)
      bridge.add(ring)
      for (let k = 0; k < 3; k++) wallLights.push(new THREE.Vector3(cx + (k - 1) * span * 0.33, WATER_Y + top + 18, bz + 32))
    }
    const lastPier = new THREE.Mesh(new THREE.BoxGeometry(span * 0.3, hump(x1) + 12, 60), marble)
    lastPier.position.set(x1, WATER_Y + (hump(x1) + 12) / 2 - 12, bz)
    bridge.add(lastPier)
    city.add(bridge)
    const isle = new THREE.Mesh(rock(260, 5.1, 0.25, 3), new THREE.MeshStandardMaterial({ color: 0x1c1f1c, roughness: 0.95, flatShading: true }))
    isle.position.set(-1850, WATER_Y - 20, -1500)
    city.add(isle)
    const pav = new THREE.Group()
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      const c = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 8), redLacquer)
      c.position.set(Math.cos(a) * 55, 30, Math.sin(a) * 55)
      pav.add(c)
    }
    const pr = new THREE.Mesh(curvedRoofGeometry({ w: 110, d: 110, rise: 55, overhang: 0.25, curl: 0.6, sag: 1.8, thick: 4 }), greenTile)
    pr.position.y = 60
    pav.add(pr)
    const fin = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), gold)
    fin.position.y = 124
    pav.add(fin)
    pav.position.set(-1850, WATER_Y + 40, -1500)
    city.add(pav)
    endpoints.push({ pos: new THREE.Vector3(-1850, WATER_Y + 170, -1500), index: -1 })
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      eaveLights.push(new THREE.Vector3(-1850 + Math.cos(a) * 82, WATER_Y + 108, -1500 + Math.sin(a) * 82))
    }
  }
  bakeStatic(city)
  root.add(city)

  // 城墙灯 + 檐角灯（Points）
  const lampGeo = new THREE.BufferGeometry()
  const allLamps = [...wallLights.map((p) => [p, 18, [1.0, 0.45, 0.15]]), ...eaveLights.map((p) => [p, 22, [1.0, 0.6, 0.25]])]
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(allLamps.flatMap(([p]) => p.toArray()), 3))
  lampGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(allLamps.map(([, s]) => s), 1))
  lampGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(allLamps.flatMap(([, , c]) => c.map((v) => v * 1.6)), 3))
  lampGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(allLamps.map(() => 1), 1))
  const lampMat = glowPointMaterial({ size: 1, maxSize: 30 })
  root.add(new THREE.Points(lampGeo, lampMat))

  // ---------- 远景：喀斯特群峰 + 仙山浮岛 + 云带 ----------
  {
    const peaks = new THREE.Group()
    // 喀斯特峰林：粗壮的柱身 + 圆顶，而不是尖锥
    const coneGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.42, 1, 0.82, 12, 6).translate(0, -0.09, 0).toNonIndexed(),
      new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.32, 0).toNonIndexed(),
    ])
    const cp = coneGeo.attributes.position
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i) + 0.5
      const a = Math.atan2(cp.getZ(i), cp.getX(i))
      const s = 1 + 0.18 * Math.sin(y * 11 + a * 3) + 0.12 * Math.sin(a * 5 + y * 3)
      cp.setX(i, cp.getX(i) * s)
      cp.setZ(i, cp.getZ(i) * s)
    }
    coneGeo.computeVertexNormals()
    const list = []
    for (let i = 0; i < 160; i++) {
      const a = -Math.PI * 0.62 + R() * Math.PI * 1.24
      const d = 13000 + R() * 17000
      const x = Math.sin(a) * d * 1.3, z = -Math.cos(a) * d - 2000
      if (z > -9000 && Math.abs(x) < 12000) continue
      const h = 1600 + R() * 3000 * (d / 30000 + 0.4)
      list.push({ x, z, h, r: h * (0.26 + R() * 0.14) })
    }
    const im = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0x1b1f2c, roughness: 1, flatShading: true }), list.length)
    list.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, WATER_Y + p.h / 2 - 60, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), new THREE.Vector3(p.r, p.h, p.r))))
    peaks.add(im)
    // 几座峰顶小庙的灯
    list.slice(0, 18).forEach((p) => eaveLights.push(new THREE.Vector3(p.x, WATER_Y + p.h - 70, p.z)))
    root.add(peaks)
  }
  const islands = []
  const falls = []
  const fallMat = waterfallMaterial([0.85, 0.9, 1.0])
  {
    const islandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })
    const defs = [[-7800, 5200, -15800, 700], [7400, 6000, -17800, 900], [-1200, 7600, -23500, 1100], [13500, 4600, -12400, 520], [-14200, 4200, -11200, 480]]
    defs.forEach(([x, y, z, r], i) => {
      const g = new THREE.Group()
      const m = new THREE.Mesh(floatingIslandGeometry({ r, depth: 1.1, seed: i * 3.1 + 1, top: [0.2, 0.32, 0.2], rock: [0.3, 0.27, 0.3], bottom: [0.08, 0.08, 0.12] }), islandMat)
      g.add(m)
      const pv = hall({ w: r * 0.28, d: r * 0.2, h: r * 0.12, baseH: r * 0.03, tiers: 2, mats: { ...hallMats, roof: greenTile } })
      pv.position.set(r * 0.1, r * 0.05, -r * 0.1)
      g.add(pv)
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.12, r * 3.2), fallMat)
      fall.position.set(r * 0.5, -r * 1.6, r * 0.55)
      fall.lookAt(0, -r * 1.6, 3000)
      g.add(fall)
      falls.push(fall)
      g.position.set(x, y, z)
      root.add(g)
      islands.push({ g, y, phase: i * 1.7 })
      endpoints.push({ pos: new THREE.Vector3(x + r * 0.1, y + r * 0.45, z - r * 0.1), index: -1 })
      eaveLights.push(new THREE.Vector3(x + r * 0.1, y + r * 0.22, z - r * 0.1 + r * 0.12))
    })
  }
  // 云雾：群峰山腰的雾带（大号柔光精灵，比实体云团自然）
  const mistBlobs = []
  for (let c = 0; c < 40; c++) {
    const a = -Math.PI * 0.75 + R() * Math.PI * 1.5
    const d = 8000 + R() * 20000
    const cx = Math.sin(a) * d * 1.25, cz = -Math.cos(a) * d - 2000, cy = 500 + R() * 1600
    const len = 2500 + R() * 5000
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    for (let k = 0; k < 10; k++) {
      const f = k / 9 - 0.5
      mistBlobs.push({ pos: new THREE.Vector3(cx, cy + (R() - 0.5) * 200, cz).addScaledVector(dir, f * len), size: 1600 + R() * 2000, alpha: 0.12 + R() * 0.1 })
    }
  }
  const mist = mistBank(mistBlobs, { color: [0.55, 0.5, 0.62], maxPx: 360 })
  root.add(mist)

  // ---------- 孔明灯：从城里升起，越飞越高 ----------
  const SKYL = 700
  const skyGeo = new THREE.BufferGeometry()
  const skySeed = new Float32Array(SKYL * 4)
  for (let i = 0; i < SKYL; i++) skySeed.set([-9000 + R() * 18000, -12000 + R() * 9000, R(), 0.6 + R() * 0.8], i * 4)
  skyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SKYL * 3), 3))
  skyGeo.setAttribute('aSeed', new THREE.BufferAttribute(skySeed, 4))
  const skyMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 1 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio;
      varying float vA;
      void main() {
        float life = fract(aSeed.z + uTime * 0.006 * aSeed.w);
        vec3 p = vec3(aSeed.x + sin(uTime * 0.05 + aSeed.z * 40.0) * 200.0 + life * 900.0, 150.0 + life * 5200.0, aSeed.y + cos(uTime * 0.04 + aSeed.z * 20.0) * 200.0);
        vA = smoothstep(0.0, 0.05, life) * smoothstep(1.0, 0.6, life) * (0.75 + 0.25 * sin(uTime * 3.0 + aSeed.z * 50.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(34.0 * 600.0 / -mv.z, 1.5, 22.0) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmt;
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float body = smoothstep(0.32, 0.18, abs(d.x) + max(0.0, -d.y) * 0.4) * smoothstep(0.42, 0.3, abs(d.y));
        float glow = smoothstep(0.5, 0.0, length(d)) * 0.5;
        float a = (body + glow) * vA * uAmt;
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * a * 2.0, 1.0);
      }
    `,
  })
  const skyLanterns = new THREE.Points(skyGeo, skyMat)
  skyLanterns.frustumCulled = false
  root.add(skyLanterns)

  // ---------- 鲲 + 粒子 ----------
  const whales = createWhales({ back: [0.03, 0.09, 0.26], belly: [0.45, 0.5, 0.8], rim: [1.0, 0.72, 0.32], splashColor: [1.0, 0.8, 0.5], moonDir: MOON })
  root.add(whales.object)
  const particles = createParticles({
    seed: 202,
    endpoints,
    emitter: new THREE.Vector3(0, 48, -30),
    flash: { beginFlash: () => houseSet.beginFlash(), addFlash: (ep, v) => houseSet.addFlash(ep.index, v) },
    lanterns: { mode: 'water', kind: 'lotus', count: 320, colors: [[1.0, 0.45, 0.6, 0.55], [1.0, 0.7, 0.3, 0.45]], radius: [70, 1300], scale: 1.3 },
    ambient: { kind: 'sparkle', count: 260, color: [0.75, 1.0, 0.45], color2: [1.0, 0.8, 0.35], floorY: -2, height: 40, radius: [18, 140], base: 0.5, gain: 0.5 },
    dust: { a: [1.0, 0.75, 0.45], b: [1.0, 0.55, 0.3] },
    glyphs: { chars: ['福', '月', '鲲', '鹏', '游', '乐', '风', '云'], font: '900 88px "Noto Serif SC", "Songti SC", "STKaiti", "SimSun", serif', colors: [[1.0, 0.8, 0.35], [1.0, 0.4, 0.3], [0.6, 0.9, 1.0]] },
    packets: { colors: [[1.0, 0.8, 0.35], [0.5, 0.9, 1.0]], arc: 0.24 },
    fireworks: { palette: [[1.0, 0.75, 0.3], [1.0, 0.3, 0.2], [1.0, 0.55, 0.75], [1.0, 0.95, 0.8], [0.4, 0.85, 1.0]], zone: (h) => [-4200 + h(1) * 8400, 1700 + h(3) * 1300, -3600 + h(2) * 1600] },
  })
  root.add(particles.object)

  // ---------- 每帧 ----------
  const tmpC = new THREE.Color()
  const total = lanternSlots.length
  return {
    name: 'ancient',
    label: '古风城群',
    root,
    accent: [1.4, 0.85, 0.35],
    exposure: 1.0,
    sky: {
      zenith: [0.006, 0.006, 0.025], mid: [0.02, 0.018, 0.06], horizon: [0.1, 0.06, 0.09], below: [0.03, 0.025, 0.04],
      glowLow: [0.55, 0.22, 0.06], glowHigh: [0.25, 0.1, 0.12], glowAmt: 1.2,
      stars: 0.8, milky: 0.7,
      orbDir: MOON, orbSize: 0.9982, orbColor: [1.0, 0.72, 0.4], orbBright: 1.15, orbHalo: [0.75, 0.5, 0.28], orbHaloAmt: 0.8,
      cloudAmt: 0.55, cloudBase: [0.05, 0.045, 0.07], cloudLit: [0.55, 0.42, 0.3], cloudScale: 1.2,
    },
    ocean: {
      deep: [0.006, 0.008, 0.02], near: [0.04, 0.03, 0.015], bio: [1.0, 0.6, 0.2], sparkle: [1.0, 0.85, 0.5],
      spec: [1.0, 0.88, 0.65], ring: [1.0, 0.45, 0.2], lightDir: MOON, waves: 0.7,
    },
    fog: { color: [0.05, 0.038, 0.07], density: 0.000048 },
    hemi: { sky: 0x3a2c5a, ground: 0x0c0806, intensity: 1.0 },
    moon: { color: 0xffe0b0, intensity: 1.0, dir: MOON },
    env: {
      top: [0.02, 0.015, 0.04],
      horizon: [0.12, 0.07, 0.08],
      glow: [0.6, 0.25, 0.08],
      panels: [
        [[3, 1.6, 0.7], [0, 60, 70], [60, 20]],
        [[2.4, 0.5, 0.2], [-70, 30, -30], [30, 50]],
        [[2.6, 1.2, 0.4], [70, 25, -40], [30, 40]],
        [[1.6, 1.3, 1.0], [0, 90, -20], [80, 30]],
      ],
    },
    update(state) {
      const t = state.t
      const hush = state.hush
      const alive = 1 - state.fall * 0.85
      updateBuildingUniforms(houseMat, state)

      // 灯笼：前奏一盏盏点亮，副歌追逐闪烁，崩溃时乱闪
      lanternMeshes.forEach(({ mesh, list, color }) => {
        list.forEach((s, i) => {
          const gi = lanternSlots.indexOf(s)
          let v
          if (state.bulbMode === 'fill') v = state.bulbFill * 1.05 > (gi + 0.5) / total ? 1.0 : 0.08
          else if (state.bulbMode === 'chase') v = 0.6 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(gi * 0.9 - t * 6), 3) + state.pulse * 0.5
          else if (state.bulbMode === 'walk') v = 0.45 + 0.9 * (Math.floor(state.beat) % total === gi % total ? 1 : 0) + 0.3
          else if (state.bulbMode === 'blink') v = Math.sin(gi * 91.7 + Math.floor(t * 12) * 13.1) > 0.2 ? 1.1 : 0.05
          else v = 0.8 + 0.2 * Math.sin(t * 1.5 + gi) + state.pulse * 0.3
          v *= (1 - 0.6 * hush) * alive
          v += state.finaleFlash + state.recoverFlash * 0.6
          mesh.setColorAt(i, tmpC.setRGB(color[0] * v * 1.3, color[1] * v * 1.3, color[2] * v * 1.3))
          lhCol.set([color[0] * 0.5, color[1] * 0.5 + 0.05, color[2] * 0.5], gi * 3)
          lhA[gi] = Math.min(1, v * 0.45)
        })
        mesh.instanceColor.needsUpdate = true
      })
      lhGeo.attributes.aColor.needsUpdate = true
      lhGeo.attributes.aAlpha.needsUpdate = true

      wallLit.emissiveIntensity = (0.35 + 0.9 * state.city) * alive * (1 - 0.4 * hush)
      lampMat.uniforms.uFade.value = (0.25 + 0.75 * Math.min(1, state.city * 1.2 + state.neon * 0.3)) * alive

      // 光柱
      const phase = (Math.PI * state.beat) / 2
      beams.forEach((b, i) => {
        const sw = state.swing
        b.rotation.set(-0.5 - sw * 0.12 * Math.sin(phase * 0.5 + i), 0, (i - 1.5) * 0.12 + (i % 2 ? -1 : 1) * sw * 0.22 * Math.cos(phase + i * 0.4))
        b.material.uniforms.uInt.value = (0.35 + 0.8 * state.beams) * (1 - 0.8 * hush) * alive
      })
      rig.key.intensity = rig.base.key * state.stage
      rig.spots.forEach((s, i) => {
        s.intensity = rig.base.spots[i] * state.beams * (0.6 + 0.6 * state.pulse) * (1 - 0.9 * hush) * alive
        s.target.position.set(Math.sin(phase + i * 2) * 14 * state.swing, 0, 4)
      })
      rig.rim.intensity = rig.base.rim * (1 - 0.5 * hush)
      rig.points.forEach((p, i) => (p.intensity = rig.base.points[i] * (0.8 + 0.2 * Math.sin(t * 7 + i)) * (1 - 0.5 * hush)))

      skyMat.uniforms.uTime.value = t
      skyMat.uniforms.uAmt.value = (0.15 + 0.85 * state.city) * alive
      islands.forEach((it) => (it.g.position.y = it.y + Math.sin(t * 0.25 + it.phase) * 40))
      fallMat.uniforms.uTime.value = t
      mist.material.uniforms.uTime.value = t
      mist.material.uniforms.uAmt.value = 1 - 0.5 * state.hush
      whales.update(state)
      particles.update(state)
    },
    setPixelRatio(pr) {
      particles.setPixelRatio(pr)
      skyMat.uniforms.uPixelRatio.value = pr
      mist.material.uniforms.uPixelRatio.value = pr
    },
  }
}
