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
      // 个别像素会出 NaN/Inf，泛光会把它糊满整屏变黑——在进泛光之前清掉
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      c = max(c, vec3(0.0));
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
      // 溶解边：一条细亮线 + 很淡的外晕（泛光会再把它晕开，所以本身要克制），首尾淡入淡出
      float env = sin(clamp(uP, 0.0, 1.0) * 3.14159);
      float core = exp(-pow((mask - th) / (w * 0.3), 2.0));
      float glow = exp(-pow((mask - th) / (w * 1.2), 2.0));
      col += uEdge * (core * 1.0 + glow * 0.15) * env;
      // 边缘附近零星的火花
      float sp = step(0.988, h(floor(vUv * vec2(uAspect, 1.0) * 260.0) + floor(uTime * 12.0))) * exp(-pow((mask - th) / (w * 1.5), 2.0));
      col += uEdge * sp * 1.5 * env;
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
    this.rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) })
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


// ---------------- 管线·blend版：LetMeGo-dschan/pipeline/post_final.py 的逐式复刻 ----------------
// 场景层（角色是 holdout：只写深度的黑剪影）→ 钳制 → 泛光(×1.15) → ACES（曝光 = 0.95×歌曲曝光×主题曝光）→ sRGB；
// 角色层单独渲染（不吃雾、不吃溶解、不过 ACES，Blender Standard 视图 = 直接 sRGB），盖在 holdout 上，
// 角色下面只留三成泛光；最后在显示空间里调色（故障条、色散、分离色调、暗角、颗粒、闪白）。
const ACES_GLSL = /* glsl */ `
  vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 acesFilmic(vec3 c, float expo) {
    const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    c *= expo / 0.6;
    return clamp(O * RRTAndODTFit(I * c), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 x) { x = clamp(x, 0.0, 1.0); return mix(12.92 * x, 1.055 * pow(max(x, vec3(1e-9)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x)); }
`
const BlendCompositeShader = {
  uniforms: { tPre: { value: null }, tPost: { value: null }, tChar: { value: null }, uExpo: { value: 1 }, uFlashAdd: { value: new THREE.Vector3() } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tPre, tPost, tChar;
    uniform float uExpo;
    uniform vec3 uFlashAdd;
    varying vec2 vUv;
    ${ACES_GLSL}
    void main() {
      vec3 pre = texture2D(tPre, vUv).rgb;
      vec3 bl = max(texture2D(tPost, vUv).rgb - pre, 0.0);
      vec3 sceneLin = pre + uFlashAdd;
      vec3 bgA = toSRGB(acesFilmic(sceneLin + bl, uExpo));
      vec3 bgC = toSRGB(acesFilmic(sceneLin + bl * 0.3, uExpo));   // 角色身上只罩一层淡淡的泛光，保持清楚
      vec4 ch = texture2D(tChar, vUv);                              // 预乘、线性
      float ca = clamp(ch.a, 0.0, 1.0);
      vec3 chDisp = ca > 0.0 ? toSRGB(ch.rgb / ca) * ca : vec3(0.0);
      gl_FragColor = vec4(bgA * (1.0 - ca) + bgC * ca + chDisp, 1.0);
    }
  `,
}
const BlendGradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGlitch: { value: 0 }, uFlash: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGlitch, uFlash, uAspect;
    varying vec2 vUv;
    float hsh(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453); }
    float ss(float e0, float e1, float x) { float q = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return q * q * (3.0 - 2.0 * q); }
    void main() {
      vec2 uv = vUv;
      if (uGlitch > 0.01) {
        float band = floor(vUv.y * 24.0 + floor(uTime * 20.0) * 7.0);
        float r = hsh(vec2(band, floor(uTime * 20.0)));
        if (r < uGlitch * 0.5) uv.x += (hsh(vec2(band, 3.0)) - 0.5) * 0.08 * uGlitch;
      }
      vec2 c = vUv - 0.5;
      float ca = 0.0018 + uGlitch * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca * 2.0 + vec2(uGlitch * 0.004, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca * 2.0 - vec2(uGlitch * 0.004, 0.0)).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += vec3(-0.004, 0.0, 0.01) * (1.0 - ss(0.0, 0.25, l));
      float rr = length(c * vec2(uAspect, 1.0));
      col *= 1.0 + (ss(1.05, 0.25, rr) - 1.0) * 0.5;
      col += (hsh(floor(gl_FragCoord.xy) + floor(uTime * 120.0) * 0.37) - 0.5) * 0.02 * (0.4 + uGlitch);
      col += vec3(0.25, 0.3, 0.45) * uFlash * 0.35;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
}
const CopyShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
}

class BlendPipeline {
  constructor(renderer, scene, themePass, bloomPass, world) {
    Object.assign(this, { renderer, scene, themePass, bloomPass, world, character: null })
    const rt = (opt = {}) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, ...opt })
    this.sceneRT = rt({ samples: 4, depthTexture: new THREE.DepthTexture(1, 1) })
    this.preRT = rt()
    this.postRT = rt()
    this.charRT = rt({ samples: 4 })
    this.compRT = rt()
    const quad = (sh) => new FullScreenQuad(new THREE.ShaderMaterial({ ...sh, uniforms: THREE.UniformsUtils.clone(sh.uniforms), depthTest: false, depthWrite: false }))
    this.clampQ = quad(ClampShader)
    this.copyQ = quad(CopyShader)
    this.compQ = quad(BlendCompositeShader)
    this.gradeQ = quad(BlendGradeShader)
    this.w = 1
    this.h = 1
  }
  setSize(w, h) {
    this.w = w
    this.h = h
    for (const r of [this.sceneRT, this.preRT, this.postRT, this.charRT, this.compRT]) r.setSize(w, h)
    this.gradeQ.material.uniforms.uAspect.value = w / h
  }
  render(state, themeExp) {
    const { renderer, scene, world, character } = this
    const st = state || { t: 0, exposure: 1, pulse: 0, glitch: 0, recoverFlash: 0, finaleFlash: 0 }
    const flash = st.recoverFlash * 0.25 + st.finaleFlash * 0.12
    // 1) 场景层：角色当 holdout（黑剪影写深度），溶解等照旧
    character?.setPassMode('holdout')
    this.themePass.render(renderer, null, this.sceneRT)
    const depth = world?.mix ? this.themePass.rtB.depthTexture : this.sceneRT.depthTexture
    // 2) 钳制 → 存一份泛光前 → 泛光
    this.clampQ.material.uniforms.tDiffuse.value = this.sceneRT.texture
    renderer.setRenderTarget(this.preRT)
    this.clampQ.render(renderer)
    this.copyQ.material.uniforms.tDiffuse.value = this.preRT.texture
    renderer.setRenderTarget(this.postRT)
    this.copyQ.render(renderer)
    if (this.bloomPass.enabled) {
      this.bloomPass.strength = (0.5 + 0.15 * st.pulse + 0.3 * st.finaleFlash) * 1.15
      this.bloomPass.render(renderer, null, this.postRT)
    }
    // 3) 角色层：只画角色，按场景深度裁掉被挡住的部分（= holdout 遮挡），透明底
    const bg = scene.background
    const fog = scene.fog
    const clear = renderer.getClearColor(new THREE.Color())
    const clearA = renderer.getClearAlpha()
    renderer.setRenderTarget(this.charRT)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    if (character?.ready && character.group.visible) {
      character.setPassMode('char', depth, this.w, this.h)
      scene.background = null
      scene.fog = null
      if (world) world.root.visible = false
      renderer.render(scene, this.themePass.camera)
      if (world) world.root.visible = true
      scene.background = bg
      scene.fog = fog
    }
    character?.setPassMode('normal')
    renderer.setClearColor(clear, clearA)
    // 4) 合成：ACES/sRGB 的场景 + 显示空间的角色
    const cu = this.compQ.material.uniforms
    cu.tPre.value = this.preRT.texture
    cu.tPost.value = this.postRT.texture
    cu.tChar.value = this.charRT.texture
    cu.uExpo.value = 0.95 * st.exposure * themeExp
    cu.uFlashAdd.value.set(0.12, 0.16, 0.3).multiplyScalar(flash)
    renderer.setRenderTarget(this.compRT)
    this.compQ.render(renderer)
    // 5) 显示空间调色 → 屏幕
    const gu = this.gradeQ.material.uniforms
    gu.tDiffuse.value = this.compRT.texture
    gu.uTime.value = st.t
    gu.uGlitch.value = st.glitch
    gu.uFlash.value = flash
    renderer.setRenderTarget(null)
    this.gradeQ.render(renderer)
  }
}

export function createPostFX(renderer, scene, camera, { bloom = true, world = null } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, rt)
  const renderPass = world ? new ThemeRenderPass(scene, camera, world) : new RenderPass(scene, camera)
  composer.addPass(renderPass)
  const clamp = new ShaderPass(ClampShader)
  composer.addPass(clamp)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.4, 1.0)
  bloomPass.enabled = bloom
  composer.addPass(bloomPass)
  const grade = new ShaderPass(GradeShader)
  composer.addPass(grade)
  composer.addPass(new OutputPass())

  // 渲染管线：blend（默认）= v2c 的 post_final.py 复刻（角色单独一层，见 BlendPipeline）；
  // web = 仓库原本的网页后期链（角色和场景一起过泛光/ACES）；simple = 关泛光/故障/闪白/暗角的干净版。只管后期，不碰场景。
  const blendPipe = new BlendPipeline(renderer, scene, renderPass, bloomPass, world)
  let pipeline = 'blend'
  function setPipeline(name) {
    pipeline = name === 'simple' || name === 'web' ? name : 'blend'
    const simple = pipeline === 'simple'
    bloomPass.enabled = simple ? false : bloom
    clamp.uniforms.uMax.value = simple ? 1e5 : 5.0
  }

  return {
    composer,
    bloomPass,
    setPipeline,
    setCharacter(c) {
      blendPipe.character = c
    },
    get pipeline() {
      return pipeline
    },
    setCamera(cam) {
      renderPass.camera = cam
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(w, h)
      grade.uniforms.uAspect.value = w / h
      const pr = renderer.getPixelRatio()
      blendPipe.setSize(Math.floor(w * pr), Math.floor(h * pr))
    },
    render(state) {
      let themeExp = 1
      if (world) themeExp = world.mix ? THREE.MathUtils.lerp(world.exposureOf(world.mix.a), world.exposureOf(world.mix.b), world.mix.p) : world.exposureOf(world.applied)
      if (pipeline === 'blend') {
        blendPipe.render(state, themeExp)
        return
      }
      if (state) {
        const simple = pipeline === 'simple'
        renderer.toneMappingExposure = (simple ? 1 : 0.95) * state.exposure * themeExp
        grade.uniforms.uTime.value = state.t
        grade.uniforms.uGlitch.value = simple ? 0 : state.glitch
        grade.uniforms.uFlash.value = simple ? 0 : state.recoverFlash * 0.25 + state.finaleFlash * 0.12
        grade.uniforms.uVignette.value = simple ? 0 : 1
        if (bloomPass.enabled) bloomPass.strength = 0.5 + 0.15 * state.pulse + 0.3 * state.finaleFlash
      }
      composer.render()
    },
  }
}
