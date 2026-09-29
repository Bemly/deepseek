import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, hash1, canvasTexture, smooth } from './util.js'

// 程序化树：按树种参数递归长出弯曲、渐细的枝干（带根部隆起和根），
// 花/叶是贴在细枝上的小片"花簇/叶簇"透明贴图（alphaToCoverage），成团分布、之间留空隙，
// 树冠内部按遮挡压暗（AO），远处用手绘剪影精灵。
// 树种：sakura（染井吉野樱）、pine（日式黑松 / 盆景松）、willow（垂柳）、broadleaf（阔叶乔木）。

// ---------- 贴图 ----------
const texCache = {}
function once(key, make) {
  return texCache[key] ?? (texCache[key] = make())
}

// 2×2 图集：四个变体，同一棵树上不会一眼看出重复
function atlas(key, seed, draw) {
  return once(key, () =>
    canvasTexture(1024, 1024, (g, w) => {
      g.clearRect(0, 0, w, w)
      const cell = w / 2
      for (let v = 0; v < 4; v++) {
        g.save()
        g.translate((v % 2) * cell, Math.floor(v / 2) * cell)
        g.beginPath()
        g.rect(0, 0, cell, cell)
        g.clip()
        draw(g, cell, rng(seed + v * 31), v)
        g.restore()
      }
    }),
  )
}

// 一根弯弯的细枝，返回沿途的点
function twig(g, R, x, y, a, len, width, color, steps = 6) {
  const pts = [[x, y]]
  g.strokeStyle = color
  g.lineCap = 'round'
  for (let s = 0; s < steps; s++) {
    a += (R() - 0.5) * 0.5
    const nx = x + Math.cos(a) * (len / steps), ny = y + Math.sin(a) * (len / steps)
    g.lineWidth = Math.max(1, width * (1 - s / steps * 0.6))
    g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke()
    x = nx; y = ny
    pts.push([x, y])
  }
  return { pts, a }
}

function flower(g, x, y, r, rot, squash, petal, edge, heart) {
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  g.scale(1, squash)
  for (let i = 0; i < 5; i++) {
    g.save()
    g.rotate((i / 5) * Math.PI * 2)
    const grd = g.createLinearGradient(0, 0, 0, -r)
    grd.addColorStop(0, heart)
    grd.addColorStop(0.4, petal)
    grd.addColorStop(1, edge)
    g.fillStyle = grd
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(r * 0.62, -r * 0.18, r * 0.52, -r * 0.98, r * 0.13, -r)
    g.lineTo(0, -r * 0.84) // 樱花瓣尖端的小缺口
    g.lineTo(-r * 0.13, -r)
    g.bezierCurveTo(-r * 0.52, -r * 0.98, -r * 0.62, -r * 0.18, 0, 0)
    g.fill()
    g.strokeStyle = 'rgba(200,120,150,0.35)'
    g.lineWidth = 1
    g.stroke()
    g.restore()
  }
  // 花蕊
  g.lineWidth = 1
  g.strokeStyle = 'rgba(170,50,80,0.9)'
  g.fillStyle = '#f2cf6a'
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const l = r * (0.3 + 0.12 * ((i * 7) % 3) / 2)
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke()
    g.beginPath(); g.arc(Math.cos(a) * l, Math.sin(a) * l, 1.4, 0, Math.PI * 2); g.fill()
  }
  g.fillStyle = '#b3345a'
  g.beginPath(); g.arc(0, 0, r * 0.12, 0, Math.PI * 2); g.fill()
  g.restore()
}

// 樱花：几根细枝 + 3~6 团花簇（染井吉野：近白的淡粉，花心偏红），花簇之间留空
export function sakuraCardTexture() {
  return atlas('sakura2', 71, (g, w, R) => {
    const clusters = []
    const nTw = 2 + Math.floor(R() * 2)
    for (let k = 0; k < nTw; k++) {
      const a0 = R() * Math.PI * 2
      const sx = w / 2 - Math.cos(a0) * w * 0.34, sy = w / 2 - Math.sin(a0) * w * 0.34
      const t = twig(g, R, sx, sy, a0, w * (0.5 + R() * 0.2), 5 + R() * 3, '#3b2226')
      for (let i = 2; i < t.pts.length; i += 2) clusters.push(t.pts[i])
      // 分出的小枝
      const b = t.pts[3]
      const t2 = twig(g, R, b[0], b[1], t.a + (R() < 0.5 ? 1 : -1) * (0.6 + R() * 0.5), w * 0.2, 3, '#3b2226', 4)
      clusters.push(t2.pts[t2.pts.length - 1])
    }
    for (const [cx, cy] of clusters) {
      if (R() < 0.2) continue
      const n = 7 + Math.floor(R() * 12)
      const spread = 26 + R() * 34
      const deep = R() < 0.18
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * spread
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d
        if (x < 22 || y < 22 || x > w - 22 || y > w - 22) continue
        const r = 12 + R() * 8
        const k = R()
        const petal = deep ? '#f6b9cc' : k < 0.45 ? '#fff7f9' : k < 0.8 ? '#fde6ee' : '#f9d2df'
        const heart = deep ? '#e46f95' : '#f1a1bb'
        flower(g, x, y, r, R() * 6.28, 0.45 + R() * 0.55, petal, deep ? '#fbd6e2' : '#ffffff', heart)
      }
      // 花苞
      for (let i = 0; i < 3; i++) {
        const a = R() * Math.PI * 2, d = spread * (0.8 + R() * 0.4)
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d
        g.strokeStyle = '#4a2a2a'; g.lineWidth = 1.5
        g.beginPath(); g.moveTo(cx + Math.cos(a) * spread * 0.5, cy + Math.sin(a) * spread * 0.5); g.lineTo(x, y); g.stroke()
        g.fillStyle = '#e8819f'
        g.beginPath(); g.ellipse(x, y, 4, 6.5, a + Math.PI / 2, 0, Math.PI * 2); g.fill()
      }
    }
  })
}

