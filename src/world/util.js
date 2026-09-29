import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// 世界单位 = MMD 单位（1 单位 ≈ 8cm，角色身高约 20）。舞台中心在原点，台面 y = 0，角色面朝 +Z。
export const WATER_Y = -6

export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// 2D value noise + fbm（给几何体生成用，CPU 端）
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const h = (i, j) => hash1(i * 57.0 + j * 131.0)
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export function fbm2(x, y, oct = 5) {
  let s = 0, amp = 0.5, f = 1
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f)
    f *= 2.03
    amp *= 0.5
  }
  return s
}

export const clamp01 = (x) => Math.min(1, Math.max(0, x))
export const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
export const lerp = (a, b, t) => a + (b - a) * t

export function canvasTexture(w, h, draw, { srgb = true, repeat = false, mipmaps = true } = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  draw(g, w, h)
  const tex = new THREE.CanvasTexture(c)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.generateMipmaps = mipmaps
  tex.anisotropy = 8
  return tex
}

// 共享 GLSL：hash / value noise / fbm
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0));
  float c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), f1 = hash13(i + vec3(1, 0, 1));
  float g = hash13(i + vec3(0, 1, 1)), h = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
`

// 发光点精灵（柔和圆点），给 Points 用
export function glowPointMaterial({ size = 1, additive = true, sizeAttenuation = true, depthWrite = false, maxSize = 96 } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uSize: { value: size }, uPixelRatio: { value: 1 }, uFade: { value: 1 }, uMax: { value: maxSize } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aAlpha;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uMax;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vAlpha *= smoothstep(4.0, 40.0, -mv.z);
        gl_PointSize = min(uMax * uPixelRatio, ${sizeAttenuation ? 'uSize * aSize * uPixelRatio * 600.0 / max(1.0, -mv.z)' : 'uSize * aSize * uPixelRatio'});
        if (aAlpha <= 0.001) gl_PointSize = 0.0;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        float core = smoothstep(1.0, 0.0, r);
        float a = core * core * vAlpha * uFade;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  })
  mat.userData.isGlowPoints = true
  return mat
}

// 把不会动的小网格按材质合并，减少 draw call（舞台上几百个零件 × 反射/阴影多遍渲染）。
// 带 userData.dynamic 的对象及其子孙、透明材质、ShaderMaterial、InstancedMesh 都不动。
export function bakeStatic(root) {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const groups = new Map()
  const isDynamic = (o) => {
    for (let p = o; p && p !== root; p = p.parent) if (p.userData.dynamic) return true
    return false
  }
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return
    const m = o.material
    if (Array.isArray(m) || m.isShaderMaterial || m.transparent || isDynamic(o)) return
    if (!groups.has(m)) groups.set(m, [])
    groups.get(m).push(o)
  })
  const tmp = new THREE.Matrix4()
  let removed = 0
  for (const [mat, meshes] of groups) {
    if (meshes.length < 2) continue
    const geos = meshes.map((o) => {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
      if (!g.attributes.normal) g.computeVertexNormals()
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
      g.clearGroups()
      g.applyMatrix4(tmp.multiplyMatrices(inv, o.matrixWorld))
      return g
    })
    const merged = mergeGeometries(geos, false)
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, mat)
    mesh.castShadow = meshes.some((o) => o.castShadow)
    mesh.receiveShadow = meshes.some((o) => o.receiveShadow)
    mesh.name = `baked:${mat.type}`
    root.add(mesh)
    for (const o of meshes) o.parent.remove(o)
    removed += meshes.length - 1
  }
  return removed
}
