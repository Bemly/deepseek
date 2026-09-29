import * as THREE from 'three'
import { GLSL_NOISE } from './util.js'

// 天空穹顶（所有主题共用一个，按主题换参数）：
// 渐变 + 地平线辉光 + 银河 + 星星 + 月亮/太阳 + 薄云 + 偶尔的流星；水下模式则变成仰望海面（斯涅尔窗 + 焦散）。
// 远景，全部在 shader 里算，几何只是一个跟着相机走的大球。
export const MOON_DIR = new THREE.Vector3(-0.62, 0.34, -1).normalize()

const v3 = (a) => new THREE.Vector3(...a)

// 港湾夜景的参数，也是其他主题没写的项的默认值
export const SKY_DEFAULTS = {
  zenith: [0.004, 0.007, 0.022],
  mid: [0.012, 0.022, 0.065],
  horizon: [0.045, 0.06, 0.14],
  below: [0.018, 0.028, 0.07],
  glowLow: [0.35, 0.08, 0.28],
  glowHigh: [0.05, 0.25, 0.4],
  glowDir: [0, 0, -1],
  glowAmt: 1,
  stars: 1,
  milky: 1,
  meteors: 1,
  orbDir: MOON_DIR.toArray(),
  orbSize: 0.9994,
  orbColor: [1, 0.97, 0.9],
  orbBright: 3.2,
  orbHalo: [0.55, 0.65, 0.9],
  orbHaloAmt: 1,
  orbKind: 0, // 0 = 月亮（有月海）1 = 太阳（柔边大光晕）
  cloudAmt: 0.75,
  cloudBase: [0.05, 0.06, 0.1],
  cloudLit: [0.35, 0.4, 0.55],
  cloudScale: 1.4,
  cloudLow: 0.52,
  under: 0,
}

