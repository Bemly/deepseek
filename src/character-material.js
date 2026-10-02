// 角色材质：v2c「TOON • Full Detail / 高模统一材质」的 three.js 复刻（只管角色，不碰场景）。
//   Original Albedo(UVMap) → 帽子纯色(cap_color, part_kind==1) → 手部贴图(HandUV, part_kind==2)
//   → FACE_EXPRESSION 表情合成（节点逐个翻译，见 face-expression.js）→ 色相/饱和度/明度(S 1.065, V 1.045)
//   → NPR • Cel + Soft Face + Rim：漫反射亮度两道 smoothstep 边 → 阴影/中间/受光三色，皮肤单独一组暖色，
//     乘反照率，再加 Fresnel(IOR 1.18) 边缘光。
// 光照：v2c 角色场景只有一盏 CHAR_Key 太阳（强度 2、白色，世界黑），EEVEE 下白色漫反射的亮度 = 0.2546×强度×cosθ（实测）。
// 每个主题的 key 方向 / 三色 / 边缘光取自 r_keys.py 的 CHARLOOK，过渡中按 world.mix 插值（和 blend 一样）。
// UV：glTF 把 v 翻成 1-v，这里翻回 Blender 约定；自带贴图用 flipY 读，两边坐标一致。
import * as THREE from 'three'
import { FACE_EXPRESSION_GLSL } from './face-expression.js'

export const CHARLOOK = {
  harbor: { key: [[0, 72, 88], [0, 8, 0]], light: [1.0, 0.95, 0.9], mid: [0.8, 0.84, 0.97], shadow: [0.42, 0.48, 0.72], rim: [0.45, 0.65, 1.0], rs: 0.22 },
  ancient: { key: [[10, 70, 90], [0, 8, 0]], light: [1.0, 0.92, 0.84], mid: [0.86, 0.8, 0.9], shadow: [0.52, 0.42, 0.62], rim: [0.62, 0.66, 1.0], rs: 0.22 },
  japan: { key: [[-30, 70, 85], [0, 8, 0]], light: [0.96, 0.95, 1.0], mid: [0.86, 0.82, 0.95], shadow: [0.52, 0.44, 0.66], rim: [1.0, 0.62, 0.82], rs: 0.22 },
  clouds: { key: [[30, 70, 85], [0, 8, 0]], light: [1.0, 0.95, 0.93], mid: [0.9, 0.85, 0.95], shadow: [0.62, 0.54, 0.74], rim: [1.0, 0.72, 0.55], rs: 0.26 },
  atlantis: { key: [[20, 90, 60], [0, 8, 0]], light: [0.9, 0.98, 1.0], mid: [0.74, 0.88, 0.94], shadow: [0.32, 0.52, 0.62], rim: [0.4, 0.95, 1.0], rs: 0.28 },
}
const KEY_LUMA = 0.2546 * 2.0 // EEVEE: 白色漫反射在强度 2 的太阳正射下的亮度

const TEX = {
  tAlbedo: 'albedo', tHand: 'hand', tFaceBase: 'face_base', tEyeUnderR: 'eye_under_r', tEyeUnderL: 'eye_under_l',
  tEyeOverR: 'eye_over_r', tEyeOverL: 'eye_over_l', tIrisR: 'iris_r', tIrisL: 'iris_l', tMouth: 'mouth',
}

const vertexShader = /* glsl */ `
attribute vec2 uv1;
attribute vec2 uv2;
attribute vec4 color;
attribute float _part_kind;
attribute float _face_layer;
varying vec2 vUv0, vUv1, vUv2;
varying vec3 vCap, vNormalV, vViewPos;
varying float vPart, vFace;
#include <common>
#include <skinning_pars_vertex>
void main() {
  vUv0 = vec2(uv.x, 1.0 - uv.y);
  vUv1 = vec2(uv1.x, 1.0 - uv1.y);
  vUv2 = vec2(uv2.x, 1.0 - uv2.y);
  vCap = color.rgb;
  vPart = _part_kind;
  vFace = _face_layer;
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vNormalV = normalize(transformedNormal);
  vViewPos = mvPosition.xyz;
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D tAlbedo, tHand;
uniform vec3 uKeyDir;            // 世界空间，指向光源
uniform vec3 uShadowTint, uMidTint, uLightTint, uRimColor;
uniform float uRimStrength;
varying vec2 vUv0, vUv1, vUv2;
varying vec3 vCap, vNormalV, vViewPos;
varying float vPart, vFace;
${FACE_EXPRESSION_GLSL}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float bsmooth(float v, float a, float b) { float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// Blender fresnel_dielectric_cos
float fresnelDielectric(float cosi, float eta) {
  float c = abs(cosi);
  float g = eta * eta - 1.0 + c * c;
  if (g <= 0.0) return 1.0;
  g = sqrt(g);
  float A = (g - c) / (g + c);
  float B = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
  return 0.5 * A * A * (1.0 + B * B);
}
void main() {
  vec3 alb = texture2D(tAlbedo, vUv0).rgb;
  alb = mix(alb, vCap, abs(vPart - 1.0) <= 0.1 ? 1.0 : 0.0);                       // CAP_IsCap
  alb = mix(alb, texture2D(tHand, vUv1).rgb, abs(vPart - 2.0) <= 0.1 ? 1.0 : 0.0);  // HAND_IsHand
  vec3 face = faceExpression(alb, vUv2, vFace);
  vec3 hsv = rgb2hsv(max(face, 0.0));
  hsv.y = clamp(hsv.y * 1.065, 0.0, 1.0);
  hsv.z *= 1.045;
  vec3 col = hsv2rgb(hsv);
  float skin = clamp((face.r - face.b - 0.015) / (0.16 - 0.015), 0.0, 1.0);        // Soft Face：R-B 映射
  vec3 N = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 L = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
  float lum = KEY_LUMA * max(dot(N, L), 0.0);
  float sh = bsmooth(lum, 0.23, 0.23 + 0.055);     // TOON_CONTROLS：Shadow Edge 0.23、Light Edge 0.55、Edge Softness 0.055
  float li = bsmooth(lum, 0.55, 0.55 + 0.055);
  vec3 cel = mix(mix(uShadowTint, uMidTint, sh), uLightTint, li);
  vec3 skinCel = mix(vec3(0.91, 0.73, 0.75), vec3(1.015, 0.99, 0.975), sh);
  cel = mix(cel, skinCel, skin);
  col *= cel;
  vec3 V = normalize(-vViewPos);
  float rim = fresnelDielectric(dot(V, N), 1.18) * uRimStrength;
  col += rim * uRimColor;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`.replace('KEY_LUMA', KEY_LUMA.toFixed(5))

