import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, WATER_Y, glowPointMaterial, bakeStatic } from './util.js'
import { woodTexture, medallionTexture, signTexture, sheetMusicTexture, bottleLabelTexture, bowlTexture, riceBumpTexture, holoTexture } from './textures.js'
import { makeWhaleGeometry } from './whales.js'

// 近景：海上爵士舞台（细节最多的部分）
// 原点 = 角色站位，台面 y = 0，观众/镜头默认在 +Z。
// 圆形木台（中心在 z=-12，半径 52）+ 五道同心拱门灯泡墙 + 两侧灯架与顶排摇头灯
// 道具：低音提琴、三角钢琴、复古麦克风、红酒小圆桌（还有一碗白饭）、CRT 终端、鲸鱼玩偶、花箱、蝴蝶结
// 前方一条木栈桥伸向观众，两侧路灯与缆绳。

export const DECK_CENTER = new THREE.Vector3(0, 0, -12)
export const DECK_R = 52
const PIER_Y = -2.2
const PIER_W = 14
const PIER_START = 46
const PIER_LEN = 150

function barBetween(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat)
  m.position.copy(a).addScaledVector(d, 0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  return m
}

function barMatrix(a, b, r) {
  const d = new THREE.Vector3().subVectors(b, a)
  const len = d.length()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  return new THREE.Matrix4().compose(a.clone().addScaledVector(d, len / 2), q, new THREE.Vector3(r, len, r))
}

function lathe(points, segs = 32) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs)
}

