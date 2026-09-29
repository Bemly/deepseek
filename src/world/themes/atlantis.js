import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, fbm2, canvasTexture, glowPointMaterial, bakeStatic, GLSL_NOISE } from '../util.js'
import { createWhales } from '../whales.js'
import { createParticles } from '../particles.js'
import { mountainRing, shoreRock, shoreRockMaterial } from '../landscape.js'
import { createLightRig, beamMaterial, beamGeometry, createBuildingMaterial, updateBuildingUniforms, instancedBuildings } from '../kit.js'
import { createCoral } from '../trees.js'

// 主题：亚特兰蒂斯城群 —— 沉在海底、灯火仍亮着的同心环之城
// 布局取自柏拉图《克里提亚篇》：中心岛 + 水环 / 陆环相间，最外一圈城墙包黄铜、第二圈包锡、
// 卫城墙闪着山铜（orichalcum）的红光；中心岛上是外覆白银、尖顶镀金的波塞冬神庙。
// 近景：马赛克圆台、山铜镶边与符文石、两翼残柱廊、身后的三叉戟门、蓝焰三足鼎、珊瑚、海葵、巨砗磲、海带
// 中景：往城里走的大台阶、环城（约 5000 座楼、圆顶、两千根列柱、三道金属城墙、运河灯带、桥）
// 远景：神庙上空悬浮的山铜核心、倒插在沙里的巨型三叉戟、海底山脊、成群的鱼和水母、头顶游过的鲸
// 整个主题是水下：天空穹顶切到"仰望海面"模式（斯涅尔窗 + 焦散），不用海面；地面和石材上投着焦散。

const SUN = [0.22, 1, -0.3] // 海面之上的太阳（从水下看在头顶偏前）
const CITY_Z = -5600
const CITY_Y = -70
const CITY_R = 4400
// [内半径, 外半径, 是水环吗]
const RINGS = [
  [0, 500, false],
  [500, 820, true],
  [820, 1500, false],
  [1500, 1950, true],
  [1950, 2900, false],
  [2900, 3380, true],
  [3380, CITY_R, false],
]
const CANAL_Y = CITY_Y - 44

// ---------- 焦散：往 MeshStandardMaterial 里注入（朝上的面最亮，随距离淡出）----------
const causticU = { uCTime: { value: 0 }, uCAmt: { value: 1 }, uCCol: { value: new THREE.Color(0.55, 0.95, 1.0) } }
function withCaustics(mat, scale = 1) {
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r)
    Object.assign(sh.uniforms, causticU)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCW;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
        #endif
        vCW = (modelMatrix * cw).xyz;`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCW;\nuniform float uCTime, uCAmt;\nuniform vec3 uCCol;\n${GLSL_NOISE}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec2 cp = vCW.xz * ${(0.05 * scale).toFixed(4)} + vCW.y * 0.01;
          float r1 = fbm(cp + vec2(uCTime * 0.35, uCTime * 0.21));
          float r2 = fbm(cp * 1.7 - vec2(uCTime * 0.26, uCTime * 0.38) + 3.1);
          float c = pow(max(0.0, 1.0 - abs(r1 - r2) * 2.0), 9.0);
          float fade = exp(-length(vCW - cameraPosition) / 2600.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * uCCol * c * uCAmt * 1.2 * smoothstep(-0.1, 0.8, wN.y) * fade;
        }`,
      )
  }
  mat.customProgramCacheKey = () => 'caustic' + scale + (mat.type ?? '')
  return mat
}

// ---------- 贴图 ----------
// 圆台的马赛克：外圈回纹（山铜色）、中圈浪花纹、里圈十六道光芒、中心三叉戟
function mosaicTexture() {
  return canvasTexture(2048, 2048, (g, w) => {
    const c = w / 2
    const R = rng(31)
    g.fillStyle = '#d9dde0'
    g.fillRect(0, 0, w, w)
    // 小石子马赛克的底纹
    for (let i = 0; i < 90000; i++) {
      const x = R() * w, y = R() * w
      const v = 205 + R() * 40
      g.fillStyle = `rgba(${v - 8},${v},${v + 6},0.55)`
      g.fillRect(x, y, 7, 7)
    }
    const ring = (r0, r1, color) => {
      g.beginPath(); g.arc(c, c, r1, 0, Math.PI * 2); g.arc(c, c, r0, 0, Math.PI * 2, true); g.fillStyle = color; g.fill()
    }
    ring(c * 0.92, c * 0.985, '#1c3f6e')
    // 回纹带
    g.strokeStyle = '#c8763a'
    g.lineWidth = 10
    const N = 72
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2
      const r0 = c * 0.93, r1 = c * 0.975
      const pts = [[r0, a0], [r1, a0], [r1, a0 + (a1 - a0) * 0.75], [r0 + (r1 - r0) * 0.3, a0 + (a1 - a0) * 0.75], [r0 + (r1 - r0) * 0.3, a0 + (a1 - a0) * 0.35], [r0 + (r1 - r0) * 0.65, a0 + (a1 - a0) * 0.35]]
      g.beginPath()
      pts.forEach(([r, a], i) => (i ? g.lineTo : g.moveTo).call(g, c + Math.cos(a) * r, c + Math.sin(a) * r))
      g.stroke()
    }
    ring(c * 0.62, c * 0.9, '#e4e6e2')
    // 浪花纹（维特鲁威卷涡）
    g.strokeStyle = '#2a6f9a'
    g.lineWidth = 14
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2
      const r = c * 0.76
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r
      g.beginPath()
      for (let s = 0; s < 40; s++) {
        const t = s / 40
        const rr = 46 * (1 - t)
        const aa = a + Math.PI / 2 + t * Math.PI * 3
        g.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr)
      }
      g.stroke()
    }
    ring(c * 0.6, c * 0.62, '#c8763a')
    // 十六道光芒
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      g.fillStyle = k % 2 ? '#1c3f6e' : '#3b7fb0'
      g.beginPath()
      g.moveTo(c + Math.cos(a) * c * 0.56, c + Math.sin(a) * c * 0.56)
      g.lineTo(c + Math.cos(a + 0.12) * c * 0.2, c + Math.sin(a + 0.12) * c * 0.2)
      g.lineTo(c + Math.cos(a - 0.12) * c * 0.2, c + Math.sin(a - 0.12) * c * 0.2)
      g.fill()
    }
    ring(c * 0.16, c * 0.2, '#c8763a')
    // 三叉戟
    g.save()
    g.translate(c, c)
    g.rotate(-Math.PI / 2) // 圆柱顶面的 UV：画布横轴对应世界 Z，这样三叉戟指向舞台后方（-Z）
    g.scale(1.25, 1.25)
    g.fillStyle = '#c8763a'
    g.fillRect(-9, -150, 18, 300)
    g.beginPath()
    g.moveTo(-70, -60); g.quadraticCurveTo(-70, -10, 0, -20); g.quadraticCurveTo(70, -10, 70, -60)
    g.lineWidth = 16; g.strokeStyle = '#c8763a'; g.stroke()
    for (const x of [-70, 0, 70]) {
      g.beginPath(); g.moveTo(x - 14, x ? -60 : -150); g.lineTo(x, x ? -120 : -210); g.lineTo(x + 14, x ? -60 : -150); g.fill()
    }
    g.restore()
  }, { mipmaps: true })
}

