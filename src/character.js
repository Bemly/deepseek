// 角色模型：默认 blend 版（v2c 的 ds-chan 三渲二角色），只克隆模型，不碰场景。
// - 文件：./models/dschan-blend.glb（本地放，见 public/models/README.md；仓库不收二进制）
// - 舞蹈动作见 update(t)：第④步把 BadBadWater_VMD 烘成 30fps 数据后在这里按歌曲时间驱动（纯函数，和 world.update 同哲学）
// - 现在先把静态 mesh 摆到 world.anchor（原点，脚 y=0，面朝 +Z），与身高参考（20 单位）同高

import * as THREE from 'three'

export const MODEL_SCALE = 1 / 0.08 // blend 米 → MMD 单位 ×12.5（与运镜同比例）
export const MODEL_HEIGHT = 20 // 对齐身高参考
export const MODEL_YAW = 0 // 若朝向不对（如背对 +Z），改这里（弧度）

export function createCharacter(scene) {
  const group = new THREE.Group()
  group.name = 'ds-chan-character'
  group.visible = false
  scene.add(group)

  const api = {
    group,
    ready: false,
    failed: false,
    // 按歌曲时间驱动（第④步填舞蹈；现在是静态站位，保持纯函数签名）
    update(_t) {},
    async load(url) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
      const gltf = await new GLTFLoader().loadAsync(url)
      const model = gltf.scene
      // 落地：包围盒 → 脚贴 y=0、x/z 居中、身高缩到 20（只做一次，按 bind pose）
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const s = MODEL_HEIGHT / Math.max(1e-6, size.y)
      model.scale.setScalar(s)
      const b2 = new THREE.Box3().setFromObject(model)
      model.position.x -= (b2.min.x + b2.max.x) / 2
      model.position.z -= (b2.min.z + b2.max.z) / 2
      model.position.y -= b2.min.y
      model.rotation.y = MODEL_YAW
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true // 舞台主光投影（README 约定）
          o.receiveShadow = false
        }
      })
      group.add(model)
      api.ready = true
      api.model = model
      group.visible = true
      return model
    },
  }
  return api
}
