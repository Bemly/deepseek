import * as THREE from 'three'
import { GLSL_NOISE } from './util.js'

// 天空穹顶：夜空渐变 + 城市光污染 + 银河 + 星星 + 月亮 + 薄云 + 偶尔的流星。
// 远景，全部在 shader 里算，几何只是一个跟着相机走的大球。
export const MOON_DIR = new THREE.Vector3(-0.62, 0.34, -1).normalize()

export function createSky() {
  const uniforms = {
    uTime: { value: 0 },
    uMoonDir: { value: MOON_DIR.clone() },
    uCity: { value: 0 },
    uNeon: { value: 0 },
    uHush: { value: 0 },
    uFlash: { value: 0 },
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
      uniform vec3 uMoonDir;
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

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;

        // 基础渐变：天顶深蓝黑 → 地平线靛紫
        vec3 zenith = vec3(0.004, 0.007, 0.022);
        vec3 mid = vec3(0.012, 0.022, 0.065);
        vec3 horizon = vec3(0.045, 0.06, 0.14);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.15, 0.85, h));

        // 城市光污染：城市在 -Z 方向，地平线附近洋红 + 青色
        float towardCity = max(0.0, -d.z) * (0.6 + 0.4 * (1.0 - abs(d.x)));
        float glowBand = exp(-max(h, 0.0) * 9.0) * towardCity;
        vec3 cityGlow = mix(vec3(0.35, 0.08, 0.28), vec3(0.05, 0.25, 0.4), smoothstep(0.0, 0.12, h));
        col += cityGlow * glowBand * (0.25 + 0.9 * uCity) * (0.6 + 0.4 * uNeon);

        // 银河
        vec3 bandN = normalize(vec3(0.55, 0.35, 0.75));
        float bd = dot(d, bandN);
        float band = exp(-bd * bd * 18.0);
        float mw = fbm3(d * 5.0) * fbm3(d * 11.0 + 3.0);
        col += vec3(0.05, 0.06, 0.12) * band * smoothstep(0.1, 0.5, mw) * 1.6 * smoothstep(0.0, 0.25, h);

        // 星星（三层密度），地平线附近被大气吃掉
        float starFade = smoothstep(0.02, 0.3, h) * (1.0 - 0.6 * uCity * exp(-h * 3.0));
        vec3 st = stars(d, 220.0, 0.985) * 1.6 + stars(d, 480.0, 0.992) * 1.2 + stars(d, 900.0, 0.994) * band * 2.0;
        col += st * starFade;

        // 月亮
        float md = dot(d, uMoonDir);
        float moonR = 0.9994;
        float disc = smoothstep(moonR - 0.00006, moonR + 0.00002, md);
        vec3 tangent = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        vec3 bit = cross(tangent, uMoonDir);
        vec2 mp = vec2(dot(d - uMoonDir, tangent), dot(d - uMoonDir, bit)) / sqrt(1.0 - moonR * moonR);
        float maria = fbm(mp * 3.0 + 4.0);
        float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
        vec3 moonCol = vec3(1.0, 0.97, 0.9) * (0.75 + 0.25 * limb) * (0.82 + 0.3 * smoothstep(0.35, 0.65, maria));
        col = mix(col, moonCol * 3.2, disc);
        float halo = pow(max(md, 0.0), 900.0) * 1.2 + pow(max(md, 0.0), 60.0) * 0.12 + pow(max(md, 0.0), 8.0) * 0.03;
        col += vec3(0.55, 0.65, 0.9) * halo;

        // 薄云：平面投影，月光勾边，底下被城市照成粉紫
        if (h > 0.0) {
          vec2 cp = d.xz / (h + 0.08) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
          float c = fbm(cp * 1.2);
          c = smoothstep(0.52, 0.8, c) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.9, h));
          float lit = pow(max(md, 0.0), 6.0);
          vec3 cloudCol = vec3(0.05, 0.06, 0.1) + vec3(0.35, 0.4, 0.55) * lit + cityGlow * towardCity * 0.6 * (0.3 + uCity);
          col = mix(col, cloudCol, c * 0.75);
        }

        // 流星：每 7 秒一颗，位置由时间片哈希决定
        float slot = floor(uTime / 7.0);
        float ft = fract(uTime / 7.0) * 7.0;
        if (ft < 0.9) {
          vec3 r = hash33(vec3(slot, 3.1, 7.7));
          vec3 start = normalize(vec3(r.x * 2.0 - 1.0, 0.35 + r.y * 0.4, -0.2 - r.z));
          vec3 dir = normalize(cross(start, vec3(0.3, 1.0, 0.2)));
          vec3 head = normalize(start + dir * ft * 0.45);
          vec3 tail = normalize(start + dir * max(0.0, ft - 0.25) * 0.45);
          vec3 ab = head - tail;
          float k = clamp(dot(d - tail, ab) / dot(ab, ab), 0.0, 1.0);
          float dist = length(d - (tail + ab * k));
          col += vec3(0.8, 0.9, 1.0) * smoothstep(0.0012, 0.0, dist) * k * (1.0 - ft / 0.9) * 2.5;
        }

        // 屏息段：天空压暗；终段闪光：整体提亮
        col *= 1.0 - 0.35 * uHush;
        col += vec3(0.12, 0.16, 0.3) * uFlash * exp(-max(h, 0.0) * 2.0);

        // 地平线以下：接近雾色，避免穿帮
        vec3 fogCol = vec3(0.018, 0.028, 0.07);
        col = mix(col, fogCol, smoothstep(0.0, -0.05, h));
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
