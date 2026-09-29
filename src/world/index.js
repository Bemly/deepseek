import * as THREE from 'three'
import { computeState } from '../state.js'
import { createSky, MOON_DIR } from './sky.js'
import { createOcean } from './ocean.js'
import { createCity } from './city.js'
import { createLandscape } from './landscape.js'
import { createWhales } from './whales.js'
import { createStage } from './stage.js'
import { createParticles } from './particles.js'
import { createScreens } from './screens.js'

// 场景总装。对外只有三件事：
//   const world = createWorld(renderer, { quality })
//   world.attach(scene)                  // 加进你的场景（雾、环境光、灯光一起装好）
//   world.update(songTimeSeconds, camera) // 每帧调用，场景状态完全由歌曲时间决定
// MMD 模型站在 world.anchor（原点），台面 y = 0，面朝 +Z。

export const FOG_COLOR = new THREE.Color().setRGB(0.028, 0.042, 0.1)

function buildEnvironment(renderer) {
  // 给近景 PBR 材质用的环境反射：夜空渐变 + 几块霓虹色"反光板"
  const env = new THREE.Scene()
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        varying vec3 vP;
        void main() {
          float h = vP.y;
          vec3 c = mix(vec3(0.05, 0.06, 0.14), vec3(0.01, 0.015, 0.04), smoothstep(0.0, 0.7, h));
          c += vec3(0.35, 0.1, 0.3) * exp(-abs(h) * 8.0) * max(0.0, -vP.z);
          c = mix(c, vec3(0.01, 0.015, 0.03), smoothstep(0.0, -0.3, h));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  )
  env.add(sky)
  const panel = (color, pos, size) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
    m.position.copy(pos)
    m.lookAt(0, 0, 0)
    env.add(m)
  }
  panel(new THREE.Color(3, 1.9, 1.0), new THREE.Vector3(0, 60, 70), [60, 20])
  panel(new THREE.Color(0.4, 1.6, 3.0), new THREE.Vector3(-70, 30, -30), [30, 50])
  panel(new THREE.Color(3.0, 0.5, 1.8), new THREE.Vector3(70, 25, -40), [30, 40])
  panel(new THREE.Color(1.2, 1.3, 2.0), new THREE.Vector3(0, 90, -20), [80, 30])
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(env, 0.02)
  pmrem.dispose()
  return rt.texture
}

export function createWorld(renderer, { quality = 'high' } = {}) {
  const root = new THREE.Group()
  root.name = 'ds-chan-world'

  const screens = createScreens()
  const sky = createSky()
  const ocean = createOcean({ quality })
  const city = createCity({ screens })
  const landscape = createLandscape()
  const whales = createWhales()
  const stage = createStage({ screens })
  const particles = createParticles({ endpoints: city.endpoints, emitter: stage.emitter })
  root.add(sky.object, ocean.object, city.object, landscape.object, whales.object, stage.object, particles.object)

  // 环境光
  const hemi = new THREE.HemisphereLight(0x2a3d7a, 0x06080e, 1.1)
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.9)
  moon.position.copy(MOON_DIR).multiplyScalar(500)
  root.add(hemi, moon)

  const environment = buildEnvironment(renderer)
  const fog = new THREE.FogExp2(FOG_COLOR.getHex(THREE.LinearSRGBColorSpace), 0.00005)
  fog.color.copy(FOG_COLOR)

  const world = {
    root,
    anchor: stage.anchor.clone(),
    keyLight: stage.keyLight,
    state: computeState(0),
    parts: { sky, ocean, city, landscape, whales, stage, particles, screens },
    computeState,
    attach(scene) {
      scene.add(root)
      scene.fog = fog
      scene.environment = environment
      scene.environmentIntensity = 0.55
      scene.background = FOG_COLOR.clone()
      return world
    },
    setSize(width, height, pixelRatio = renderer.getPixelRatio()) {
      ocean.setResolution(width * pixelRatio, height * pixelRatio)
      particles.setPixelRatio(pixelRatio)
      root.traverse((o) => {
        const u = o.material && o.material.uniforms
        if (u && u.uPixelRatio) u.uPixelRatio.value = pixelRatio
      })
    },
    update(t, camera) {
      const s = computeState(t)
      world.state = s
      screens.update(s)
      sky.update(s, camera)
      ocean.update(s)
      city.update(s)
      landscape.update(s)
      whales.update(s)
      stage.update(s)
      particles.update(s, city)
      hemi.intensity = 1.1 * (1 - 0.4 * s.hush)
      return s
    },
  }
  return world
}
