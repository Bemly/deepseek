import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLSL_NOISE, fbm2 } from './util.js'

// 各主题共用的积木：固定数量的灯光组、光柱材质、带窗户的楼体材质、中式/和式曲面屋顶、塔、殿、
// 浮空岛、云团、瀑布。

// ---------- 灯光组 ----------
// 每个主题都用同样数量、同样类型的灯（1 盏带阴影的主光 + 3 盏聚光 + 2 盏点光），
// 这样切主题时材质不用重新编译着色器，过渡不会卡一下。
export function createLightRig({ key = {}, spots = [], rim = {}, points = [] } = {}) {
  const group = new THREE.Group()
  group.name = 'light-rig'
  const k = new THREE.SpotLight(key.color ?? 0xffe2c0, key.intensity ?? 16000, 0, key.angle ?? 0.36, key.penumbra ?? 0.6, 2)
  k.position.set(...(key.pos ?? [0, 72, 88]))
  k.target.position.set(...(key.target ?? [0, 8, 0]))
  k.castShadow = true
  k.shadow.mapSize.set(2048, 2048)
  k.shadow.bias = -0.0003
  k.shadow.normalBias = 0.04
  k.shadow.camera.near = 40
  k.shadow.camera.far = 260
  group.add(k, k.target)
  const mk = (o, def) => {
    const s = new THREE.SpotLight(o.color ?? def.color, o.intensity ?? def.intensity, 0, o.angle ?? def.angle, o.penumbra ?? 0.7, 2)
    s.position.set(...(o.pos ?? def.pos))
    s.target.position.set(...(o.target ?? def.target))
    group.add(s, s.target)
    return s
  }
  const sp = [0, 1].map((i) => mk(spots[i] ?? {}, { color: i ? 0xff66cc : 0x66ccff, intensity: 6000, angle: 0.3, pos: [i ? 30 : -30, 60, -20], target: [0, 0, 0] }))
  const r = mk(rim, { color: 0x6fa8ff, intensity: 7000, angle: 0.5, pos: [0, 50, -60], target: [0, 10, 0] })
  const pts = [0, 1].map((i) => {
    const o = points[i] ?? {}
    const p = new THREE.PointLight(o.color ?? 0xffa25a, o.intensity ?? 20, 0, 2)
    p.position.set(...(o.pos ?? [i ? 30 : -30, 12, 16]))
    group.add(p)
    return p
  })
  return { group, key: k, spots: sp, rim: r, points: pts, base: { key: k.intensity, spots: sp.map((s) => s.intensity), rim: r.intensity, points: pts.map((p) => p.intensity) } }
}

