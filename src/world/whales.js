import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLSL_NOISE, WATER_Y } from './util.js'

// 鲸鱼：程序化几何（身体车削 + 尾鳍 + 长胸鳍 + 小背鳍），沿 +X 从尾(0)到头(1)，长度归一化为 1。
// 天空鲸：半透明、星星斑点（呼应大肥鱼尾巴上的星星）、边缘发光，绕着城市上空慢慢游。
// 跃海鲸：终段 "So let me go" 之后从海湾里跃出。

function bodyRadius(s) {
  if (s < 0.62) {
    const k = s / 0.62
    return 0.012 + (0.13 - 0.012) * (1 - Math.pow(1 - k, 2.2))
  }
  const k = (s - 0.62) / 0.38
  return 0.13 * Math.sqrt(Math.max(0, 1 - Math.pow(k, 2.4)))
}

function partAttr(geo, part) {
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count).fill(part), 1))
  return geo
}

function finGeometry(shapeFn, depth) {
  const shape = new THREE.Shape()
  shapeFn(shape)
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 2, curveSegments: 16 })
  g.translate(0, 0, -depth / 2)
  g.deleteAttribute('uv')
  return g.index ? g.toNonIndexed() : g
}

export function makeWhaleGeometry({ M = 64, K = 28 } = {}) {
  // 身体
  const pos = [], idx = []
  for (let i = 0; i <= M; i++) {
    const s = i / M
    const r = bodyRadius(s)
    const cy = 0.018 * Math.sin(Math.PI * s) - 0.01 * Math.max(0, s - 0.8) * 5
    for (let j = 0; j <= K; j++) {
      const th = (j / K) * Math.PI * 2
      const c = Math.cos(th), sn = Math.sin(th)
      const y = r * c * (c > 0 ? 0.88 : 0.72) + cy
      const z = r * sn
      pos.push(s, y, z)
    }
  }
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < K; j++) {
      const a = i * (K + 1) + j, b = a + K + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  let body = new THREE.BufferGeometry()
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  body.setIndex(idx)
  body.computeVertexNormals()
  body = body.toNonIndexed()
  partAttr(body, 0)

  // 尾鳍（水平）
  const fluke = finGeometry((sh) => {
    sh.moveTo(0.03, 0)
    sh.bezierCurveTo(-0.02, 0.05, -0.08, 0.12, -0.14, 0.22)
    sh.bezierCurveTo(-0.11, 0.2, -0.08, 0.12, -0.085, 0.05)
    sh.quadraticCurveTo(-0.08, 0.0, -0.095, 0)
    sh.quadraticCurveTo(-0.08, 0.0, -0.085, -0.05)
    sh.bezierCurveTo(-0.08, -0.12, -0.11, -0.2, -0.14, -0.22)
    sh.bezierCurveTo(-0.08, -0.12, -0.02, -0.05, 0.03, 0)
  }, 0.01)
  fluke.rotateX(Math.PI / 2)
  fluke.computeVertexNormals()
  partAttr(fluke, 1)

  // 长胸鳍（座头鲸那种）
  const pecShape = (sh) => {
    sh.moveTo(0, 0)
    sh.bezierCurveTo(0.03, 0.02, 0.12, 0.05, 0.3, 0.02)
    sh.bezierCurveTo(0.14, -0.01, 0.05, -0.03, 0, -0.02)
    sh.lineTo(0, 0)
  }
  const pecs = []
  for (const side of [1, -1]) {
    const g = finGeometry(pecShape, 0.008)
    // 形状在 XY，长度沿 +X；转到向后向下伸出
    g.rotateX(Math.PI / 2)
    g.rotateY(side * 2.2)
    g.rotateZ(-0.35)
    g.translate(0.7, -0.06, side * 0.1)
    g.computeVertexNormals()
    pecs.push(partAttr(g, side > 0 ? 2 : 3))
  }

  // 背鳍
  const dorsal = finGeometry((sh) => {
    sh.moveTo(0, 0)
    sh.quadraticCurveTo(0.02, 0.03, -0.035, 0.05)
    sh.quadraticCurveTo(-0.03, 0.02, -0.06, 0)
    sh.lineTo(0, 0)
  }, 0.008)
  dorsal.translate(0.36, 0.09, 0)
  dorsal.computeVertexNormals()
  partAttr(dorsal, 4)

  const merged = mergeGeometries([body, fluke, ...pecs, dorsal])
  merged.computeBoundingSphere()
  return merged
}

const WHALE_VERTEX = /* glsl */ `
  attribute float aPart;
  uniform float uTime, uSwim, uAmp;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vWorld;
  varying float vPart;
  vec3 swim(vec3 p) {
    float s = clamp(p.x, -0.2, 1.0);
    float w = uTime * uSwim;
    float env = pow(1.0 - clamp(s, 0.0, 1.0), 2.2) + max(0.0, -s) * 3.0;
    p.y += sin(w - s * 5.2) * uAmp * env;
    if (aPart > 1.5 && aPart < 3.5) p.y += sin(w * 0.5 + 1.0) * abs(p.z) * 0.6;
    return p;
  }
`

