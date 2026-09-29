import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

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

// 主题过渡：同一个场景按两个主题各渲染一遍，再用"从舞台中心向外扩散的噪声溶解 + 发光边缘"混合。
// 没在过渡时就是普通的一遍渲染。
const MixShader = {
  uniforms: {
    tA: { value: null },
    tB: { value: null },
    uP: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uEdge: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA, tB;
    uniform float uP, uTime, uAspect;
    uniform vec3 uEdge;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
    void main() {
      vec2 c = (vUv - vec2(0.5, 0.45)) * vec2(uAspect, 1.0);
      float radial = length(c) / (0.5 * sqrt(uAspect * uAspect + 1.0));
      float mask = radial * 0.62 + fbm(vUv * vec2(uAspect, 1.0) * 3.5 + uTime * 0.15) * 0.38;
      float th = uP * 1.25 - 0.1;
      float w = 0.045;
      float k = smoothstep(th - w * 0.4, th + w * 0.4, mask); // 1 = 还是旧主题
      vec3 a = texture2D(tA, vUv).rgb;
      vec3 b = texture2D(tB, vUv).rgb;
      vec3 col = mix(b, a, k);
      float edge = exp(-pow((mask - th) / w, 2.0)) * step(0.001, uP) * step(uP, 0.999);
      col += uEdge * edge * 2.2;
      // 边缘附近零星的火花
      float sp = step(0.985, h(floor(vUv * vec2(uAspect, 1.0) * 220.0) + floor(uTime * 12.0))) * exp(-pow((mask - th) / (w * 3.0), 2.0));
      col += uEdge * sp * 3.0 * step(0.001, uP) * step(uP, 0.999);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

class ThemeRenderPass extends Pass {
  constructor(scene, camera, world) {
    super()
    this.scene = scene
    this.camera = camera
    this.world = world
    this.needsSwap = false
    this.rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    this.rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    this.mat = new THREE.ShaderMaterial({ ...MixShader, uniforms: THREE.UniformsUtils.clone(MixShader.uniforms), depthTest: false, depthWrite: false })
    this.quad = new FullScreenQuad(this.mat)
  }
  setSize(w, h) {
    this.rtA.setSize(w, h)
    this.rtB.setSize(w, h)
    this.mat.uniforms.uAspect.value = w / h
  }
  render(renderer, writeBuffer, readBuffer) {
    const mix = this.world?.mix
    const target = this.renderToScreen ? null : readBuffer
    if (!mix) {
      if (this.world) this.world.applyTheme(this.world.applied)
      renderer.setRenderTarget(target)
      renderer.clear()
      renderer.render(this.scene, this.camera)
      return
    }
    this.world.applyTheme(mix.a)
    renderer.setRenderTarget(this.rtA)
    renderer.clear()
    renderer.render(this.scene, this.camera)
    this.world.applyTheme(mix.b)
    renderer.setRenderTarget(this.rtB)
    renderer.clear()
    renderer.render(this.scene, this.camera)
    const u = this.mat.uniforms
    u.tA.value = this.rtA.texture
    u.tB.value = this.rtB.texture
    u.uP.value = mix.p
    u.uTime.value = this.world.state.t
    u.uEdge.value.set(...(mix.accent ?? [1, 1, 1]))
    renderer.setRenderTarget(target)
    this.quad.render(renderer)
  }
  dispose() {
    this.rtA.dispose()
    this.rtB.dispose()
    this.mat.dispose()
    this.quad.dispose()
  }
}

export function createPostFX(renderer, scene, camera, { bloom = true, world = null } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, rt)
  const renderPass = world ? new ThemeRenderPass(scene, camera, world) : new RenderPass(scene, camera)
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
        let themeExp = 1
        if (world) themeExp = world.mix ? THREE.MathUtils.lerp(world.exposureOf(world.mix.a), world.exposureOf(world.mix.b), world.mix.p) : world.exposureOf(world.applied)
        renderer.toneMappingExposure = 0.95 * state.exposure * themeExp
        grade.uniforms.uTime.value = state.t
        grade.uniforms.uGlitch.value = state.glitch
        grade.uniforms.uFlash.value = state.recoverFlash * 0.25 + state.finaleFlash * 0.12
        bloomPass.strength = 0.5 + 0.15 * state.pulse + 0.3 * state.finaleFlash
      }
      composer.render()
    },
  }
}
