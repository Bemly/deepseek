import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { GLSL_NOISE, WATER_Y } from './util.js'
import { MOON_DIR } from './sky.js'

// 海面：平面镜反射 + 程序化波浪法线扰动 + 月光高光 + 荧光海（跟着 state.sea）。
// 反射里能看到霓虹城市、舞台和 MMD 角色本身。有水的主题（港湾/古风/和风）共用这一片，按主题换颜色。

export const OCEAN_DEFAULTS = {
  deep: [0.004, 0.012, 0.03],
  near: [0.0, 0.03, 0.05],
  bio: [0.1, 0.55, 1.0],
  sparkle: [0.5, 0.9, 1.0],
  spec: [0.8, 0.85, 1.0],
  ring: [1.0, 0.6, 0.3],
  lightDir: MOON_DIR.toArray(),
  waves: 1,
}
export function createOcean({ quality }) {
  const res = quality === 'low' ? 512 : quality === 'ultra' ? 2048 : 1024
  const shader = {
    name: 'NightOcean',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uTime: { value: 0 },
        uSea: { value: 0 },
        uPulse: { value: 0 },
        uHush: { value: 0 },
        uMoonDir: { value: MOON_DIR.clone() },
        uDeep: { value: new THREE.Vector3() },
        uNear: { value: new THREE.Vector3() },
        uBio: { value: new THREE.Vector3() },
        uSparkle: { value: new THREE.Vector3() },
        uSpec: { value: new THREE.Vector3() },
        uRing: { value: new THREE.Vector3() },
        uWaves: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 color;
      uniform float uTime, uSea, uPulse, uHush, uWaves;
      uniform vec3 uMoonDir, uDeep, uNear, uBio, uSparkle, uSpec, uRing;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${GLSL_NOISE}

      // 几组方向波的解析导数 + 噪声，距离越远振幅越小（抗闪烁）
      vec3 waveNormal(vec2 p, float dist) {
        vec2 g = vec2(0.0);
        float t = uTime;
        vec2 dirs[5];
        dirs[0] = normalize(vec2(1.0, 0.35));
        dirs[1] = normalize(vec2(-0.6, 1.0));
        dirs[2] = normalize(vec2(0.2, -1.0));
        dirs[3] = normalize(vec2(-1.0, -0.25));
        dirs[4] = normalize(vec2(0.75, 0.9));
        float freqs[5];
        freqs[0] = 0.012; freqs[1] = 0.021; freqs[2] = 0.037; freqs[3] = 0.066; freqs[4] = 0.11;
        float amps[5];
        amps[0] = 10.0; amps[1] = 6.0; amps[2] = 3.5; amps[3] = 2.0; amps[4] = 1.2;
        for (int i = 0; i < 5; i++) {
          float f = freqs[i];
          float fade = exp(-dist * f * 0.0035);
          float ph = dot(dirs[i], p) * f + t * sqrt(f * 9.8) * 2.2;
          g += dirs[i] * cos(ph) * f * amps[i] * fade * uWaves;
        }
        float nf = exp(-dist * 0.00045);
        vec2 q = p * 0.045 + vec2(t * 0.05, -t * 0.03);
        float e = 0.35;
        float n0 = fbm(q);
        g += vec2(fbm(q + vec2(e, 0.0)) - n0, fbm(q + vec2(0.0, e)) - n0) * 1.4 * nf * uWaves;
        return normalize(vec3(-g.x, 1.0, -g.y));
      }

      void main() {
        vec3 viewV = cameraPosition - vWorld;
        float dist = length(viewV);
        vec3 V = viewV / dist;
        vec3 N = waveNormal(vWorld.xz, dist);

        // 反射：沿法线扰动投影坐标。竖向拉长一些，让霓虹倒影成为长条
        vec4 uv = vUv;
        float k = 0.028 * (1.0 - smoothstep(2000.0, 30000.0, dist) * 0.7);
        uv.xy += vec2(N.x * 0.7, N.z * 1.9) * k * uv.w;
        vec3 refl = texture2DProj(tDiffuse, uv).rgb;
        // 反射里的极亮点（月亮、灯芯）软钳制，避免水面出现一整团白光
        refl = refl / (1.0 + max(0.0, max(refl.r, max(refl.g, refl.b)) - 1.5) * 0.6);

        float ndv = max(dot(N, V), 0.0);
        float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
        fres = clamp(fres, 0.0, 1.0);

        // 水体本色：深海蓝，靠近舞台稍带青色
        float nearStage = exp(-length(vWorld.xz) / 260.0);
        vec3 body = uDeep + uNear * nearStage * (0.4 + uSea);

        vec3 col = mix(body, refl, 0.35 + 0.65 * fres);

        // 月光高光路径
        vec3 H = normalize(uMoonDir + V);
        float spec = pow(max(dot(N, H), 0.0), 700.0) * 2.2 + pow(max(dot(N, H), 0.0), 80.0) * 0.05;
        col += uSpec * spec * (1.0 - 0.4 * uHush);

        // 荧光海：细碎发光的波纹，靠近舞台最密，随节拍呼吸
        float bioMask = exp(-length(vWorld.xz) / 1400.0) + 0.25 * exp(-length(vWorld.xz - vec2(-2200.0, -400.0)) / 500.0);
        vec2 bp = vWorld.xz * 0.055;
        float cell = abs(fbm(bp + vec2(uTime * 0.12, uTime * 0.07)) - 0.5);
        float lines = pow(1.0 - clamp(cell * 3.5, 0.0, 1.0), 14.0) * smoothstep(0.35, 0.7, vnoise(vWorld.xz * 0.01 + uTime * 0.03));
        float sparkle = step(0.997, hash12(floor(vWorld.xz * 0.35) + floor(uTime * 3.0))) * 0.8 * exp(-dist / 250.0);
        vec3 bio = uBio * lines + uSparkle * sparkle;
        col += bio * bioMask * uSea * (0.55 + 0.45 * uPulse) * exp(-dist / 900.0) * 0.45;

        // 舞台脚下一圈暖色光晕
        float ring = exp(-pow((length(vWorld.xz) - 46.0) / 10.0, 2.0));
        col += uRing * ring * 0.08;

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  }

  const geo = new THREE.PlaneGeometry(160000, 160000)
  const water = new Reflector(geo, {
    textureWidth: res,
    textureHeight: res,
    clipBias: 0.002,
    color: 0xffffff,
    shader,
    multisample: quality === 'low' ? 0 : 4,
  })
  water.material.fog = true
  water.rotation.x = -Math.PI / 2
  water.position.y = WATER_Y
  water.name = 'ocean'
  const u = water.material.uniforms

  return {
    object: water,
    setParams(p = {}) {
      const g = (k) => p[k] ?? OCEAN_DEFAULTS[k]
      for (const k of ['deep', 'near', 'bio', 'sparkle', 'spec', 'ring']) u['u' + k[0].toUpperCase() + k.slice(1)].value.set(...g(k))
      u.uMoonDir.value.set(...g('lightDir')).normalize()
      u.uWaves.value = g('waves')
    },
    setResolution(w, h) {
      const scale = quality === 'low' ? 0.35 : quality === 'ultra' ? 0.75 : 0.5
      water.getRenderTarget().setSize(Math.max(256, Math.round(w * scale)), Math.max(256, Math.round(h * scale)))
    },
    update(state) {
      u.uTime.value = state.t
      u.uSea.value = state.sea
      u.uPulse.value = state.pulse
      u.uHush.value = state.hush
    },
  }
}