export async function createCharacterMaterial(base = './models/tex/') {
  const loader = new THREE.TextureLoader()
  const uniforms = {
    uKeyDir: { value: new THREE.Vector3(0, 1, 1).normalize() },
    uShadowTint: { value: new THREE.Color() },
    uMidTint: { value: new THREE.Color() },
    uLightTint: { value: new THREE.Color() },
    uRimColor: { value: new THREE.Color() },
    uRimStrength: { value: 0.22 },
    uFaceEyeR: { value: 20 },
    uFaceEyeL: { value: 20 },
    uFaceMouth: { value: 0 },
    uFaceIrisR: { value: new THREE.Vector2() },
    uFaceIrisL: { value: new THREE.Vector2() },
    uFaceIrisScale: { value: 1 },
  }
  await Promise.all(
    Object.entries(TEX).map(async ([u, name]) => {
      const t = await loader.loadAsync(`${base}${name}.webp`)
      t.colorSpace = THREE.SRGBColorSpace // Blender 里都是 sRGB 贴图，节点里按线性取
      t.flipY = true
      t.anisotropy = 4
      uniforms[u] = { value: t }
    }),
  )
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide })
  mat.name = 'DS_TOON_WEB'
  setLook(mat, 'harbor', 'harbor', 1)
  return mat
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
function keyDir(look, out) {
  const [from, to] = look.key
  return out.set(from[0] - to[0], from[1] - to[1], from[2] - to[2]).normalize()
}
// r_keys.char_look 的 web 版：主题 a→b 按 p 插值（三色、边缘光、key 方向）
export function setLook(mat, a, b, p) {
  const A = CHARLOOK[a] || CHARLOOK.harbor
  const B = CHARLOOK[b] || A
  const u = mat.uniforms
  const lerp3 = (c, x, y) => c.setRGB(x[0] + (y[0] - x[0]) * p, x[1] + (y[1] - x[1]) * p, x[2] + (y[2] - x[2]) * p, THREE.LinearSRGBColorSpace)
  lerp3(u.uLightTint.value, A.light, B.light)
  lerp3(u.uMidTint.value, A.mid, B.mid)
  lerp3(u.uShadowTint.value, A.shadow, B.shadow)
  lerp3(u.uRimColor.value, A.rim, B.rim)
  u.uRimStrength.value = A.rs + (B.rs - A.rs) * p
  u.uKeyDir.value.copy(keyDir(A, _a).multiplyScalar(1 - p).add(keyDir(B, _b).multiplyScalar(p))).normalize()
}

// v2c 表情驱动值（逐帧，120fps；整数部分=图集条带，取最近帧不插值）
export async function loadFaceTrack(base = './data/face-v2c') {
  const meta = await (await fetch(`${base}.json`)).json()
  const data = new Float32Array(await (await fetch(`${base}.bin`)).arrayBuffer())
  const n = meta.channels.length
  return {
    meta,
    apply(mat, t) {
      const f = Math.max(0, Math.min(meta.frames - 1, Math.round(t * meta.fps)))
      const o = f * n
      const u = mat.uniforms
      u.uFaceEyeR.value = data[o]
      u.uFaceEyeL.value = data[o + 1]
      u.uFaceMouth.value = data[o + 2]
      u.uFaceIrisR.value.set(data[o + 3], data[o + 4])
      u.uFaceIrisL.value.set(data[o + 5], data[o + 6])
      u.uFaceIrisScale.value = data[o + 7]
    },
  }
}