// 黑松：细枝顶端一簇簇向外、向上张开的针叶（刷子状）
export function pineCardTexture() {
  return atlas('pine2', 72, (g, w, R) => {
    const tufts = []
    const base = twig(g, R, w * 0.5, w * 0.92, -Math.PI / 2 + (R() - 0.5) * 0.4, w * 0.5, 7, '#3a2a20', 5)
    for (let i = 1; i < base.pts.length; i++) {
      const [x, y] = base.pts[i]
      const side = i % 2 ? 1 : -1
      const t = twig(g, R, x, y, -Math.PI / 2 + side * (0.7 + R() * 0.5), w * (0.12 + R() * 0.12), 3.5, '#3a2a20', 3)
      tufts.push([...t.pts[t.pts.length - 1], t.a])
    }
    tufts.push([...base.pts[base.pts.length - 1], base.a])
    for (const [cx, cy, a0] of tufts) {
      const L = 55 + R() * 35
      // 针叶簇底下的暗色体积
      g.fillStyle = 'rgba(14,34,20,0.85)'
      g.beginPath(); g.ellipse(cx + Math.cos(a0) * L * 0.3, cy + Math.sin(a0) * L * 0.3, L * 0.45, L * 0.3, a0, 0, Math.PI * 2); g.fill()
      for (let k = 0; k < 90; k++) {
        const b = a0 + (R() - 0.5) * 2.6
        const l = L * (0.55 + R() * 0.45)
        const shade = R()
        g.strokeStyle = `rgb(${18 + shade * 30},${48 + shade * 55},${30 + shade * 30})`
        g.lineWidth = 2.4 + R() * 1.4
        const bx = cx - Math.cos(a0) * 8 * R(), by = cy - Math.sin(a0) * 8 * R()
        g.beginPath()
        g.moveTo(bx, by)
        g.quadraticCurveTo(bx + Math.cos(b) * l * 0.5, by + Math.sin(b) * l * 0.5 - 4, bx + Math.cos(b) * l, by + Math.sin(b) * l)
        g.stroke()
      }
      // 顶芽（"蜡烛"）
      g.fillStyle = '#b7a57a'
      g.beginPath(); g.ellipse(cx + Math.cos(a0) * 10, cy + Math.sin(a0) * 10, 3, 9, a0 + Math.PI / 2, 0, Math.PI * 2); g.fill()
    }
  })
}

function leafShape(g, l, wdt) {
  g.beginPath()
  g.moveTo(0, 0)
  g.bezierCurveTo(wdt, -l * 0.25, wdt * 0.8, -l * 0.8, 0, -l)
  g.bezierCurveTo(-wdt * 0.8, -l * 0.8, -wdt, -l * 0.25, 0, 0)
}

// 阔叶：带互生叶片的小枝
export function leafCardTexture() {
  return atlas('leaf2', 73, (g, w, R) => {
    const nTw = 3 + Math.floor(R() * 2)
    for (let k = 0; k < nTw; k++) {
      const a0 = R() * Math.PI * 2
      const t = twig(g, R, w / 2 - Math.cos(a0) * w * 0.25, w / 2 - Math.sin(a0) * w * 0.25, a0, w * 0.45, 3, '#3d3222', 6)
      for (let i = 1; i < t.pts.length; i++) {
        for (const s of [-1, 1]) {
          if (R() < 0.15) continue
          const [x, y] = t.pts[i]
          const l = 34 + R() * 26
          g.save()
          g.translate(x, y)
          g.rotate(t.a + Math.PI / 2 + s * (0.7 + R() * 0.5) + Math.PI)
          const hue = 88 + R() * 40, sat = 30 + R() * 25, lig = 20 + R() * 20
          const grd = g.createLinearGradient(-l * 0.3, 0, l * 0.3, 0)
          grd.addColorStop(0, `hsl(${hue},${sat}%,${lig * 0.75}%)`)
          grd.addColorStop(1, `hsl(${hue},${sat}%,${lig * 1.25}%)`)
          g.fillStyle = grd
          leafShape(g, l, l * 0.34)
          g.fill()
          g.strokeStyle = `hsla(${hue},${sat}%,${lig * 1.6}%,0.6)`
          g.lineWidth = 1
          g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -l * 0.95); g.stroke()
          g.restore()
        }
      }
    }
  })
}

// 柳条：一张图里四根（按 U 选一根），细茎 + 下垂的狭长柳叶
export function willowStrandTexture() {
  return once('willow2', () => {
    const R = rng(74)
    return canvasTexture(256, 1024, (g, w, h) => {
      g.clearRect(0, 0, w, h)
      for (let c = 0; c < 4; c++) {
        const x0 = c * 64 + 32
        g.strokeStyle = 'rgba(96,84,48,0.95)'
        g.lineWidth = 1.6
        g.beginPath(); g.moveTo(x0, 0)
        for (let y = 0; y <= h; y += 16) g.lineTo(x0 + Math.sin(y / 90 + c) * 5, y)
        g.stroke()
        for (let y = 10; y < h - 14; y += 9 + R() * 5) {
          const s = R() < 0.5 ? -1 : 1
          const x = x0 + Math.sin(y / 90 + c) * 5
          const l = 18 + R() * 12
          g.save()
          g.translate(x, y)
          g.rotate(Math.PI + s * (0.25 + R() * 0.35))
          const hue = 72 + R() * 28
          g.fillStyle = `hsl(${hue}, ${42 + R() * 20}%, ${30 + R() * 22}%)`
          leafShape(g, l, 3.2)
          g.fill()
          g.restore()
        }
      }
    })
  })
}

// 草丛/野花：四个变体（纯草、草+白花、草+粉紫花、低矮三叶草+黄花），画在卡片下半部往上长
export function meadowCardTexture() {
  return atlas('meadow', 77, (g, w, R, v) => {
    const blades = v === 3 ? 40 : 110
    for (let i = 0; i < blades; i++) {
      const x0 = w * (0.12 + R() * 0.76), h = w * (v === 3 ? 0.25 : 0.45 + R() * 0.45)
      const lean = (R() - 0.5) * w * 0.3
      const hue = 80 + R() * 40, lig = 22 + R() * 26
      const grd = g.createLinearGradient(0, w, 0, w - h)
      grd.addColorStop(0, `hsl(${hue},${35 + R() * 20}%,${lig * 0.5}%)`)
      grd.addColorStop(1, `hsl(${hue - 10},${40 + R() * 20}%,${lig * 1.3}%)`)
      g.fillStyle = grd
      const bw = 3 + R() * 5
      g.beginPath()
      g.moveTo(x0 - bw, w)
      g.quadraticCurveTo(x0 + lean * 0.3, w - h * 0.6, x0 + lean, w - h)
      g.quadraticCurveTo(x0 + lean * 0.3 + bw * 0.4, w - h * 0.6, x0 + bw, w)
      g.fill()
    }
    if (v === 3) {
      for (let i = 0; i < 40; i++) {
        const x = w * (0.1 + R() * 0.8), y = w * (0.72 + R() * 0.25)
        g.fillStyle = `hsl(${100 + R() * 20},40%,${25 + R() * 15}%)`
        for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x + Math.cos(k * 2.1) * 9, y + Math.sin(k * 2.1) * 7, 9, 0, Math.PI * 2); g.fill() }
      }
    }
    if (v > 0) {
      const n = v === 3 ? 14 : 22
      for (let i = 0; i < n; i++) {
        const x = w * (0.12 + R() * 0.76), top = w * (v === 3 ? 0.62 + R() * 0.2 : 0.2 + R() * 0.45)
        g.strokeStyle = '#3f6a2c'; g.lineWidth = 2.5
        g.beginPath(); g.moveTo(x, w); g.lineTo(x + (R() - 0.5) * 20, top); g.stroke()
        const col = v === 1 ? ['#ffffff', '#f4f0ff', '#fff6e0'] : v === 2 ? ['#f0a0d0', '#c890f0', '#ffb0c8'] : ['#ffd84a', '#ffe070', '#ffc830']
        g.fillStyle = col[Math.floor(R() * 3)]
        const r = v === 3 ? 7 : 10 + R() * 6
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2
          g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.6, top + Math.sin(a) * r * 0.45, r * 0.5, r * 0.3, a, 0, Math.PI * 2); g.fill()
        }
        g.fillStyle = '#e8b030'
        g.beginPath(); g.arc(x, top, r * 0.28, 0, Math.PI * 2); g.fill()
      }
    }
  })
}