export function createStage({ screens }) {
  const root = new THREE.Group()
  root.name = 'stage'
  const R = rng(5)
  const shadowCasters = []
  const cast = (o) => {
    o.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true
        c.receiveShadow = true
      }
    })
    return o
  }

  // ---------- 材质 ----------
  const wood = woodTexture()
  const deckMat = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.35 })
  const pierMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 })
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a15a, metalness: 1, roughness: 0.28 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe6f0, metalness: 1, roughness: 0.12 })
  const navyLacquer = new THREE.MeshPhysicalMaterial({ color: 0x0c1a3c, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 })
  const ivory = new THREE.MeshPhysicalMaterial({ color: 0xe9e2d0, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 })
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1b1f2a, metalness: 0.7, roughness: 0.45 })
  const truss = new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.9, roughness: 0.32 })
  const blackLacquer = new THREE.MeshPhysicalMaterial({ color: 0x040405, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04 })
  const postWood = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 })

  // ---------- 木台 ----------
  {
    const PW = 3.0, GAP = 0.14
    const xs = []
    for (let x = -DECK_R + PW / 2; x < DECK_R; x += PW + GAP) xs.push(x)
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), deckMat, xs.length)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    xs.forEach((x, i) => {
      const xm = Math.max(Math.abs(x - PW / 2), Math.abs(x + PW / 2))
      const len = 2 * Math.sqrt(Math.max(0, DECK_R * DECK_R - xm * xm))
      m.compose(new THREE.Vector3(x, -0.4, DECK_CENTER.z), new THREE.Quaternion(), new THREE.Vector3(PW, 0.8, Math.max(len, 0.01)))
      planks.setMatrixAt(i, m)
      const v = 0.62 + R() * 0.3
      planks.setColorAt(i, c.setRGB(v, v * (0.9 + R() * 0.08), v * (0.82 + R() * 0.1)))
    })
    planks.receiveShadow = true
    root.add(planks)
    // 缝隙下面的暗底
    const under = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R, DECK_R, 0.5, 96), new THREE.MeshStandardMaterial({ color: 0x0a0604 }))
    under.position.set(0, -1.1, DECK_CENTER.z)
    root.add(under)
  }
  // 黄铜包边、深蓝漆裙边、金线、浮箱
  {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(DECK_R + 0.2, 0.55, 12, 180), brass)
    rim.rotation.x = Math.PI / 2
    rim.position.set(0, -0.15, DECK_CENTER.z)
    root.add(rim)
    const fascia = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R + 0.3, DECK_R + 0.3, 5, 180, 1, true), navyLacquer)
    fascia.position.set(0, -2.7, DECK_CENTER.z)
    root.add(fascia)
    const trim = new THREE.Mesh(new THREE.TorusGeometry(DECK_R + 0.35, 0.16, 8, 180), brass)
    trim.rotation.x = Math.PI / 2
    trim.position.set(0, -2.6, DECK_CENTER.z)
    root.add(trim)
    const pontoon = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R - 1, DECK_R - 4, 7, 96), new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.8 }))
    pontoon.position.set(0, -8.5, DECK_CENTER.z)
    root.add(pontoon)
  }
  // 舞台中心徽章（角色脚下）
  {
    const med = new THREE.Mesh(
      new THREE.CircleGeometry(9, 96),
      new THREE.MeshPhysicalMaterial({ map: medallionTexture(), metalness: 0.2, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.45 }),
    )
    med.rotation.x = -Math.PI / 2
    med.position.y = 0.03
    med.receiveShadow = true
    root.add(med)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.1, 0.18, 8, 96), brass)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.05
    root.add(ring)
  }

  // ---------- 台口脚灯 ----------
  const footLens = []
  {
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2) })
    for (let i = 0; i < 14; i++) {
      const a = THREE.MathUtils.lerp(-0.95, 0.95, i / 13)
      if (Math.abs(a) < 0.16) continue
      const p = new THREE.Vector3(Math.sin(a) * (DECK_R - 2.4), 0, DECK_CENTER.z + Math.cos(a) * (DECK_R - 2.4))
      const g = new THREE.Group()
      g.position.copy(p)
      g.lookAt(0, 0, DECK_CENTER.z)
      const housing = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.1, 1.3, 2, 0.2), darkMetal)
      housing.position.y = 0.55
      g.add(housing)
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), lensMat.clone())
      lens.position.set(0, 0.62, 0.66)
      lens.rotation.x = -0.35
      g.add(lens)
      footLens.push(lens)
      root.add(cast(g))
    }
  }

  // ---------- 台阶 + 栈桥 ----------
  {
    for (const [top, zc] of [[-1.1, 41.9], [-2.2 + 0.001, 44.6]]) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(16, 1.1, 2.7), pierMat)
      step.position.set(0, top - 0.55, zc)
      step.receiveShadow = true
      root.add(step)
      const nose = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.25, 0.3), brass)
      nose.position.set(0, top - 0.05, zc + 1.35)
      root.add(nose)
    }
    const n = Math.floor(PIER_LEN / 2.7)
    const pl = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pierMat, n)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const z = PIER_START + i * 2.7 + 1.2
      m.compose(new THREE.Vector3((R() - 0.5) * 0.3, PIER_Y - 0.35, z), q, new THREE.Vector3(2.4, 0.7, PIER_W + (R() - 0.5) * 0.6))
      pl.setMatrixAt(i, m)
      const v = 0.45 + R() * 0.25
      pl.setColorAt(i, c.setRGB(v, v * 0.92, v * 0.85))
    }
    pl.receiveShadow = true
    root.add(pl)
    for (const x of [-4.5, 4.5]) {
      const stringer = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, PIER_LEN), postWood)
      stringer.position.set(x, PIER_Y - 1.5, PIER_START + PIER_LEN / 2)
      root.add(stringer)
    }
    // 桩 + 缆绳 + 路灯
    const ropeGeos = []
    const globes = []
    const globeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.8, 1.0) })
    for (let k = 0; k * 12 <= PIER_LEN - 4; k++) {
      const z = PIER_START + 2 + k * 12
      for (const side of [-1, 1]) {
        const x = side * (PIER_W / 2 + 0.4)
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 17, 10), postWood)
        post.position.set(x, WATER_Y - 5 + 8.5, z)
        post.castShadow = true
        root.add(post)
        const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), brass)
        capTop.position.set(x, WATER_Y + 12, z)
        root.add(capTop)
        if (k * 12 + 12 <= PIER_LEN - 4) {
          const a = new THREE.Vector3(x, WATER_Y + 10.8, z)
          const b = new THREE.Vector3(x, WATER_Y + 10.8, z + 12)
          const mid = a.clone().lerp(b, 0.5)
          mid.y -= 1.3
          ropeGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 16, 0.16, 6))
        }
        if (z < 125) {
          // 靠近舞台的一段只用矮桩灯，免得挡住正面镜头
          const bol = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), globeMat)
          bol.position.set(x, WATER_Y + 12.9, z)
          root.add(bol)
          const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.75, 0.5, 12), darkMetal)
          hat.position.set(x, WATER_Y + 13.65, z)
          root.add(hat)
          globes.push(bol.position.clone())
        } else if (k % 2 === (side > 0 ? 0 : 1)) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 11, 8), darkMetal)
          pole.position.set(x, WATER_Y + 12 + 5.5, z)
          root.add(pole)
          root.add(barBetween(new THREE.Vector3(x, WATER_Y + 23, z), new THREE.Vector3(x - side * 2.4, WATER_Y + 23, z), 0.1, darkMetal))
          root.add(barBetween(new THREE.Vector3(x - side * 2.4, WATER_Y + 23, z), new THREE.Vector3(x - side * 2.4, WATER_Y + 22.7, z), 0.08, darkMetal))
          const globe = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), globeMat)
          globe.position.set(x - side * 2.4, WATER_Y + 21.9, z)
          root.add(globe)
          globes.push(globe.position.clone())
        }
      }
    }
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xb49a72, roughness: 0.95 })
    root.add(new THREE.Mesh(mergeGeometries(ropeGeos), ropeMat))
    // 路灯光晕
    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.Float32BufferAttribute(globes.flatMap((p) => [p.x, p.y, p.z]), 3))
    gg.setAttribute('aSize', new THREE.Float32BufferAttribute(globes.map(() => 7), 1))
    gg.setAttribute('aColor', new THREE.Float32BufferAttribute(globes.flatMap(() => [1.0, 0.65, 0.3]), 3))
    gg.setAttribute('aAlpha', new THREE.Float32BufferAttribute(globes.map(() => 0.8), 1))
    root.add(new THREE.Points(gg, glowPointMaterial({ size: 1 })))
  }

  // ---------- 拱门灯泡墙 ----------
  const bulbs = []
  const ARCHES = 5
  {
    for (let i = 0; i < ARCHES; i++) {
      const r = 28 + i * 4
      const z = -18 - i * 4.5
      const arch = new THREE.Mesh(new THREE.TorusGeometry(r, i === ARCHES - 1 ? 1.1 : 0.85, 14, 120, Math.PI), i % 2 ? navyLacquer : ivory)
      arch.position.set(0, 0, z)
      root.add(cast(arch))
      const trim = new THREE.Mesh(new THREE.TorusGeometry(r - 1.0, 0.18, 8, 120, Math.PI), brass)
      trim.position.set(0, 0, z + 0.4)
      root.add(trim)
      for (const s of [-1, 1]) {
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 2.2, 16), navyLacquer)
        plinth.position.set(s * r, 1.1, z)
        root.add(cast(plinth))
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.14, 6, 24), brass)
        ring.rotation.x = Math.PI / 2
        ring.position.set(s * r, 2.2, z)
        root.add(ring)
      }
      const n = 20 + i * 3
      for (let k = 0; k < n; k++) {
        const a = THREE.MathUtils.lerp(0.05, 0.95, k / (n - 1)) * Math.PI
        bulbs.push({ pos: new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z + 0.95), arch: i, k, n, u: k / (n - 1) })
      }
    }
  }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length)
  {
    const m = new THREE.Matrix4()
    bulbs.forEach((b, i) => {
      m.makeTranslation(b.pos.x, b.pos.y, b.pos.z)
      bulbMesh.setMatrixAt(i, m)
      bulbMesh.setColorAt(i, new THREE.Color(0.1, 0.1, 0.1))
    })
    root.add(bulbMesh)
  }
  const bulbHaloGeo = new THREE.BufferGeometry()
  const bulbHaloCol = new Float32Array(bulbs.length * 3)
  const bulbHaloA = new Float32Array(bulbs.length)
  bulbHaloGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs.flatMap((b) => [b.pos.x, b.pos.y, b.pos.z + 0.2]), 3))
  bulbHaloGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(bulbs.map(() => 3.2), 1))
  bulbHaloGeo.setAttribute('aColor', new THREE.BufferAttribute(bulbHaloCol, 3))
  bulbHaloGeo.setAttribute('aAlpha', new THREE.BufferAttribute(bulbHaloA, 1))
  root.add(new THREE.Points(bulbHaloGeo, glowPointMaterial({ size: 1 })))

  // 顶部霓虹招牌 "Let Me Go"
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2, 2, 2) })
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(50, 15.1), signMat)
  sign.position.set(0, 44 + 8.2, -18 - 4 * 4.5 - 0.6)
  root.add(sign)
  const signBack = new THREE.Mesh(new RoundedBoxGeometry(44, 12, 0.6, 3, 0.8), navyLacquer)
  signBack.position.set(0, 52, -37.6)
  root.add(signBack)
  for (const s of [-1, 1]) root.add(barBetween(new THREE.Vector3(s * 14, 44.5, -36.5), new THREE.Vector3(s * 14, 46.5, -37.4), 0.3, darkMetal))

  // ---------- 灯架与摇头灯 ----------
  const TRUSS_X = 48, TRUSS_Z = -24, TRUSS_H = 67
  {
    const mats = []
    const S = 1.5
    const addBar = (a, b, r) => mats.push(barMatrix(a, b, r))
    // 两侧立柱
    for (const sx of [-1, 1]) {
      const cx = sx * TRUSS_X
      const corners = [[-S, -S], [S, -S], [S, S], [-S, S]]
      for (const [dx, dz] of corners) addBar(new THREE.Vector3(cx + dx, 0, TRUSS_Z + dz), new THREE.Vector3(cx + dx, TRUSS_H, TRUSS_Z + dz), 0.26)
      for (let y = 0; y < TRUSS_H; y += 3) {
        for (let c = 0; c < 4; c++) {
          const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4]
          addBar(new THREE.Vector3(cx + ax, y, TRUSS_Z + az), new THREE.Vector3(cx + bx, y + 3, TRUSS_Z + bz), 0.1)
          addBar(new THREE.Vector3(cx + ax, y, TRUSS_Z + az), new THREE.Vector3(cx + bx, y, TRUSS_Z + bz), 0.1)
        }
      }
      const base = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 6), darkMetal)
      base.position.set(cx, 0.3, TRUSS_Z)
      root.add(base)
    }
    // 顶排横梁
    const y0 = TRUSS_H - S * 2, y1 = TRUSS_H
    const zs = [TRUSS_Z - S, TRUSS_Z + S]
    for (const y of [y0, y1]) for (const z of zs) addBar(new THREE.Vector3(-TRUSS_X - S, y, z), new THREE.Vector3(TRUSS_X + S, y, z), 0.26)
    for (let x = -TRUSS_X; x < TRUSS_X; x += 3) {
      addBar(new THREE.Vector3(x, y0, zs[0]), new THREE.Vector3(x + 3, y1, zs[0]), 0.1)
      addBar(new THREE.Vector3(x, y0, zs[1]), new THREE.Vector3(x + 3, y1, zs[1]), 0.1)
      addBar(new THREE.Vector3(x, y1, zs[0]), new THREE.Vector3(x, y1, zs[1]), 0.1)
      addBar(new THREE.Vector3(x, y0, zs[0]), new THREE.Vector3(x, y0, zs[1]), 0.1)
    }
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), truss, mats.length)
    mats.forEach((mm, i) => inst.setMatrixAt(i, mm))
    inst.castShadow = true
    root.add(inst)
  }
  // 摇头灯
  const heads = []
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vAlong = uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uInt;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float fade = pow(vAlong, 1.6);
        gl_FragColor = vec4(uColor * edge * fade * uInt * 0.35, 1.0);
      }
    `,
  })
  const HEAD_COLORS = [[0.3, 0.8, 1.0], [1.0, 0.3, 0.8], [1.0, 0.85, 0.6], [1.0, 0.85, 0.6], [1.0, 0.3, 0.8], [0.3, 0.8, 1.0]]
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 15
    const g = new THREE.Group()
    g.position.set(x, TRUSS_H - 3.4, TRUSS_Z)
    const yoke = new THREE.Group()
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.4), darkMetal)
    clamp.position.y = 0.6
    g.add(clamp)
    const body = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.0, 1.8, 2, 0.25), darkMetal)
    yoke.add(body)
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 1.1), darkMetal)
      arm.position.set(s * 1.35, -1.4, 0)
      yoke.add(arm)
    }
    const head = new THREE.Group()
    head.position.y = -2.2
    const can = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.8, 2.6, 16), darkMetal)
    head.add(can)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(...HEAD_COLORS[i]).multiplyScalar(4) }))
    lens.position.y = -1.31
    lens.rotation.x = Math.PI / 2
    head.add(lens)
    const bm = beamMat.clone()
    bm.uniforms = { uColor: { value: new THREE.Vector3(...HEAD_COLORS[i]) }, uInt: { value: 1 } }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 12, 90, 28, 1, true).translate(0, -45 - 1.3, 0), bm)
    beam.frustumCulled = false
    head.add(beam)
    yoke.add(head)
    g.add(yoke)
    root.add(g)
    g.userData.dynamic = true
    heads.push({ group: g, yoke, head, beam, lens, color: HEAD_COLORS[i], x })
  }

  // ---------- 低音提琴 ----------
  const bass = new THREE.Group()
  let bassGlow
  const bassStrings = []
  {
    const sh = new THREE.Shape()
    const half = [
      [0, 0], [3.2, 0, 4.4, 1.8, 4.3, 4.2], [4.2, 6.0, 2.6, 6.4, 2.6, 7.6], [2.6, 8.8, 3.6, 9.2, 3.5, 11.0], [3.4, 12.6, 2.0, 13.6, 1.0, 14.0],
    ]
    sh.moveTo(0, 0)
    for (let i = 1; i < half.length; i++) sh.bezierCurveTo(...half[i])
    sh.lineTo(-1.0, 14.0)
    sh.bezierCurveTo(-2.0, 13.6, -3.4, 12.6, -3.5, 11.0)
    sh.bezierCurveTo(-3.6, 9.2, -2.6, 8.8, -2.6, 7.6)
    sh.bezierCurveTo(-2.6, 6.4, -4.2, 6.0, -4.3, 4.2)
    sh.bezierCurveTo(-4.4, 1.8, -3.2, 0, 0, 0)
    const bodyGeo = new THREE.ExtrudeGeometry(sh, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.4, bevelSegments: 4, curveSegments: 28 })
    bodyGeo.translate(0, 0, -1.2)
    const varnish = new THREE.MeshPhysicalMaterial({ color: 0xb8612a, map: wood, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 })
    const body = new THREE.Mesh(bodyGeo, varnish)
    body.position.y = 2
    bass.add(body)
    // 发光外壳（"The bass goes walking" 时亮起）
    bassGlow = new THREE.Mesh(bodyGeo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uInt: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec3 p = position + normal * 0.35;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uInt; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * f * uInt * 2.5, 1.0);
        }
      `,
    }))
    bassGlow.position.y = 2
    bass.add(bassGlow)
    const ebony = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.35 })
    const neck = new THREE.Mesh(new THREE.BoxGeometry(1.0, 9.5, 1.0), varnish)
    neck.position.set(0, 2 + 14 + 4.5, -0.2)
    bass.add(neck)
    const fb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 11.5, 0.3), ebony)
    fb.position.set(0, 2 + 11.7 + 5.2, 1.0)
    fb.rotation.x = -0.035
    bass.add(fb)
    const pegbox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 1.0), varnish)
    pegbox.position.set(0, 2 + 14 + 10.2, -0.3)
    bass.add(pegbox)
    const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.3, 8, 16), varnish)
    scroll.position.set(0, 2 + 14 + 11.6, -0.2)
    scroll.rotation.y = Math.PI / 2
    bass.add(scroll)
    for (let k = 0; k < 4; k++) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), brass)
      peg.rotation.z = Math.PI / 2
      peg.position.set(k % 2 ? 0.8 : -0.8, 2 + 14 + 9.4 + Math.floor(k / 2) * 0.9, -0.3)
      bass.add(peg)
    }
    const bridgeP = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 0.18), new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.6 }))
    bridgeP.position.set(0, 2 + 6.2, 1.85)
    bass.add(bridgeP)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 0.3), ebony)
    tail.position.set(0, 2 + 2.4, 1.75)
    bass.add(tail)
    for (const s of [-1, 1]) {
      const fh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicMaterial({ color: 0x050302 }))
      fh.scale.set(0.35, 3.2, 1)
      fh.position.set(s * 1.9, 2 + 7.2, 1.72)
      fh.rotation.z = s * 0.12
      bass.add(fh)
    }
    const stringMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, metalness: 0.8, roughness: 0.3 })
    for (let k = 0; k < 4; k++) {
      const x0 = (k - 1.5) * 0.3
      const s = barBetween(new THREE.Vector3(x0, 2 + 3.9, 1.92), new THREE.Vector3(x0 * 0.5, 2 + 14 + 9.0, 1.2), 0.035, stringMat)
      s.userData.dynamic = true
      bass.add(s)
      bassStrings.push(s)
    }
    const pin = barBetween(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(0, 0, 0.4), 0.12, chrome)
    bass.add(pin)
    bass.position.set(-30, 0, -6)
    bass.rotation.set(0, 0.55, -0.16)
    root.add(cast(bass))
  }

  // ---------- 三角钢琴 ----------
  {
    const piano = new THREE.Group()
    const outline = (sh) => {
      sh.moveTo(-7.5, 0)
      sh.lineTo(7.5, 0)
      sh.lineTo(7.5, 3.5)
      sh.bezierCurveTo(7.5, 9, 2.2, 9.5, 1.8, 14)
      sh.bezierCurveTo(1.5, 18, 0, 21, -3, 21)
      sh.bezierCurveTo(-6.5, 21, -7.5, 19, -7.5, 16)
      sh.lineTo(-7.5, 0)
    }
    const caseShape = new THREE.Shape()
    outline(caseShape)
    const hole = new THREE.Path()
    // 内腔：稍微缩一圈
    hole.moveTo(-7.0, 0.5)
    hole.lineTo(7.0, 0.5)
    hole.lineTo(7.0, 3.6)
    hole.bezierCurveTo(7.0, 8.7, 1.8, 9.2, 1.35, 13.9)
    hole.bezierCurveTo(1.05, 17.6, -0.2, 20.5, -3, 20.5)
    hole.bezierCurveTo(-6.1, 20.5, -7.0, 18.8, -7.0, 16)
    hole.lineTo(-7.0, 0.5)
    caseShape.holes.push(hole)
    const rimGeo = new THREE.ExtrudeGeometry(caseShape, { depth: 3.6, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2, curveSegments: 40 })
    rimGeo.rotateX(-Math.PI / 2)
    const rim = new THREE.Mesh(rimGeo, blackLacquer)
    rim.position.y = 7.4
    piano.add(rim)
    // 底板 + 金色铁板 + 琴弦
    const floorShape = new THREE.Shape()
    outline(floorShape)
    const bottom = new THREE.Mesh(new THREE.ExtrudeGeometry(floorShape, { depth: 0.4, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2), blackLacquer)
    bottom.position.y = 7.4
    piano.add(bottom)
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(hole.getPoints(12)), 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8913f, metalness: 1, roughness: 0.35 }))
    plate.position.y = 9.3
    plate.scale.set(0.97, 1, 0.97)
    piano.add(plate)
    const strPos = []
    for (let k = 0; k < 44; k++) {
      const x = THREE.MathUtils.lerp(-6.6, 6.6, k / 43)
      const len = THREE.MathUtils.lerp(19.5, 4.5, Math.pow(k / 43, 0.8))
      strPos.push(x, 9.45, -2.5, x * 0.5 - 1.5, 9.45, -2.5 - len * 0.85)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(strPos, 3))
    piano.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xd9d2c0 })))
    // 琴盖（撑开）
    const lidPivot = new THREE.Group()
    lidPivot.position.set(-7.5, 11.1, 0)
    const lidGeo = new THREE.ExtrudeGeometry(floorShape, { depth: 0.22, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2)
    lidGeo.translate(7.5, 0, 0)
    const lid = new THREE.Mesh(lidGeo, blackLacquer)
    lidPivot.add(lid)
    lidPivot.rotation.z = 0.62
    piano.add(lidPivot)
    const prop = barBetween(new THREE.Vector3(4.6, 11.1, -8.0), new THREE.Vector3(2.8, 18.1, -8.0), 0.14, blackLacquer)
    piano.add(prop)
    // 键盘
    const keyBed = new THREE.Mesh(new THREE.BoxGeometry(15.4, 1.3, 2.9), blackLacquer)
    keyBed.position.set(0, 8.0, 1.2)
    piano.add(keyBed)
    const whiteN = 52
    const kw = 13.6 / whiteN
    const whites = new THREE.InstancedMesh(new THREE.BoxGeometry(kw * 0.92, 0.32, 2.3), new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.35 }), whiteN)
    const blacksIdx = []
    const m = new THREE.Matrix4()
    for (let k = 0; k < whiteN; k++) {
      m.makeTranslation(-6.8 + kw * (k + 0.5), 8.8, 1.45)
      whites.setMatrixAt(k, m)
      const n = (k + 5) % 7
      if (n !== 2 && n !== 6 && k < whiteN - 1) blacksIdx.push(k)
    }
    piano.add(whites)
    const blacks = new THREE.InstancedMesh(new THREE.BoxGeometry(kw * 0.55, 0.45, 1.4), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.3 }), blacksIdx.length)
    blacksIdx.forEach((k, i) => {
      m.makeTranslation(-6.8 + kw * (k + 1), 9.0, 0.95)
      blacks.setMatrixAt(i, m)
    })
    piano.add(blacks)
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.8, 3.0), blackLacquer)
      cheek.position.set(s * 7.3, 8.9, 1.25)
      piano.add(cheek)
    }
    const fallboard = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.9, 0.25), blackLacquer)
    fallboard.position.set(0, 9.6, 0.1)
    fallboard.rotation.x = -0.4
    piano.add(fallboard)
    // 谱架 + 乐谱
    const stand = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.8, 0.15), blackLacquer)
    stand.position.set(0, 12.4, -1.2)
    stand.rotation.x = -0.28
    piano.add(stand)
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.9), new THREE.MeshStandardMaterial({ map: sheetMusicTexture(), roughness: 0.9 }))
    sheet.position.set(-0.8, 12.55, -1.1)
    sheet.rotation.set(-0.28, 0, 0.02)
    piano.add(sheet)
    const sheet2 = sheet.clone()
    sheet2.position.x = 2.9
    sheet2.rotation.z = -0.04
    piano.add(sheet2)
    // 腿 + 踏板
    const legGeo = lathe([[0.0, 0], [0.55, 0], [0.5, 0.5], [0.42, 2.5], [0.62, 4.8], [0.5, 6.0], [0.8, 6.6], [0.8, 7.4], [0, 7.4]], 16)
    for (const [x, z] of [[-6.4, 0.6], [6.4, 0.6], [-3.2, -18.8]]) {
      const leg = new THREE.Mesh(legGeo, blackLacquer)
      leg.position.set(x, 0, z)
      piano.add(leg)
      const caster = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), brass)
      caster.position.set(x, 0.3, z)
      piano.add(caster)
    }
    const lyre = new THREE.Mesh(new THREE.BoxGeometry(2.2, 5.4, 0.5), blackLacquer)
    lyre.position.set(0, 3.8, -2.5)
    piano.add(lyre)
    for (let k = 0; k < 3; k++) {
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 1.3), brass)
      pedal.position.set((k - 1) * 0.6, 1.1, -1.9)
      piano.add(pedal)
    }
    // 琴凳
    const bench = new THREE.Group()
    const seat = new THREE.Mesh(new RoundedBoxGeometry(7, 1.0, 3.4, 2, 0.3), blackLacquer)
    seat.position.y = 6.2
    bench.add(seat)
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(6.6, 0.5, 3.0, 2, 0.22), new THREE.MeshStandardMaterial({ color: 0x14244d, roughness: 0.85 }))
    cushion.position.y = 6.9
    bench.add(cushion)
    for (const [x, z] of [[-3, -1.3], [3, -1.3], [-3, 1.3], [3, 1.3]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 5.8, 8), blackLacquer)
      l.position.set(x, 2.9, z)
      bench.add(l)
    }
    bench.position.set(0, 0, 6.4)
    piano.add(bench)

    piano.position.set(23, 0, -4)
    piano.rotation.y = -Math.PI / 2 + 0.38
    root.add(cast(piano))
  }

  // ---------- 复古麦克风 ----------
  {
    const mic = new THREE.Group()
    const base = new THREE.Mesh(lathe([[0, 0], [2.6, 0], [2.6, 0.25], [1.2, 0.6], [0.3, 0.8], [0, 0.8]], 32), chrome)
    mic.add(base)
    mic.add(barBetween(new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, 15.2, 0), 0.16, chrome))
    const holder = new THREE.Group()
    holder.position.y = 15.6
    holder.rotation.x = 0.35
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 6, 20, Math.PI), chrome)
    yoke.rotation.z = Math.PI
    holder.add(yoke)
    // 经典"胶囊"型动圈话筒：上下金属壳 + 中间横纹格栅
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.3, 8, 20), chrome)
    shell.position.y = 0.4
    holder.add(shell)
    const grilleTex = (() => {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 256
      const g = c.getContext('2d')
      g.fillStyle = '#20242c'
      g.fillRect(0, 0, 64, 256)
      g.fillStyle = '#c9d0da'
      for (let y = 0; y < 256; y += 8) g.fillRect(0, y, 64, 3)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()
    const grille = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 1.1, 24, 1, true), new THREE.MeshStandardMaterial({ map: grilleTex, metalness: 0.8, roughness: 0.35 }))
    grille.position.y = 0.4
    holder.add(grille)
    mic.add(holder)
    mic.position.set(-39, 0, 22)
    mic.rotation.y = 1.1
    root.add(cast(mic))
  }

  // ---------- 红酒小圆桌（+ 一碗白饭）----------
  let wineLiquid, wineGlassBowlProfile, tableLight, lampShadeMat
  const wineMat = new THREE.MeshPhysicalMaterial({ color: 0x5a0714, roughness: 0.08, transparent: true, opacity: 0.92, clearcoat: 1 })
  {
    const tbl = new THREE.Group()
    const marble = new THREE.MeshPhysicalMaterial({ color: 0xe9e5dc, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 })
    const top = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.4, 48), marble)
    top.position.y = 9.4
    tbl.add(top)
    const edge = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.12, 6, 48), brass)
    edge.rotation.x = Math.PI / 2
    edge.position.y = 9.4
    tbl.add(edge)
    tbl.add(new THREE.Mesh(lathe([[0, 0], [2.4, 0], [2.4, 0.3], [0.9, 0.9], [0.35, 1.6], [0.3, 7.5], [0.5, 8.4], [1.0, 9.2], [0, 9.2]], 32), brass))
    // 酒瓶
    const bottleProfile = [[0, 0], [0.5, 0], [0.52, 0.1], [0.52, 2.4], [0.44, 2.75], [0.2, 3.05], [0.17, 3.9], [0.19, 3.95], [0.19, 4.05], [0, 4.05]]
    const bottle = new THREE.Mesh(lathe(bottleProfile, 32), new THREE.MeshPhysicalMaterial({ color: 0x0c2a14, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.88 }))
    bottle.position.set(-1.6, 9.6, -1.2)
    tbl.add(bottle)
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.535, 0.535, 1.2, 32, 1, true, -Math.PI * 0.2, Math.PI * 1.1), new THREE.MeshStandardMaterial({ map: bottleLabelTexture(), roughness: 0.7 }))
    label.position.set(-1.6, 9.6 + 1.3, -1.2)
    label.rotation.y = 0.8
    tbl.add(label)
    const foil = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x5a0a14, metalness: 0.6, roughness: 0.3 }))
    foil.position.set(-1.6, 9.6 + 3.7, -1.2)
    tbl.add(foil)
    // 两只高脚杯
    wineGlassBowlProfile = [[0.06, 1.1], [0.3, 1.2], [0.44, 1.45], [0.47, 1.75], [0.42, 2.15]]
    const glassProfile = [[0, 0], [0.42, 0], [0.42, 0.04], [0.08, 0.1], [0.05, 0.9], [0.06, 1.1], [0.3, 1.2], [0.44, 1.45], [0.47, 1.75], [0.42, 2.15], [0.41, 2.15], [0.45, 1.75], [0.42, 1.46], [0.29, 1.23], [0, 1.15]]
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.22, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })
    for (const [x, z] of [[1.3, 0.6], [2.4, -1.0]]) {
      const gl = new THREE.Mesh(lathe(glassProfile, 32), glassMat)
      gl.position.set(x, 9.6, z)
      gl.renderOrder = 2
      tbl.add(gl)
    }
    wineLiquid = new THREE.Mesh(new THREE.BufferGeometry(), wineMat)
    wineLiquid.position.set(1.3, 9.6, 0.6)
    wineLiquid.renderOrder = 1
    tbl.add(wineLiquid)
    // 一碗白饭 + 筷子（主食白饭）
    const bowl = new THREE.Mesh(lathe([[0, 0], [0.55, 0], [0.62, 0.12], [0.95, 0.5], [1.25, 1.05], [1.28, 1.12], [1.2, 1.12], [0.9, 0.58], [0, 0.5]], 40), new THREE.MeshPhysicalMaterial({ map: bowlTexture(), roughness: 0.25, clearcoat: 1 }))
    bowl.position.set(-1.2, 9.6, 1.9)
    tbl.add(bowl)
    const bump = riceBumpTexture()
    bump.repeat.set(3, 3)
    const rice = new THREE.Mesh(new THREE.SphereGeometry(1.14, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfbfaf4, roughness: 0.8, bumpMap: bump, bumpScale: 2.5 }))
    rice.scale.set(1, 0.62, 1)
    rice.position.set(-1.2, 9.6 + 1.0, 1.9)
    tbl.add(rice)
    const chopMat = new THREE.MeshStandardMaterial({ color: 0x6a1010, roughness: 0.35 })
    // 筷子搁在小筷架上
    const rest = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2d5fb8, roughness: 0.3 }))
    rest.rotation.x = Math.PI / 2
    rest.position.set(-2.7, 9.72, 3.05)
    tbl.add(rest)
    for (const dx of [-0.07, 0.07]) {
      const cs = barBetween(new THREE.Vector3(-2.75 + dx, 9.86, 3.05), new THREE.Vector3(0.3 + dx * 3, 9.68, 3.35), 0.05, chopMat)
      tbl.add(cs)
    }
    // 小台灯
    const lamp = new THREE.Group()
    lamp.add(new THREE.Mesh(lathe([[0, 0], [0.7, 0], [0.7, 0.15], [0.12, 0.3], [0.1, 2.6], [0, 2.6]], 20), brass))
    lampShadeMat = new THREE.MeshStandardMaterial({ color: 0xf2e2c4, emissive: new THREE.Color(1.0, 0.62, 0.3), emissiveIntensity: 1.5, side: THREE.DoubleSide, roughness: 0.9 })
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 1.2, 24, 1, true), lampShadeMat)
    shade.position.y = 2.9
    lamp.add(shade)
    tableLight = new THREE.PointLight(0xffa25a, 30, 0, 2)
    tableLight.position.y = 2.7
    lamp.add(tableLight)
    lamp.position.set(2.0, 9.6, -2.6)
    tbl.add(lamp)
    tbl.position.set(30, 0, 17)
    root.add(cast(tbl))

    // 旁边一把曲木椅
    const chair = new THREE.Group()
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.5, 32), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.5 }))
    seat.position.y = 5.6
    chair.add(seat)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4
      chair.add(barBetween(new THREE.Vector3(Math.cos(a) * 1.5, 5.4, Math.sin(a) * 1.5), new THREE.Vector3(Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0), 0.14, postWood))
    }
    const back = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.14, 8, 32, Math.PI), postWood)
    back.position.set(0, 9.2, -1.9)
    chair.add(back)
    for (const s of [-1, 1]) chair.add(barBetween(new THREE.Vector3(s * 1.9, 5.8, -1.9), new THREE.Vector3(s * 1.9, 9.2, -1.9), 0.14, postWood))
    chair.position.set(37, 0, 23)
    chair.rotation.y = -2.3
    root.add(cast(chair))
  }

  // ---------- CRT 终端 + 鲸鱼玩偶 ----------
  let screenMat, termLight
  {
    const desk = new THREE.Group()
    const deskTop = new THREE.Mesh(new RoundedBoxGeometry(10, 0.6, 9, 2, 0.2), new THREE.MeshPhysicalMaterial({ map: wood, color: 0x9a6a44, roughness: 0.4, clearcoat: 0.6 }))
    deskTop.position.y = 9.2
    desk.add(deskTop)
    for (const [x, z] of [[-4.4, -3.9], [4.4, -3.9], [-4.4, 3.9], [4.4, 3.9]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 9, 10), postWood)
      leg.position.set(x, 4.5, z)
      desk.add(leg)
    }
    const beige = new THREE.MeshStandardMaterial({ color: 0xd9cfb6, roughness: 0.55 })
    const crt = new THREE.Mesh(new RoundedBoxGeometry(6.2, 5.2, 4.4, 4, 0.7), beige)
    crt.position.set(-0.8, 9.5 + 2.6, -1.2)
    desk.add(crt)
    const back = new THREE.Mesh(new RoundedBoxGeometry(4.2, 3.6, 1.8, 3, 0.6), beige)
    back.position.set(-0.8, 9.5 + 2.4, -3.8)
    desk.add(back)
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(5.2, 4.1, 0.3, 3, 0.35), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4 }))
    bezel.position.set(-0.8, 9.5 + 2.75, 1.0)
    desk.add(bezel)
    // 微微鼓起的屏幕
    const sg = new THREE.PlaneGeometry(4.6, 3.45, 16, 12)
    const sp = sg.attributes.position
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i)
      sp.setZ(i, 0.18 - 0.012 * (x * x + y * y))
    }
    sg.computeVertexNormals()
    screenMat = new THREE.MeshBasicMaterial({ map: screens.crtTexture, color: new THREE.Color(1.5, 1.5, 1.5) })
    const scr = new THREE.Mesh(sg, screenMat)
    scr.position.set(-0.8, 9.5 + 2.75, 1.1)
    desk.add(scr)
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.6) }))
    led.position.set(1.8, 9.5 + 0.6, 1.02)
    desk.add(led)
    // 键盘
    const kb = new THREE.Mesh(new RoundedBoxGeometry(5.6, 0.45, 2.1, 2, 0.15), beige)
    kb.position.set(-0.4, 9.75, 2.9)
    kb.rotation.x = 0.06
    desk.add(kb)
    const caps = new THREE.InstancedMesh(new RoundedBoxGeometry(0.3, 0.2, 0.3, 1, 0.06), new THREE.MeshStandardMaterial({ color: 0xece4d0, roughness: 0.6 }), 56)
    const m = new THREE.Matrix4()
    for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) {
      m.makeTranslation(-0.4 - 2.47 + c * 0.38 + (r % 2) * 0.1, 10.05, 2.3 + r * 0.42)
      caps.setMatrixAt(r * 14 + c, m)
    }
    desk.add(caps)
    termLight = new THREE.PointLight(0x5fc8ff, 18, 0, 2)
    termLight.position.set(-0.8, 12.2, 4.5)
    desk.add(termLight)
    // 鲸鱼玩偶（坐在显示器旁边）
    const plushGeo = makeWhaleGeometry({ M: 32, K: 16 })
    const plush = new THREE.Mesh(plushGeo, new THREE.MeshStandardMaterial({ color: 0x5b9be8, roughness: 0.95 }))
    plush.scale.setScalar(4.2)
    plush.position.set(4.0, 9.5 + 0.5, -2.2)
    plush.rotation.set(0, -1.9, 0.08)
    desk.add(plush)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0x05070c }))
      eye.position.set(0.86, 0.0, s * 0.1)
      plush.add(eye)
    }
    desk.position.set(-30, 0, 16)
    desk.rotation.y = 0.75
    root.add(cast(desk))
    // 从终端拖到拱门的电缆
    const cable = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-33.6, 10.5, 13.2), new THREE.Vector3(-35.2, 5, 12), new THREE.Vector3(-35.4, 0.25, 9),
      new THREE.Vector3(-33, 0.25, -2), new THREE.Vector3(-29, 0.25, -12), new THREE.Vector3(-27.6, 0.25, -17.5),
    ])
    root.add(new THREE.Mesh(new THREE.TubeGeometry(cable, 80, 0.22, 6), new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.6 })))
  }

  // ---------- 花箱（白色五瓣花，和大肥鱼发饰同款）----------
  {
    const box = new THREE.Mesh(new RoundedBoxGeometry(9, 2.6, 3, 2, 0.3), navyLacquer)
    const petal = new THREE.CircleGeometry(0.34, 10).scale(1, 0.6, 1).translate(0.3, 0, 0)
    const petals = []
    for (let k = 0; k < 5; k++) petals.push(petal.clone().rotateZ((k / 5) * Math.PI * 2))
    const flowerGeo = mergeGeometries(petals).rotateX(-Math.PI / 2)
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xfbfbff, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x223355, emissiveIntensity: 0.3 })
    const centerMat = new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.5, emissive: 0x402a00 })
    const leafGeo = new THREE.SphereGeometry(0.5, 8, 6).scale(1.5, 0.35, 0.7)
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2c5a36, roughness: 0.7 })
    for (const [x, z, ry] of [[-12, 36.5, 0], [12, 36.5, 0], [-41, 14, 1.0], [41, 14, -1.0]]) {
      const g = new THREE.Group()
      const b = box.clone()
      b.position.y = 1.3
      g.add(b)
      const trim = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.2, 3.1), brass)
      trim.position.y = 2.5
      g.add(trim)
      const fl = new THREE.InstancedMesh(flowerGeo, flowerMat, 26)
      const cn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), centerMat, 26)
      const lv = new THREE.InstancedMesh(leafGeo, leafMat, 40)
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      for (let k = 0; k < 26; k++) {
        const p = new THREE.Vector3((R() - 0.5) * 8, 3 + R() * 1.4, (R() - 0.5) * 2.4)
        q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.6 + 0.3, R() * 6.28, (R() - 0.5) * 0.6))
        const s = 0.8 + R() * 0.5
        m.compose(p, q, new THREE.Vector3(s, s, s))
        fl.setMatrixAt(k, m)
        m.compose(p.clone().add(new THREE.Vector3(0, 0.05, 0)), q, new THREE.Vector3(s, s, s))
        cn.setMatrixAt(k, m)
      }
      for (let k = 0; k < 40; k++) {
        q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.8, R() * 6.28, (R() - 0.5) * 0.8))
        m.compose(new THREE.Vector3((R() - 0.5) * 8.4, 2.7 + R() * 1.2, (R() - 0.5) * 2.6), q, new THREE.Vector3(1, 1, 1))
        lv.setMatrixAt(k, m)
      }
      g.add(fl, cn, lv)
      g.position.set(x, 0, z)
      g.rotation.y = ry
      root.add(cast(g))
    }
  }

  // ---------- 深蓝蝴蝶结（灯架上，呼应角色发饰）----------
  {
    const bowMat = new THREE.MeshPhysicalMaterial({ color: 0x14285e, roughness: 0.55, sheen: 1, sheenColor: new THREE.Color(0x6688cc), sheenRoughness: 0.4 })
    const loop = new THREE.TorusGeometry(1.6, 0.55, 10, 24).scale(1.3, 0.75, 0.45)
    const tailShape = new THREE.Shape()
    tailShape.moveTo(-0.5, 0)
    tailShape.lineTo(0.5, 0)
    tailShape.lineTo(0.8, -4)
    tailShape.lineTo(0.1, -3.4)
    tailShape.lineTo(-0.4, -4.1)
    tailShape.lineTo(-0.5, 0)
    const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.12, bevelEnabled: false })
    for (const sx of [-1, 1]) {
      const bow = new THREE.Group()
      for (const s of [-1, 1]) {
        const l = new THREE.Mesh(loop, bowMat)
        l.position.x = s * 2.0
        l.rotation.z = s * 0.25
        bow.add(l)
        const t = new THREE.Mesh(tailGeo, bowMat)
        t.position.set(s * 0.4, -0.2, 0)
        t.rotation.z = s * 0.28
        bow.add(t)
      }
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10).scale(1, 1.1, 0.7), bowMat)
      bow.add(knot)
      bow.position.set(sx * TRUSS_X, 34, TRUSS_Z + 1.9)
      root.add(cast(bow))
    }
  }

  // ---------- JSON 全息光环 ----------
  const holoTex = holoTexture()
  const holoRings = []
  for (const [r, y, h, rep, speed] of [[22, 38, 3.2, 3, 0.05]]) {
    const tex = holoTex.clone()
    tex.repeat.set(rep, 1)
    tex.needsUpdate = true
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uMap: { value: tex }, uOff: { value: 0 }, uRep: { value: rep }, uOpacity: { value: 0 }, uTime: { value: 0 }, uGlitch: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uOff, uRep, uOpacity, uTime, uGlitch;
        varying vec2 vUv;
        void main() {
          vec2 uv = vec2(vUv.x * uRep + uOff, vUv.y);
          uv.x += uGlitch * 0.05 * sin(floor(vUv.y * 12.0) * 7.0 + uTime * 40.0);
          vec4 c = texture2D(uMap, uv);
          float scan = 0.75 + 0.25 * sin(vUv.y * 180.0 - uTime * 6.0);
          float edge = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
          vec3 col = c.rgb * c.a * scan * edge * 1.3 + vec3(0.2, 0.6, 1.0) * 0.03 * edge;
          gl_FragColor = vec4(col * uOpacity, 1.0);
        }
      `,
    })
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 96, 1, true), mat)
    ring.position.y = y
    ring.userData.speed = speed
    root.add(ring)
    holoRings.push(ring)
  }

  // ---------- 灯光 ----------
  const lights = new THREE.Group()
  const key = new THREE.SpotLight(0xffe2c0, 16000, 0, 0.36, 0.6, 2)
  key.position.set(0, 72, 88)
  key.target.position.set(0, 8, 0)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0003
  key.shadow.normalBias = 0.04
  key.shadow.camera.near = 40
  key.shadow.camera.far = 260
  lights.add(key, key.target)
  const colorSpots = [1, 4].map((hi) => {
    const s = new THREE.SpotLight(new THREE.Color(...HEAD_COLORS[hi]), 9000, 0, 0.3, 0.7, 2)
    s.userData.head = hi
    lights.add(s, s.target)
    return s
  })
  const rimLight = new THREE.SpotLight(0x6fa8ff, 7000, 0, 0.5, 0.8, 2)
  rimLight.position.set(0, 50, -60)
  rimLight.target.position.set(0, 10, 0)
  lights.add(rimLight, rimLight.target)
  root.add(lights)

  // 静态零件按材质合并
  bakeStatic(root)

  // ---------- 每帧状态 ----------
  const tmpC = new THREE.Color()
  const tmpV = new THREE.Vector3()
  const down = new THREE.Vector3(0, -1, 0)
  let lastWine = -1

  function rebuildWine(fill) {
    const prof = wineGlassBowlProfile
    const y0 = prof[0][1], y1 = prof[prof.length - 1][1]
    const top = y0 + (y1 - y0) * fill * 0.9
    const pts = [new THREE.Vector2(0, y0 + 0.02)]
    for (const [r, y] of prof) {
      if (y >= top) break
      pts.push(new THREE.Vector2(r * 0.93, y))
    }
    // 液面处的半径插值
    let rTop = prof[0][0]
    for (let i = 1; i < prof.length; i++) {
      if (prof[i][1] >= top) {
        const [r0, a] = prof[i - 1], [r1, b] = prof[i]
        rTop = r0 + (r1 - r0) * ((top - a) / (b - a))
        break
      }
    }
    pts.push(new THREE.Vector2(rTop * 0.93, top), new THREE.Vector2(0, top))
    wineLiquid.geometry.dispose()
    wineLiquid.geometry = new THREE.LatheGeometry(pts, 32)
  }

  return {
    object: root,
    // 给 MMD 模型参考的站位：原点，面朝 +Z
    anchor: new THREE.Vector3(0, 0, 0),
    // 工具调用光束从招牌顶上发射
    emitter: new THREE.Vector3(0, 60, -37),
    keyLight: key,
    update(state) {
      const t = state.t
      const hush = state.hush
      const alive = 1 - state.fall * 0.85

      // 拱门灯泡
      const warm = [2.6, 1.7, 0.85], cyan = [0.7, 1.9, 2.8]
      const total = bulbs.length
      bulbs.forEach((b, i) => {
        let v = 0.06
        let col = warm
        switch (state.bulbMode) {
          case 'fill': {
            // 前奏：灯泡一颗颗亮起来，最新亮的几颗更亮
            const f = state.bulbFill * 1.02
            v = f > (i + 0.5) / total ? 0.9 : 0.05
            if (f > (i + 0.5) / total && f < (i + 12) / total) v = 1.6
            break
          }
          case 'walk': {
            const step = Math.floor(state.beat) % b.n
            const d = Math.min(Math.abs(b.k - step), Math.abs(b.k - (b.n - 1 - step)))
            v = 0.25 + 1.4 * Math.exp(-d * 0.9)
            break
          }
          case 'chase': {
            const w = 0.5 + 0.5 * Math.sin(b.u * 18 - t * 7 + b.arch * 0.9)
            v = 0.35 + 0.9 * Math.pow(w, 3) + state.pulse * 0.6
            col = b.arch % 2 ? cyan : warm
            break
          }
          case 'blink': {
            const h = Math.sin(i * 91.7 + Math.floor(t * 12) * 13.1) * 43758.5
            v = h - Math.floor(h) > 0.55 ? 1.2 : 0.02
            col = h - Math.floor(h) > 0.8 ? [2.8, 0.4, 0.6] : warm
            break
          }
          default:
            v = 0.55 + 0.25 * Math.sin(t * 1.6 + b.u * 6 + b.arch) + state.pulse * 0.35
        }
        v *= 1 - 0.75 * hush
        v += state.finaleFlash * 1.2 + state.recoverFlash * 0.8
        tmpC.setRGB(col[0] * v, col[1] * v, col[2] * v)
        bulbMesh.setColorAt(i, tmpC)
        bulbHaloCol[i * 3] = col[0] * 0.35
        bulbHaloCol[i * 3 + 1] = col[1] * 0.35
        bulbHaloCol[i * 3 + 2] = col[2] * 0.35
        bulbHaloA[i] = Math.min(1, v * 0.6)
      })
      bulbMesh.instanceColor.needsUpdate = true
      bulbHaloGeo.attributes.aColor.needsUpdate = true
      bulbHaloGeo.attributes.aAlpha.needsUpdate = true

      // 招牌
      const signOn = state.t < 1.2 ? Math.max(0, Math.sin(t * 30)) * 0.5 : 1
      const sk = signOn * (1.1 + state.pulse * 0.6 + hush * (0.6 + 0.4 * Math.sin(t * 5))) * (state.glitch > 0.4 && Math.sin(t * 61) > 0.3 ? 0.15 : 1)
      signMat.color.setRGB(2 * sk, 2 * sk, 2 * sk)

      // 摇头灯：4/4 摇摆（一小节一个来回，1、3 拍到两端）
      const phase = (Math.PI * state.beat) / 2
      heads.forEach((h, i) => {
        const dirSign = i % 2 ? -1 : 1
        const sw = state.swing
        const tx = h.x * 0.35 + dirSign * sw * 22 * Math.cos(phase + i * 0.4)
        const tz = 6 + sw * 12 * Math.sin(phase * 0.5 + i)
        const target = tmpV.set(tx, 0, tz)
        const origin = h.group.position.clone().add(new THREE.Vector3(0, -2.2, 0))
        const dir = target.sub(origin).normalize()
        // 偏航 + 俯仰
        const yaw = Math.atan2(dir.x, dir.z)
        h.yoke.rotation.y = yaw
        h.head.rotation.x = -Math.acos(THREE.MathUtils.clamp(-dir.y, -1, 1))
        const inten = state.beams * (0.6 + 0.6 * state.pulse) * (1 - 0.9 * hush) * alive * (state.glitch > 0.4 ? (Math.sin(t * 50 + i * 3) > 0 ? 1 : 0.1) : 1)
        h.beam.material.uniforms.uInt.value = inten
        h.lens.material.color.setRGB(h.color[0] * 4 * (0.3 + inten), h.color[1] * 4 * (0.3 + inten), h.color[2] * 4 * (0.3 + inten))
      })
      colorSpots.forEach((s) => {
        const h = heads[s.userData.head]
        h.head.updateWorldMatrix(true, false)
        h.head.getWorldPosition(s.position)
        const d = down.clone().applyQuaternion(h.head.getWorldQuaternion(new THREE.Quaternion()))
        s.target.position.copy(s.position).addScaledVector(d, 60)
        s.intensity = 9000 * state.beams * (0.5 + 0.7 * state.pulse) * (1 - 0.9 * hush) * alive
      })
      key.intensity = 16000 * state.stage * (1 + 0.25 * state.finaleFlash)
      key.angle = 0.36 - 0.12 * hush
      rimLight.intensity = 7000 * (0.4 + 0.6 * state.beams) * (1 - 0.6 * hush)

      // 脚灯
      footLens.forEach((l, i) => {
        const v = (1.2 + 0.8 * state.pulse * (i % 2 ? 1 : 0.4)) * (1 - 0.6 * hush) * alive
        l.material.color.setRGB(3 * v, 2.2 * v, 1.2 * v)
      })

      // 低音提琴
      bassGlow.material.uniforms.uInt.value = state.bass * (0.6 + 0.8 * state.beatPulse)
      bassStrings.forEach((s, i) => {
        const vib = state.bass * 0.8 * Math.sin(t * 90 + i * 2) * Math.exp(-state.beatFrac * 3)
        s.scale.x = 1 + Math.abs(vib) * 2
        s.scale.z = 1 + Math.abs(vib) * 2
      })

      // 红酒
      if (Math.abs(state.wine - lastWine) > 0.004) {
        rebuildWine(state.wine)
        lastWine = state.wine
      }
      tableLight.intensity = 30 * state.table * (1 - 0.3 * hush)
      lampShadeMat.emissiveIntensity = 1.5 * state.table

      // 终端屏幕
      const scrK = state.screen === 'busy' ? 1.8 : 1.5
      screenMat.color.setRGB(scrK, scrK, scrK)
      termLight.color.set(state.screen === 'busy' ? 0xff4d6d : 0x5fc8ff)
      termLight.intensity = 18 * (0.8 + 0.3 * Math.sin(t * 7))

      // 全息环
      holoRings.forEach((r, i) => {
        r.rotation.y = t * r.userData.speed * 2
        const u = r.material.uniforms
        u.uOff.value = t * 0.02 * (i ? -1 : 1)
        u.uTime.value = t
        u.uGlitch.value = state.glitch
        u.uOpacity.value = state.holo * (0.8 + 0.4 * state.pulse) * (1 - 0.8 * hush) * (state.fall > 0 ? (Math.sin(t * 43) > 0 ? 0.6 : 0.05) : 1)
      })
    },
  }
}