// 大理石（带淡淡的纹理）
function marbleTexture() {
  const R = rng(5)
  return canvasTexture(1024, 1024, (g, w) => {
    g.fillStyle = '#e9ecec'
    g.fillRect(0, 0, w, w)
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(${120 + R() * 40},${130 + R() * 40},${140 + R() * 40},${0.08 + R() * 0.16})`
      g.lineWidth = 1 + R() * 4
      g.beginPath()
      let x = R() * w, y = R() * w
      g.moveTo(x, y)
      for (let k = 0; k < 20; k++) {
        x += (R() - 0.3) * 80
        y += (R() - 0.5) * 60
        g.lineTo(x, y)
      }
      g.stroke()
    }
  }, { repeat: true })
}

// 圆顶的经纬线发光
function domeTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#fff'
    g.lineWidth = 3
    for (let k = 0; k < 16; k++) { g.beginPath(); g.moveTo((k / 16) * w, 0); g.lineTo((k / 16) * w, h); g.stroke() }
    for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(0, (k / 5) * h); g.lineTo(w, (k / 5) * h); g.stroke() }
  }, { repeat: true })
}

// 巨藻（Macrocystis）：细茎 + 两侧长长的金褐色叶片，每片叶子根部一个小气囊（四个变体排在一张图里，按 U 选）
function kelpTexture() {
  const R = rng(9)
  return canvasTexture(512, 2048, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    const cw = w / 4
    for (let c = 0; c < 4; c++) {
      const x0 = c * cw + cw / 2
      const sx = (y) => x0 + Math.sin(y / 140 + c) * 6
      g.strokeStyle = '#5c4516'
      g.lineWidth = 4
      g.beginPath(); g.moveTo(sx(h), h)
      for (let y = h; y >= 0; y -= 16) g.lineTo(sx(y), y)
      g.stroke()
      for (let y = h - 40; y > 20; y -= 26 + R() * 18) {
        const s = R() < 0.5 ? -1 : 1
        const x = sx(y)
        const L = 44 + R() * 40, Wd = 9 + R() * 6
        const ang = -Math.PI / 2 + s * (0.5 + R() * 0.35) // 斜向上长
        g.save()
        g.translate(x, y)
        g.rotate(ang)
        const grd = g.createLinearGradient(0, 0, L, 0)
        const hue = 36 + R() * 16
        grd.addColorStop(0, `hsl(${hue},65%,26%)`)
        grd.addColorStop(0.5, `hsl(${hue + 4},70%,${36 + R() * 10}%)`)
        grd.addColorStop(1, `hsl(${hue + 8},72%,${44 + R() * 10}%)`)
        g.fillStyle = grd
        g.beginPath()
        g.moveTo(6, 0)
        g.bezierCurveTo(L * 0.3, -Wd, L * 0.75, -Wd * 0.8, L, 0)
        g.bezierCurveTo(L * 0.75, Wd * 0.8, L * 0.3, Wd, 6, 0)
        g.fill()
        // 叶面的皱褶
        g.strokeStyle = 'rgba(60,40,10,0.35)'
        g.lineWidth = 1
        for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(L * k / 6, -Wd * 0.6); g.lineTo(L * k / 6 + 4, Wd * 0.6); g.stroke() }
        // 气囊
        g.fillStyle = '#8a6a24'
        g.beginPath(); g.ellipse(4, 0, 5, 3.5, 0, 0, Math.PI * 2); g.fill()
        g.restore()
      }
    }
  })
}

// ---------- 几何 ----------
// 带凹槽的柱身 + 柱础 + 柱头（高 1，半径约 0.06），近看有 20 道凹槽
function columnGeometry({ broken = 0 } = {}) {
  const H = 1 - broken
  const shaft = new THREE.CylinderGeometry(0.052, 0.06, H * 0.84, 40, 16, true)
  const p = shaft.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const a = Math.atan2(z, x)
    const k = 1 - 0.07 * Math.pow(Math.abs(Math.cos(a * 10)), 0.6)
    p.setX(i, x * k)
    p.setZ(i, z * k)
    if (broken && p.getY(i) > H * 0.84 / 2 - 0.001) p.setY(i, p.getY(i) + (fbm2(x * 40, z * 40, 2) - 0.5) * 0.06)
  }
  shaft.computeVertexNormals()
  shaft.translate(0, 0.06 + H * 0.42, 0)
  const parts = [
    new THREE.BoxGeometry(0.17, 0.03, 0.17).translate(0, 0.015, 0),
    new THREE.CylinderGeometry(0.075, 0.08, 0.03, 40).translate(0, 0.045, 0),
    shaft,
  ]
  if (!broken) {
    parts.push(new THREE.CylinderGeometry(0.085, 0.056, 0.06, 40).translate(0, 0.93, 0))
    parts.push(new THREE.BoxGeometry(0.19, 0.035, 0.19).translate(0, 0.98, 0))
  }
  return mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n }))
}

// 海底：以原点为中心的极坐标网格，舞台附近是平台，往城的方向落到盆地，远处升起成海盆的山壁
function seabedHeight(x, z) {
  const r0 = Math.hypot(x, z)
  const plateau = 1 - THREE.MathUtils.smoothstep(r0, 170, 360)
  const dunes = 14 * fbm2(x / 900, z / 900, 4) + 5 * Math.sin(x / 60 + fbm2(x / 400, z / 400, 2) * 6) * fbm2(x / 1500 + 3, z / 1500, 2)
  const plain = CITY_Y - 6 + dunes
  const dc = Math.hypot(x, z - CITY_Z)
  const inCity = 1 - THREE.MathUtils.smoothstep(dc, CITY_R + 60, CITY_R + 300)
  let y = plain * (1 - inCity) + (CITY_Y - 70) * inCity // 城区下面压低（城有自己的地面）
  y = y * (1 - plateau) + (-3 + 1.6 * fbm2(x / 30, z / 30, 3)) * plateau
  const far = Math.max(0, Math.hypot(x * 0.8, z - CITY_Z * 0.6) - 12000)
  y += Math.pow(far / 20000, 1.6) * 5200 * (0.7 + 0.6 * fbm2(x / 5000, z / 5000, 3))
  return y
}

function seabedGeometry() {
  const radial = 640, rings = 300
  const pos = [], col = [], idx = []
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0 : 30 * Math.pow(60000 / 30, i / rings)
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      const y = seabedHeight(x, z)
      pos.push(x, y, z)
      const n = fbm2(x / 200, z / 200, 3)
      const sand = [0.5 + n * 0.2, 0.48 + n * 0.18, 0.4 + n * 0.14]
      const deep = 1 - THREE.MathUtils.smoothstep(y, CITY_Y - 20, -40)
      col.push(sand[0] * (0.55 + 0.45 * deep), sand[1] * (0.6 + 0.4 * deep), sand[2] * (0.7 + 0.3 * deep))
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
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// 城区地面：以城心为中心的极坐标网格；水环是深沟，陆环是铺石的台地，外缘一圈垂直的墙面
function cityFloorGeometry() {
  const radial = 720
  const radii = []
  for (let r = 0; r <= CITY_R; r += 10) radii.push(r)
  const pos = [], col = [], idx = []
  const heightAt = (r) => {
    for (const [r0, r1, water] of RINGS) {
      if (r >= r0 && r <= r1) {
        if (!water) return CITY_Y
        const e = Math.min(r - r0, r1 - r) // 离岸距离
        return CITY_Y + (CANAL_Y - CITY_Y) * THREE.MathUtils.smoothstep(e, 0, 30)
      }
    }
    return CITY_Y
  }
  const waterAt = (r) => RINGS.some(([r0, r1, w]) => w && r > r0 + 20 && r < r1 - 20)
  radii.push(CITY_R + 0.5, CITY_R + 1) // 外缘往下的墙
  radii.forEach((r, i) => {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      let y = heightAt(r)
      if (i === radii.length - 1) y = CITY_Y - 120
      pos.push(x, y, z)
      const tile = (Math.floor(r / 40) + Math.floor((a * r) / 40)) % 2
      const n = fbm2(x / 160, z / 160, 3)
      if (waterAt(r)) col.push(0.05 + n * 0.03, 0.12 + n * 0.05, 0.14 + n * 0.05)
      else col.push((0.42 + tile * 0.05 + n * 0.12), (0.45 + tile * 0.05 + n * 0.12), (0.46 + tile * 0.04 + n * 0.1))
    }
  })
  for (let i = 0; i < radii.length - 1; i++)
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial
      const a = i * radial + j, b = i * radial + j1, c = (i + 1) * radial + j, d = (i + 1) * radial + j1
      idx.push(a, b, c, b, d, c)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// 水母：钟形伞 + 波浪状的口腕和细触手（窄带），长度归一化（伞高 1）
function jellyGeometry() {
  const prof = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const a = t * Math.PI * 0.5
    prof.push(new THREE.Vector2(Math.sin(a) * 1.0 * (1 + 0.08 * t), Math.cos(a) * 1.0 - 0.1 * t * t))
  }
  const bell = new THREE.LatheGeometry(prof, 32)
  // 伞缘的扇贝形起伏
  const p = bell.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i)
    if (y < 0.2) {
      const a = Math.atan2(z, x)
      p.setY(i, y - 0.06 * Math.abs(Math.sin(a * 8)) * (0.2 - y) * 5)
    }
  }
  bell.computeVertexNormals()
  const parts = [bell.toNonIndexed()]
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2
    const L = k % 2 ? 4.5 : 2.6
    const w = k % 2 ? 0.05 : 0.22
    const r = k % 2 ? 0.9 : 0.35
    const seg = 18
    const pos = []
    for (let s = 0; s < seg; s++) {
      const y0 = -0.1 - (s / seg) * L, y1 = -0.1 - ((s + 1) / seg) * L
      const wig0 = Math.sin(s * 0.8 + k) * 0.15 * (s / seg), wig1 = Math.sin((s + 1) * 0.8 + k) * 0.15 * ((s + 1) / seg)
      const cx0 = Math.cos(a) * (r + wig0), cz0 = Math.sin(a) * (r + wig0)
      const cx1 = Math.cos(a) * (r + wig1), cz1 = Math.sin(a) * (r + wig1)
      const tx = -Math.sin(a) * w, tz = Math.cos(a) * w
      pos.push(cx0 - tx, y0, cz0 - tz, cx0 + tx, y0, cz0 + tz, cx1 + tx, y1, cz1 + tz, cx0 - tx, y0, cz0 - tz, cx1 + tx, y1, cz1 + tz, cx1 - tx, y1, cz1 - tz)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    parts.push(g)
  }
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g }))
}

// 小鱼：扁的椭球身体 + 尾鳍，沿 +X 游
function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 12, 8).scale(1, 0.34, 0.16).toNonIndexed()
  const tail = new THREE.BufferGeometry()
  tail.setAttribute('position', new THREE.Float32BufferAttribute([-0.9, 0, 0, -1.55, 0.42, 0, -1.4, 0, 0, -0.9, 0, 0, -1.4, 0, 0, -1.55, -0.42, 0], 3))
  tail.computeVertexNormals()
  const dorsal = new THREE.BufferGeometry()
  dorsal.setAttribute('position', new THREE.Float32BufferAttribute([0.2, 0.3, 0, -0.4, 0.3, 0, -0.1, 0.55, 0], 3))
  dorsal.computeVertexNormals()
  body.deleteAttribute('uv')
  return mergeGeometries([body, tail, dorsal])
}

export function createAtlantisTheme({ quality = 'high' } = {}) {
  const root = new THREE.Group()
  root.name = 'theme-atlantis'
  const R = rng(1337)
  const endpoints = []

  // ---------- 材质 ----------
  const marbleMap = marbleTexture()
  const marble = withCaustics(new THREE.MeshStandardMaterial({ map: marbleMap, color: 0xdfe6e8, roughness: 0.45 }))
  const marbleOld = withCaustics(new THREE.MeshStandardMaterial({ map: marbleMap, color: 0x9fb4b4, roughness: 0.7 }))
  const orichalcum = new THREE.MeshStandardMaterial({ color: 0xd9784a, metalness: 1, roughness: 0.28, emissive: 0xff5a2a, emissiveIntensity: 0.25 })
  const brass = new THREE.MeshStandardMaterial({ color: 0xb89a4a, metalness: 1, roughness: 0.32 })
  const tin = new THREE.MeshStandardMaterial({ color: 0xbcc6cc, metalness: 1, roughness: 0.3 })
  const silver = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, metalness: 1, roughness: 0.2 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xe8b85a, metalness: 1, roughness: 0.22 })
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5a7a62, metalness: 0.7, roughness: 0.45 }) // 长了铜绿的青铜
  const runeMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const glowLine = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.0) })
  const oriGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.4) })

  // ---------- 海底 ----------
  const bedMat = withCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.8)
  const bed = new THREE.Mesh(seabedGeometry(), bedMat)
  bed.receiveShadow = true
  root.add(bed)

  // ---------- 近景：圆台 ----------
  const stage = new THREE.Group()
  const DR = 34
  {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(DR, DR, 1.6, 128), [marble, withCaustics(new THREE.MeshStandardMaterial({ map: mosaicTexture(), color: 0xb4c0c4, roughness: 0.8, envMapIntensity: 0.5 })), marble])
    top.position.y = -0.8
    top.receiveShadow = true
    stage.add(top)
    for (const [r, h, y] of [[DR + 3, 1.4, -2.3], [DR + 6, 1.4, -3.7]]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.4, h, 128), marbleOld)
      st.position.y = y
      st.receiveShadow = true
      stage.add(st)
    }
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(DR - 0.2, 0.28, 8, 256), orichalcum)
    inlay.rotation.x = Math.PI / 2
    inlay.position.y = 0.02
    stage.add(inlay)
  }
  // 符文石：一圈 24 块，灯随 bulbMode 变化
  const RUNES = 24
  const runeStones = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.5, 1.2), runeMat, RUNES)
  for (let i = 0; i < RUNES; i++) {
    const a = (i / RUNES) * Math.PI * 2
    runeStones.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(a) * (DR + 1.6), -1.35, Math.cos(a) * (DR + 1.6)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1)))
    runeStones.setColorAt(i, new THREE.Color(0.2, 0.9, 1.2))
  }
  stage.add(runeStones)

  // 两翼残柱廊：弧形排列，几根断了，一根倒在地上
  {
    const colFull = columnGeometry()
    const colBroken = columnGeometry({ broken: 0.45 })
    const full = [], broken = []
    const CR = 46, CH = 40
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const a = side * (Math.PI * 0.5 + (k / 6) * Math.PI * 0.36)
        const x = Math.sin(a) * CR, z = Math.cos(a) * CR - 4
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -3, z), new THREE.Quaternion(), new THREE.Vector3(CH, CH, CH))
        if ((side < 0 && k === 5) || (side > 0 && k === 2)) broken.push(m)
        else full.push({ m, a })
      }
      // 额枋：架在相邻完好的柱子上
      const arcFull = full.filter((f) => Math.sign(f.a) === side)
      for (let k = 0; k < arcFull.length - 1; k++) {
        const p0 = new THREE.Vector3().setFromMatrixPosition(arcFull[k].m), p1 = new THREE.Vector3().setFromMatrixPosition(arcFull[k + 1].m)
        if (p0.distanceTo(p1) > 26) continue
        const beam = new THREE.Mesh(new THREE.BoxGeometry(p0.distanceTo(p1) + 5, 3.2, 5.5), marbleOld)
        beam.position.copy(p0).add(p1).multiplyScalar(0.5).setY(-3 + CH + 1.4)
        beam.rotation.y = Math.atan2(-(p1.z - p0.z), p1.x - p0.x)
        stage.add(beam)
        const frieze = new THREE.Mesh(new THREE.BoxGeometry(p0.distanceTo(p1) + 5, 0.5, 5.7), glowLine)
        frieze.position.copy(beam.position).setY(beam.position.y - 0.8)
        frieze.rotation.y = beam.rotation.y
        stage.add(frieze)
      }
    }
    const imF = new THREE.InstancedMesh(colFull, marbleOld, full.length)
    full.forEach((f, i) => imF.setMatrixAt(i, f.m))
    imF.castShadow = true
    imF.receiveShadow = true
    stage.add(imF)
    const imB = new THREE.InstancedMesh(colBroken, marbleOld, broken.length)
    broken.forEach((m, i) => imB.setMatrixAt(i, m))
    stage.add(imB)
    // 倒下的柱子（分成三截）
    for (let k = 0; k < 3; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.2, 9.5, 40), marbleOld)
      seg.rotation.set(0.1 * k, 0.3 + k * 0.12, Math.PI / 2 + (k - 1) * 0.05)
      seg.position.set(-58 + k * 10.5, -1.5, -34 + k * 3.5)
      stage.add(seg)
    }
  }

  // 身后的三叉戟门：两根方柱 + 过梁（刻字发光）+ 门楣上的三叉戟
  {
    const gate = new THREE.Group()
    for (const s of [-1, 1]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(6, 52, 6), marble)
      pier.position.set(s * 17, 23, 0)
      pier.castShadow = true
      gate.add(pier)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 8), marble)
      cap.position.set(s * 17, 49.5, 0)
      gate.add(cap)
      for (let k = 0; k < 6; k++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.35, 6.2), glowLine)
        band.position.set(s * 17, 6 + k * 7, 0)
        gate.add(band)
      }
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(44, 5, 7), marble)
    lintel.position.y = 53
    gate.add(lintel)
    const script = new THREE.Mesh(new THREE.BoxGeometry(30, 1.2, 7.2), oriGlow)
    script.position.y = 53
    gate.add(script)
    // 三叉戟
    const tri = new THREE.Group()
    tri.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 18, 16).translate(0, 9, 0), orichalcum))
    const bar = new THREE.Mesh(new THREE.TorusGeometry(4, 0.5, 8, 24, Math.PI), orichalcum)
    bar.rotation.z = Math.PI
    bar.position.y = 16
    tri.add(bar)
    for (const x of [-4, 0, 4]) {
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 12), orichalcum)
      prong.position.set(x, x ? 18.5 : 20.5, 0)
      tri.add(prong)
      if (x) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 3, 12), orichalcum)
        stem.position.set(x, 15.5, 0)
        tri.add(stem)
      }
    }
    tri.position.y = 55.5
    gate.add(tri)
    gate.position.set(0, -3, -44)
    stage.add(gate)
  }

  // 蓝焰青铜三足鼎
  const flames = []
  for (const s of [-1, 1]) {
    const g = new THREE.Group()
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(3.2, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bronze)
    bowl.position.y = 11
    g.add(bowl)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.25, 8, 40), gold)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 11
    g.add(rim)
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 12, 8), bronze)
      leg.position.set(Math.cos(a) * 2, 5, Math.sin(a) * 2)
      leg.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18)
      g.add(leg)
    }
    g.position.set(s * 25, -0.1, 12)
    stage.add(g)
    flames.push(new THREE.Vector3(s * 25, 13.5, 12))
  }

  // 大台阶：从圆台后方一路下到城区
  {
    const steps = 60
    for (let k = 0; k < steps; k++) {
      const y = -4.5 - k * ((CITY_Y + 4) * -1 / steps)
      const st = new THREE.Mesh(new THREE.BoxGeometry(40 + k * 0.4, 1.2, 6), marbleOld)
      st.position.set(0, y, -60 - k * 5.2)
      st.receiveShadow = true
      stage.add(st)
    }
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 320), marbleOld)
      const mid = new THREE.Vector3(s * 24, (-4.5 + CITY_Y) / 2 + 3, -60 - 155)
      wall.position.copy(mid)
      wall.rotation.x = -Math.atan2(-4.5 - CITY_Y, 310)
      stage.add(wall)
    }
  }

  // 近景岩石
  const rockMat = withCaustics(shoreRockMaterial(), 1.2)
  for (let k = 0; k < 16; k++) {
    const a = R() * Math.PI * 2, d = 62 + R() * 110
    const x = Math.sin(a) * d, z = Math.cos(a) * d
    if (Math.abs(x) < 30 && z < -40) continue // 别挡大台阶
    const rr = 3 + R() * 9
    const m = new THREE.Mesh(shoreRock(rr, k * 3.3, { flat: 0.6, detail: 24, waterline: -999, stone: [0.24, 0.26, 0.26], moss: [0.12, 0.2, 0.16] }), rockMat)
    m.position.set(x, seabedHeight(x, z) - rr * 0.2, z)
    m.rotation.y = R() * 6
    stage.add(m)
  }
  bakeStatic(stage)
  root.add(stage)

  // ---------- 近景的活物：珊瑚、海扇、海葵、砗磲、海带 ----------
  const life = new THREE.Group()
  {
    const palette = [
      [[0.35, 0.08, 0.16], [1.0, 0.42, 0.52]],
      [[0.3, 0.14, 0.04], [1.0, 0.62, 0.22]],
      [[0.18, 0.08, 0.3], [0.72, 0.45, 1.0]],
      [[0.06, 0.2, 0.22], [0.35, 1.0, 0.85]],
      [[0.3, 0.26, 0.06], [1.0, 0.9, 0.4]],
    ]
    for (let k = 0; k < 46; k++) {
      const a = R() * Math.PI * 2, d = 40 + Math.pow(R(), 0.7) * 150
      const x = Math.sin(a) * d, z = Math.cos(a) * d
      if (Math.abs(x) < 28 && z < -30 && z > -380) continue
      if (d < 44 && z > 20) continue
      const [base, tip] = palette[Math.floor(R() * palette.length)]
      const fan = R() < 0.3
      const c = createCoral(fan ? 'fan' : 'coral', { seed: k + 1, height: fan ? 10 + R() * 12 : 5 + R() * 8, base, tip, glow: fan ? 0.25 : 0.5 })
      c.position.set(x, seabedHeight(x, z) - 0.3, z)
      c.rotation.y = R() * 6
      life.add(c)
    }
    // 脑珊瑚
    const brainMat = withCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 1.4)
    for (let k = 0; k < 14; k++) {
      const a = R() * Math.PI * 2, d = 45 + R() * 120
      const x = Math.sin(a) * d, z = Math.cos(a) * d
      if (Math.abs(x) < 28 && z < -30) continue
      const r = 1.6 + R() * 3.2
      const geo = new THREE.SphereGeometry(r, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.6)
      const p = geo.attributes.position
      const col = []
      const hue = R()
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i)
        const m = Math.abs(Math.sin((fbm2(v.x / r * 2 + k, v.z / r * 2 + v.y / r, 3) * 10 + v.y / r * 2) * Math.PI))
        v.multiplyScalar(1 + 0.05 * m)
        p.setXYZ(i, v.x, v.y, v.z)
        const c = hue < 0.5 ? [0.55, 0.45, 0.25] : [0.45, 0.3, 0.45]
        col.push(c[0] * (0.6 + 0.5 * m), c[1] * (0.6 + 0.5 * m), c[2] * (0.6 + 0.5 * m))
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      geo.computeVertexNormals()
      const b = new THREE.Mesh(geo, brainMat)
      b.position.set(x, seabedHeight(x, z) - r * 0.35, z)
      life.add(b)
    }
    // 砗磲：两片波浪边的壳 + 发光珍珠
    for (const [x, z, s] of [[-40, 22, 1], [44, -12, 0.8]]) {
      const g = new THREE.Group()
      const shellGeo = new THREE.SphereGeometry(5, 64, 16, 0, Math.PI, 0, Math.PI / 2)
      const sp = shellGeo.attributes.position
      for (let i = 0; i < sp.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(sp, i)
        const a = Math.atan2(v.z, v.x)
        v.multiplyScalar(1 + 0.08 * Math.sin(a * 10))
        sp.setXYZ(i, v.x, v.y * 0.7, v.z)
      }
      shellGeo.computeVertexNormals()
      const shellMat = new THREE.MeshPhysicalMaterial({ color: 0xd8e4ec, roughness: 0.35, iridescence: 1, iridescenceIOR: 1.6, side: THREE.DoubleSide })
      const lo = new THREE.Mesh(shellGeo, shellMat)
      lo.rotation.x = Math.PI / 2
      const hi = new THREE.Mesh(shellGeo, shellMat)
      hi.rotation.x = -Math.PI / 2 - 0.9
      g.add(lo, hi)
      const mantle = new THREE.Mesh(new THREE.CircleGeometry(4.8, 48, 0, Math.PI).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a6a9a, emissive: 0x1a8ab0, emissiveIntensity: 0.6, roughness: 0.4 }))
      mantle.position.y = 0.1
      g.add(mantle)
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfefff, emissiveIntensity: 1.6, roughness: 0.2 }))
      pearl.position.set(0, 1.2, 1.4)
      g.add(pearl)
      g.scale.setScalar(s)
      g.position.set(x, seabedHeight(x, z) + 0.3, z)
      g.rotation.y = x < 0 ? 0.8 : -2.2
      life.add(g)
    }
  }
  root.add(life)

  // 海葵：一簇簇会摆动的触手（实例化）
  const anemoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })
  const anemoneU = { uTime: { value: 0 } }
  anemoneMat.onBeforeCompile = (sh) => {
    sh.uniforms.uATime = anemoneU.uTime
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uATime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        float k = max(0.0, position.y) * max(0.0, position.y);
        transformed.x += sin(uATime * 1.4 + ph + position.z * 3.0) * 0.18 * k;
        transformed.z += cos(uATime * 1.1 + ph + position.x * 3.0) * 0.18 * k;`,
      )
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.35;')
  }
  anemoneMat.customProgramCacheKey = () => 'anemone'
  {
    const parts = []
    const AR = rng(77)
    for (let k = 0; k < 60; k++) {
      const a = AR() * Math.PI * 2, r = Math.sqrt(AR()) * 0.8
      const h = 1.2 + AR() * 1.0
      const t = new THREE.CylinderGeometry(0.02, 0.07, h, 5).translate(0, h / 2, 0)
      t.rotateZ((AR() - 0.5) * 0.9 * r)
      t.rotateX((AR() - 0.5) * 0.9 * r)
      t.translate(Math.cos(a) * r, 0.3, Math.sin(a) * r)
      const n = t.attributes.position.count
      const col = []
      for (let i = 0; i < n; i++) {
        const y = t.attributes.position.getY(i) / 2.5
        col.push(0.4 + 0.6 * y, 0.2 + 0.5 * y, 0.5 + 0.5 * y)
      }
      t.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      parts.push(t.toNonIndexed())
    }
    const disc = new THREE.CylinderGeometry(0.9, 1.1, 0.5, 20).translate(0, 0.25, 0).toNonIndexed()
    disc.setAttribute('color', new THREE.Float32BufferAttribute(new Array(disc.attributes.position.count * 3).fill(0.3), 3))
    parts.push(disc)
    const geo = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g }))
    const N = 90
    const im = new THREE.InstancedMesh(geo, anemoneMat, N)
    const tints = [[1.0, 0.45, 0.7], [1.0, 0.65, 0.3], [0.6, 0.55, 1.0], [0.4, 1.0, 0.8]]
    for (let i = 0; i < N; i++) {
      const a = AR() * Math.PI * 2, d = 38 + AR() * 140
      const x = Math.sin(a) * d, z = Math.cos(a) * d
      const s = 1.2 + AR() * 1.8
      im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, seabedHeight(x, z) - 0.2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), AR() * 6), new THREE.Vector3(s, s, s)))
      const c = tints[Math.floor(AR() * tints.length)]
      im.setColorAt(i, new THREE.Color(...c))
    }
    root.add(im)
  }

  // 海带林：舞台两侧 + 城外平原上成片
  const kelpTex = kelpTexture()
  const kelpMat = new THREE.MeshStandardMaterial({ map: kelpTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.7, vertexColors: true, emissive: 0xffc070, emissiveMap: kelpTex, emissiveIntensity: 0.18 })
  const kelpU = { uTime: { value: 0 } }
  kelpMat.onBeforeCompile = (sh) => {
    sh.uniforms.uKTime = kelpU.uTime
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uKTime;\nattribute vec2 aKelp;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float kk = aKelp.x * aKelp.x;
        transformed.x += (sin(uKTime * 0.7 + aKelp.y + aKelp.x * 2.5) * 0.6 + sin(uKTime * 1.9 + aKelp.y * 2.0) * 0.15) * kk * 9.0;
        transformed.z += cos(uKTime * 0.55 + aKelp.y * 1.3 + aKelp.x * 2.0) * kk * 6.0;`,
      )
  }
  kelpMat.customProgramCacheKey = () => 'kelp'
  {
    const KR = rng(55)
    const pos = [], uv = [], nrm = [], col = [], kv = []
    const addKelp = (x, y, z, H) => {
      const W = 8 + KR() * 6
      const seg = 24
      const variant = Math.floor(KR() * 4)
      const ph = KR() * 6.28
      const rot = KR() * Math.PI
      const shade = 0.7 + KR() * 0.5
      for (const r of [rot, rot + Math.PI / 2]) {
        const dx = Math.cos(r) * W * 0.5, dz = Math.sin(r) * W * 0.5
        for (let s = 0; s < seg; s++) {
          const t0 = s / seg, t1 = (s + 1) / seg
          const lean0 = Math.sin(t0 * 2.2 + ph) * H * 0.05, lean1 = Math.sin(t1 * 2.2 + ph) * H * 0.05
          const q = [
            [x - dx + lean0, y + t0 * H, z - dz, 0, t0], [x + dx + lean0, y + t0 * H, z + dz, 1, t0], [x + dx + lean1, y + t1 * H, z + dz, 1, t1],
            [x - dx + lean0, y + t0 * H, z - dz, 0, t0], [x + dx + lean1, y + t1 * H, z + dz, 1, t1], [x - dx + lean1, y + t1 * H, z - dz, 0, t1],
          ]
          for (const [px, py, pz, u, t] of q) {
            pos.push(px, py, pz)
            uv.push((variant + u) * 0.25, t)
            nrm.push(0, 1, 0)
            const c = shade * (0.45 + 0.55 * t)
            col.push(c, c, c)
            kv.push(t, ph)
          }
        }
      }
    }
    for (let k = 0; k < 140; k++) {
      const a = KR() * Math.PI * 2, d = 70 + Math.pow(KR(), 0.6) * 260
      const x = Math.sin(a) * d, z = Math.cos(a) * d
      if (Math.abs(x) < 40 && z < -30 && z > -400) continue
      if (z > 40 && Math.abs(x) < 60) continue // 别挡正面镜头
      addKelp(x, seabedHeight(x, z) - 1, z, 30 + KR() * 70)
    }
    // 城外的海带林（成片）
    for (let k = 0; k < 2600; k++) {
      const a = KR() * Math.PI * 2, d = 500 + KR() * 9000
      const x = Math.sin(a) * d * 1.3, z = Math.cos(a) * d - 2000
      if (Math.hypot(x, z - CITY_Z) < CITY_R + 250) continue
      if (fbm2(x / 1400, z / 1400, 3) < 0.5) continue
      addKelp(x, seabedHeight(x, z) - 2, z, 60 + KR() * 160)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setAttribute('aKelp', new THREE.Float32BufferAttribute(kv, 2))
    const kelp = new THREE.Mesh(g, kelpMat)
    kelp.frustumCulled = false
    root.add(kelp)
  }

  // ---------- 中景：环城 ----------
  const city = new THREE.Group()
  city.position.set(0, 0, CITY_Z)
  const floor = new THREE.Mesh(cityFloorGeometry(), withCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 0.9))
  floor.receiveShadow = true
  city.add(floor)

  const houseMat = createBuildingMaterial({
    extentX: CITY_R + 200, base: [0.16, 0.2, 0.22], top: [0.12, 0.16, 0.18], grid: [12, 20], win: [0.3, 0.7, 0.14, 0.8],
    warm: [1.0, 0.72, 0.38], cool: [0.35, 0.95, 1.0], winGain: 2.2, lattice: 0, neonMix: [1.0, 1.6, 0.6], flash: [0.5, 1.0, 1.0], glass: [0.02, 0.06, 0.08],
    amb: [0.9, 1.1, 1.2],
  })
  const houses = []
  const domeSlots = []
  const gableSlots = []
  const landRings = RINGS.filter((r) => !r[2])
  for (const [r0, r1] of landRings) {
    const inner = r0 === 0
    for (let r = Math.max(r0 + 60, inner ? 160 : 0); r < r1 - 50; r += 64) {
      const n = Math.floor((2 * Math.PI * r) / 58)
      for (let j = 0; j < n; j++) {
        if (R() > 0.72) continue
        const a = (j / n) * Math.PI * 2 + (R() - 0.5) * 0.01
        // 四条放射大道
        const axisD = Math.min(...[0, 1, 2, 3].map((q) => Math.abs(Math.sin(a - q * Math.PI / 2)) * r))
        if (axisD < 55) continue
        const x = Math.cos(a) * r, z = Math.sin(a) * r
        const w = 30 + R() * 22, d = 26 + R() * 18
        const tall = R() < 0.05 + (r < 1500 ? 0.08 : 0)
        const h = tall ? 70 + R() * 80 : 22 + R() * 34
        houses.push({ x, y: CITY_Y, z, w, d, h, rot: -a })
        let top = CITY_Y + h, tw = w, td = d
        if (tall) {
          // 退台式的塔：往上一层层收
          const tiers = 2 + Math.floor(R() * 3)
          for (let k = 0; k < tiers; k++) {
            tw *= 0.72; td *= 0.72
            const th = 18 + R() * 30
            houses.push({ x, y: top, z, w: tw, d: td, h: th, rot: -a })
            top += th
          }
          endpoints.push({ pos: new THREE.Vector3(x, top + 30, z + CITY_Z), index: houses.length - 1, _slot: houses[houses.length - 1] })
        }
        const roofPick = R()
        if (tall || roofPick < 0.34) domeSlots.push({ x, y: top, z, s: Math.min(tw, td) * 0.48 })
        else if (roofPick < 0.8) gableSlots.push({ x, y: top, z, w: w * 1.08, d: d * 1.1, rise: Math.min(w, d) * 0.28, rot: -a, kind: R() < 0.55 ? 0 : 1 })
      }
    }
  }
  const houseSet = instancedBuildings(houses, houseMat, R, { neon: [[0.2, 0.9, 1.0], [1.0, 0.55, 0.25], [0.6, 0.5, 1.0]], density: [0.35, 0.8] })
  for (const ep of endpoints) ep.index = ep._slot.index
  city.add(houseSet.mesh)
  // 圆顶（铜绿 + 发光经纬线）
  const domeTex = domeTexture()
  const domeMat = new THREE.MeshStandardMaterial({ color: 0x4a8a82, metalness: 0.6, roughness: 0.35, emissive: 0x40e0ff, emissiveMap: domeTex, emissiveIntensity: 0.6 })
  const domes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, domeSlots.length)
  domeSlots.forEach((d, i) => domes.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(d.x, d.y, d.z), new THREE.Quaternion(), new THREE.Vector3(d.s, d.s * 0.9, d.s))))
  domes.frustumCulled = false
  city.add(domes)
  // 两坡屋顶（三角山花朝街）：一半铜绿、一半浅色石材
  {
    const prism = new THREE.BufferGeometry()
    const P = [
      [-0.5, 0, -0.5], [0.5, 0, -0.5], [0, 1, -0.5],
      [-0.5, 0, 0.5], [0, 1, 0.5], [0.5, 0, 0.5],
    ]
    const tri = (a, b, c) => [...P[a], ...P[b], ...P[c]]
    // 两个山墙 + 两片屋面（山墙在 ±Z，屋脊沿 Z）
    const pos = [...tri(0, 2, 1), ...tri(3, 5, 4), ...tri(0, 3, 4), ...tri(0, 4, 2), ...tri(1, 2, 4), ...tri(1, 4, 5)]
    prism.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    prism.computeVertexNormals()
    const roofMats = [
      new THREE.MeshStandardMaterial({ color: 0x4a8a78, metalness: 0.55, roughness: 0.45 }),
      withCaustics(new THREE.MeshStandardMaterial({ color: 0xc8ccc4, roughness: 0.7 })),
    ]
    for (const kind of [0, 1]) {
      const list = gableSlots.filter((g) => g.kind === kind)
      const im = new THREE.InstancedMesh(prism, roofMats[kind], list.length)
      // 屋脊朝向：放射方向（山花朝环形街道）
      list.forEach((g, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(g.x, g.y, g.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.rot), new THREE.Vector3(g.w, g.rise, g.d))))
      im.frustumCulled = false
      city.add(im)
    }
  }

  // 环的边缘：列柱 + 金属城墙 + 运河灯带
  const colGeo = columnGeometry()
  const colSlots = []
  const canalLights = []
  for (const [r0, r1, water] of RINGS) {
    if (!water) continue
    for (const r of [r0 - 14, r1 + 14]) {
      const n = Math.floor((2 * Math.PI * r) / 44)
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2
        const axisD = Math.min(...[0, 1, 2, 3].map((q) => Math.abs(Math.sin(a - q * Math.PI / 2)) * r))
        if (axisD < 45) continue
        colSlots.push(new THREE.Vector3(Math.cos(a) * r, CITY_Y, Math.sin(a) * r))
      }
      const nl = Math.floor((2 * Math.PI * r) / 26)
      for (let j = 0; j < nl; j++) {
        const a = (j / nl) * Math.PI * 2
        const rr = r + (r < r1 ? 12 : -12)
        canalLights.push(new THREE.Vector3(Math.cos(a) * rr, CITY_Y - 3, Math.sin(a) * rr + CITY_Z))
      }
    }
  }
  const cols = new THREE.InstancedMesh(colGeo, marbleOld, colSlots.length)
  colSlots.forEach((p, i) => cols.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(36, 36, 36))))
  cols.frustumCulled = false
  city.add(cols)
  // 列柱上的环形额枋
  for (const [r0, r1, water] of RINGS) {
    if (!water) continue
    for (const r of [r0 - 14, r1 + 14]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + 3.5, r + 3.5, 3, 360, 1, true), marbleOld)
      ring.position.y = CITY_Y + 37.5
      city.add(ring)
      const ring2 = new THREE.Mesh(new THREE.CylinderGeometry(r - 3.5, r - 3.5, 3, 360, 1, true), marbleOld)
      ring2.position.y = CITY_Y + 37.5
      city.add(ring2)
    }
  }
  // 三道金属城墙（黄铜 / 锡 / 山铜），墙顶一道发光线
  const wallGlow = []
  for (const [r, mat, glow] of [[CITY_R - 20, brass, [1.4, 1.0, 0.4]], [2900 - 30, tin, [0.6, 1.3, 1.6]], [500 - 30, orichalcum, [2.2, 0.8, 0.35]]]) {
    const h = r > 4000 ? 60 : r > 2000 ? 48 : 70
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 720, 1, true), mat)
    wall.position.y = CITY_Y + h / 2
    city.add(wall)
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(r - 8, r - 8, h, 720, 1, true), mat)
    inner.position.y = CITY_Y + h / 2
    city.add(inner)
    const cap = new THREE.Mesh(new THREE.RingGeometry(r - 8, r, 720, 1).rotateX(-Math.PI / 2), mat)
    cap.position.y = CITY_Y + h
    city.add(cap)
    const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(...glow) })
    const line = new THREE.Mesh(new THREE.TorusGeometry(r + 0.5, 1.2, 6, 720), gm)
    line.rotation.x = Math.PI / 2
    line.position.y = CITY_Y + h - 6
    city.add(line)
    wallGlow.push({ m: gm, base: new THREE.Color(...glow) })
    // 塔楼
    const tn = Math.floor((2 * Math.PI * r) / 420)
    for (let j = 0; j < tn; j++) {
      const a = (j / tn) * Math.PI * 2 + 0.2
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(16, 19, h * 1.7, 32), mat)
      tw.position.set(Math.cos(a) * r, CITY_Y + h * 0.85, Math.sin(a) * r)
      city.add(tw)
      const tc = new THREE.Mesh(new THREE.ConeGeometry(21, 26, 32), gold)
      tc.position.set(Math.cos(a) * r, CITY_Y + h * 1.7 + 13, Math.sin(a) * r)
      city.add(tc)
    }
  }
  // 四条放射大道上的桥（跨水环）
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2
    for (const [r0, r1, water] of RINGS) {
      if (!water) continue
      const len = r1 - r0 + 40
      const mid = (r0 + r1) / 2
      const br = new THREE.Group()
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 4, 60), marble)
      deck.position.y = CITY_Y + 2
      br.add(deck)
      const nA = Math.max(2, Math.round(len / 90))
      for (let k = 0; k < nA; k++) {
        const ax = -len / 2 + ((k + 0.5) / nA) * len
        const arch = new THREE.Mesh(new THREE.TorusGeometry(len / nA / 2 - 6, 5, 8, 24, Math.PI), marbleOld)
        arch.position.set(ax, CANAL_Y + 2, 0)
        arch.scale.y = (CITY_Y - CANAL_Y) / (len / nA / 2 - 6)
        br.add(arch)
        for (const s of [-1, 1]) {
          const lamp = new THREE.Vector3(Math.cos(a) * (mid + ax), CITY_Y + 12, Math.sin(a) * (mid + ax) + CITY_Z)
          lamp.x += -Math.sin(a) * s * 28
          lamp.z += Math.cos(a) * s * 28
          canalLights.push(lamp)
        }
      }
      br.position.set(Math.cos(a) * mid, 0, Math.sin(a) * mid)
      br.rotation.y = -a
      city.add(br)
    }
  }

  // 中心岛：三层台基 + 波塞冬神庙（外覆白银、尖顶镀金）+ 悬浮的山铜核心
  const core = new THREE.Group()
  {
    const temple = new THREE.Group()
    const L = 300, W = 150
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(L + 90 - k * 30, 10, W + 70 - k * 25), marble)
      b.position.y = 5 + k * 10
      temple.add(b)
    }
    const base = 30
    const colsT = []
    const nx = 8, nz = 17
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue
      colsT.push(new THREE.Vector3(-W / 2 + (i / (nx - 1)) * W, base, -L / 2 + (j / (nz - 1)) * L))
    }
    const imT = new THREE.InstancedMesh(colGeo, marble, colsT.length)
    colsT.forEach((p, i) => imT.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(80, 80, 80))))
    temple.add(imT)
    const cella = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 70, L * 0.72), silver)
    cella.position.y = base + 35
    temple.add(cella)
    const ent = new THREE.Mesh(new THREE.BoxGeometry(W + 16, 12, L + 16), silver)
    ent.position.y = base + 80 + 6
    temple.add(ent)
    const frieze = new THREE.Mesh(new THREE.BoxGeometry(W + 16.5, 3, L + 16.5), oriGlow)
    frieze.position.y = base + 83
    temple.add(frieze)
    // 两坡屋顶
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2 - 10, 0), new THREE.Vector2(W / 2 + 10, 0), new THREE.Vector2(0, 42)])
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: L + 20, bevelEnabled: false }).translate(0, 0, -(L + 20) / 2), silver)
    roof.position.y = base + 92
    temple.add(roof)
    for (const s of [-1, 1]) {
      const acro = new THREE.Mesh(new THREE.ConeGeometry(6, 18, 16), gold)
      acro.position.set(0, base + 92 + 42 + 9, s * (L / 2 + 10))
      temple.add(acro)
      for (const e of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 16), gold)
        c.position.set(e * (W / 2 + 10), base + 98, s * (L / 2 + 10))
        temple.add(c)
      }
    }
    temple.position.y = CITY_Y
    city.add(temple)
    endpoints.push({ pos: new THREE.Vector3(0, CITY_Y + 170, CITY_Z), index: -1 })
    // 神庙四周的方尖碑
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const ob = new THREE.Mesh(new THREE.CylinderGeometry(3, 9, 120, 4).rotateY(Math.PI / 4), marble)
      ob.position.set(Math.cos(a) * 330, CITY_Y + 60, Math.sin(a) * 330)
      city.add(ob)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(4.3, 12, 4).rotateY(Math.PI / 4), oriGlow)
      tip.position.set(Math.cos(a) * 330, CITY_Y + 126, Math.sin(a) * 330)
      city.add(tip)
    }
    // 山铜核心：双八面体水晶 + 两圈转环
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(60, 0).scale(1, 1.7, 1), new THREE.MeshStandardMaterial({ color: 0xff8a50, emissive: 0xff5a20, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.92 }))
    core.add(crystal)
    for (const [r, tilt] of [[120, 0.3], [150, -0.5]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 3, 8, 128), orichalcum)
      ring.rotation.x = Math.PI / 2 + tilt
      core.add(ring)
    }
    core.position.set(0, CITY_Y + 460, 0)
    city.add(core)
  }
  // 高塔（顶上的水晶是数据包的目的地）
  const spireTips = []
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + 0.1
    const r = k % 2 ? 2400 : 1200
    const h = 260 + R() * 220
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(6, 22, h, 24), marble)
    sp.position.set(x, CITY_Y + h / 2, z)
    city.add(sp)
    for (let b = 1; b < 5; b++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(22 - (b / 5) * 16 + 1, 1.2, 6, 32), gold)
      band.rotation.x = Math.PI / 2
      band.position.set(x, CITY_Y + (b / 5) * h, z)
      city.add(band)
    }
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(12, 0).scale(1, 2, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 2.0) }))
    tip.position.set(x, CITY_Y + h + 20, z)
    city.add(tip)
    spireTips.push(tip)
    endpoints.push({ pos: new THREE.Vector3(x, CITY_Y + h + 20, z + CITY_Z), index: -1 })
  }
  root.add(city)

  // 运河灯带（Points）
  const lampGeo = new THREE.BufferGeometry()
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(canalLights.flatMap((p) => p.toArray()), 3))
  lampGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(canalLights.map(() => 12), 1))
  lampGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(canalLights.flatMap(() => [0.35, 1.3, 1.6]), 3))
  lampGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(canalLights.map(() => 1), 1))
  const lampMat = glowPointMaterial({ size: 1, maxSize: 26 })
  root.add(new THREE.Points(lampGeo, lampMat))
  // 近景的蓝焰
  const flameGeo = new THREE.BufferGeometry()
  const flamePts = []
  const FR = rng(12)
  for (const f of flames) for (let k = 0; k < 40; k++) flamePts.push([f.x + (FR() - 0.5) * 3, f.y + FR() * 5, f.z + (FR() - 0.5) * 3, FR()])
  flameGeo.setAttribute('position', new THREE.Float32BufferAttribute(flamePts.flatMap((p) => p.slice(0, 3)), 3))
  flameGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(flamePts.map((p) => 2 + p[3] * 3), 1))
  flameGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(flamePts.flatMap(() => [0.3, 0.9, 1.6]), 3))
  flameGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(flamePts.map(() => 0.8), 1))
  const flameMat = glowPointMaterial({ size: 1, maxSize: 60 })
  const flamePoints = new THREE.Points(flameGeo, flameMat)
  flamePoints.frustumCulled = false
  root.add(flamePoints)

  // ---------- 远景 ----------
  // 倒插在沙里的巨型三叉戟
  {
    const tri = new THREE.Group()
    const m = new THREE.MeshStandardMaterial({ color: 0x3e6a5c, metalness: 0.8, roughness: 0.5 })
    tri.add(new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 900, 24).translate(0, 450, 0), m))
    const bar = new THREE.Mesh(new THREE.TorusGeometry(120, 14, 12, 48, Math.PI), m)
    bar.rotation.z = Math.PI
    bar.position.y = 880
    tri.add(bar)
    for (const x of [-120, 0, 120]) {
      const prong = new THREE.Mesh(new THREE.CylinderGeometry(12, 14, x ? 180 : 260, 16), m)
      prong.position.set(x, x ? 970 : 1010, 0)
      tri.add(prong)
      const head = new THREE.Mesh(new THREE.ConeGeometry(28, 90, 16), m)
      head.position.set(x, x ? 1105 : 1185, 0)
      tri.add(head)
    }
    tri.position.set(-3600, CITY_Y - 60, -2600)
    tri.rotation.set(0.12, 0.6, 0.28)
    root.add(tri)
  }
  root.add(mountainRing({ radius: 34000, spread: 6000, height: 7000, seed: 6.1, color: 0x02080c, topColor: 0x0a2530, sector: -0.6 }))
  root.add(mountainRing({ radius: 22000, spread: 4000, height: 3500, seed: 2.9, color: 0x030a10, topColor: 0x0c2a36, sector: -0.4 }))

  // 光柱（从海面斜射下来）
  const beams = []
  for (let i = 0; i < 7; i++) {
    const near = i < 4
    const m = new THREE.Mesh(beamGeometry(near ? 6 : 120, near ? 26 : 500, near ? 200 : 3000), beamMaterial([0.55, 0.95, 1.0], near ? 0.18 : 0.12))
    if (near) m.position.set((i - 1.5) * 34, 150, -30 + (i % 2) * 20)
    else m.position.set((i - 5) * 2200, 2400, CITY_Z + (i - 5) * 800)
    m.rotation.set(0.28, 0, (i - 3) * 0.08)
    m.frustumCulled = false
    root.add(m)
    beams.push(m)
  }

  // ---------- 鱼群 ----------
  const FISH_SCHOOLS = [
    { n: 420, c: [0, 52, -26], ax: [70, 8, 30], r: [8, 24], w: 0.35, s: 1.6 }, // 绕着舞台上空
    { n: 500, c: [-600, 160, -2200], ax: [500, 80, 400], r: [20, 60], w: 0.12, s: 5 },
    { n: 500, c: [900, 260, -4200], ax: [700, 120, 500], r: [25, 80], w: 0.1, s: 6 },
    { n: 400, c: [-1500, 420, -6500], ax: [900, 140, 700], r: [30, 90], w: 0.08, s: 7 },
    { n: 380, c: [300, 90, -900], ax: [300, 40, 200], r: [15, 45], w: 0.2, s: 3 },
  ]
  const fishCount = FISH_SCHOOLS.reduce((a, s) => a + s.n, 0)
  const fishMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f0, metalness: 0.85, roughness: 0.25 })
  const fish = new THREE.InstancedMesh(fishGeometry(), fishMat, fishCount)
  fish.frustumCulled = false
  const fishData = []
  const FSR = rng(21)
  FISH_SCHOOLS.forEach((sc, si) => {
    for (let i = 0; i < sc.n; i++) {
      fishData.push({ sc, si, th: FSR() * Math.PI * 2, ph: FSR() * Math.PI * 2, rr: sc.r[0] + FSR() * (sc.r[1] - sc.r[0]), yo: (FSR() - 0.5) * sc.r[1] * 0.5, sp: 0.8 + FSR() * 0.4, size: sc.s * (0.7 + FSR() * 0.6) })
      const tint = si === 0 ? [0.6 + FSR() * 0.4, 0.8, 1.0] : [0.8 + FSR() * 0.2, 0.9, 1.0]
      fish.setColorAt(fishData.length - 1, new THREE.Color(...tint))
    }
  })
  root.add(fish)

  // ---------- 水母 ----------
  const JN = 150
  const jellyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  const jellies = new THREE.InstancedMesh(jellyGeometry(), jellyMat, JN)
  jellies.frustumCulled = false
  const jellyData = []
  const JR = rng(99)
  const jellyCols = [[1.0, 0.4, 0.8], [0.4, 0.9, 1.2], [0.8, 0.5, 1.2], [1.1, 0.7, 0.4]]
  for (let i = 0; i < JN; i++) {
    const near = i < 18
    const a = JR() * Math.PI * 2, d = near ? 50 + JR() * 90 : 300 + JR() * 6000
    const p = new THREE.Vector3(Math.sin(a) * d, near ? 30 + JR() * 60 : 80 + JR() * 900, Math.cos(a) * d - (near ? 0 : 3200))
    const s = near ? 2 + JR() * 2.5 : 8 + JR() * 22
    const c = jellyCols[Math.floor(JR() * jellyCols.length)]
    jellyData.push({ p, s, ph: JR() * 6.28, rise: 2 + JR() * 4, range: near ? 60 : 500, c })
    jellies.setColorAt(i, new THREE.Color(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5))
  }
  root.add(jellies)
  const jgGeo = new THREE.BufferGeometry()
  jgGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(JN * 3), 3))
  jgGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(jellyData.map((j) => j.s * 2.2), 1))
  jgGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(jellyData.flatMap((j) => j.c.map((v) => v * 0.6)), 3))
  jgGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(jellyData.map(() => 0.7), 1))
  const jgMat = glowPointMaterial({ size: 1, maxSize: 80 })
  const jellyGlow = new THREE.Points(jgGeo, jgMat)
  jellyGlow.frustumCulled = false
  root.add(jellyGlow)

  // ---------- 灯光 ----------
  const rig = createLightRig({
    key: { color: 0xc8f4ff, intensity: 3600, pos: [20, 90, 60], target: [0, 8, 0] },
    spots: [{ color: 0x40d8ff, intensity: 3200, pos: [-40, 55, -10] }, { color: 0xb070ff, intensity: 3000, pos: [40, 55, -10] }],
    rim: { color: 0x7ae8ff, intensity: 9000, pos: [0, 70, -90] },
    points: [{ color: 0x50c8ff, intensity: 60, pos: [-25, 14, 12] }, { color: 0x50c8ff, intensity: 60, pos: [25, 14, 12] }],
  })
  root.add(rig.group)

  // ---------- 鲸 + 粒子 ----------
  const whales = createWhales({ floorY: 2600, back: [0.02, 0.1, 0.2], belly: [0.4, 0.75, 0.85], rim: [0.4, 1.0, 1.1], splashColor: [0.6, 1.0, 1.1], moonDir: SUN })
  root.add(whales.object)
  const particles = createParticles({
    seed: 505,
    endpoints,
    emitter: new THREE.Vector3(0, 60, -44),
    flash: { beginFlash: () => houseSet.beginFlash(), addFlash: (ep, v) => houseSet.addFlash(ep.index, v) },
    lanterns: { mode: 'none' },
    ambient: { kind: 'bubble', count: 520, floorY: -3, height: 110, radius: [12, 150] },
    dust: { a: [0.6, 0.95, 1.0], b: [0.9, 0.95, 1.0] },
    glyphs: { chars: ['Ψ', 'Α', 'Ω', 'Σ', 'Δ', 'Φ', 'Λ', 'Ξ'], font: '700 96px "Noto Serif", "Times New Roman", "DejaVu Serif", serif', colors: [[0.4, 1.0, 1.1], [1.0, 0.6, 0.35], [0.7, 0.7, 1.1]] },
    packets: { colors: [[0.4, 1.0, 1.2], [1.0, 0.6, 0.3]], arc: 0.22 },
    fireworks: { palette: [[0.3, 1.0, 1.1], [0.6, 0.5, 1.2], [1.0, 0.5, 0.8], [0.4, 1.1, 0.7], [1.0, 0.75, 0.4]], zone: (h) => [-3200 + h(1) * 6400, 500 + h(3) * 700, CITY_Z - 1800 + h(2) * 3600] },
  })
  root.add(particles.object)

  // ---------- 每帧 ----------
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const sc3 = new THREE.Vector3()
  const X = new THREE.Vector3(1, 0, 0)
  const tmpC = new THREE.Color()
  const fishPos = (f, t, out) => {
    const sc = f.sc
    const ct = t * sc.w
    const cx = sc.c[0] + Math.sin(ct) * sc.ax[0]
    const cy = sc.c[1] + Math.sin(ct * 1.3 + 1) * sc.ax[1]
    const cz = sc.c[2] + Math.sin(ct * 0.7 + 2) * sc.ax[2]
    const a = f.th + t * f.sp * 0.6
    return out.set(cx + Math.cos(a) * f.rr, cy + f.yo + Math.sin(a * 2 + f.ph) * f.rr * 0.15, cz + Math.sin(a) * f.rr)
  }
  return {
    name: 'atlantis',
    label: '亚特兰蒂斯',
    root,
    ocean: null,
    accent: [0.4, 1.3, 1.5],
    exposure: 1.0,
    sky: {
      under: 1,
      zenith: [0.25, 0.62, 0.66], mid: [0.03, 0.15, 0.2], horizon: [0.012, 0.06, 0.09], below: [0.002, 0.008, 0.016],
      glowLow: [0.15, 0.55, 0.65], glowHigh: [0.3, 0.9, 1.0], glowDir: [0, 0, -1], glowAmt: 1,
      stars: 0, milky: 0, meteors: 0, cloudAmt: 0,
      orbDir: SUN, orbColor: [1.0, 0.97, 0.85], orbBright: 3, orbHalo: [0.35, 0.8, 0.85], orbHaloAmt: 1,
    },
    fog: { color: [0.01, 0.06, 0.085], density: 0.000085 },
    hemi: { sky: 0x4aa8c0, ground: 0x08141c, intensity: 1.0 },
    moon: { color: 0xa8ecff, intensity: 1.4, dir: SUN },
    env: {
      top: [0.3, 0.75, 0.85],
      horizon: [0.02, 0.1, 0.14],
      glow: [0.1, 0.5, 0.6],
      panels: [
        [[0.8, 2.4, 2.8], [0, 60, 70], [60, 20]],
        [[0.6, 1.6, 2.6], [-70, 30, -30], [30, 50]],
        [[1.8, 0.9, 2.6], [70, 25, -40], [30, 40]],
        [[2.6, 1.2, 0.6], [0, 20, -90], [80, 30]],
      ],
    },
    update(state) {
      const t = state.t
      const hush = state.hush
      const alive = 1 - state.fall * 0.85
      updateBuildingUniforms(houseMat, state)
      causticU.uCTime.value = t
      causticU.uCAmt.value = (0.55 + 0.45 * state.sea) * (1 - 0.5 * hush)
      kelpU.uTime.value = t
      anemoneU.uTime.value = t

      // 符文石
      for (let i = 0; i < RUNES; i++) {
        let b
        if (state.bulbMode === 'fill') b = state.bulbFill * 1.05 > (i + 0.5) / RUNES ? 1 : 0.06
        else if (state.bulbMode === 'chase') b = 0.3 + 1.1 * Math.pow(0.5 + 0.5 * Math.sin((i / RUNES) * Math.PI * 6 - t * 5), 4) + state.pulse * 0.4
        else if (state.bulbMode === 'walk') b = 0.25 + 1.3 * (Math.floor(state.beat) % RUNES === i ? 1 : 0)
        else if (state.bulbMode === 'blink') b = Math.sin(i * 91.7 + Math.floor(t * 12) * 13.1) > 0.2 ? 1.1 : 0.03
        else b = 0.6 + 0.3 * Math.sin(t * 1.6 + i * 0.5)
        b = b * (1 - 0.6 * hush) * alive + state.finaleFlash + state.recoverFlash * 0.6
        runeStones.setColorAt(i, tmpC.setRGB(0.25 * b, 1.4 * b, 1.8 * b))
      }
      runeStones.instanceColor.needsUpdate = true

      glowLine.color.setRGB(0.4, 1.6, 2.0).multiplyScalar((0.35 + 0.8 * state.neon + 0.3 * state.pulse) * alive * (1 - 0.5 * hush))
      oriGlow.color.setRGB(2.2, 0.9, 0.4).multiplyScalar((0.5 + 0.7 * state.city) * alive)
      orichalcum.emissiveIntensity = (0.15 + 0.35 * state.neon) * alive
      wallGlow.forEach((w) => w.m.color.copy(w.base).multiplyScalar((0.3 + 0.9 * state.city) * alive))
      domeMat.emissiveIntensity = (0.2 + 0.9 * state.city) * alive
      lampMat.uniforms.uFade.value = (0.25 + 0.75 * Math.min(1, state.city * 1.2)) * alive
      flameMat.uniforms.uFade.value = 0.8 + 0.2 * Math.sin(t * 9) + state.pulse * 0.3
      spireTips.forEach((s, i) => s.material.color.setRGB(0.5, 1.6, 2.0).multiplyScalar((0.4 + 0.8 * state.city + 0.4 * state.pulse * (i % 2)) * alive))

      // 核心：缓慢自转，holo 越强越亮
      core.rotation.y = t * 0.2
      core.children[1].rotation.z = t * 0.5
      core.children[2].rotation.z = -t * 0.35
      core.children[0].material.emissiveIntensity = (0.8 + 1.6 * state.holo + state.pulse * 0.5) * alive + state.finaleFlash * 2
      core.position.y = CITY_Y + 460 + Math.sin(t * 0.5) * 12

      beams.forEach((b, i) => (b.material.uniforms.uInt.value = (0.4 + 0.6 * state.beams + 0.25 * Math.sin(t * 0.4 + i * 1.7)) * (1 - 0.6 * hush)))
      const phase = (Math.PI * state.beat) / 2
      rig.key.intensity = rig.base.key * state.stage
      rig.spots.forEach((s, i) => {
        s.intensity = rig.base.spots[i] * state.beams * (0.6 + 0.6 * state.pulse) * (1 - 0.9 * hush) * alive
        s.target.position.set(Math.sin(phase + i * 2) * 14 * state.swing, 0, 0)
      })
      rig.rim.intensity = rig.base.rim * (1 - 0.4 * hush)
      rig.points.forEach((p, i) => (p.intensity = rig.base.points[i] * (0.75 + 0.25 * Math.sin(t * 9 + i * 2))))

      // 鱼群
      for (let i = 0; i < fishData.length; i++) {
        const f = fishData[i]
        fishPos(f, t, v)
        fishPos(f, t + 0.05, v2)
        v2.sub(v).normalize()
        q.setFromUnitVectors(X, v2)
        sc3.setScalar(f.size)
        m4.compose(v, q, sc3)
        fish.setMatrixAt(i, m4)
      }
      fish.instanceMatrix.needsUpdate = true

      // 水母：一张一合往上漂，到顶再从下面出现
      const jp = jgGeo.attributes.position.array
      for (let i = 0; i < JN; i++) {
        const j = jellyData[i]
        const pulse = Math.sin(t * 1.6 + j.ph)
        const y = j.p.y + ((t * j.rise + j.ph * 30) % j.range) - j.range * 0.5
        v.set(j.p.x + Math.sin(t * 0.2 + j.ph) * j.s * 2, y, j.p.z)
        sc3.set(j.s * (1 + 0.1 * pulse), j.s * (1 - 0.15 * pulse), j.s * (1 + 0.1 * pulse))
        q.setFromAxisAngle(X, Math.sin(t * 0.3 + j.ph) * 0.2)
        m4.compose(v, q, sc3)
        jellies.setMatrixAt(i, m4)
        jp[i * 3] = v.x
        jp[i * 3 + 1] = v.y + j.s * 0.4
        jp[i * 3 + 2] = v.z
      }
      jellies.instanceMatrix.needsUpdate = true
      jgGeo.attributes.position.needsUpdate = true
      jellyMat.opacity = 0.35 + 0.3 * state.sea
      jgMat.uniforms.uFade.value = 0.5 + 0.5 * state.sea + state.pulse * 0.2

      whales.update(state)
      particles.update(state)
    },
    setPixelRatio(pr) {
      particles.setPixelRatio(pr)
    },
  }
}