function barkTexture(kind) {
  return once('bark-' + kind, () => {
    const R = rng(75 + kind.length)
    return canvasTexture(256, 512, (g, w, h) => {
      if (kind === 'pine') {
        // 黑松：龟甲状剥落的鳞片树皮
        g.fillStyle = '#2c2420'
        g.fillRect(0, 0, w, h)
        for (let i = 0; i < 180; i++) {
          const x = R() * w, y = R() * h, rw = 14 + R() * 26, rh = 20 + R() * 40
          const l = 30 + R() * 30
          g.fillStyle = `rgb(${l + 20},${l + 10},${l})`
          g.beginPath()
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2
            g.lineTo(x + Math.cos(a) * rw * (0.7 + R() * 0.3), y + Math.sin(a) * rh * (0.7 + R() * 0.3))
          }
          g.closePath()
          g.fill()
          g.strokeStyle = 'rgba(10,6,4,0.8)'
          g.lineWidth = 2
          g.stroke()
        }
      } else {
        g.fillStyle = kind === 'sakura' ? '#3e2c2e' : '#4a3d32'
        g.fillRect(0, 0, w, h)
        for (let i = 0; i < 240; i++) {
          const x = R() * w
          g.strokeStyle = R() < 0.6 ? `rgba(16,10,8,${0.25 + R() * 0.4})` : `rgba(150,130,115,${0.12 + R() * 0.18})`
          g.lineWidth = 1 + R() * 3
          g.beginPath(); g.moveTo(x, 0)
          for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y / 40 + i) * (kind === 'willow' ? 7 : 3), y)
          g.stroke()
        }
        if (kind === 'sakura') {
          // 樱树皮特有的横向皮孔
          for (let i = 0; i < 140; i++) {
            g.fillStyle = `rgba(${150 + R() * 40},${120 + R() * 30},${110 + R() * 30},0.45)`
            g.fillRect(R() * w, R() * h, 12 + R() * 26, 2 + R() * 2)
          }
        }
      }
    }, { repeat: true })
  })
}

