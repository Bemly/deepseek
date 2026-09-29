import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, hash1, WATER_Y, glowPointMaterial, canvasTexture } from './util.js'
import { FIREWORK_LIFE } from '../state.js'

// 会动的小东西：河灯/天灯、环境粒子（泡泡/花瓣/萤火）、光尘、放飞的符号、工具调用光束、终段烟花。
// 每个主题各建一份，用配置决定长相；全部由歌曲时间决定位置（没有累积状态），可以随意拖进度。

const TRAIL = 220
const MAX_PACKETS = 16

function lanternGeometry(kind) {
  const L = (pts, segs = 10) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs)
  if (kind === 'sky') return L([[0, 0], [1.3, 0], [1.9, 2.5], [2.0, 4.2], [1.4, 5.2], [0, 5.3]], 10) // 孔明灯
  if (kind === 'lotus') {
    // 莲花灯：浅碗 + 两层花瓣
    const parts = [L([[0, 0], [1.0, 0], [1.3, 0.5], [0.2, 0.6], [0, 0.6]], 8)]
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 7; i++) {
        const g = new THREE.SphereGeometry(0.55, 5, 3).scale(0.55, 1.25, 0.28)
        g.rotateX(layer ? -0.35 : -0.6)
        g.translate(0, 0.9, layer ? 0.55 : 0.95)
        g.rotateY((i / 7) * Math.PI * 2 + layer * 0.45)
        parts.push(g)
      }
    }
    for (const g of parts) g.deleteAttribute('uv')
    return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))
  }
  return L([[0, 0], [0.9, 0], [1.1, 0.4], [1.25, 1.4], [1.1, 2.4], [0.7, 2.8], [0.5, 2.8], [0, 2.8]], 10)
}

const DEFAULT_GLYPHS = { chars: ['{', '}', '[', ']', ':', '"', '✓', '♪'], font: '700 96px "JetBrains Mono", Consolas, Menlo, monospace', colors: [[0.5, 0.9, 1.0], [1.0, 0.6, 0.85], [1.0, 0.85, 0.55]] }
const DEFAULT_PALETTE = [[0.35, 0.8, 1.0], [1.0, 0.35, 0.75], [1.0, 0.8, 0.4], [0.7, 0.5, 1.0], [0.6, 1.0, 0.85]]

