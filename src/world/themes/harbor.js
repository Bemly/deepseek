import { createCity, coastZ } from '../city.js'
import { createLandscape } from '../landscape.js'
import { createStage } from '../stage.js'
import { createWhales } from '../whales.js'
import { createParticles } from '../particles.js'
import * as THREE from 'three'

// 主题：霓虹港湾（最早的那个场景）
export function createHarborTheme({ screens }) {
  const root = new THREE.Group()
  root.name = 'theme:harbor'
  const city = createCity({ screens })
  const landscape = createLandscape()
  const stage = createStage({ screens })
  const whales = createWhales()
  const particles = createParticles({
    endpoints: city.endpoints,
    emitter: stage.emitter,
    flash: city,
    fireworks: {
      // 在城市前面的海湾上空炸开，水里还能看到倒影
      zone: (h) => {
        const x = -3800 + h(1) * 7600
        return [x, 1500 + h(3) * 1100, coastZ(x) + 700 + h(2) * 1400]
      },
    },
  })
  root.add(city.object, landscape.object, stage.object, whales.object, particles.object)

  return {
    name: 'harbor',
    label: '霓虹港湾',
    root,
    usesScreens: true,
    accent: [0.35, 0.85, 1.4],
    sky: {},
    ocean: {},
    fog: { color: [0.028, 0.042, 0.1], density: 0.00005 },
    hemi: { sky: 0x2a3d7a, ground: 0x06080e, intensity: 1.1 },
    moon: { color: 0x9fb4ff, intensity: 0.9 },
    env: {
      top: [0.01, 0.015, 0.04],
      horizon: [0.05, 0.06, 0.14],
      glow: [0.35, 0.1, 0.3],
      panels: [
        [[3, 1.9, 1.0], [0, 60, 70], [60, 20]],
        [[0.4, 1.6, 3.0], [-70, 30, -30], [30, 50]],
        [[3.0, 0.5, 1.8], [70, 25, -40], [30, 40]],
        [[1.2, 1.3, 2.0], [0, 90, -20], [80, 30]],
      ],
    },
    stage,
    update(state) {
      city.update(state)
      landscape.update(state)
      stage.update(state)
      whales.update(state)
      particles.update(state)
    },
    setPixelRatio(pr) {
      particles.setPixelRatio(pr)
    },
  }
}
