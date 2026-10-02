// 角色模型：默认 blend 版（LetMeGo-dschan_v2c.blend 的 Character_FullDetail + Character_Rig + 舞蹈），只克隆模型，不碰场景。
// - mesh+rig：./models/dschan-blend.glb（Draco，烘焙材质；见 public/models/README.md）
// - 舞蹈：./data/dance-v2c.glb —— v2c 的动作由 Blender glTF 导出器直接导出（每 4 帧采一次 = 30fps），
//   Z-up→Y-up 和骨骼轴向都由导出器换算，three 侧用 AnimationMixer 播放，不再手算 rest×offset。
// - 摆放：blend 世界坐标原样搬过来（glTF 已是 Y-up 米制），只乘 12.5 换成 web 单位——
//   和 blend 运镜（blend-camera.js 的 blendToWeb）同一套换算，所以特写能对准脸。不做包围盒居中/缩身高。
// - update(t) 是歌曲时间的纯函数（mixer.setTime），任意跳时间/倒放/逐帧渲染都一致。

import * as THREE from 'three'

export const BLEND_TO_WEB = 1 / 0.08 // 12.5，见 blend-camera.js
export const BLEND_FPS = 120 // v2c 时间轴：第 f 帧 = 歌曲 (f-1)/120 秒
export const OUTLINE_COLOR = 0x0a1026 // 描边壳颜色（深蓝黑墨线）
export const OUTLINE_WIDTH = 0.12 // 描边宽度（web 单位；?outline= 可调，0 关闭）

// 背面膨胀壳描边（blend 侧 TOON Outline 修改器的 web 复刻）：
// 把 mesh 克隆一份，翻到背面显示，顶点沿法线外扩。位移写在 begin_vertex 里，
// 蒙皮在之后才作用，所以偏移会跟着骨骼一起转。宽度按模型本地坐标传入。
export function addOutlineShell(mesh, widthLocal) {
  if (!mesh.geometry.getAttribute('normal') || !(widthLocal > 0)) return null
  const mat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide })
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uOutlineW = { value: widthLocal }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'uniform float uOutlineW;\n#include <common>')
      // 用 bind 空间的 normal 属性外扩（蒙皮之后会跟着骨骼转）；MeshBasic 非蒙皮时没有 objectNormal
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutlineW;')
  }
  mat.customProgramCacheKey = () => 'ds-outline'
  const shell = mesh.clone() // SkinnedMesh.clone 会共享 skeleton + bind 矩阵，正好
  shell.material = mat
  shell.name = `${mesh.name}__outline`
  shell.castShadow = false
  shell.receiveShadow = false
  shell.frustumCulled = false
  shell.renderOrder = -1
  mesh.parent?.add(shell)
  return shell
}

async function gltfLoader() {
  const [gltfMod, dracoMod] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
  ])
  const draco = new dracoMod.DRACOLoader()
  draco.setDecoderPath('./draco/')
  const loader = new gltfMod.GLTFLoader()
  loader.setDRACOLoader(draco)
  return loader
}

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
    update(_t) {},
    async load(url, danceUrl, outlineWidth) {
      if (!(outlineWidth >= 0)) outlineWidth = OUTLINE_WIDTH // NaN/缺省 → 默认；0 = 关闭
      const loader = await gltfLoader()
      const gltf = await loader.loadAsync(url)
      const model = gltf.scene
      model.scale.setScalar(BLEND_TO_WEB)
      const outlineLocal = outlineWidth > 0 ? outlineWidth / BLEND_TO_WEB : 0
      model.traverse((o) => {
        if (o.isMesh) {
          // 烘焙贴图已含最终颜色；COLOR_0/1 是 blend 的 cap_color / face_layer 等属性，不能再乘进颜色
          if (o.material) o.material.vertexColors = false
          o.castShadow = true // 舞台主光投影（README 约定）
          o.receiveShadow = false
          if (o.isSkinnedMesh) o.frustumCulled = false // 跳舞时包围盒会跑掉，直接关掉裁剪
          if (outlineLocal > 0 && !o.name.endsWith('__outline')) addOutlineShell(o, outlineLocal)
        }
      })
      group.add(model)
      api.model = model
      api.ready = true
      group.visible = true
      try {
        await api.loadDance(loader, danceUrl || './data/dance-v2c.glb')
      } catch (err) {
        console.warn('[model] 舞蹈数据加载失败，角色保持静态：', err)
      }
      return model
    },
    async loadDance(loader, url) {
      const g = await loader.loadAsync(url)
      const clip = g.animations[0]
      if (!clip) throw new Error('dance glb has no animation')
      // 导出器的时间轴从第 1 帧起算还是从 0 起算，看第一个关键帧时间：歌曲 t 秒 = v2c 第 t*120+1 帧
      const t0 = Math.min(...clip.tracks.map((tr) => tr.times[0]))
      const mixer = new THREE.AnimationMixer(api.model)
      const action = mixer.clipAction(clip)
      action.play()
      api.mixer = mixer
      api.clip = clip
      api.danceReady = true
      api.update = (t) => {
        mixer.setTime(Math.max(0, Math.min(clip.duration, t + t0)))
      }
    },
  }
  return api
}