export function createSky() {
  const uniforms = {
    uTime: { value: 0 },
    uCity: { value: 0 },
    uNeon: { value: 0 },
    uHush: { value: 0 },
    uFlash: { value: 0 },
  }
  const keys = {}
  for (const [k, v] of Object.entries(SKY_DEFAULTS)) {
    const name = 'u' + k[0].toUpperCase() + k.slice(1)
    keys[k] = name
    uniforms[name] = { value: Array.isArray(v) ? v3(v) : v }
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // 永远画在最远处
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCity, uNeon, uHush, uFlash;
      uniform vec3 uZenith, uMid, uHorizon, uBelow, uGlowLow, uGlowHigh, uGlowDir;
      uniform float uGlowAmt, uStars, uMilky, uMeteors;
      uniform vec3 uOrbDir, uOrbColor, uOrbHalo;
      uniform float uOrbSize, uOrbBright, uOrbHaloAmt, uOrbKind;
      uniform float uCloudAmt, uCloudScale, uCloudLow;
      uniform vec3 uCloudBase, uCloudLit;
      uniform float uUnder;
      varying vec3 vDir;
      ${GLSL_NOISE}

      vec3 stars(vec3 d, float scale, float thresh) {
        vec3 p = d * scale;
        vec3 id = floor(p);
        vec3 f = fract(p) - 0.5;
        float h = hash13(id);
        if (h < thresh) return vec3(0.0);
        vec3 o = (hash33(id) - 0.5) * 0.7;
        float r = length(f - o);
        float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
        float b = smoothstep(0.09, 0.0, r) * tw * pow((h - thresh) / (1.0 - thresh), 1.5);
        vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash13(id + 7.0));
        return tint * b;
      }

      vec3 underwater(vec3 d) {
        // 水下：往下是深渊，往上越来越亮，头顶一圈斯涅尔窗，窗里是晃动的海面
        float h = d.y;
        vec3 col = mix(uBelow, uHorizon, smoothstep(-0.7, 0.05, h));
        col = mix(col, uMid, smoothstep(0.05, 0.5, h));
        col = mix(col, uZenith, smoothstep(0.45, 0.85, h));
        float win = smoothstep(0.6, 0.72, h);
        vec2 sp = d.xz / max(h, 0.05) * 1.6;
        float r1 = fbm(sp * 1.3 + vec2(uTime * 0.12, uTime * 0.05));
        float r2 = fbm(sp * 2.7 - vec2(uTime * 0.08, uTime * 0.11));
        float caustic = pow(1.0 - abs(r1 - r2) * 2.0, 6.0);
        col += uOrbHalo * win * (0.35 + 1.2 * caustic);
        float md = max(dot(d, uOrbDir), 0.0);
        col += uOrbColor * (pow(md, 60.0) * uOrbBright + pow(md, 6.0) * 0.15) * win;
        // 远处城市方向的辉光
        float toward = max(0.0, dot(normalize(vec3(d.x, 0.0001, d.z)), normalize(vec3(uGlowDir.x, 0.0, uGlowDir.z))));
        col += uGlowLow * exp(-abs(h) * 6.0) * toward * uGlowAmt * (0.3 + uCity);
        return col;
      }

      void main() {
        vec3 d = normalize(vDir);
        if (uUnder > 0.5) {
          vec3 c = underwater(d) * (1.0 - 0.35 * uHush) + uGlowHigh * uFlash * 0.3;
          gl_FragColor = vec4(c, 1.0);
          return;
        }
        float h = d.y;

        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
        col = mix(col, uZenith, smoothstep(0.15, 0.85, h));

        // 地平线辉光（城市灯火 / 夕阳）
        vec3 gd = normalize(vec3(uGlowDir.x, 0.0, uGlowDir.z));
        float toward = max(0.0, dot(normalize(vec3(d.x, 0.0001, d.z)), gd));
        toward = toward * (0.6 + 0.4 * toward);
        float glowBand = exp(-max(h, 0.0) * 9.0) * toward;
        vec3 glowCol = mix(uGlowLow, uGlowHigh, smoothstep(0.0, 0.12, h));
        col += glowCol * glowBand * (0.25 + 0.9 * uCity) * (0.6 + 0.4 * uNeon) * uGlowAmt;

        // 银河
        vec3 bandN = normalize(vec3(0.55, 0.35, 0.75));
        float bd = dot(d, bandN);
        float band = exp(-bd * bd * 18.0);
        float mw = fbm3(d * 5.0) * fbm3(d * 11.0 + 3.0);
        col += vec3(0.05, 0.06, 0.12) * band * smoothstep(0.1, 0.5, mw) * 1.6 * smoothstep(0.0, 0.25, h) * uMilky;

        // 星星
        float starFade = smoothstep(0.02, 0.3, h) * (1.0 - 0.6 * uCity * exp(-h * 3.0));
        vec3 st = stars(d, 220.0, 0.985) * 1.6 + stars(d, 480.0, 0.992) * 1.2 + stars(d, 900.0, 0.994) * band * 2.0;
        col += st * starFade * uStars;

        // 月亮 / 太阳
        float md = dot(d, uOrbDir);
        float sinR = sqrt(max(1e-6, 1.0 - uOrbSize * uOrbSize));
        float disc = smoothstep(uOrbSize - sinR * 0.0017, uOrbSize + sinR * 0.0006, md);
        vec3 tangent = normalize(cross(uOrbDir, vec3(0.0, 1.0, 0.0)));
        vec3 bit = cross(tangent, uOrbDir);
        vec2 mp = vec2(dot(d - uOrbDir, tangent), dot(d - uOrbDir, bit)) / sinR;
        float maria = fbm(mp * 3.0 + 4.0);
        float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
        vec3 orb = uOrbColor * (uOrbKind < 0.5 ? (0.75 + 0.25 * limb) * (0.82 + 0.3 * smoothstep(0.35, 0.65, maria)) : 1.0);
        col = mix(col, orb * uOrbBright, disc);
        float mdp = max(md, 0.0);
        float halo = pow(mdp, 900.0) * 1.2 + pow(mdp, 60.0) * 0.12 + pow(mdp, 8.0) * 0.03;
        if (uOrbKind > 0.5) halo = pow(mdp, 400.0) * 1.5 + pow(mdp, 30.0) * 0.35 + pow(mdp, 4.0) * 0.12;
        col += uOrbHalo * halo * uOrbHaloAmt;

        // 薄云：平面投影，被月光/太阳勾边，底部被地平线辉光染色
        if (h > 0.0 && uCloudAmt > 0.0) {
          vec2 cp = d.xz / (h + 0.08) * uCloudScale + vec2(uTime * 0.004, uTime * 0.0015);
          float c = fbm(cp * 1.2);
          c = smoothstep(uCloudLow, uCloudLow + 0.28, c) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.9, h));
          float lit = pow(mdp, 6.0);
          vec3 cloudCol = uCloudBase + uCloudLit * lit + glowCol * toward * 0.6 * (0.3 + uCity) * uGlowAmt;
          col = mix(col, cloudCol, c * uCloudAmt);
        }

        // 流星：每 7 秒一颗
        float slot = floor(uTime / 7.0);
        float ft = fract(uTime / 7.0) * 7.0;
        if (ft < 0.9 && uMeteors > 0.0) {
          vec3 r = hash33(vec3(slot, 3.1, 7.7));
          vec3 start = normalize(vec3(r.x * 2.0 - 1.0, 0.35 + r.y * 0.4, -0.2 - r.z));
          vec3 dir = normalize(cross(start, vec3(0.3, 1.0, 0.2)));
          vec3 head = normalize(start + dir * ft * 0.45);
          vec3 tail = normalize(start + dir * max(0.0, ft - 0.25) * 0.45);
          vec3 ab = head - tail;
          float k = clamp(dot(d - tail, ab) / dot(ab, ab), 0.0, 1.0);
          float dist = length(d - (tail + ab * k));
          col += vec3(0.8, 0.9, 1.0) * smoothstep(0.0012, 0.0, dist) * k * (1.0 - ft / 0.9) * 2.5 * uMeteors;
        }

        col *= 1.0 - 0.35 * uHush;
        col += vec3(0.12, 0.16, 0.3) * uFlash * exp(-max(h, 0.0) * 2.0);
        col = mix(col, uBelow, smoothstep(0.0, -0.05, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat)
  mesh.scale.setScalar(50000)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  mesh.name = 'sky'

  return {
    object: mesh,
    uniforms,
    // 切主题时调用：没给的参数回到默认（港湾夜景）
    setParams(p = {}) {
      for (const [k, name] of Object.entries(keys)) {
        const v = p[k] ?? SKY_DEFAULTS[k]
        if (Array.isArray(v)) uniforms[name].value.set(v[0], v[1], v[2])
        else uniforms[name].value = v
      }
      uniforms.uOrbDir.value.normalize()
    },
    update(state, camera) {
      mesh.position.copy(camera.position)
      uniforms.uTime.value = state.t
      uniforms.uCity.value = state.city
      uniforms.uNeon.value = state.neon
      uniforms.uHush.value = state.hush
      uniforms.uFlash.value = state.finaleFlash + state.recoverFlash * 0.4
    },
  }
}