// ---------- 光柱（加色、沿长度渐隐、边缘淡出）----------
export function beamMaterial(color = [1, 1, 1], strength = 0.35) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Vector3(...color) }, uInt: { value: 1 }, uStrength: { value: strength } },
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
      uniform vec3 uColor;
      uniform float uInt, uStrength;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float fade = pow(vAlong, 1.6);
        gl_FragColor = vec4(uColor * edge * fade * uInt * uStrength, 1.0);
      }
    `,
  })
}

// 从原点朝 -Y 伸出去的圆锥光柱
export function beamGeometry(r0, r1, len) {
  return new THREE.CylinderGeometry(r0, r1, len, 28, 1, true).translate(0, -len / 2, 0)
}

// ---------- 带窗户的楼体材质（InstancedMesh 的单位盒子，底面在 y=0）----------
// 夜景主题：窗户按 state.city 亮灯、按 cityWave 扫亮、按 fall 从右往左熄灭；白天主题可以打太阳光。
export function createBuildingMaterial(o = {}) {
  const extentX = o.extentX ?? 16000
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uCity: { value: 0 },
      uWave: { value: 0 },
      uFall: { value: 0 },
      uNeon: { value: 0 },
      uPulse: { value: 0 },
      uGlitch: { value: 0 },
      uHush: { value: 0 },
      uBase: { value: new THREE.Color(...(o.base ?? [0.01, 0.014, 0.028])) },
      uTop: { value: new THREE.Color(...(o.top ?? o.base ?? [0.012, 0.017, 0.034])) },
      uGrid: { value: new THREE.Vector2(...(o.grid ?? [26, 40])) },
      uWin: { value: new THREE.Vector4(...(o.win ?? [0.13, 0.87, 0.24, 0.84])) },
      uWarm: { value: new THREE.Color(...(o.warm ?? [1.0, 0.7, 0.4])) },
      uCool: { value: new THREE.Color(...(o.cool ?? [0.7, 0.85, 1.0])) },
      uWinGain: { value: o.winGain ?? 1 },
      uNeonMix: { value: new THREE.Vector3(...(o.neonMix ?? [1.2, 2.4, 0.8])) },
      uFlashCol: { value: new THREE.Color(...(o.flash ?? [0.55, 0.9, 1.0])) },
      uSunDir: { value: new THREE.Vector3(...(o.sunDir ?? [-0.3, 0.2, 1.0])).normalize() },
      uSunCol: { value: new THREE.Color(...(o.sun ?? [0, 0, 0])) },
      uAmb: { value: new THREE.Color(...(o.amb ?? [1, 1, 1])) },
      uGlass: { value: new THREE.Color(...(o.glass ?? [0.01, 0.018, 0.04])) },
      uLatticeAmt: { value: o.lattice ?? 0 },
    },
  ])
  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute vec3 aNeon;
      attribute float aFlash;
      attribute float aDensity;
      varying vec3 vLocal;
      varying vec3 vNrm;
      varying vec3 vScale;
      varying float vSeed;
      varying vec3 vNeonCol;
      varying float vFlash;
      varying float vDensity;
      varying vec3 vWorld;
      varying vec3 vWN;
      #include <fog_pars_vertex>
      void main() {
        vLocal = position;
        vNrm = normal;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vSeed = aSeed;
        vNeonCol = aNeon;
        vFlash = aFlash;
        vDensity = aDensity;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCity, uWave, uFall, uNeon, uPulse, uGlitch, uHush, uWinGain, uLatticeAmt;
      uniform vec3 uBase, uTop, uWarm, uCool, uNeonMix, uFlashCol, uSunDir, uSunCol, uAmb, uGlass;
      uniform vec2 uGrid;
      uniform vec4 uWin;
      varying vec3 vLocal;
      varying vec3 vNrm;
      varying vec3 vScale;
      varying float vSeed;
      varying vec3 vNeonCol;
      varying float vFlash;
      varying float vDensity;
      varying vec3 vWorld;
      varying vec3 vWN;
      #include <fog_pars_fragment>
      ${GLSL_NOISE}

      void main() {
        float xN = clamp((vWorld.x + ${extentX.toFixed(1)}) / ${(extentX * 2).toFixed(1)}, 0.0, 1.0);
        float wake = smoothstep(xN - 0.04, xN, uWave);
        float dead = smoothstep(1.0 - uFall - 0.03, 1.0 - uFall, xN) * step(0.001, uFall);
        float glitchFlick = uGlitch > 0.01 ? step(0.5, hash12(vec2(vSeed * 13.0, floor(uTime * 18.0)))) : 1.0;
        float alive = (1.0 - dead) * mix(1.0, glitchFlick, min(1.0, uGlitch * 1.5));
        float level = uCity * mix(0.12, 1.0, wake) * alive;
        float neonOn = uNeon * alive * step(0.45, fract(vSeed * 7.13));

        float height = vScale.y;
        float y = vLocal.y * height;
        vec3 lightC = uAmb + uSunCol * max(dot(normalize(vWN), uSunDir), 0.0);
        vec3 col;

        if (vNrm.y > 0.5) {
          float ex = 0.5 - abs(vLocal.x), ez = 0.5 - abs(vLocal.z);
          float edge = min(ex * vScale.x, ez * vScale.z);
          float rim = smoothstep(5.0, 1.0, edge);
          col = uTop * lightC * 1.2 + vNeonCol * rim * neonOn * 2.5 * uNeonMix.x / 1.2;
          col += uFlashCol * vFlash * (0.4 + rim * 4.0);
        } else {
          bool sideX = abs(vNrm.x) > 0.5;
          float faceW = sideX ? vScale.z : vScale.x;
          float u = (sideX ? vLocal.z : vLocal.x) * faceW;
          vec2 grid = vec2(u / uGrid.x, y / uGrid.y);
          vec2 cell = floor(grid);
          vec2 f = fract(grid);
          float faceId = dot(vNrm, vec3(1.0, 2.0, 3.0));
          float h = hash13(vec3(cell, vSeed * 97.0 + faceId));
          float h2 = hash13(vec3(cell.yx, vSeed * 31.0 + faceId + 5.0));
          float lit = step(h, vDensity * level);
          float m = smoothstep(uWin.x, uWin.x + 0.06, f.x) * smoothstep(uWin.y, uWin.y - 0.06, f.x) * smoothstep(uWin.z, uWin.z + 0.08, f.y) * smoothstep(uWin.w, uWin.w - 0.08, f.y);
          // 格子窗（中式/和式）：窗里再画细格
          if (uLatticeAmt > 0.0) {
            vec2 lf = fract(f * vec2(4.0, 3.0));
            float bars = max(smoothstep(0.1, 0.0, min(lf.x, 1.0 - lf.x)), smoothstep(0.1, 0.0, min(lf.y, 1.0 - lf.y)));
            m *= 1.0 - bars * uLatticeAmt;
          }
          vec3 tint = mix(vNeonCol, vec3(1.0), 0.45);
          vec3 wc = h2 < 0.55 ? uWarm : h2 < 0.88 ? uCool : tint;
          float inten = (0.45 + 0.75 * fract(h2 * 13.7)) * uWinGain;
          if (h2 > 0.985) inten *= 0.4 + 0.6 * step(0.3, fract(uTime * (0.7 + h2) + h));
          vec3 detailed = wc * inten * lit * m;
          float px = max(fwidth(grid.x), fwidth(grid.y));
          float detail = 1.0 - smoothstep(0.3, 0.9, px);
          vec3 avg = mix(uWarm, uCool, 0.4) * 0.85 * vDensity * level * 0.3 * uWinGain;
          vec3 win = mix(avg, detailed, detail);
          float shade = 0.55 + 0.45 * max(0.0, dot(vNrm, normalize(vec3(-0.3, 0.2, 1.0))));
          col = uBase * shade * lightC + uGlass * (1.0 - m) * smoothstep(0.0, 1.0, y / max(height, 1.0));
          col += win;
          float edgeU = faceW * 0.5 - abs(u);
          float corner = smoothstep(4.0, 1.0, edgeU) * step(0.6, fract(vSeed * 3.71));
          float crown = smoothstep(height - 26.0, height - 20.0, y) * smoothstep(height - 6.0, height - 12.0, y);
          float stripe = step(0.72, fract(vSeed * 5.3)) * smoothstep(3.0, 0.0, abs(mod(y + vSeed * 50.0, 160.0) - 80.0));
          float beat = 1.0 + uPulse * 0.9;
          col += vNeonCol * (corner * uNeonMix.x + crown * uNeonMix.y + stripe * uNeonMix.z) * neonOn * beat;
          col += uFlashCol * vFlash * (crown * 10.0 + 0.35 + 0.8 * smoothstep(height * 0.6, height, y));
        }
        col *= 1.0 - 0.35 * uHush;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

export function updateBuildingUniforms(mat, state) {
  const u = mat.uniforms
  u.uTime.value = state.t
  u.uCity.value = state.city
  u.uWave.value = state.cityWave
  u.uFall.value = state.fall
  u.uNeon.value = state.neon
  u.uPulse.value = state.pulse
  u.uGlitch.value = state.glitch
  u.uHush.value = state.hush
}

// 一批楼体：slots = [{x, y?, z, w, d, h, rot?}]，返回带"被击中闪光"接口的 InstancedMesh
export function instancedBuildings(slots, material, R, { neon = [[0.1, 0.75, 1.0]], density = [0.2, 0.6] } = {}) {
  const count = slots.length
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const aSeed = new Float32Array(count)
  const aNeon = new Float32Array(count * 3)
  const aFlash = new Float32Array(count)
  const aDensity = new Float32Array(count)
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count))
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  slots.forEach((s, i) => {
    q.setFromAxisAngle(up, s.rot ?? 0)
    m4.compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q, new THREE.Vector3(s.w, s.h, s.d))
    mesh.setMatrixAt(i, m4)
    aSeed[i] = R() * 100
    const c = neon[Math.floor(R() * neon.length)]
    aNeon.set(c, i * 3)
    aDensity[i] = s.density ?? density[0] + R() * (density[1] - density[0])
    s.index = i
  })
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1))
  geo.setAttribute('aNeon', new THREE.InstancedBufferAttribute(aNeon, 3))
  const flashAttr = new THREE.InstancedBufferAttribute(aFlash, 1)
  flashAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('aFlash', flashAttr)
  geo.setAttribute('aDensity', new THREE.InstancedBufferAttribute(aDensity, 1))
  mesh.frustumCulled = false
  const touched = new Set()
  return {
    mesh,
    beginFlash() {
      for (const i of touched) aFlash[i] = 0
      touched.clear()
      flashAttr.needsUpdate = true
    },
    addFlash(index, v) {
      if (index < 0 || index >= count) return
      aFlash[index] = Math.max(aFlash[index], v)
      touched.add(index)
      flashAttr.needsUpdate = true
    },
  }
}

// ---------- 曲面屋顶（中式庑殿/歇山的简化，四角起翘）----------
// 底面 w×d（不含出檐），屋脊沿长边。返回的几何底边在 y=0，屋脊高 rise。
export function curvedRoofGeometry({ w = 1, d = 1, rise = 0.5, overhang = 0.2, curl = 0.3, sag = 1.7, thick = 0.04, segs = 14 } = {}) {
  const W = w * (1 + overhang * 2), D = d * (1 + overhang * 2)
  const long = Math.max(W, D), short = Math.min(W, D)
  const alongX = W >= D
  const height = (x, z) => {
    const a = alongX ? Math.abs(x) : Math.abs(z)
    const b = alongX ? Math.abs(z) : Math.abs(x)
    const m = Math.min(1, Math.max(Math.max(0, a - (long - short) / 2) / (short / 2), b / (short / 2)))
    const cx = Math.abs(x) / (W / 2), cz = Math.abs(z) / (D / 2)
    const lift = curl * rise * Math.pow(cx, 5) * Math.pow(cz, 5) * 1.6 + curl * rise * 0.25 * Math.pow(m, 6)
    return rise * Math.pow(1 - m, sag) + lift
  }
  const pos = [], idx = []
  const N = segs
  const vid = (layer, i, j) => layer * (N + 1) * (N + 1) + i * (N + 1) + j
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = (i / N - 0.5) * W, z = (j / N - 0.5) * D
        pos.push(x, height(x, z) - layer * thick * (1 + (rise * 0.1)), z)
      }
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = vid(0, i, j), b = vid(0, i + 1, j), c = vid(0, i, j + 1), e = vid(0, i + 1, j + 1)
      idx.push(a, c, b, b, c, e)
      const a2 = vid(1, i, j), b2 = vid(1, i + 1, j), c2 = vid(1, i, j + 1), e2 = vid(1, i + 1, j + 1)
      idx.push(a2, b2, c2, b2, e2, c2)
    }
  }
  // 檐口侧边
  const edge = []
  for (let i = 0; i < N; i++) edge.push([i, 0, i + 1, 0], [N, i, N, i + 1], [N - i, N, N - i - 1, N], [0, N - i, 0, N - i - 1])
  for (const [i0, j0, i1, j1] of edge) {
    const a = vid(0, i0, j0), b = vid(0, i1, j1), c = vid(1, i0, j0), e = vid(1, i1, j1)
    idx.push(a, b, c, b, e, c)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// 屋脊（沿长边的一根 + 四条垂脊），给近景建筑加细节
export function roofRidgeGeometry({ w, d, rise, overhang = 0.2, r = 0.03 }) {
  const W = w * (1 + overhang * 2), D = d * (1 + overhang * 2)
  const alongX = W >= D
  const half = (Math.max(W, D) - Math.min(W, D)) / 2
  const parts = []
  const bar = (a, b) => {
    const dir = new THREE.Vector3().subVectors(b, a)
    const g = new THREE.CylinderGeometry(r, r, dir.length(), 6)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()))
    g.translate(...a.clone().addScaledVector(dir, 0.5).toArray())
    parts.push(g)
  }
  const top = rise + r
  const p = (x, z) => (alongX ? new THREE.Vector3(x, top, z) : new THREE.Vector3(z, top, x))
  bar(p(-half, 0), p(half, 0))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const corner = alongX ? new THREE.Vector3((sx * W) / 2, rise * 0.12, (sz * D) / 2) : new THREE.Vector3((sx * W) / 2, rise * 0.12, (sz * D) / 2)
    bar(p(sx * half, 0), corner)
  }
  // 两端鸱吻
  for (const sx of [-1, 1]) {
    const g = new THREE.BoxGeometry(r * 3, r * 7, r * 2)
    const at = p(sx * half, 0)
    g.translate(at.x, at.y + r * 3, at.z)
    parts.push(g)
  }
  return mergeGeometries(parts.map((g) => (g.deleteAttribute('uv'), g.index ? g.toNonIndexed() : g)))
}

// ---------- 塔（多层楼阁式）----------
// 返回 Group，并给出每层檐角的位置（挂灯用）
export function pagoda({ tiers = 7, baseW = 40, tierH = 26, taper = 0.9, rise = 0.35, curl = 0.35, overhang = 0.32, wallMat, roofMat, colMat, trimMat, finialMat, octagonal = false }) {
  const group = new THREE.Group()
  const corners = []
  let y = 0
  let w = baseW
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(baseW * 1.5, tierH * 0.3, baseW * 1.5), trimMat ?? wallMat)
  plinth.position.y = tierH * 0.15
  group.add(plinth)
  y = tierH * 0.3
  for (let i = 0; i < tiers; i++) {
    const h = tierH * (i === 0 ? 1.25 : 1)
    const body = new THREE.Mesh(octagonal ? new THREE.CylinderGeometry(w * 0.55, w * 0.6, h, 8) : new THREE.BoxGeometry(w, h, w), wallMat)
    body.position.y = y + h / 2
    group.add(body)
    if (colMat) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.045, w * 0.045, h, 8), colMat)
        c.position.set((sx * w) / 2, y + h / 2, (sz * w) / 2)
        group.add(c)
      }
    }
    const roof = new THREE.Mesh(curvedRoofGeometry({ w, d: w, rise: w * rise, overhang, curl, sag: 1.9, thick: w * 0.03 }), roofMat)
    roof.position.y = y + h - w * 0.02
    group.add(roof)
    const W = w * (1 + overhang * 2)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3((sx * W) / 2, y + h + w * rise * curl * 1.1, (sz * W) / 2))
    y += h + w * rise * 0.55
    w *= taper
  }
  // 塔刹
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.05, w * 0.12, tierH * 1.6, 8), finialMat ?? roofMat)
  spire.position.y = y + tierH * 0.8
  group.add(spire)
  for (let k = 0; k < 5; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.13, w * 0.025, 6, 16), finialMat ?? roofMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y + tierH * (0.3 + k * 0.25)
    group.add(ring)
  }
  const top = new THREE.Vector3(0, y + tierH * 1.7, 0)
  return { group, corners, top, height: y + tierH * 1.7 }
}

// ---------- 浮空岛 ----------
// 上面是微微隆起的平顶，下面是倒锥形岩体；顶点色：顶面草/石，下面岩石渐暗
export function floatingIslandGeometry({ r = 1, depth = 1.6, seed = 1, top = [0.35, 0.55, 0.3], rock = [0.42, 0.36, 0.33], bottom = [0.12, 0.1, 0.12], segs = 40 } = {}) {
  const rings = 14
  const pos = [], col = [], idx = []
  const cTop = new THREE.Color(...top), cRock = new THREE.Color(...rock), cBot = new THREE.Color(...bottom)
  // 顶面
  pos.push(0, 0.06 * r, 0)
  col.push(cTop.r, cTop.g, cTop.b)
  const edgeR = (a) => r * (0.85 + 0.3 * fbm2(Math.cos(a) * 1.5 + seed, Math.sin(a) * 1.5 + seed * 2, 4))
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2
    const er = edgeR(a)
    pos.push(Math.cos(a) * er, 0.0, Math.sin(a) * er)
    col.push(cTop.r * 0.9, cTop.g * 0.9, cTop.b * 0.9)
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j)
  // 下半岩体
  const base = 1 + segs
  for (let i = 1; i <= rings; i++) {
    const t = i / rings
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2
      const er = edgeR(a) * Math.pow(1 - t, 0.9) * (0.9 + 0.25 * fbm2(a * 3 + seed, t * 4, 3))
      const y = -t * depth * r * (0.85 + 0.3 * fbm2(a * 2 + seed * 3, 1.3, 3))
      pos.push(Math.cos(a) * er, y, Math.sin(a) * er)
      const c = cRock.clone().lerp(cBot, t)
      if (i === 1) c.lerp(cTop, 0.4)
      col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < rings; i++) {
    const r0 = i === 0 ? 1 : base + (i - 1) * segs
    const r1 = base + i * segs
    for (let j = 0; j < segs; j++) {
      const a = r0 + j, b = r0 + ((j + 1) % segs), c = r1 + j, e = r1 + ((j + 1) % segs)
      idx.push(a, b, c, b, e, c)
    }
  }
  const tip = pos.length / 3
  pos.push(0, -depth * r * 1.05, 0)
  col.push(cBot.r, cBot.g, cBot.b)
  const last = base + (rings - 1) * segs
  for (let j = 0; j < segs; j++) idx.push(last + j, last + ((j + 1) % segs), tip)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// ---------- 云团材质（实例化的球，软边 + 顶亮底暗 + 噪声起伏）----------
export function cloudMaterial({ lit = [1.0, 0.85, 0.75], shade = [0.45, 0.42, 0.62], sunDir = [0.3, 0.4, -1], rim = [1.0, 0.7, 0.6], opacity = 1 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uLit: { value: new THREE.Color(...lit) },
      uShade: { value: new THREE.Color(...shade) },
      uRim: { value: new THREE.Color(...rim) },
      uSun: { value: new THREE.Vector3(...sunDir).normalize() },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uGlow: { value: 0 },
    },
  ])
  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vW;
      varying float vH;
      #include <fog_pars_vertex>
      ${GLSL_NOISE}
      void main() {
        vec3 p = position;
        float n = vnoise3(p * 2.2 + uTime * 0.05);
        p += normal * (n - 0.5) * 0.35;
        #ifdef USE_INSTANCING
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
        #endif
        vW = wp.xyz;
        vH = position.y;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLit, uShade, uRim, uSun;
      uniform float uOpacity, uGlow;
      varying vec3 vN;
      varying vec3 vW;
      varying float vH;
      #include <fog_pars_fragment>
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSun) * 0.5 + 0.5;
        float up = N.y * 0.5 + 0.5;
        vec3 col = mix(uShade, uLit, smoothstep(0.2, 0.9, ndl * 0.7 + up * 0.4));
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        col += uRim * fres * 0.45 * max(dot(V, -uSun) * 0.5 + 0.5, 0.2);
        col += uRim * uGlow;
        float a = smoothstep(0.0, 0.45, max(dot(N, V), 0.0)) * uOpacity;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

// 一团云：若干球拼成，返回 [{pos, r}]
export function cloudCluster(R, { count = 14, spread = 1, height = 0.6, flat = 0.55 } = {}) {
  const out = []
  for (let i = 0; i < count; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * spread
    const r = (0.35 + R() * 0.45) * (1 - d / (spread * 1.6))
    out.push({ pos: new THREE.Vector3(Math.cos(a) * d, R() * height * (1 - d / (spread * 1.3)), Math.sin(a) * d * flat), r })
  }
  return out
}

// ---------- 瀑布（竖直带子，向下流动的条纹，底部化成水雾）----------
export function waterfallMaterial(color = [0.8, 0.92, 1.0]) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(...color) }, uInt: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uInt;
      uniform vec3 uCol;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        float streak = vnoise(vec2(vUv.x * 18.0, vUv.y * 3.0 + uTime * 2.2));
        streak = smoothstep(0.35, 0.9, streak);
        float side = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
        float fade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
        float a = (0.25 + streak * 0.75) * side * fade * uInt;
        gl_FragColor = vec4(uCol * a * 0.6, 1.0);
      }
    `,
  })
}

