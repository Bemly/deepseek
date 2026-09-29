import * as THREE from 'three'
import { computeState } from '../state.js'
import { createSky, MOON_DIR } from './sky.js'
import { createOcean } from './ocean.js'
import { createScreens } from './screens.js'
import { THEME_FACTORIES, THEME_ORDER } from './themes/index.js'
import { setTreeWind } from './trees.js'

// 场景总装 + 主题切换。对外：
//   const world = createWorld(renderer, { quality })
//   world.attach(scene)                   // 加进你的场景（雾、环境光、灯光一起装好）
//   world.update(songTimeSeconds, camera) // 每帧调用，场景状态完全由歌曲时间决定
//   world.transitionTo('ancient', 2.5)    // 手动切主题（按真实时间过渡）
//   world.setSchedule([...])              // 或者按歌曲时间排程切换（可逐帧离线渲染）
// MMD 模型站在 world.anchor（原点），台面 y = 0，面朝 +Z。所有主题都遵守这个约定。

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

function buildEnvironment(renderer, spec) {
  // 给近景 PBR 材质用的环境反射：天空渐变 + 几块有颜色的"反光板"
  const env = new THREE.Scene()
  const u = {
    uTop: { value: new THREE.Vector3(...spec.top) },
    uHor: { value: new THREE.Vector3(...spec.horizon) },
    uGlow: { value: new THREE.Vector3(...spec.glow) },
  }
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(100, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: u,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uHor, uGlow;
          varying vec3 vP;
          void main() {
            float h = vP.y;
            vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.7, h));
            c += uGlow * exp(-abs(h) * 8.0) * max(0.0, -vP.z);
            c = mix(c, uHor * 0.3, smoothstep(0.0, -0.3, h));
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    ),
  )
  for (const [color, pos, size] of spec.panels ?? []) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), side: THREE.DoubleSide }))
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    env.add(m)
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(env, 0.02)
  pmrem.dispose()
  return rt.texture
}

export function createWorld(renderer, { quality = 'high', themes = THEME_ORDER, initial } = {}) {
  const root = new THREE.Group()
  root.name = 'ds-chan-world'

  const screens = createScreens()
  const sky = createSky()
  const ocean = createOcean({ quality })
  root.add(sky.object, ocean.object)

  const hemi = new THREE.HemisphereLight(0x2a3d7a, 0x06080e, 1.1)
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.9)
  moon.position.copy(MOON_DIR).multiplyScalar(500)
  root.add(hemi, moon)

  const ctx = { screens, quality }
  const list = themes.map((name) => {
    const th = THEME_FACTORIES[name](ctx)
    th.envMap = buildEnvironment(renderer, th.env)
    th.root.visible = false
    root.add(th.root)
    return th
  })
  const byName = Object.fromEntries(list.map((t) => [t.name, t]))

  const fog = new THREE.FogExp2(0x000000, 0.00005)
  let scene = null
  let current = initial && byName[initial] ? initial : list[0].name
  let manual = null // { from, to, start, dur }（真实时间）
  let schedule = null // [{ t, theme, duration }]（歌曲时间）
  let applied = null

  function applyTheme(name) {
    const th = byName[name]
    if (!th) return
    for (const t of list) t.root.visible = t === th
    sky.setParams(th.sky)
    ocean.object.visible = th.ocean !== null
    if (th.ocean) ocean.setParams(th.ocean)
    fog.color.setRGB(...th.fog.color)
    fog.density = th.fog.density
    if (scene) {
      scene.environment = th.envMap
      if (scene.background?.isColor) scene.background.setRGB(...th.fog.color)
    }
    hemi.color.set(th.hemi.sky)
    hemi.groundColor.set(th.hemi.ground)
    hemi.intensity = th.hemi.intensity * (1 - 0.4 * (world.state?.hush ?? 0))
    moon.color.set(th.moon.color)
    moon.intensity = th.moon.intensity
    moon.position.set(...(th.moon.dir ?? MOON_DIR.toArray())).normalize().multiplyScalar(500)
    applied = name
  }

  function resolveMix(t) {
    if (schedule && schedule.length) {
      let idx = 0
      for (let i = 0; i < schedule.length; i++) if (t >= schedule[i].t) idx = i
      const e = schedule[idx]
      const prev = idx > 0 ? schedule[idx - 1].theme : e.theme
      const p = (t - e.t) / (e.duration ?? 2.2)
      if (idx > 0 && p < 1 && prev !== e.theme) return { a: prev, b: e.theme, p: ease(p) }
      return { a: e.theme, b: e.theme, p: 1 }
    }
    if (manual) {
      const p = (performance.now() - manual.start) / 1000 / manual.dur
      if (p < 1) return { a: manual.from, b: manual.to, p: ease(Math.max(0, p)) }
      manual = null
    }
    return { a: current, b: current, p: 1 }
  }

  const world = {
    root,
    anchor: new THREE.Vector3(0, 0, 0),
    themes: list.map((t) => ({ name: t.name, label: t.label })),
    get theme() {
      return current
    },
    state: computeState(0),
    mix: null, // 过渡中：{ a, b, p, accent }；否则 null
    parts: { sky, ocean, screens, themes: byName },
    computeState,
    attach(s) {
      scene = s
      s.add(root)
      s.fog = fog
      s.background = new THREE.Color()
      applyTheme(current)
      return world
    },
    applyTheme,
    // 立刻切换（没有过渡）
    setTheme(name) {
      if (!byName[name]) return
      manual = null
      current = name
    },
    // 按真实时间做溶解过渡
    transitionTo(name, duration = 2.4) {
      if (!byName[name] || schedule) return
      const shown = world.mix ? (world.mix.p < 0.5 ? world.mix.a : world.mix.b) : current
      if (name === shown) return
      manual = { from: shown, to: name, start: performance.now(), dur: duration }
      current = name
    },
    // 按歌曲时间排程：[{ t: 0, theme: 'harbor' }, { t: 51.44, theme: 'clouds', duration: 2 }, ...]
    setSchedule(entries) {
      schedule = entries ? [...entries].sort((x, y) => x.t - y.t) : null
      manual = null
    },
    get schedule() {
      return schedule
    },
    setSize(width, height, pixelRatio = renderer.getPixelRatio()) {
      ocean.setResolution(width * pixelRatio, height * pixelRatio)
      for (const t of list) t.setPixelRatio?.(pixelRatio)
      root.traverse((o) => {
        const u = o.material && o.material.uniforms
        if (u && u.uPixelRatio) u.uPixelRatio.value = pixelRatio
      })
    },
    // 预编译所有主题的着色器，避免第一次切换时卡顿
    compile(r, s, camera) {
      for (const t of list) {
        applyTheme(t.name)
        r.compile(s, camera)
      }
      applyTheme(current)
    },
    update(t, camera) {
      const s = computeState(t)
      world.state = s
      const m = resolveMix(t)
      if (schedule) current = m.b
      world.mix = m.a !== m.b ? { a: m.a, b: m.b, p: m.p, accent: byName[m.b].accent } : null
      const active = m.a === m.b ? [byName[m.a]] : [byName[m.a], byName[m.b]]
      if (active.some((th) => th.usesScreens)) screens.update(s)
      sky.update(s, camera)
      ocean.update(s)
      setTreeWind(t)
      for (const th of active) th.update(s, camera)
      // 不用 createPostFX 时：直接显示离过渡终点更近的一侧
      applyTheme(m.p < 0.5 ? m.a : m.b)
      return s
    },
    exposureOf(name) {
      return byName[name]?.exposure ?? 1
    },
    get applied() {
      return applied
    },
  }
  return world
}
