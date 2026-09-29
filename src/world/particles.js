import * as THREE from 'three'
import { rng, hash1, WATER_Y, glowPointMaterial, canvasTexture } from './util.js'
import { coastZ } from './city.js'
import { FIREWORK_LIFE } from '../state.js'

// 会动的小东西：水面河灯、泡泡、空气里的光尘、放飞的 JSON 符号、工具调用光束、终段烟花。
// 全部由歌曲时间决定位置（没有累积状态），可以随意拖进度。

const TRAIL = 220
const MAX_PACKETS = 16

export function createParticles({ endpoints, emitter }) {
  const root = new THREE.Group()
  root.name = 'particles'
  const R = rng(99)

  // ---------- 水面河灯 ----------
  const LANTERNS = 260
  const lanternData = []
  for (let i = 0; i < LANTERNS; i++) {
    let a, r, x, z
    do {
      a = R() * Math.PI * 2
      r = 75 + Math.pow(R(), 1.6) * 1700
      x = Math.sin(a) * r
      z = Math.cos(a) * r - 12
    } while (Math.abs(x) < 16 && z > 35 && z < 210)
    const k = R()
    lanternData.push({ a, r, seed: R() * 100, color: k < 0.72 ? [1.0, 0.55, 0.22] : k < 0.87 ? [0.3, 0.75, 1.0] : [1.0, 0.35, 0.65], s: 0.8 + R() * 0.6 })
  }
  const lanternGeo = new THREE.LatheGeometry(
    [[0, 0], [0.9, 0], [1.1, 0.4], [1.25, 1.4], [1.1, 2.4], [0.7, 2.8], [0.5, 2.8], [0, 2.8]].map(([x, y]) => new THREE.Vector2(x, y)),
    10,
  )
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.9 })
  const lanterns = new THREE.InstancedMesh(lanternGeo, lanternMat, LANTERNS)
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
  lhGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(lanternData.map(() => 0.7), 1))
  const lhMat = glowPointMaterial({ size: 1, maxSize: 40 })
  const lanternHalo = new THREE.Points(lhGeo, lhMat)
  lanternHalo.frustumCulled = false
  root.add(lanternHalo)

  // ---------- 泡泡 ----------
  const BUBBLES = 280
  const bGeo = new THREE.BufferGeometry()
  const bSeed = new Float32Array(BUBBLES * 4)
  for (let i = 0; i < BUBBLES; i++) {
    const a = R() * Math.PI * 2, r = 20 + R() * 75
    bSeed.set([Math.sin(a) * r, Math.cos(a) * r - 12, R(), 0.4 + R() * 1.2], i * 4)
  }
  bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUBBLES * 3), 3))
  bGeo.setAttribute('aSeed', new THREE.BufferAttribute(bSeed, 4))
  const bMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 1 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio;
      varying float vA;
      void main() {
        float life = fract(aSeed.z + uTime * 0.035 * aSeed.w);
        vec3 p = vec3(aSeed.x + sin(uTime * 1.7 + aSeed.z * 30.0) * 1.2, ${WATER_Y.toFixed(1)} + life * 75.0, aSeed.y + cos(uTime * 1.3 + aSeed.z * 20.0) * 1.2);
        vA = smoothstep(0.0, 0.08, life) * smoothstep(1.0, 0.7, life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(34.0, (0.6 + aSeed.w) * 600.0 / -mv.z) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmt;
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        float ring = smoothstep(0.7, 0.92, r) * smoothstep(1.0, 0.92, r);
        float hi = smoothstep(0.25, 0.0, length(d - vec2(-0.18, -0.18)));
        float a = (ring * 0.9 + hi * 0.8 + 0.06 * step(r, 1.0)) * vA * uAmt;
        gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * a, 1.0);
      }
    `,
  })
  const bubbles = new THREE.Points(bGeo, bMat)
  bubbles.frustumCulled = false
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
    uniforms: { uTime: { value: 0 }, uAmt: { value: 1 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio;
      varying float vA;
      varying vec3 vC;
      void main() {
        vec3 p = aSeed.xyz + vec3(sin(uTime * 0.21 + aSeed.w * 40.0) * 3.0, sin(uTime * 0.13 + aSeed.w * 17.0) * 2.0, cos(uTime * 0.17 + aSeed.w * 23.0) * 3.0);
        vA = 0.5 + 0.5 * sin(uTime * (1.0 + aSeed.w * 2.0) + aSeed.w * 60.0);
        vC = aSeed.w > 0.7 ? vec3(0.4, 0.8, 1.0) : vec3(1.0, 0.8, 0.55);
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
  const GLYPHS = ['{', '}', '[', ']', ':', '"', '✓', '♪']
  const atlas = canvasTexture(1024, 128, (g) => {
    g.clearRect(0, 0, 1024, 128)
    g.font = '700 96px "JetBrains Mono", Consolas, Menlo, monospace'
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
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uAtlas: { value: atlas }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio;
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
        vC = mod(aSeed.z, 3.0) < 1.0 ? vec3(0.5, 0.9, 1.0) : mod(aSeed.z, 3.0) < 2.0 ? vec3(1.0, 0.6, 0.85) : vec3(1.0, 0.85, 0.55);
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
  const PALETTE = [[0.35, 0.8, 1.0], [1.0, 0.35, 0.75], [1.0, 0.8, 0.4], [0.7, 0.5, 1.0], [0.6, 1.0, 0.85]]
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
    update(state, city) {
      const t = state.t

      // 河灯
      const glow = (0.55 + 0.45 * Math.min(1, state.sea)) * (1 - 0.5 * state.hush)
      lanternMat.emissiveIntensity = glow
      lanternData.forEach((d, i) => {
        const a = d.a + t * 0.004 * (0.5 + hash1(i))
        const x = Math.sin(a) * d.r
        const z = Math.cos(a) * d.r - 12
        const y = WATER_Y + 0.2 + Math.sin(t * 0.9 + d.seed) * 0.35
        q.setFromAxisAngle(sc.set(Math.sin(d.seed), 0, Math.cos(d.seed)), Math.sin(t * 0.8 + d.seed) * 0.08)
        m4.compose(P.set(x, y, z), q, sc.setScalar(d.s))
        lanterns.setMatrixAt(i, m4)
        lhPos[i * 3] = x
        lhPos[i * 3 + 1] = y + 1.6 * d.s
        lhPos[i * 3 + 2] = z
      })
      lanterns.instanceMatrix.needsUpdate = true
      lhGeo.attributes.position.needsUpdate = true
      lhMat.uniforms.uFade.value = glow

      bMat.uniforms.uTime.value = t
      bMat.uniforms.uAmt.value = 0.25 + 0.6 * state.sea
      dMat.uniforms.uTime.value = t
      dMat.uniforms.uAmt.value = 0.4 + 0.6 * state.beams
      gMat.uniforms.uTime.value = t
      gMat.uniforms.uAmt.value = state.glyphs

      // 工具调用光束
      pAlpha.fill(0)
      city.beginFlash()
      const nEP = endpoints.length
      state.packets.slice(-MAX_PACKETS).forEach((pk, slot) => {
        const ep = endpoints[pk.target % nEP]
        S.copy(emitter)
        E.copy(ep.pos)
        const dist = S.distanceTo(E)
        C.copy(S).lerp(E, 0.45)
        C.y += dist * 0.28 + 300
        const pink = pk.id % 3 === 2
        const col = pink ? [1.0, 0.45, 0.85] : [0.45, 0.9, 1.0]
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
          city.addFlash(ep, Math.exp(-pk.hit * 1.8))
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
        const x = -3800 + h(1) * 7600
        // 在城市前面的海湾上空炸开，水里还能看到倒影
        const z = coastZ(x) + 700 + h(2) * 1400
        f.m.uniforms.uO.value.set(x, 1500 + h(3) * 1100, z)
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