// 若干组"楼/屋"放在地形上时用：地面高度函数
export function smoothTerrain(x, z, { base = 0, amp = 300, scale = 4000, seed = 1 } = {}) {
  return base + amp * fbm2(x / scale + seed, z / scale - seed, 4)
}

// ---------- 雾带：一堆大而软的精灵点，横着排成一条条，缓慢漂移 ----------
// blobs = [{ pos: Vector3, size: 世界单位直径, alpha }]
export function mistBank(blobs, { color = [0.5, 0.55, 0.7], maxPx = 320, additive = true } = {}) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(blobs.flatMap((b) => b.pos.toArray()), 3))
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(blobs.map((b) => b.size), 1))
  g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(blobs.map((b) => b.alpha ?? 0.3), 1))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(blobs.map((_, i) => (i * 0.618) % 1), 1))
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(...color) }, uPixelRatio: { value: 1 }, uAmt: { value: 1 }, uMax: { value: maxPx } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aSeed;
      uniform float uTime, uPixelRatio, uMax;
      varying float vA;
      varying float vSeed;
      void main() {
        vec3 p = position + vec3(sin(uTime * 0.02 + aSeed * 30.0) * aSize * 0.08, 0.0, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(uMax, aSize * 600.0 / max(1.0, -mv.z)) * uPixelRatio;
        vA = aAlpha;
        vSeed = aSeed;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      uniform float uAmt;
      varying float vA;
      varying float vSeed;
      ${GLSL_NOISE}
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        d.y *= 1.8; // 扁一点
        float r = length(d) * 2.0;
        float n = fbm(gl_PointCoord * 2.5 + vSeed * 17.0);
        float a = pow(smoothstep(1.0, 0.0, r), 1.6) * (0.35 + 0.9 * n) * vA * uAmt;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uCol * a, ${additive ? 'a' : 'a'});
      }
    `,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  return pts
}
