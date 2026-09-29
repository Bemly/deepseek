import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// 后期：高光钳制 → 泛光（霓虹必需）→ 调色/暗角/色散/故障（"system falls" 时）→ ACES 色调映射输出

// 把极亮的镜面高光钳住，避免清漆/金属上的点光高光在泛光里炸成一大团
const ClampShader = {
  name: 'ClampShader',
  uniforms: { tDiffuse: { value: null }, uMax: { value: 5.0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float m = max(max(c.r, c.g), c.b);
      if (m > uMax) c *= uMax / m;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
}
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uFlash: { value: 0 },
    uVignette: { value: 1 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGlitch, uFlash, uVignette, uAspect;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // 故障：横向错位条
      if (uGlitch > 0.01) {
        float band = floor(uv.y * 24.0 + floor(uTime * 20.0) * 7.0);
        float r = h(vec2(band, floor(uTime * 20.0)));
        if (r < uGlitch * 0.5) uv.x += (h(vec2(band, 3.0)) - 0.5) * 0.08 * uGlitch;
      }
      vec2 c = uv - 0.5;
      float ca = 0.0018 + uGlitch * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca * 2.0 + vec2(uGlitch * 0.004, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca * 2.0 - vec2(uGlitch * 0.004, 0.0)).b;
      // 冷色阴影、暖色高光的轻度分离色调
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += vec3(-0.002, 0.0, 0.006) * (1.0 - smoothstep(0.0, 0.2, l));
      col *= mix(vec3(1.0), vec3(1.04, 1.0, 0.95), smoothstep(0.3, 2.0, l));
      // 暗角
      vec2 vc = c * vec2(uAspect, 1.0);
      col *= mix(1.0, smoothstep(1.05, 0.25, length(vc)), 0.55 * uVignette);
      // 颗粒
      col += (h(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * 0.012 * (0.4 + uGlitch);
      col += vec3(0.25, 0.3, 0.45) * uFlash;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
}

export function createPostFX(renderer, scene, camera, { bloom = true } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, rt)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)
  composer.addPass(new ShaderPass(ClampShader))
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.4, 1.0)
  bloomPass.enabled = bloom
  composer.addPass(bloomPass)
  const grade = new ShaderPass(GradeShader)
  composer.addPass(grade)
  composer.addPass(new OutputPass())

  return {
    composer,
    bloomPass,
    setCamera(cam) {
      renderPass.camera = cam
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(w, h)
      grade.uniforms.uAspect.value = w / h
    },
    render(state) {
      if (state) {
        renderer.toneMappingExposure = 0.95 * state.exposure
        grade.uniforms.uTime.value = state.t
        grade.uniforms.uGlitch.value = state.glitch
        grade.uniforms.uFlash.value = state.recoverFlash * 0.25 + state.finaleFlash * 0.12
        bloomPass.strength = 0.5 + 0.15 * state.pulse + 0.3 * state.finaleFlash
      }
      composer.render()
    },
  }
}