// ---------- 枝干 ----------
function taperedTube(points, r0, r1, radial, flare = 0) {
  const curve = new THREE.CatmullRomCurve3(points)
  const tub = Math.max(3, points.length * 3)
  const frames = curve.computeFrenetFrames(tub, false)
  const len = curve.getLength()
  const pos = [], nrm = [], uv = [], idx = []
  for (let i = 0; i <= tub; i++) {
    const t = i / tub
    const p = curve.getPointAt(t)
    let r = r0 + (r1 - r0) * t
    if (flare) r *= 1 + flare * Math.exp(-t * 16) // 根部隆起
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a))
      const rr = flare ? r * (1 + flare * 0.25 * Math.exp(-t * 10) * Math.sin(a * 5)) : r // 板根的起伏
      pos.push(p.x + n.x * rr, p.y + n.y * rr, p.z + n.z * rr)
      nrm.push(n.x, n.y, n.z)
      uv.push(j / radial, (t * len) / (Math.PI * 4 * Math.max(r0, 0.02)))
    }
  }
  for (let i = 0; i < tub; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

// 树种参数：trunk 主干；levels 逐级分枝
//   n 子枝数、at 在父枝上的位置区间、angle 分叉角、len 长度（第一级相对树高，之后相对父枝）、
//   rad 半径比、elev 枝条逐渐趋向的仰角（负数 = 下垂）、bend 趋向速度、taperTop 越靠上的枝越短
const SPECIES = {
  sakura: {
    trunk: { len: 0.32, rad: 0.05, lean: 0.35, steps: 7, gnarl: 0.22, flare: 0.8 },
    levels: [
      { n: [4, 6], at: [0.7, 1.0], angle: 0.9, len: 0.56, rad: 0.62, elev: 0.6, bend: 0.14, gnarl: 0.2, steps: 7 },
      { n: [3, 4], at: [0.3, 1.0], angle: 0.7, len: 0.5, rad: 0.58, elev: 0.28, bend: 0.12, gnarl: 0.25, steps: 5 },
      { n: [3, 4], at: [0.25, 1.0], angle: 0.75, len: 0.5, rad: 0.6, elev: 0.1, bend: 0.14, gnarl: 0.3, steps: 4 },
      { n: [2, 3], at: [0.3, 1.0], angle: 0.8, len: 0.52, rad: 0.62, elev: -0.08, bend: 0.2, gnarl: 0.35, steps: 3 },
    ],
    outward: 0.7,
  },
  pine: {
    trunk: { len: 0.8, rad: 0.04, lean: 0.6, steps: 9, gnarl: 0.34, flare: 0.5 },
    levels: [
      { n: [6, 8], at: [0.3, 0.98], angle: 1.3, len: 0.36, rad: 0.5, elev: -0.1, bend: 0.25, gnarl: 0.25, steps: 6, taperTop: 0.7 },
      { n: [3, 4], at: [0.35, 1.0], angle: 0.75, len: 0.45, rad: 0.55, elev: 0.08, bend: 0.25, gnarl: 0.3, steps: 4 },
      { n: [2, 3], at: [0.5, 1.0], angle: 0.6, len: 0.45, rad: 0.6, elev: 0.18, bend: 0.3, gnarl: 0.3, steps: 3 },
    ],
    outward: 0.9,
  },
  willow: {
    trunk: { len: 0.36, rad: 0.05, lean: 0.3, steps: 7, gnarl: 0.3, flare: 0.6 },
    levels: [
      { n: [4, 6], at: [0.72, 1.0], angle: 0.6, len: 0.4, rad: 0.6, elev: 1.0, bend: 0.1, gnarl: 0.25, steps: 6 },
      { n: [3, 4], at: [0.3, 1.0], angle: 0.7, len: 0.5, rad: 0.55, elev: 0.5, bend: 0.12, gnarl: 0.3, steps: 4 },
      { n: [3, 3], at: [0.3, 1.0], angle: 0.8, len: 0.5, rad: 0.6, elev: 0.15, bend: 0.15, gnarl: 0.35, steps: 3 },
    ],
    outward: 0.5,
  },
  // 鹿角珊瑚：短粗、一路向上分叉
  coral: {
    trunk: { len: 0.22, rad: 0.07, lean: 0.35, steps: 4, gnarl: 0.3, flare: 0.25 },
    levels: [
      { n: [3, 5], at: [0.55, 1.0], angle: 0.75, len: 0.42, rad: 0.72, elev: 1.05, bend: 0.14, gnarl: 0.3, steps: 5 },
      { n: [2, 3], at: [0.35, 1.0], angle: 0.6, len: 0.62, rad: 0.74, elev: 1.2, bend: 0.2, gnarl: 0.35, steps: 4 },
      { n: [2, 3], at: [0.4, 1.0], angle: 0.55, len: 0.6, rad: 0.78, elev: 1.25, bend: 0.2, gnarl: 0.35, steps: 3 },
    ],
    outward: 0.3,
    noRoots: true,
  },
  // 海扇（柳珊瑚）：在一个平面里铺开的细密网枝
  fan: {
    trunk: { len: 0.12, rad: 0.03, lean: 0.1, steps: 3, gnarl: 0.1, flare: 0.2 },
    levels: [
      { n: [4, 5], at: [0.5, 1.0], angle: 0.7, len: 0.5, rad: 0.7, elev: 0.9, bend: 0.1, gnarl: 0.25, steps: 6 },
      { n: [3, 4], at: [0.2, 1.0], angle: 0.6, len: 0.5, rad: 0.7, elev: 1.0, bend: 0.1, gnarl: 0.3, steps: 5 },
      { n: [3, 3], at: [0.2, 1.0], angle: 0.6, len: 0.5, rad: 0.75, elev: 1.05, bend: 0.12, gnarl: 0.3, steps: 4 },
      { n: [2, 3], at: [0.3, 1.0], angle: 0.6, len: 0.5, rad: 0.8, elev: 1.1, bend: 0.12, gnarl: 0.3, steps: 3 },
    ],
    outward: 0,
    planar: true,
    noRoots: true,
  },
  broadleaf: {
    trunk: { len: 0.4, rad: 0.045, lean: 0.15, steps: 7, gnarl: 0.2, flare: 0.5 },
    levels: [
      { n: [4, 5], at: [0.55, 1.0], angle: 0.65, len: 0.42, rad: 0.62, elev: 0.95, bend: 0.1, gnarl: 0.2, steps: 6 },
      { n: [3, 4], at: [0.3, 1.0], angle: 0.7, len: 0.52, rad: 0.58, elev: 0.55, bend: 0.1, gnarl: 0.25, steps: 4 },
      { n: [3, 3], at: [0.25, 1.0], angle: 0.75, len: 0.52, rad: 0.6, elev: 0.3, bend: 0.12, gnarl: 0.3, steps: 3 },
      { n: [2, 3], at: [0.3, 1.0], angle: 0.8, len: 0.5, rad: 0.62, elev: 0.2, bend: 0.15, gnarl: 0.35, steps: 3 },
    ],
    outward: 0.4,
  },
}

const UP = new THREE.Vector3(0, 1, 0)
function perpendicular(d) {
  const a = Math.abs(d.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(d, a).normalize()
  const v = new THREE.Vector3().crossVectors(d, u).normalize()
  return [u, v]
}

function growSkeleton(R, type, height) {
  const S = SPECIES[type]
  const segs = []
  const radiusAt = (seg, t) => seg.r0 + (seg.r1 - seg.r0) * t
  const minR = height * 0.0016

  const grow = (start, dir, len, rad, level, cfg, flare = 0) => {
    const pts = [start.clone()]
    let p = start.clone()
    const d = dir.clone()
    for (let s = 0; s < cfg.steps; s++) {
      d.x += (R() - 0.5) * cfg.gnarl
      d.z += (R() - 0.5) * cfg.gnarl
      d.y += (R() - 0.5) * cfg.gnarl * 0.4
      if (S.planar) d.z *= 0.08
      d.normalize()
      if (cfg.elev !== undefined) {
        const h = new THREE.Vector2(d.x, d.z)
        if (h.lengthSq() < 1e-4) h.set(R() - 0.5, R() - 0.5)
        h.normalize()
        const target = new THREE.Vector3(h.x * Math.cos(cfg.elev), Math.sin(cfg.elev), h.y * Math.cos(cfg.elev))
        d.lerp(target, cfg.bend).normalize()
      }
      p = p.clone().addScaledVector(d, len / cfg.steps)
      pts.push(p)
    }
    const seg = { pts, r0: Math.max(minR, rad), r1: Math.max(minR, rad * 0.62), level, len, flare, dir: d.clone() }
    segs.push(seg)
    const L = S.levels[level]
    if (!L) return
    const n = L.n[0] + Math.floor(R() * (L.n[1] - L.n[0] + 1))
    const phase = R() * Math.PI * 2
    for (let k = 0; k < n; k++) {
      const t = level === 0 ? L.at[0] + ((k + R() * 0.6) / n) * (L.at[1] - L.at[0]) : L.at[0] + R() * (L.at[1] - L.at[0])
      const fi = t * (pts.length - 1)
      const i0 = Math.floor(fi), i1 = Math.min(pts.length - 1, i0 + 1)
      const origin = pts[i0].clone().lerp(pts[i1], fi - i0)
      const pd = pts[i1].clone().sub(pts[i0]).normalize()
      const [u, v] = perpendicular(pd)
      const phi = level === 0 ? phase + (k / n) * Math.PI * 2 + (R() - 0.5) * 0.6 : phase + k * 2.39996 + (R() - 0.5) * 0.8
      const axis = u.clone().multiplyScalar(Math.cos(phi)).addScaledVector(v, Math.sin(phi))
      const nd = pd.clone().applyAxisAngle(axis, L.angle * (0.8 + R() * 0.4))
      if (S.planar) { nd.z *= 0.08; if (Math.abs(nd.x) < 0.2) nd.x += (k % 2 ? 0.3 : -0.3); nd.normalize() }
      // 让枝条往树冠外侧长（不往主干方向回折）
      const radial = new THREE.Vector3(origin.x, 0, origin.z)
      if (radial.length() > height * 0.04) {
        radial.normalize()
        const hz = new THREE.Vector3(nd.x, 0, nd.z)
        const dot = hz.dot(radial)
        if (dot < 0) nd.addScaledVector(radial, -dot * (1 + S.outward))
        else nd.addScaledVector(radial, S.outward * 0.25 * hz.length())
        nd.normalize()
      }
      let clen = level === 0 ? height * L.len : len * L.len
      clen *= 0.8 + R() * 0.4
      if (L.taperTop) clen *= 1 - L.taperTop * t
      grow(origin, nd, clen, radiusAt(seg, t) * L.rad, level + 1, L)
    }
  }

  const T = S.trunk
  const lean = new THREE.Vector3((R() - 0.5) * T.lean, 1, (R() - 0.5) * T.lean).normalize()
  grow(new THREE.Vector3(0, -height * 0.02, 0), lean, height * T.len, height * T.rad, 0, T, T.flare)
  // 露出地面的根
  const roots = S.noRoots ? 0 : 3 + Math.floor(R() * 3)
  for (let k = 0; k < roots; k++) {
    const a = (k / roots) * Math.PI * 2 + R()
    const d = new THREE.Vector3(Math.cos(a), -0.35, Math.sin(a)).normalize()
    const pts = [new THREE.Vector3(Math.cos(a) * height * T.rad * 0.3, height * 0.02, Math.sin(a) * height * T.rad * 0.3)]
    let p = pts[0]
    for (let s = 0; s < 4; s++) {
      d.x += (R() - 0.5) * 0.3; d.z += (R() - 0.5) * 0.3; d.y -= 0.12; d.normalize()
      p = p.clone().addScaledVector(d, height * 0.035)
      pts.push(p)
    }
    segs.push({ pts, r0: height * T.rad * 0.55, r1: height * T.rad * 0.12, level: 0, len: height * 0.14, flare: 0 })
  }
  return segs
}

// 沿枝条按间距取点
function sampleAlong(segs, spacing, R) {
  const out = []
  for (const s of segs) {
    const curve = new THREE.CatmullRomCurve3(s.pts)
    const n = Math.max(1, Math.round(s.len / spacing))
    for (let i = 0; i < n; i++) {
      const t = (i + 0.3 + R() * 0.7) / n
      out.push({ pos: curve.getPointAt(Math.min(1, t)), tan: curve.getTangentAt(Math.min(1, t)), seg: s })
    }
  }
  return out
}

// 叶片/花片几何：先收集 {c 中心, s 尺寸, q 朝向}，再按树冠整体算法线和 AO
function cardGeometry(R, items, { height, tint, tintVar, aoMin = 0.35, sway = 0.006 }) {
  const n = items.length
  const center = new THREE.Vector3()
  for (const it of items) center.add(it.c)
  center.multiplyScalar(1 / Math.max(1, n))
  const ext = new THREE.Vector3(1e-3, 1e-3, 1e-3)
  let minY = Infinity, maxY = -Infinity
  for (const it of items) {
    ext.x = Math.max(ext.x, Math.abs(it.c.x - center.x))
    ext.y = Math.max(ext.y, Math.abs(it.c.y - center.y))
    ext.z = Math.max(ext.z, Math.abs(it.c.z - center.z))
    minY = Math.min(minY, it.c.y)
    maxY = Math.max(maxY, it.c.y)
  }
  const pos = new Float32Array(n * 18), nrm = new Float32Array(n * 18), uv = new Float32Array(n * 12), col = new Float32Array(n * 18), sw = new Float32Array(n * 6)
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
  const cuv = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
  const p = new THREE.Vector3()
  items.forEach((it, k) => {
    const rel = it.c.clone().sub(center)
    const e = new THREE.Vector3(rel.x / ext.x, rel.y / ext.y, rel.z / ext.z)
    const dist = e.length()
    const nn = e.clone().normalize()
    nn.y = nn.y * 0.7 + 0.35
    nn.normalize()
    const hFrac = (it.c.y - minY) / Math.max(1e-3, maxY - minY)
    let ao = aoMin + (1 - aoMin) * smooth((dist - 0.2) / 0.75)
    ao *= 0.72 + 0.28 * hFrac
    if (it.ao !== undefined) ao *= it.ao
    const v = (1 - tintVar + R() * tintVar * 2) * ao
    const variant = Math.floor(R() * 4)
    const ou = (variant % 2) * 0.5, ov = variant < 2 ? 0.5 : 0
    const s = sway * height * Math.max(0.15, it.c.y / height)
    for (let i = 0; i < 6; i++) {
      p.set(corners[i][0] * it.s, corners[i][1] * it.s, 0).applyQuaternion(it.q).add(it.c)
      pos.set([p.x, p.y, p.z], k * 18 + i * 3)
      nrm.set([nn.x, nn.y, nn.z], k * 18 + i * 3)
      uv.set([ou + cuv[i][0] * 0.5, ov + cuv[i][1] * 0.5], k * 12 + i * 2)
      col.set([tint[0] * v, tint[1] * v, tint[2] * v], k * 18 + i * 3)
      sw[k * 6 + i] = s
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1))
  return g
}

const _e = new THREE.Euler()
const randomQuat = (R) => new THREE.Quaternion().setFromEuler(_e.set(R() * Math.PI * 2, R() * Math.PI * 2, R() * Math.PI * 2))
// 大致朝外（让树冠外缘看起来饱满），带随机倾斜和自转
function outwardQuat(R, normal, tilt) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
  const t = new THREE.Quaternion().setFromEuler(_e.set((R() - 0.5) * tilt, (R() - 0.5) * tilt, R() * Math.PI * 2))
  return q.multiply(t)
}

// 柳条：从细枝垂下的弯曲窄带（十字交叉两片），越往下摆得越厉害
function willowStrands(R, anchors, height, trunkTop) {
  const pos = [], nrm = [], uv = [], col = [], sw = []
  const W = height * 0.022
  const N = 10
  for (const a of anchors) {
    // 长短参差：大多垂到树高的一半上下，外圈的更长；下端离地面留出空
    const out = new THREE.Vector3(a.pos.x - trunkTop.x, 0, a.pos.z - trunkTop.z)
    const reach = Math.min(1, out.length() / (height * 0.45))
    if (out.lengthSq() < 1e-4) out.set(1, 0, 0)
    out.normalize()
    const L = Math.min(height * (0.12 + R() * 0.28 + reach * 0.18), a.pos.y - height * (0.1 + R() * 0.12))
    if (L < height * 0.05) continue
    const side = new THREE.Vector3(-out.z, 0, out.x)
    const arc = height * (0.02 + R() * 0.06)
    const twist = (R() - 0.5) * 0.6
    const variant = Math.floor(R() * 4)
    const shade = 0.75 + R() * 0.4
    const pts = []
    for (let i = 0; i <= N; i++) {
      const t = i / N
      // 先向外拱一点再垂下，末端略向内收
      const o = arc * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) - arc * 0.3 * t * t
      pts.push(a.pos.clone().addScaledVector(out, o).addScaledVector(side, twist * o).setY(a.pos.y - L * (t * 0.85 + 0.15 * t * t) + arc * 0.3 * Math.sin(t * Math.PI) * (1 - t)))
    }
    for (const axis of [side, out]) {
      for (let i = 0; i < N; i++) {
        const q = [pts[i], pts[i + 1]]
        const quad = [
          [q[0], -1, i], [q[0], 1, i], [q[1], 1, i + 1],
          [q[0], -1, i], [q[1], 1, i + 1], [q[1], -1, i + 1],
        ]
        for (const [pp, sd, ii] of quad) {
          const t = ii / N
          const w = W * (1 - t * 0.55)
          pos.push(pp.x + axis.x * sd * w * 0.5, pp.y, pp.z + axis.z * sd * w * 0.5)
          nrm.push(out.x * 0.5, 0.75, out.z * 0.5)
          uv.push((variant + (sd + 1) / 2) * 0.25, 1 - t * (L / (height * 0.5)))
          const c = shade * (0.6 + 0.4 * (1 - t))
          col.push(0.8 * c, 0.95 * c, 0.58 * c)
          sw.push(height * 0.003 + L * t * 0.03)
        }
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sw, 1))
  return g
}

const foliageMats = {}
const windTime = { value: 0 }
function foliageMaterial(kind, { emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  const key = kind + emissive + ':' + emissiveIntensity
  if (foliageMats[key]) return foliageMats[key]
  const map = kind === 'sakura' ? sakuraCardTexture() : kind === 'pine' ? pineCardTexture() : kind === 'willow' ? willowStrandTexture() : kind === 'meadow' ? meadowCardTexture() : leafCardTexture()
  const m = new THREE.MeshStandardMaterial({
    map, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, vertexColors: true,
    roughness: kind === 'sakura' ? 0.7 : 0.8,
    emissive, emissiveMap: emissiveIntensity ? map : null, emissiveIntensity,
  })
  // 风吹：每个顶点的摆幅存在 aSway 里（柳条下端摆得多）
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWindTime = windTime
    // 细针叶/花瓣在远处的 mip 上 alpha 会被平均掉、被 alphaTest 剔光；按 mip 等级把 alpha 放大补回来
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      vec2 texel = vMapUv * 1024.0;
      vec2 tdx = dFdx(texel), tdy = dFdy(texel);
      float mipLevel = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
      diffuseColor.a *= 1.0 + mipLevel * 0.28;`,
    )
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nattribute float aSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wphase = dot(position, vec3(0.07, 0.03, 0.05));
        transformed.x += (sin(uWindTime * 1.3 + wphase) + 0.4 * sin(uWindTime * 3.1 + wphase * 2.7)) * aSway;
        transformed.z += cos(uWindTime * 1.1 + wphase * 1.3) * aSway * 0.8;`,
      )
  }
  m.customProgramCacheKey = () => 'foliage-wind'
  foliageMats[key] = m
  return m
}

export function setTreeWind(t) {
  windTime.value = t
}

// 一棵树：返回 Group（枝干 + 花叶），底部在原点，高度约为 height
export function createTree(type, { seed = 1, height = 40, tint, glow = 0, glowColor, barkColor, density = 1 } = {}) {
  const R = rng(seed * 7919 + 13)
  const segs = growSkeleton(R, type, height)
  const S = SPECIES[type]
  const last = S.levels.length
  const g = new THREE.Group()
  g.name = 'tree-' + type

  const barkKind = type === 'pine' ? 'pine' : type === 'sakura' ? 'sakura' : 'plain'
  const bark = new THREE.MeshStandardMaterial({
    map: barkTexture(barkKind), bumpMap: barkTexture(barkKind), bumpScale: 3,
    color: barkColor ?? (type === 'pine' ? 0x8a7a70 : type === 'sakura' ? 0x9a8488 : 0x9a8c7c), roughness: 0.95,
  })
  const tubes = segs.map((s) => taperedTube(s.pts, s.r0, s.r1, s.level === 0 ? 14 : s.level === 1 ? 9 : s.level === 2 ? 6 : 4, s.flare))
  const trunk = new THREE.Mesh(mergeGeometries(tubes), bark)
  trunk.castShadow = true
  trunk.receiveShadow = true
  g.add(trunk)

  const fine = segs.filter((s) => s.level >= last - 1)
  const tips = segs.filter((s) => s.level === last)
  const trunkTop = segs[0].pts[segs[0].pts.length - 1]
  const items = []
  let foliage

  if (type === 'sakura') {
    // 花簇：沿最后两级细枝排列，末梢再补一团
    // 满开：细枝上密、再往里的枝上稀疏地也开着
    const pts = sampleAlong(fine, height * 0.024 / density, R)
    pts.push(...sampleAlong(segs.filter((s) => s.level === last - 2), height * 0.07 / density, R))
    for (const t of tips) for (let k = 0; k < 3; k++) pts.push({ pos: t.pts[t.pts.length - 1], tan: t.dir })
    const crown = pts.reduce((a, p) => a.add(p.pos), new THREE.Vector3()).multiplyScalar(1 / pts.length)
    for (const p of pts) {
      const s = height * (0.065 + R() * 0.05)
      const c = p.pos.clone().add(new THREE.Vector3((R() - 0.5), (R() - 0.3), (R() - 0.5)).multiplyScalar(height * 0.045))
      const out = c.clone().sub(crown).setY((c.y - crown.y) * 1.5).normalize()
      items.push({ c, s, q: R() < 0.55 ? outwardQuat(R, out, 1.6) : randomQuat(R) })
    }
    const geo = cardGeometry(R, items, { height, tint: tint ?? [1, 1, 1], tintVar: 0.08, aoMin: 0.42 })
    foliage = new THREE.Mesh(geo, foliageMaterial('sakura', { emissive: glowColor ?? 0xffc6d8, emissiveIntensity: glow }))
  } else if (type === 'pine') {
    // 黑松：每根末梢一片接近水平的针叶垫，垫的上表面亮、下表面暗
    const ends = [...tips.map((t) => ({ pos: t.pts[t.pts.length - 1], dir: t.dir })), ...sampleAlong(fine.filter((s) => s.level === last - 1), height * 0.08, R).map((p) => ({ pos: p.pos, dir: p.tan }))]
    for (const e of ends) {
      const padR = height * (0.06 + R() * 0.04)
      const cnt = Math.round(18 * density)
      for (let k = 0; k < cnt; k++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * padR
        const dy = (R() - 0.35) * padR * 0.35
        const c = e.pos.clone().add(new THREE.Vector3(Math.cos(a) * d + e.dir.x * padR * 0.4, padR * 0.25 + dy, Math.sin(a) * d + e.dir.z * padR * 0.4))
        const q = R() < 0.8
          ? new THREE.Quaternion().setFromEuler(_e.set(-Math.PI / 2 + (R() - 0.5) * 0.9, 0, R() * Math.PI * 2, 'XZY'))
          : randomQuat(R)
        items.push({ c, s: height * (0.075 + R() * 0.04), q, ao: 0.6 + 0.4 * smooth((dy / (padR * 0.35) + 0.35) / 1) })
      }
    }
    const geo = cardGeometry(R, items, { height, tint: tint ?? [0.8, 0.9, 0.78], tintVar: 0.12, aoMin: 0.5 })
    foliage = new THREE.Mesh(geo, foliageMaterial('pine', { emissiveIntensity: 0 }))
  } else if (type === 'willow') {
    const anchors = sampleAlong(fine, height * 0.022 / density, R)
    for (const t of tips) anchors.push({ pos: t.pts[t.pts.length - 1] })
    foliage = new THREE.Mesh(willowStrands(R, anchors, height, trunkTop), foliageMaterial('willow'))
    // 枝头的叶簇，树冠顶上不秃
    for (const a of anchors) if (R() < 0.5) items.push({ c: a.pos.clone().add(new THREE.Vector3(R() - 0.5, R() - 0.2, R() - 0.5).multiplyScalar(height * 0.04)), s: height * (0.05 + R() * 0.03), q: randomQuat(R) })
    const tuft = new THREE.Mesh(cardGeometry(R, items, { height, tint: tint ?? [0.85, 1, 0.62], tintVar: 0.12 }), foliageMaterial('leaf'))
    tuft.castShadow = true
    g.add(tuft)
  } else {
    const pts = sampleAlong(fine, height * 0.05 / density, R)
    for (const t of tips) for (let k = 0; k < 2; k++) pts.push({ pos: t.pts[t.pts.length - 1] })
    const crown = pts.reduce((a, p) => a.add(p.pos), new THREE.Vector3()).multiplyScalar(1 / pts.length)
    for (const p of pts) {
      const c = p.pos.clone().add(new THREE.Vector3(R() - 0.5, R() - 0.4, R() - 0.5).multiplyScalar(height * 0.05))
      const out = c.clone().sub(crown).normalize()
      items.push({ c, s: height * (0.09 + R() * 0.05), q: R() < 0.6 ? outwardQuat(R, out, 1.4) : randomQuat(R) })
    }
    foliage = new THREE.Mesh(cardGeometry(R, items, { height, tint: tint ?? [0.9, 1, 0.85], tintVar: 0.15 }), foliageMaterial('leaf', { emissive: glowColor ?? 0, emissiveIntensity: glow }))
  }
  foliage.castShadow = true
  foliage.receiveShadow = true
  g.add(foliage)
  g.userData.dynamic = true // 不参与 bakeStatic（风动）
  return g
}

// 珊瑚：只有"枝干"，按高度从根部的深色渐变到枝头的亮色，枝头有发光的水螅体小球
export function createCoral(type = 'coral', { seed = 1, height = 12, base = [0.35, 0.12, 0.2], tip = [1.0, 0.45, 0.55], glow = 0.4 } = {}) {
  const R = rng(seed * 4099 + 7)
  const segs = growSkeleton(R, type, height)
  const minR = type === 'fan' ? height * 0.006 : height * 0.02
  const parts = segs.map((s) => taperedTube(s.pts, Math.max(minR, s.r0), Math.max(minR * 0.9, s.r1), s.level === 0 ? 10 : 6, s.flare))
  const last = SPECIES[type].levels.length
  if (type === 'coral') {
    for (const s of segs) if (s.level === last) {
      const e = s.pts[s.pts.length - 1]
      parts.push(new THREE.SphereGeometry(Math.max(minR, s.r1) * 1.25, 8, 6).translate(e.x, e.y, e.z))
    }
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => { p.deleteAttribute('uv'); return p }))
  const p = g.attributes.position
  const col = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, p.getY(i) / height))
    const k = Math.pow(t, 1.3)
    for (let c = 0; c < 3; c++) col[i * 3 + c] = base[c] + (tip[c] - base[c]) * k
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const m = new THREE.Mesh(g, coralMaterial(glow))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