export function createParticles({
  endpoints = [],
  emitter = new THREE.Vector3(0, 60, -37),
  flash = null,
  lanterns: lanternCfg = {},
  ambient: ambientCfg = {},
  dust: dustCfg = {},
  glyphs: glyphCfg = DEFAULT_GLYPHS,
  packets: packetCfg = {},
  fireworks: fwCfg = {},
  seed = 99,
} = {}) {
  const root = new THREE.Group()
  root.name = 'particles'
  const R = rng(seed)

  // ---------- 河灯 / 天灯 ----------
  const lMode = lanternCfg.mode ?? 'water'
  const LANTERNS = lMode === 'none' ? 0 : lanternCfg.count ?? 260
  const lColors = lanternCfg.colors ?? [[1.0, 0.55, 0.22, 0.72], [0.3, 0.75, 1.0, 0.15], [1.0, 0.35, 0.65, 0.13]]
  const lFloor = lanternCfg.floorY ?? WATER_Y
  const [rMin, rMax] = lanternCfg.radius ?? [75, 1775]
  const lScale = lanternCfg.scale ?? 1
  const lanternData = []
  for (let i = 0; i < LANTERNS; i++) {
    let a, r, x, z
    do {
      a = R() * Math.PI * 2
      r = rMin + Math.pow(R(), 1.6) * (rMax - rMin)
      x = Math.sin(a) * r
      z = Math.cos(a) * r - 12
    } while (Math.abs(x) < 16 && z > 35 && z < 210)
    let k = R(), color = lColors[0]
    for (const c of lColors) {
      if (k < c[3]) { color = c; break }
      k -= c[3]
    }
    lanternData.push({ a, r, seed: R() * 100, color: color.slice(0, 3), s: (0.8 + R() * 0.6) * lScale, life: R(), speed: 0.6 + R() * 0.8 })
  }
  const lanternGeo = lanternGeometry(lanternCfg.kind ?? (lMode === 'air' ? 'sky' : 'paper'))
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.9, side: THREE.DoubleSide })
  const lanterns = new THREE.InstancedMesh(lanternGeo, lanternMat, Math.max(1, LANTERNS))
  lanterns.visible = LANTERNS > 0
  lanternData.forEach((d, i) => lanterns.setColorAt(i, new THREE.Color(d.color[0], d.color[1], d.color[2])))
  lanternMat.onBeforeCompile = (sh) => {
    // 让实例颜色驱动自发光
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor * 2.2;\n#endif')
  }
  lanterns.frustumCulled = false
  root.add(lanterns)
  const lhGeo = new THREE.BufferGeometry()
  const lhPos = new Float32Array(LANTERNS * 3)
  lhGeo.setAttribute('position', new THREE.BufferAttribute(lhPos, 3))
  lhGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(lanternData.map((d) => 9 * d.s), 1))
  lhGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(lanternData.flatMap((d) => d.color.map((c) => c * 0.9)), 3))
  const lhAlpha = new Float32Array(LANTERNS).fill(0.7)
  lhGeo.setAttribute('aAlpha', new THREE.BufferAttribute(lhAlpha, 1))
  const lhMat = glowPointMaterial({ size: 1, maxSize: 40 })
  const lanternHalo = new THREE.Points(lhGeo, lhMat)
  lanternHalo.frustumCulled = false
  root.add(lanternHalo)

  // ---------- 环境粒子：泡泡 / 花瓣 / 萤火 ----------
  const kind = ambientCfg.kind ?? 'bubble'
  const KINDS = { bubble: 0, petal: 1, sparkle: 2 }
  const AMB = ambientCfg.count ?? 280
  const ambFloor = ambientCfg.floorY ?? WATER_Y
  const ambH = ambientCfg.height ?? 75
  const [aMin, aMax] = ambientCfg.radius ?? [20, 95]
  const bGeo = new THREE.BufferGeometry()
  const bSeed = new Float32Array(AMB * 4)
  for (let i = 0; i < AMB; i++) {
    const a = R() * Math.PI * 2, r = aMin + R() * (aMax - aMin)
    bSeed.set([Math.sin(a) * r, Math.cos(a) * r - 12, R(), 0.4 + R() * 1.2], i * 4)
  }
  bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AMB * 3), 3))
  bGeo.setAttribute('aSeed', new THREE.BufferAttribute(bSeed, 4))
  const bMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: kind === 'petal' ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uAmt: { value: 1 }, uPixelRatio: { value: 1 },
      uCol: { value: new THREE.Color(...(ambientCfg.color ?? [0.55, 0.85, 1.0])) },
      uCol2: { value: new THREE.Color(...(ambientCfg.color2 ?? ambientCfg.color ?? [0.55, 0.85, 1.0])) },
      uSize: { value: ambientCfg.size ?? 1 },
    },
    defines: { KIND: KINDS[kind] ?? 0 },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio, uSize;
      varying float vA;
      varying float vRot;
      varying float vMix;
      void main() {
        vec3 p;
        vMix = fract(aSeed.z * 7.3);
        vRot = 0.0;
        #if KIND == 0
          float life = fract(aSeed.z + uTime * 0.035 * aSeed.w);
          p = vec3(aSeed.x + sin(uTime * 1.7 + aSeed.z * 30.0) * 1.2, ${ambFloor.toFixed(1)} + life * ${ambH.toFixed(1)}, aSeed.y + cos(uTime * 1.3 + aSeed.z * 20.0) * 1.2);
          vA = smoothstep(0.0, 0.08, life) * smoothstep(1.0, 0.7, life);
        #elif KIND == 1
          // 花瓣：从高处飘落，随风往 +X 漂，一边翻转
          float life = fract(aSeed.z + uTime * 0.03 * (0.6 + aSeed.w * 0.5));
          float y = ${(ambFloor + ambH).toFixed(1)} - life * ${ambH.toFixed(1)};
          p = vec3(aSeed.x + life * 40.0 + sin(uTime * 0.9 + aSeed.z * 30.0) * 4.0, y, aSeed.y + cos(uTime * 0.7 + aSeed.z * 20.0) * 3.0);
          vA = smoothstep(0.0, 0.05, life) * smoothstep(1.0, 0.9, life);
          vRot = uTime * (1.0 + aSeed.w) + aSeed.z * 20.0;
        #else
          // 萤火：在一块空间里慢慢游走、明灭
          p = vec3(aSeed.x, ${ambFloor.toFixed(1)} + fract(aSeed.z * 13.1) * ${ambH.toFixed(1)}, aSeed.y)
            + vec3(sin(uTime * 0.31 + aSeed.z * 40.0) * 6.0, sin(uTime * 0.23 + aSeed.z * 17.0) * 3.0, cos(uTime * 0.27 + aSeed.z * 23.0) * 6.0);
          vA = pow(0.5 + 0.5 * sin(uTime * (1.2 + aSeed.w * 1.5) + aSeed.z * 60.0), 3.0);
        #endif
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(34.0, (0.6 + aSeed.w) * 600.0 * uSize / -mv.z) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmt;
      uniform vec3 uCol, uCol2;
      varying float vA;
      varying float vRot;
      varying float vMix;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        #if KIND == 0
          float r = length(d) * 2.0;
          float ring = smoothstep(0.7, 0.92, r) * smoothstep(1.0, 0.92, r);
          float hi = smoothstep(0.25, 0.0, length(d - vec2(-0.18, -0.18)));
          float a = (ring * 0.9 + hi * 0.8 + 0.06 * step(r, 1.0)) * vA * uAmt;
          gl_FragColor = vec4(uCol * a, 1.0);
        #elif KIND == 1
          float c = cos(vRot), s = sin(vRot * 0.7);
          vec2 q = mat2(c, -s, s, c) * d;
          q.x *= 1.0 + 0.6 * abs(sin(vRot * 0.5)); // 翻转时变窄
          float body = smoothstep(0.42, 0.36, length(q * vec2(1.7, 1.0)));
          float notch = smoothstep(0.07, 0.12, length(q - vec2(0.0, 0.42)));
          float a = body * notch * vA * uAmt;
          if (a < 0.02) discard;
          vec3 col = mix(uCol, uCol2, vMix) * (0.8 + 0.4 * (0.5 - q.y));
          gl_FragColor = vec4(col, a * 0.9);
        #else
          float r = length(d) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          a = a * a * vA * uAmt;
          gl_FragColor = vec4(mix(uCol, uCol2, vMix) * a * 1.6, 1.0);
        #endif
      }
    `,
  })
  const bubbles = new THREE.Points(bGeo, bMat)
  bubbles.frustumCulled = false
  bubbles.visible = AMB > 0
  root.add(bubbles)

  // ---------- 光尘 ----------
  const DUST = 600
  const dGeo = new THREE.BufferGeometry()
  const dSeed = new Float32Array(DUST * 4)
  for (let i = 0; i < DUST; i++) dSeed.set([(R() - 0.5) * 120, R() * 70, (R() - 0.5) * 110 - 5, R()], i * 4)
  dGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3))
  dGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 4))
  const dMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uAmt: { value: 1 }, uPixelRatio: { value: 1 },
      uDA: { value: new THREE.Color(...(dustCfg.a ?? [1.0, 0.8, 0.55])) },
      uDB: { value: new THREE.Color(...(dustCfg.b ?? [0.4, 0.8, 1.0])) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio;
      uniform vec3 uDA, uDB;
      varying float vA;
      varying vec3 vC;
      void main() {
        vec3 p = aSeed.xyz + vec3(sin(uTime * 0.21 + aSeed.w * 40.0) * 3.0, sin(uTime * 0.13 + aSeed.w * 17.0) * 2.0, cos(uTime * 0.17 + aSeed.w * 23.0) * 3.0);
        vA = 0.5 + 0.5 * sin(uTime * (1.0 + aSeed.w * 2.0) + aSeed.w * 60.0);
        vC = aSeed.w > 0.7 ? uDB : uDA;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(10.0, 90.0 / -mv.z) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmt;
      varying float vA;
      varying vec3 vC;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r) * vA * uAmt;
        gl_FragColor = vec4(vC * a * 0.8, 1.0);
      }
    `,
  })
  const dust = new THREE.Points(dGeo, dMat)
  dust.frustumCulled = false
  root.add(dust)

  // ---------- 放飞的 JSON 符号 ----------
  const GLYPHS = glyphCfg.chars
  const gc = glyphCfg.colors ?? DEFAULT_GLYPHS.colors
  const atlas = canvasTexture(1024, 128, (g) => {
    g.clearRect(0, 0, 1024, 128)
    g.font = glyphCfg.font ?? DEFAULT_GLYPHS.font
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#ffffff'
    GLYPHS.forEach((c, i) => g.fillText(c, i * 128 + 64, 68))
  }, { mipmaps: true })
  const GL = 120
  const gGeo = new THREE.BufferGeometry()
  const gSeed = new Float32Array(GL * 4)
  for (let i = 0; i < GL; i++) gSeed.set([R() * Math.PI * 2, R(), Math.floor(R() * GLYPHS.length), 0.6 + R() * 0.8], i * 4)
  gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GL * 3), 3))
  gGeo.setAttribute('aSeed', new THREE.BufferAttribute(gSeed, 4))
  const gMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uAmt: { value: 0 }, uAtlas: { value: atlas }, uPixelRatio: { value: 1 },
      uG0: { value: new THREE.Vector3(...gc[0]) }, uG1: { value: new THREE.Vector3(...gc[1]) }, uG2: { value: new THREE.Vector3(...gc[2]) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio;
      uniform vec3 uG0, uG1, uG2;
      varying float vA;
      varying float vG;
      varying vec3 vC;
      void main() {
        float life = fract(aSeed.y + uTime * 0.045 * aSeed.w);
        float a = aSeed.x + life * 5.0;
        float r = 30.0 + life * life * 260.0;
        vec3 p = vec3(cos(a) * r, 32.0 + life * 420.0, sin(a) * r - 12.0);
        vA = smoothstep(0.0, 0.06, life) * smoothstep(1.0, 0.6, life);
        vG = aSeed.z;
        vC = mod(aSeed.z, 3.0) < 1.0 ? uG0 : mod(aSeed.z, 3.0) < 2.0 ? uG1 : uG2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(90.0, (6.0 + aSeed.w * 6.0) * 600.0 / -mv.z) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uAmt;
      varying float vA;
      varying float vG;
      varying vec3 vC;
      void main() {
        vec2 uv = vec2((vG + gl_PointCoord.x) / 8.0, 1.0 - gl_PointCoord.y);
        float m = texture2D(uAtlas, uv).a;
        float a = m * vA * uAmt;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vC * a * 2.0, 1.0);
      }
    `,
  })
  const glyphs = new THREE.Points(gGeo, gMat)
  glyphs.frustumCulled = false
  root.add(glyphs)

  // ---------- 工具调用光束 ----------
  const N = MAX_PACKETS * (TRAIL + 1)
  const pGeo = new THREE.BufferGeometry()
  const pPos = new Float32Array(N * 3)
  const pSize = new Float32Array(N)
  const pCol = new Float32Array(N * 3)
  const pAlpha = new Float32Array(N)
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1))
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3))
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1))
  const pMat = glowPointMaterial({ size: 1, maxSize: 160 })
  const packets = new THREE.Points(pGeo, pMat)
  packets.frustumCulled = false
  root.add(packets)
  const S = new THREE.Vector3(), C = new THREE.Vector3(), E = new THREE.Vector3(), P = new THREE.Vector3()
  const bez = (u, out) => {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u
    return out.set(S.x * a + C.x * b + E.x * c, S.y * a + C.y * b + E.y * c, S.z * a + C.z * b + E.z * c)
  }

  // ---------- 烟花 ----------
  const FW_POOL = 10
  const FW_N = 380
  const FW_TRAIL = 5
  const fireworks = []
  const PALETTE = fwCfg.palette ?? DEFAULT_PALETTE
  const fwZone = fwCfg.zone ?? ((h) => [-3800 + h(1) * 7600, 1500 + h(3) * 1100, -5600 + h(2) * 1400])
  for (let k = 0; k < FW_POOL; k++) {
    const g = new THREE.BufferGeometry()
    const dir = new Float32Array(FW_N * FW_TRAIL * 4)
    const lag = new Float32Array(FW_N * FW_TRAIL)
    for (let i = 0; i < FW_N; i++) {
      const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u)
      const w = 0.75 + R() * 0.25
      // 每颗火星带几个"过去的自己"，拖出尾迹
      for (let k = 0; k < FW_TRAIL; k++) {
        dir.set([s * Math.cos(a), u, s * Math.sin(a), w], (i * FW_TRAIL + k) * 4)
        lag[i * FW_TRAIL + k] = k
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FW_N * FW_TRAIL * 3), 3))
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4))
    g.setAttribute('aLag', new THREE.BufferAttribute(lag, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uO: { value: new THREE.Vector3() }, uAge: { value: -1 }, uC1: { value: new THREE.Vector3() }, uC2: { value: new THREE.Vector3() }, uR: { value: 600 }, uPixelRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 aDir;
        attribute float aLag;
        uniform vec3 uO;
        uniform float uAge, uR, uPixelRatio;
        varying vec3 vC;
        varying float vA;
        uniform vec3 uC1, uC2;
        void main() {
          float rise = 0.7;
          vec3 p;
          vA = 0.0;
          if (uAge < rise) {
            // 升空：所有粒子挤在一起，只看到一颗火星往上窜
            float k = uAge / rise;
            p = uO - vec3(0.0, (1.0 - k) * (1.0 - k) * uO.y * 0.8, 0.0);
            vA = gl_VertexID < ${FW_TRAIL} ? 1.0 - aLag / ${FW_TRAIL}.0 : 0.0;
            p.y -= aLag * 22.0;
            vC = vec3(1.0, 0.8, 0.5);
          } else {
            float a = max(0.0, uAge - rise - aLag * 0.07);
            p = uO + aDir.xyz * uR * aDir.w * (1.0 - exp(-a * 3.2)) - vec3(0.0, 60.0 * a * a, 0.0);
            vA = pow(max(0.0, 1.0 - a / ${(FIREWORK_LIFE - 0.7).toFixed(2)}), 1.4) * (0.7 + 0.3 * sin(a * 30.0 + aDir.w * 50.0));
            vC = mix(uC1, uC2, step(0.6, fract(aDir.w * 13.0)));
            if (a < 0.1) vC += vec3(1.2);
            vA *= 1.0 - aLag / ${FW_TRAIL}.0;
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(95.0 * 600.0 / -mv.z * (1.0 - aLag * 0.12), 2.0, 48.0) * uPixelRatio * step(0.001, vA);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          gl_FragColor = vec4(vC * a * a * vA * 2.4, 1.0);
        }
      `,
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    pts.visible = false
    root.add(pts)
    fireworks.push({ pts, m })
  }

  const allShaderMats = [lhMat, bMat, dMat, gMat, pMat, ...fireworks.map((f) => f.m)]
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const sc = new THREE.Vector3()

  return {
    object: root,
    setPixelRatio(pr) {
      for (const m of allShaderMats) m.uniforms.uPixelRatio.value = pr
    },
    update(state) {
      const t = state.t

      // 河灯（漂在水面）/ 天灯（慢慢升空）
      const glow = (0.55 + 0.45 * Math.min(1, state.sea)) * (1 - 0.5 * state.hush) * (lanternCfg.glow ?? 1)
      lanternMat.emissiveIntensity = glow
      const airH = lanternCfg.height ?? 1600
      lanternData.forEach((d, i) => {
        let x, y, z, fade = 1
        if (lMode === 'air') {
          const life = (d.life + t * 0.006 * d.speed) % 1
          const a = d.a + life * 0.8
          const r = d.r * (0.6 + life * 0.6)
          x = Math.sin(a) * r
          z = Math.cos(a) * r - 12
          y = lFloor + life * airH + Math.sin(t * 0.7 + d.seed) * 2
          fade = Math.min(1, life * 12) * Math.min(1, (1 - life) * 4)
        } else {
          const a = d.a + t * 0.004 * (0.5 + hash1(i))
          x = Math.sin(a) * d.r
          z = Math.cos(a) * d.r - 12
          y = lFloor + 0.2 + Math.sin(t * 0.9 + d.seed) * 0.35
        }
        q.setFromAxisAngle(sc.set(Math.sin(d.seed), 0, Math.cos(d.seed)), Math.sin(t * 0.8 + d.seed) * 0.08)
        m4.compose(P.set(x, y, z), q, sc.setScalar(d.s * (0.2 + 0.8 * fade)))
        lanterns.setMatrixAt(i, m4)
        lhPos[i * 3] = x
        lhPos[i * 3 + 1] = y + 1.6 * d.s
        lhPos[i * 3 + 2] = z
        lhAlpha[i] = 0.7 * fade
      })
      if (LANTERNS) {
        lanterns.instanceMatrix.needsUpdate = true
        lhGeo.attributes.position.needsUpdate = true
        lhGeo.attributes.aAlpha.needsUpdate = true
      }
      lhMat.uniforms.uFade.value = glow

      bMat.uniforms.uTime.value = t
      bMat.uniforms.uAmt.value = (ambientCfg.base ?? 0.25) + (ambientCfg.gain ?? 0.6) * state.sea
      dMat.uniforms.uTime.value = t
      dMat.uniforms.uAmt.value = 0.4 + 0.6 * state.beams
      gMat.uniforms.uTime.value = t
      gMat.uniforms.uAmt.value = state.glyphs

      // 工具调用光束
      pAlpha.fill(0)
      flash?.beginFlash()
      const nEP = endpoints.length
      const pc = packetCfg.colors ?? [[0.45, 0.9, 1.0], [1.0, 0.45, 0.85]]
      if (nEP) state.packets.slice(-MAX_PACKETS).forEach((pk, slot) => {
        const ep = endpoints[pk.target % nEP]
        S.copy(emitter)
        E.copy(ep.pos)
        const dist = S.distanceTo(E)
        C.copy(S).lerp(E, 0.45)
        C.y += dist * (packetCfg.arc ?? 0.28) + 300
        const col = pk.id % 3 === 2 ? pc[1] : pc[0]
        const base = slot * (TRAIL + 1)
        if (pk.hit < 0) {
          const u = pk.p < 0.5 ? 4 * pk.p * pk.p * pk.p : 1 - Math.pow(-2 * pk.p + 2, 3) / 2
          for (let k = 0; k <= TRAIL; k++) {
            const uu = Math.max(0, u - k * 0.0018)
            bez(uu, P)
            const i = base + k
            pPos[i * 3] = P.x
            pPos[i * 3 + 1] = P.y
            pPos[i * 3 + 2] = P.z
            const head = k === 0
            const fall = 1 - k / (TRAIL + 1)
            pSize[i] = (head ? 34 : 18 * (0.3 + 0.7 * fall)) * (0.25 + uu * 3.2)
            const f = head ? 2.4 : 1.5
            pCol[i * 3] = col[0] * f + (head ? 0.8 : 0)
            pCol[i * 3 + 1] = col[1] * f + (head ? 0.8 : 0)
            pCol[i * 3 + 2] = col[2] * f + (head ? 0.8 : 0)
            pAlpha[i] = uu <= 0 && k > 0 ? 0 : Math.pow(fall, 1.6)
          }
          // 发射瞬间：招牌顶上闪一下
          if (pk.p < 0.25) {
            const i = base + TRAIL
            pPos[i * 3] = S.x
            pPos[i * 3 + 1] = S.y
            pPos[i * 3 + 2] = S.z
            pSize[i] = 26
            pCol[i * 3] = col[0] * 3
            pCol[i * 3 + 1] = col[1] * 3
            pCol[i * 3 + 2] = col[2] * 3
            pAlpha[i] = 1 - pk.p / 0.25
          }
        } else {
          // 命中：落点一团闪光，楼冠跟着亮
          const i = base
          pPos[i * 3] = E.x
          pPos[i * 3 + 1] = E.y
          pPos[i * 3 + 2] = E.z
          pSize[i] = 160 + pk.hit * 700
          pCol[i * 3] = col[0] * 2
          pCol[i * 3 + 1] = col[1] * 2
          pCol[i * 3 + 2] = col[2] * 2
          pAlpha[i] = Math.exp(-pk.hit * 3)
          flash?.addFlash(ep, Math.exp(-pk.hit * 1.8))
        }
      })
      pGeo.attributes.position.needsUpdate = true
      pGeo.attributes.aSize.needsUpdate = true
      pGeo.attributes.aColor.needsUpdate = true
      pGeo.attributes.aAlpha.needsUpdate = true

      // 烟花
      fireworks.forEach((f) => (f.pts.visible = false))
      state.fireworks.slice(-FW_POOL).forEach((fw, i) => {
        const f = fireworks[i]
        const h = (n) => hash1(fw.seed * 13.7 + n)
        f.m.uniforms.uO.value.set(...fwZone(h))
        f.m.uniforms.uAge.value = fw.age
        f.m.uniforms.uR.value = 560 + h(4) * 480
        const c1 = PALETTE[Math.floor(h(5) * PALETTE.length)], c2 = PALETTE[Math.floor(h(6) * PALETTE.length)]
        f.m.uniforms.uC1.value.set(...c1)
        f.m.uniforms.uC2.value.set(...c2)
        f.pts.visible = true
      })
    },
  }
}