export function whaleMaterial({ sky = true } = {}) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSwim: { value: 1.2 },
      uAmp: { value: 0.03 },
      uOpacity: { value: 1 },
      uGlow: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(-0.62, 0.34, -1).normalize() },
    },
  ])
  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: sky,
    depthWrite: !sky,
    blending: sky ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${WHALE_VERTEX}
      #include <fog_pars_vertex>
      void main() {
        vec3 p = swim(position);
        vObj = position;
        vPart = aPart;
        // 用有限差分修正法线的倾斜
        vec3 q = swim(position + vec3(0.01, 0.0, 0.0));
        float slope = (q.y - p.y) / 0.01;
        vec3 n = normalize(normal + vec3(-slope * normal.y, 0.0, 0.0));
        vN = normalize(mat3(modelMatrix) * n);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity, uGlow;
      uniform vec3 uMoonDir;
      varying vec3 vObj;
      varying vec3 vN;
      varying vec3 vWorld;
      varying float vPart;
      #include <fog_pars_fragment>
      ${GLSL_NOISE}
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        if (!gl_FrontFacing) N = -N;
        float belly = smoothstep(0.02, -0.06, vObj.y);
        // 背深蓝、腹浅蓝（大肥鱼配色）
        vec3 back = vec3(0.03, 0.1, 0.42);
        vec3 bellyC = vec3(0.3, 0.55, 1.0);
        vec3 base = mix(back, bellyC, belly);
        // 腹褶纹
        float grooves = belly * smoothstep(0.55, 0.9, vObj.x) * (0.5 + 0.5 * sin(vObj.z * 260.0));
        base = mix(base, base * 0.6, grooves * 0.6);
        // 星星斑点
        vec3 sp = vObj * vec3(90.0, 90.0, 90.0);
        vec3 id = floor(sp);
        float h = hash13(id);
        float d = length(fract(sp) - 0.5 - (hash33(id) - 0.5) * 0.5);
        float star = smoothstep(0.22, 0.0, d) * step(0.93, h) * (1.0 - belly);
        star *= 0.6 + 0.4 * sin(uTime * 3.0 + h * 50.0);
        float fres = pow(1.0 - abs(dot(N, V)), 2.5);
        vec3 col;
        float alpha = 1.0;
        ${sky ? `
        col = base * (0.18 + 0.3 * fres) + vec3(0.2, 0.6, 1.0) * pow(fres, 1.5) * 1.1 + vec3(0.8, 0.9, 1.0) * star * 3.0;
        col += vec3(0.3, 0.7, 1.0) * grooves * 0.25;
        col *= uGlow * uOpacity;
        ` : `
        float diff = max(dot(N, uMoonDir), 0.0);
        float spec = pow(max(dot(reflect(-uMoonDir, N), V), 0.0), 40.0);
        // 城市方向（-Z）来的粉紫色环境光 + 舞台方向的暖光，让深色鲸身在夜里读得出来
        float cityL = max(dot(N, normalize(vec3(0.0, 0.3, -1.0))), 0.0);
        float stageL = max(dot(N, normalize(vec3(-0.6, 0.2, 0.8))), 0.0);
        col = base * (0.06 + 0.4 * diff + 0.22 * cityL) + vec3(0.9, 0.5, 0.3) * stageL * 0.12 * (1.0 - belly * 0.5);
        col += vec3(0.6, 0.7, 0.9) * spec * 0.5 + vec3(0.25, 0.6, 1.0) * fres * 0.8 + vec3(0.9, 0.95, 1.0) * star * 3.0;
        `}
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

export function createWhales() {
  const root = new THREE.Group()
  root.name = 'whales'
  const geo = makeWhaleGeometry()

  // 天空鲸：椭圆轨道绕城市上空
  const sky = [
    { len: 1500, cx: 800, cz: -9000, rx: 5200, rz: 2600, y: 2900, speed: 0.022, phase: 0.0, bob: 120 },
    { len: 900, cx: -2600, cz: -6800, rx: 3800, rz: 1600, y: 2000, speed: 0.03, phase: 2.1, bob: 90 },
    { len: 520, cx: 1800, cz: -4600, rx: 2600, rz: 1100, y: 1350, speed: 0.042, phase: 4.0, bob: 60 },
    { len: 260, cx: -600, cz: -2600, rx: 1500, rz: 700, y: 900, speed: 0.06, phase: 1.0, bob: 40 },
  ].map((o) => {
    const mat = whaleMaterial({ sky: true })
    const m = new THREE.Mesh(geo, mat)
    m.scale.setScalar(o.len)
    m.frustumCulled = false
    root.add(m)
    return { ...o, mesh: m, mat }
  })

  // 跃海鲸
  const breachMat = whaleMaterial({ sky: false })
  breachMat.uniforms.uAmp.value = 0.02
  const breach = new THREE.Mesh(geo, breachMat)
  breach.scale.setScalar(520)
  breach.visible = false
  root.add(breach)
  const BREACH_POS = new THREE.Vector3(1000, WATER_Y, -1900)
  const BREACH_YAW = 3.0
  const BREACH_DIR = new THREE.Vector3(Math.cos(BREACH_YAW), 0, -Math.sin(BREACH_YAW))
  const BREACH_RUN = 1100

  // 水花：出水和落水各一团粒子
  const SPL = 900
  const sGeo = new THREE.BufferGeometry()
  const sDir = new Float32Array(SPL * 3)
  const sPos = new Float32Array(SPL * 3)
  for (let i = 0; i < SPL; i++) {
    const a = Math.random() * Math.PI * 2
    const up = 0.5 + Math.random() * 0.5
    const sp = 0.3 + Math.random()
    sDir.set([Math.cos(a) * sp * (1 - up * 0.6), up * (0.8 + Math.random() * 1.4), Math.sin(a) * sp * (1 - up * 0.6)], i * 3)
  }
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
  sGeo.setAttribute('aDir', new THREE.BufferAttribute(sDir, 3))
  const splashMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAge: { value: -1 }, uAge2: { value: -1 }, uO: { value: BREACH_POS.clone() }, uO2: { value: BREACH_POS.clone() } },
    vertexShader: /* glsl */ `
      attribute vec3 aDir;
      uniform float uAge, uAge2;
      uniform vec3 uO, uO2;
      varying float vA;
      void main() {
        bool second = gl_VertexID % 2 == 1;
        float age = second ? uAge2 : uAge;
        vec3 o = second ? uO2 : uO;
        vA = 0.0;
        vec3 p = o;
        if (age > 0.0 && age < 4.0) {
          p = o + aDir * vec3(260.0, 520.0, 260.0) * age - vec3(0.0, 260.0, 0.0) * age * age;
          p.y = max(p.y, o.y);
          vA = (1.0 - age / 4.0) * step(o.y + 0.1, p.y + 0.2);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(14000.0 / -mv.z, 1.0, 9.0) * step(0.001, vA);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, r) * vA;
        gl_FragColor = vec4(vec3(0.55, 0.8, 1.0) * a * 0.55, 1.0);
      }
    `,
  })
  const splash = new THREE.Points(sGeo, splashMat)
  splash.frustumCulled = false
  root.add(splash)

  const tmp = new THREE.Vector3()
  return {
    object: root,
    update(state) {
      const t = state.t
      for (const w of sky) {
        const a = w.phase + t * w.speed
        const x = w.cx + Math.cos(a) * w.rx
        const z = w.cz + Math.sin(a) * w.rz
        const y = w.y + Math.sin(t * 0.3 + w.phase) * w.bob
        w.mesh.position.set(x, y, z)
        // 朝切线方向游
        tmp.set(-Math.sin(a) * w.rx, 0, Math.cos(a) * w.rz).normalize()
        w.mesh.rotation.set(0, Math.atan2(-tmp.z, tmp.x), Math.sin(t * 0.3 + w.phase + 1.2) * 0.06)
        w.mat.uniforms.uTime.value = t + w.phase * 10
        w.mat.uniforms.uSwim.value = 1.1
        w.mat.uniforms.uOpacity.value = state.whales
        w.mat.uniforms.uGlow.value = 0.8 + 0.5 * state.pulse + state.finaleFlash
        w.mesh.visible = state.whales > 0.01
      }

      // 跃海：抛物线 + 身体从抬头到翻身落水
      const b = state.breach
      if (b >= 0 && b < 6) {
        const T = 3.4
        const k = b / T
        breach.visible = k <= 1.05
        const height = 820 * 4 * k * (1 - k)
        breach.position.copy(BREACH_POS).addScaledVector(BREACH_DIR, k * BREACH_RUN)
        breach.position.y = WATER_Y - 260 + height
        const pitch = THREE.MathUtils.lerp(1.25, -1.35, k)
        breach.rotation.set(0.9 * k, BREACH_YAW, pitch)
        breachMat.uniforms.uTime.value = state.t
        splashMat.uniforms.uAge.value = b - 0.15
        splashMat.uniforms.uAge2.value = b - T * 0.97
        splashMat.uniforms.uO2.value.copy(BREACH_POS).addScaledVector(BREACH_DIR, BREACH_RUN).setY(WATER_Y)
      } else {
        breach.visible = false
        splashMat.uniforms.uAge.value = -1
        splashMat.uniforms.uAge2.value = -1
      }
    },
  }
}