const coralMats = {}
function coralMaterial(glow) {
  if (coralMats[glow]) return coralMats[glow]
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })
  // 枝头自发光（用顶点色本身当发光色）
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * smoothstep(0.35, 1.0, max(vColor.r, max(vColor.g, vColor.b))) * ${glow.toFixed(3)};`)
  }
  m.customProgramCacheKey = () => 'coral' + glow
  return (coralMats[glow] = m)
}

// 草地：一簇簇十字交叉的草/野花卡片。points = [{ pos: Vector3, up?: Vector3 }]
// flowers = 各变体出现的权重 [纯草, 白花, 粉紫花, 黄花]
export function meadow(points, { size = 2.4, seed = 5, tint = [1, 1, 1], flowers = [0.55, 0.15, 0.15, 0.15] } = {}) {
  const R = rng(seed)
  const n = points.length
  const pos = new Float32Array(n * 36), nrm = new Float32Array(n * 36), uv = new Float32Array(n * 24), col = new Float32Array(n * 36), sw = new Float32Array(n * 12)
  const acc = []
  let sum = 0
  for (const f of flowers) acc.push((sum += f))
  const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 0], [0.5, 1], [-0.5, 1]]
  points.forEach((pt, k) => {
    const s = size * (0.6 + R() * 0.8)
    const r0 = R() * Math.PI
    const pick = R() * sum
    const variant = acc.findIndex((a) => pick <= a)
    const ou = (variant % 2) * 0.5, ov = variant < 2 ? 0.5 : 0
    const v = 0.8 + R() * 0.35
    for (let c = 0; c < 2; c++) {
      const a = r0 + c * Math.PI / 2
      const dx = Math.cos(a), dz = Math.sin(a)
      for (let i = 0; i < 6; i++) {
        const [cx, cy] = corners[i]
        const o = (k * 12 + c * 6 + i)
        pos.set([pt.pos.x + dx * cx * s, pt.pos.y + cy * s * 0.8 - s * 0.05, pt.pos.z + dz * cx * s], o * 3)
        nrm.set([0, 1, 0], o * 3)
        uv.set([ou + (cx + 0.5) * 0.5, ov + cy * 0.5], o * 2)
        const shade = v * (0.55 + 0.45 * cy)
        col.set([tint[0] * shade, tint[1] * shade, tint[2] * shade], o * 3)
        sw[o] = cy * s * 0.06
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1))
  const m = new THREE.Mesh(g, foliageMaterial('meadow'))
  m.receiveShadow = true
  m.userData.dynamic = true
  return m
}

// 从一块几何体（岩石、岛）朝上的表面上撒点，给 meadow 用
export function scatterOnTop(geo, { count, minUp = 0.75, minY = -Infinity, maxR = Infinity, seed = 3 }) {
  const R = rng(seed)
  const p = geo.attributes.position, n = geo.attributes.normal
  const index = geo.index
  const tri = index ? index.count / 3 : p.count / 3
  const out = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3()
  let tries = 0
  while (out.length < count && tries++ < count * 30) {
    const t = Math.floor(R() * tri)
    const ia = index ? index.getX(t * 3) : t * 3, ib = index ? index.getX(t * 3 + 1) : t * 3 + 1, ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
    nn.fromBufferAttribute(n, ia)
    if (nn.y < minUp) continue
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic)
    let u = R(), v = R()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    const q = a.clone().addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v)
    if (q.y < minY || Math.hypot(q.x, q.z) > maxR) continue
    out.push({ pos: q })
  }
  return out
}

// ---------- 远处的树林：手绘树剪影精灵（2×2 图集：樱、松、阔叶、柏）----------
function forestAtlas() {
  return once('forest2', () =>
    canvasTexture(1024, 1024, (g) => {
      g.clearRect(0, 0, 1024, 1024)
      const R = rng(76)
      const cell = 512
      // 有枝干、成团的树冠：先画主枝，再在枝端撒小圆点团（亮面在左上）
      const crownTree = (ox, oy, pal, trunk, { spreadX, spreadY, top, clumps, dots }) => {
        const bx = ox + cell / 2, by = oy + cell - 8
        g.strokeStyle = trunk
        g.lineCap = 'round'
        const ends = []
        const trunkTopY = by - (by - (oy + top)) * 0.45
        g.lineWidth = 16
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (R() - 0.5) * 20, trunkTopY); g.stroke()
        for (let k = 0; k < 6; k++) {
          const ex = bx + (k / 5 - 0.5) * spreadX * 1.6 + (R() - 0.5) * 40
          const ey = oy + top + R() * spreadY * 0.8
          g.lineWidth = 7
          g.beginPath(); g.moveTo(bx, trunkTopY); g.quadraticCurveTo((bx + ex) / 2, trunkTopY - 20, ex, ey); g.stroke()
          ends.push([ex, ey])
        }
        for (let c = 0; c < clumps; c++) {
          const e = ends[Math.floor(R() * ends.length)]
          const cx = e[0] + (R() - 0.5) * spreadX * 0.5, cy = e[1] + (R() - 0.5) * spreadY * 0.5
          const cr = 26 + R() * 34
          for (let i = 0; i < dots; i++) {
            const a = R() * Math.PI * 2, d = Math.sqrt(R()) * cr
            const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8
            if (x < ox + 6 || x > ox + cell - 6 || y < oy + 6) continue
            const light = 0.5 + ((-Math.cos(a) - Math.sin(a)) * d / cr) * 0.35 + (oy + cell * 0.5 - cy) / cell * 0.4
            g.fillStyle = pal[Math.max(0, Math.min(pal.length - 1, Math.floor(light * pal.length)))]
            g.beginPath(); g.arc(x, y, 5 + R() * 7, 0, Math.PI * 2); g.fill()
          }
        }
      }
      crownTree(0, 0, ['#a66883', '#cf8ca8', '#eab4c7', '#f8d6e2', '#fff1f6'], '#2e1d1e', { spreadX: 190, spreadY: 170, top: 70, clumps: 30, dots: 70 })
      // 松：弯曲主干 + 层层水平针叶垫
      {
        const ox = 512
        g.strokeStyle = '#241a14'
        g.lineWidth = 16
        g.lineCap = 'round'
        g.beginPath(); g.moveTo(ox + 256, 504); g.bezierCurveTo(ox + 300, 380, ox + 210, 260, ox + 262, 90); g.stroke()
        for (let l = 0; l < 6; l++) {
          const y = 100 + l * 62, w = 60 + l * 28 + R() * 30
          const cx = ox + 250 + (R() - 0.5) * 40
          g.lineWidth = 5
          g.beginPath(); g.moveTo(ox + 256, y + 20); g.lineTo(cx + (l % 2 ? 1 : -1) * w * 0.7, y + 6); g.stroke()
          for (let k = 0; k < 120; k++) {
            const x = cx + (R() - 0.5) * w * 1.9, yy = y + (R() - 0.6) * 26
            g.fillStyle = yy < y - 4 ? ['#3a6446', '#4a7652'][Math.floor(R() * 2)] : ['#16281c', '#1f3826', '#2a4a32'][Math.floor(R() * 3)]
            g.beginPath(); g.ellipse(x, yy, 7 + R() * 9, 3 + R() * 4, (R() - 0.5) * 0.4, 0, Math.PI * 2); g.fill()
          }
        }
      }
      crownTree(0, 512, ['#1f3a22', '#2d4f2c', '#3f6838', '#577f46', '#72994f'], '#30241a', { spreadX: 170, spreadY: 180, top: 60, clumps: 32, dots: 70 })
      // 柏：高耸的尖塔形，由一团团深绿组成
      {
        const ox = 512, oy = 512
        g.fillStyle = '#261a12'
        g.fillRect(ox + 248, oy + 420, 16, 92)
        for (let i = 0; i < 1400; i++) {
          const h = R()
          const y = oy + 30 + h * 400
          const half = 16 + h * 90
          const x = ox + 256 + (R() - 0.5) * 2 * half
          const light = (ox + 256 - x) / half * 0.5 + 0.5
          g.fillStyle = ['#132318', '#1b3020', '#244028', '#2f5032'][Math.min(3, Math.floor(light * 4))]
          g.beginPath(); g.arc(x, y, 4 + R() * 6, 0, Math.PI * 2); g.fill()
        }
      }
    }),
  )
}

const KIND = { sakura: 0, pine: 1, broadleaf: 2, cypress: 3 }
// list = [{ pos: Vector3（树底）, size, kind }]
export function forestSprites(list, { tint = [1, 1, 1], glow = 0, glowColor = [1, 0.6, 0.8] } = {}) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((t) => [t.pos.x, t.pos.y + t.size * 0.5, t.pos.z]), 3))
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(list.map((t) => t.size), 1))
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(list.map((t) => KIND[t.kind] ?? 2), 1))
  g.setAttribute('aVar', new THREE.Float32BufferAttribute(list.map((t) => hash1(t.pos.x * 0.37 + t.pos.z * 1.71)), 1))
  const m = new THREE.ShaderMaterial({
    transparent: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uAtlas: { value: null },
        uTint: { value: new THREE.Color(...tint) },
        uGlow: { value: glow },
        uGlowCol: { value: new THREE.Color(...glowColor) },
        uPixelRatio: { value: 1 },
      },
    ]),
    fog: true,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aKind;
      attribute float aVar;
      uniform float uPixelRatio;
      varying float vKind;
      varying float vVar;
      #include <fog_pars_vertex>
      void main() {
        vKind = aKind;
        vVar = aVar;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = min(512.0, aSize * 600.0 / max(1.0, -mvPosition.z)) * uPixelRatio;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform vec3 uTint, uGlowCol;
      uniform float uGlow;
      varying float vKind;
      varying float vVar;
      #include <fog_pars_fragment>
      void main() {
        vec2 pc = gl_PointCoord;
        if (vVar > 0.5) pc.x = 1.0 - pc.x; // 一半镜像，减少重复感
        vec2 cell = vec2(mod(vKind, 2.0), floor(vKind / 2.0));
        vec2 uv = (vec2(pc.x, 1.0 - pc.y) + vec2(cell.x, 1.0 - cell.y)) * 0.5;
        vec4 c = texture2D(uAtlas, uv);
        if (c.a < 0.5) discard;
        vec3 col = c.rgb * uTint * (0.8 + vVar * 0.4);
        if (vKind < 0.5) col += uGlowCol * uGlow * c.rgb;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
  m.uniforms.uAtlas.value = forestAtlas() // merge 会克隆贴图（克隆体没有上传版本号），所以在 merge 之后再赋值
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  return pts
}
