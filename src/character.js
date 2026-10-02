// 角色模型：默认 blend 版（v2c 的 ds-chan 三渲二角色 + BadBadWater_VMD 舞蹈），只克隆模型，不碰场景。
// - mesh+rig：./models/dschan-blend.glb（本地，Draco；见 public/models/README.md）
// - 舞蹈：./data/dance-30fps.{json,bin}（v2c 动作按 30fps 采样：174 骨骼四元数 + Hips 位移 + 15 脸部 props）
// - update(t) 是歌曲时间的纯函数（和 world.update 同哲学）：任意跳时间/倒放/逐帧渲染都一致
// - 脸部 props 已存下（api.face），但 web 材质是烘焙 unlit，暂不驱动，留给以后

import * as THREE from 'three'

export const MODEL_HEIGHT = 20 // 对齐身高参考
export const MODEL_YAW = 0 // 若朝向不对（如背对 +Z），改这里（弧度）
export const DANCE_FPS = 30

const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _v = new THREE.Vector3()

export function createCharacter(scene) {
  const group = new THREE.Group()
  group.name = 'ds-chan-character'
  group.visible = false
  scene.add(group)

  const api = {
    group,
    ready: false, // mesh 就绪
    danceReady: false, // 动作就绪
    failed: false,
    face: null, // 当前帧脸部 props（预留）
    update(_t) {},
    async load(url, danceBase) {
      const [gltfMod, dracoMod] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/DRACOLoader.js'),
      ])
      const draco = new dracoMod.DRACOLoader()
      draco.setDecoderPath('./draco/')
      const loader = new gltfMod.GLTFLoader()
      loader.setDRACOLoader(draco)
      const gltf = await loader.loadAsync(url)
      const model = gltf.scene
      // 落地：包围盒 → 脚贴 y=0、x/z 居中、身高缩到 20（只做一次，按 bind pose）
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      model.scale.setScalar(MODEL_HEIGHT / Math.max(1e-6, size.y))
      const b2 = new THREE.Box3().setFromObject(model)
      model.position.x -= (b2.min.x + b2.max.x) / 2
      model.position.z -= (b2.min.z + b2.max.z) / 2
      model.position.y -= b2.min.y
      model.rotation.y = MODEL_YAW
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true // 舞台主光投影（README 约定）
          o.receiveShadow = false
          if (o.isSkinnedMesh) o.frustumCulled = false // 跳舞时包围盒会跑掉，直接关掉裁剪
        }
      })
      group.add(model)
      api.model = model
      api.ready = true
      group.visible = true
      // 骨骼按名索引（与 dance json 的 bones 对齐；缺的骨不动）。
      // 注意：blend 动作存的是相对 rest 的偏移，three 里要 rest(*)offset 叠加，不能直接覆盖。
      const byName = new Map()
      model.traverse((o) => {
        if (o.isBone) {
          byName.set(o.name, o)
          o.userData.restPos = o.position.clone()
          o.userData.restQuat = o.quaternion.clone()
        }
      })
      api.bones = byName
      try {
        await api.loadDance(danceBase || './data/dance-30fps')
      } catch (err) {
        console.warn('[model] 舞蹈数据加载失败，角色保持静态：', err)
      }
      return model
    },
    async loadDance(base) {
      const meta = await (await fetch(`${base}.json`)).json()
      if (!meta?.bones?.length) throw new Error('bad dance header')
      const buf = await (await fetch(`${base}.bin`)).arrayBuffer()
      const data = new Float32Array(buf)
      const nb = meta.bones.length
      const np = meta.props.length
      const stride = nb * 4 + 3 + np
      const bones = meta.bones.map((n) => api.bones.get(n) || null)
      // rest 变换（load 时已存 userData）：位置偏移要先转到 rest 朝向系再叠加
      const restP = bones.map((b) => (b ? b.userData.restPos : null))
      const restQ = bones.map((b) => (b ? b.userData.restQuat : null))
      const hips = api.bones.get('Hips') || null
      const hipsRestP = hips ? hips.userData.restPos : null
      const hipsRestQ = hips ? hips.userData.restQuat : null
      const hipsOff = nb * 4
      api.face = new Float32Array(np)
      api.danceReady = true
      api.update = (t) => {
        const x = Math.max(0, Math.min(meta.frames - 1, t * DANCE_FPS))
        const i0 = Math.floor(x)
        const i1 = Math.min(meta.frames - 1, i0 + 1)
        const w = x - i0
        const a = i0 * stride
        const b = i1 * stride
        for (let i = 0; i < nb; i++) {
          const bone = bones[i]
          if (!bone) continue
          _qa.set(data[a + i * 4], data[a + i * 4 + 1], data[a + i * 4 + 2], data[a + i * 4 + 3])
          _qb.set(data[b + i * 4], data[b + i * 4 + 1], data[b + i * 4 + 2], data[b + i * 4 + 3])
          // 两端先各叠 rest 再 slerp（等价于偏移插值，rest 不变时精确）
          _qa.premultiply(restQ[i])
          _qb.premultiply(restQ[i])
          bone.quaternion.copy(_qa).slerp(_qb, w)
        }
        if (hips) {
          _v.set(
            data[a + hipsOff] + (data[b + hipsOff] - data[a + hipsOff]) * w,
            data[a + hipsOff + 1] + (data[b + hipsOff + 1] - data[a + hipsOff + 1]) * w,
            data[a + hipsOff + 2] + (data[b + hipsOff + 2] - data[a + hipsOff + 2]) * w,
          ).applyQuaternion(hipsRestQ)
          hips.position.copy(hipsRestP).add(_v)
        }
        for (let k = 0; k < np; k++) api.face[k] = data[a + hipsOff + 3 + k]
      }
    },
  }
  return api
}
