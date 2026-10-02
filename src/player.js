// 玩家模式：角色脱离舞蹈（歌曲/场景时间轴照走），由第一人称 / 第三人称镜头控制。只动角色和相机，不碰场景。
//   WASD 前后左右 · 空格 跳 · 按住 Shift 蹲 · Ctrl 或双击 W 跑
//   双击空格 进入/退出飞行（像 MC）：飞行时按住空格上升、Shift 下降，有加速度和阻尼
//   V 切换 第一人称 / 背后第三人称 / 正面第三人称（设置面板里也能选）· 滚轮调第三人称距离 · 1–0 特色动作 · 鼠标看（点画面锁定指针，Esc 释放）
// 和场景有碰撞（collision.js）：角色是一个胶囊体，能站在台阶/屋顶上，撞墙会停，第三人称相机被挡时会拉近。
// 头发/裙摆/尾巴/耳朵用弹簧骨随动（springbones.js）。
// 动作风格（可切换，缺的槽位回退到 Motifect）：
//   少女MMD  向前走 Chibi walk（tweekcrystal）、向前跑 女の子走り（@fuudo_food_0309）—— tools/retarget_vmd.py
//   Motifect 45 段 AI 动捕移动包里的 18 段 —— tools/retarget_bvh.py
//   Quaternius Universal Animation Library（CC0）—— tools/retarget_glb.py
//   手搓      这个项目自己做的二次元少女动作 —— tools/handmade_moves.py
//   导入      你自己导入的 VMD / VRMA / BVH / FBX / GLB（只在你浏览器里，不进仓库）—— src/motion-import.js
import * as THREE from 'three'
import { HEAD_CLIP } from './character.js'

const M = 12.5 // 1 米 = 12.5 web 单位（blend → web）
const G = 20 // 重力 m/s²
const JUMP_V = 6.2 // 起跳速度 → 约 0.95 m 高
const WALK = 0.9, RUN = 3.0, CROUCH = 0.8 // m/s（走 = 小碎步，片段 0.35 m/s × 约 2.6 倍步频）
const FLY = 6, FLY_SPRINT = 14, FLY_V = 5 // m/s
const FLY_MAX_BOOST = 32 // 按住移动时每 2 秒速度翻倍（和手动机位一样），最高 32 倍
const DOUBLE_TAP = 0.3 // 秒
// 碰撞胶囊（米）：半径、站立高度、下蹲高度；下台阶时最多往下吸附的高度
const CAP_R = 0.2, CAP_H = 1.42, CAP_H_CROUCH = 1.0, SNAP = 0.35
export const VIEWS = { fp: '第一人称', back: '第三人称（背后）', front: '第三人称（正面）' }
// Motifect 的 jump_standing（30fps）：44 帧前是蹲下蓄力，47 离地，53 腾空最高，59 落地，72 站稳 → 切成三段
const MOTIFECT_JUMP = { jump_start: [44 / 30, 53 / 30], jump_air: [53 / 30, 54 / 30], jump_land: [59 / 30, 72 / 30] }
const PACKS = {
  motifect: { glb: './data/moves.glb', json: './data/moves.json' },
  vmd: { glb: './data/moves-vmd.glb', json: './data/moves-vmd.json' },
  ual: { glb: './data/moves-ual.glb', json: './data/moves-ual.json' },
  hand: { glb: './data/moves-hand.glb', json: './data/moves-hand.json' },
}
const LOCO = ['idle', 'idle2', 'walk', 'walk_back', 'walk_l', 'walk_r', 'run', 'run_back', 'run_l', 'run_r', 'jump_start', 'jump_air', 'jump_land', 'fall_land', 'crouch', 'crouch_fwd', 'crouch_back']
const mapOf = (pack, slots) => Object.fromEntries(slots.map((x) => (Array.isArray(x) ? [x[0], `${pack}/${x[1]}`] : [x, `${pack}/${x}`])))
export const STYLES = {
  girl: { label: '少女MMD', map: mapOf('vmd', [['walk', 'chibi_walk'], ['run', 'girl_run']]) },
  motifect: { label: 'Motifect', map: {} },
  ual: { label: 'Quaternius', map: mapOf('ual', ['idle', 'idle2', 'walk', 'run', 'jump_start', 'jump_air', 'jump_land', ['fall_land', 'jump_land'], 'crouch', 'crouch_fwd']) },
  hand: { label: '手搓', map: mapOf('hand', ['idle', ['idle2', 'idle'], 'walk', 'run', 'jump_start', 'jump_air', 'jump_land', ['fall_land', 'jump_land'], 'crouch', 'crouch_fwd']) },
  import: { label: '导入', map: {} },
}

// 特色动作（数字键 1–8）：前两个来自之前的三渲二版本，中间四段从 v2c 舞蹈里截（带当时的表情），最后两段是《我的悲伤是水做的》
const EMOTES = [
  { name: 'emote_wave', label: '挥手' },
  { name: 'emote_heart', label: '比心' },
  { name: 'emote_lmg_wink', label: '眨眼', dance: [119.4, 122.6] },
  { name: 'emote_lmg_hook', label: '写JSON', dance: [15.5, 20.5] },
  { name: 'emote_lmg_chorus', label: '副歌', dance: [53.0, 58.0] },
  { name: 'emote_lmg_honey', label: '举手', dance: [62.0, 67.0] },
  { name: 'emote_bbw_chorus', label: '水·副歌' },
  { name: 'emote_bbw_handsup', label: '水·举手' },
  { name: 'hand/emote_cheer', label: '欢呼（手搓）', fresh: true, meta: { face_fixed: [15, 15, 11, 0, 0, 0, 0, 1] } },
  { name: 'ual/dance', label: '跳舞（Quaternius）', fresh: true, loop: 2, meta: { face_fixed: [20, 20, 11, 0, 0, 0, 0, 1] } },
]

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
const approach = (x, target, step) => (x < target ? Math.min(target, x + step) : Math.max(target, x - step))

export function createPlayer({ character, camera, canvas, hud, collider = null }) {
  const keys = new Set()
  const lastTap = {}
  const p = new THREE.Vector3() // 脚底位置（web 单位）
  const vel = new THREE.Vector3() // m/s
  let yaw = 0 // 相机水平角：0 = 看向 +Z
  let pitch = -0.1
  let charYaw = 0 // 角色朝向：0 = 面向 +Z（rig 的 -Y 经 glTF 变成 +Z）
  let grounded = true
  let flying = false
  let sprint = false
  let flyHold = 0 // 飞行中按住移动键的时长
  let boost = 1
  let view = 'fp'
  let camDist = 3.4 // 第三人称相机距离（米），滚轮调
  let camCur = camDist * M // 实际距离（被墙挡住时拉近）
  const contact = { hit: false, up: -1, down: 1, wall: new THREE.Vector3() }
  const _s0 = new THREE.Vector3()
  const _s1 = new THREE.Vector3()
  let mixer = null
  let acts = {}
  let base = null // 当前循环动作（pack/clip）
  let jump = null // { phase: 'up'|'air'|'land', k: 当前动作 }
  let style = 'girl'
  const metas = {}
  let emote = null // { name, t }
  let blink = { next: 2, t: -1 }
  let idleAlt = 0
  let emotes = []
  let hipsBind = null
  let springs = null

  // 槽位 → 当前风格里的动作（缺了就用 Motifect 的）
  function key(slot) {
    const m = STYLES[style]?.map[slot]
    if (m && acts[m]) return m
    if (acts[`motifect/${slot}`]) return `motifect/${slot}`
    return slot === 'fall_land' ? key('jump_land') : null
  }
  function fade(slot, dur = 0.22, timeScale = 1) {
    const k = key(slot)
    const a = k && acts[k]
    if (!a) return
    a.timeScale = timeScale
    if (base === k) return
    const prev = base && acts[base]
    a.reset().setEffectiveWeight(1).fadeIn(dur).play()
    if (prev) prev.fadeOut(dur)
    base = k
  }
  function addClip(k, clip, info) {
    clip.name = k
    const a = mixer.clipAction(clip)
    const n = k.split('/').pop()
    if (/^(jump_start|jump_land|fall_land|land|jump|crouch_rise)$/.test(n) || n.startsWith('emote_')) {
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
    }
    acts[k] = a
    const [pack, name] = k.split('/')
    ;(metas[pack] ||= {})[name] = info
  }
  async function loadPack(pack, loader) {
    const P = PACKS[pack]
    const [g, info] = await Promise.all([loader.loadAsync(P.glb), fetch(P.json).then((r) => r.json())])
    const seen = new Set()
    for (const clip of g.animations) {
      if (seen.has(clip.name)) continue
      seen.add(clip.name)
      const name = clip.name
      addClip(`${pack}/${name}`, clip, info[name])
      if (pack === 'motifect' && name === 'jump') {
        for (const [slot, [t0, t1]] of Object.entries(MOTIFECT_JUMP)) {
          const c = new THREE.AnimationClip(slot, -1, clip.tracks.map((tr) => tr.clone().trim(t0, t1).shift(-t0)))
          addClip(`motifect/${slot}`, c, { speed: [0, 0], duration: t1 - t0 })
        }
      }
    }
  }

  async function load() {
    if (mixer) return
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    mixer = new THREE.AnimationMixer(character.model)
    await Promise.all(Object.keys(PACKS).map((k) => loadPack(k, loader).catch((err) => console.warn('[player] 动作包加载失败', k, err))))
    // Hips 的绑定姿势朝向（算舞蹈片段起点朝向用）
    character.model.traverse((o) => {
      if (o.isSkinnedMesh && !hipsBind) {
        const i = o.skeleton.bones.findIndex((b) => b.name === 'Hips')
        if (i >= 0) hipsBind = new THREE.Quaternion().setFromRotationMatrix(o.skeleton.boneInverses[i].clone().invert())
      }
    })
    springs = character.springs // 角色模块建的弹簧骨（舞蹈/自由共用）
    api.springs = springs
    // 特色动作：emotes.glb（水做的两段 + 旧三渲二的挥手/比心）+ 从已加载的 v2c 舞蹈里截的四段
    const [eg, emeta] = await Promise.all([
      loader.loadAsync('./data/emotes.glb'),
      fetch('./data/emotes.json').then((r) => r.json()),
    ])
    const clips = Object.fromEntries(eg.animations.map((c) => [c.name, c]))
    for (const e of EMOTES) {
      if (e.fresh) {
        // 动作包里自带的（原地、朝前），直接用
        if (!acts[e.name]) continue
        e.yaw = 0
        if (e.loop) acts[e.name].setLoop(THREE.LoopRepeat, e.loop)
        else acts[e.name].setLoop(THREE.LoopOnce, 1)
        acts[e.name].clampWhenFinished = true
        emotes.push(e)
        continue
      }
      let clip = clips[e.name]
      if (e.dance && character.clip) {
        const off = 1 / 120 // 舞蹈 glb 第 1 帧在 1/120 秒
        clip = new THREE.AnimationClip(e.name, -1, character.clip.tracks.map((tr) => tr.clone().trim(e.dance[0] + off, e.dance[1] + off).shift(-(e.dance[0] + off))))
      }
      if (!clip) continue
      e.yaw = inPlace(clip)
      e.meta = emeta[e.name]
      const a = mixer.clipAction(clip)
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
      acts[e.name] = a
      emotes.push(e)
    }
  }
  // 舞蹈片段原地化：Hips 水平位移减去起点；返回起点时的朝向（让动作从角色当前朝向开始）
  function inPlace(clip) {
    const pos = clip.tracks.find((t) => t.name === 'Hips.position')
    if (pos) {
      const x0 = pos.values[0], z0 = pos.values[2]
      for (let i = 0; i < pos.values.length; i += 3) {
        pos.values[i] -= x0
        pos.values[i + 2] -= z0
      }
    }
    // 朝向取整段的平均（段首可能正在转身）
    const rot = clip.tracks.find((t) => t.name === 'Hips.quaternion')
    if (!rot || !hipsBind) return 0
    const inv = hipsBind.clone().invert()
    const q = new THREE.Quaternion()
    const f = new THREE.Vector3()
    let sx = 0, sz = 0
    for (let i = 0; i < rot.values.length; i += 4) {
      q.fromArray(rot.values, i).multiply(inv)
      f.set(0, 0, 1).applyQuaternion(q)
      const l = Math.hypot(f.x, f.z) || 1
      sx += f.x / l
      sz += f.z / l
    }
    return Math.atan2(sx, sz)
  }

  const api = {
    active: false,
    _debug: () => ({ yaw, flyW: flyW.v, flying, grounded, view, vel: vel.toArray().map((x) => +x.toFixed(2)), base, jump: jump && `${jump.phase}:${jump.k}`, emote: emote?.name, p: p.toArray().map((x) => +x.toFixed(1)) }),
    get view() {
      return view
    },
    setView(v) {
      if (!VIEWS[v] || v === view) return
      view = v
      api.onView?.(view)
      hud?.(api.help())
    },
    onView: null,
    onWheel(dy) {
      if (view === 'fp') return
      camDist = THREE.MathUtils.clamp(camDist * Math.exp(dy * 0.001), 1.2, 12)
    },
    ensureLoaded: () => load(),
    get style() {
      return style
    },
    // 切换动作风格（下一帧起生效）
    setStyle(name) {
      if (!STYLES[name]) return
      style = name
      if (base) {
        const slot = base.split('/').pop()
        base = null
        for (const a of Object.values(acts)) if (!emote || a !== acts[emote.name]) a.fadeOut(0.25)
        if (LOCO.includes(slot)) fade(slot, 0.25)
      }
      hud?.(api.help())
    },
    // 导入的动作（motion-import.js）：放进「导入」风格的某个槽位，或者作为特色动作
    addImported(slot, clip, info = {}) {
      if (!mixer) return
      const k = `import/${slot}`
      if (acts[k]) {
        acts[k].stop()
        mixer.uncacheAction(acts[k].getClip())
      }
      addClip(k, clip, { speed: [0, info.speed || 0], ...info })
      if (slot.startsWith('emote_')) {
        const e = { name: k, label: info.label || slot.slice(6), fresh: true, yaw: 0 }
        const i = emotes.findIndex((x) => x.name === k)
        if (i >= 0) emotes[i] = e
        else emotes.push(e)
      } else STYLES.import.map[slot] = k
      hud?.(api.help())
    },
    get flying() {
      return flying
    },
    async enter() {
      if (!character.ready) return
      await load()
      // 从舞蹈当前位置/朝向接手
      character.model.updateMatrixWorld(true)
      const hips = character.model.getObjectByName('Hips')
      const tl = character.model.getObjectByName('ToesL')
      const tr = character.model.getObjectByName('ToesR')
      hips.getWorldPosition(_v)
      p.set(_v.x, 0, _v.z)
      if (tl && tr) {
        const t = tl.getWorldPosition(new THREE.Vector3()).add(tr.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)
        charYaw = Math.atan2(t.x - _v.x, t.z - _v.z)
      }
      yaw = charYaw
      pitch = -0.1
      vel.set(0, 0, 0)
      grounded = true
      flying = false
      jump = emote = null
      base = null
      mixer.stopAllAction()
      springs.reset()
      fade('idle', 0)
      character.dancing = false
      character.model.position.copy(p)
      character.model.rotation.set(0, charYaw, 0)
      api.active = true
      collider?.warm(p, 250 * M) // 周围 250 m 的场景几何先建好 BVH
      hud?.(api.help())
    },
    exit() {
      api.active = false
      mixer?.stopAllAction()
      base = null
      character.dancing = true
      character.model.position.set(0, 0, 0)
      character.model.rotation.set(0, 0, 0)
      character.group.visible = true
      HEAD_CLIP.uHeadClip.value.w = 0
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      hud?.('')
    },
    help() {
      const v = VIEWS[view]
      const keyOf = (i) => (i < 9 ? String(i + 1) : i === 9 ? '0' : null)
      return `${v} · ${STYLES[style].label}${flying ? ` · 飞行中${boost >= 2 ? ` ×${Math.floor(boost)}` : ''}` : ''} ｜ WASD 移动 · 空格 跳 · Shift 蹲 · Ctrl/双击W 跑 · 双击空格 飞行 · V 视角${view === 'fp' ? '' : ' · 滚轮 远近'} · 点画面锁定鼠标\n特色动作：${emotes
        .map((e, i) => keyOf(i) && `${keyOf(i)} ${e.label}`)
        .filter(Boolean)
        .join('  ')}`
    },
    onMouse(dx, dy) {
      yaw -= dx * 0.0025
      pitch = Math.max(-1.45, Math.min(1.45, pitch - dy * 0.0025))
    },
    onKey(e, down) {
      const c = e.code
      if (!down) {
        keys.delete(c)
        if (c === 'KeyW' || c === 'ControlLeft' || c === 'ControlRight') sprint = keys.has('ControlLeft') || keys.has('ControlRight') ? sprint : false
        return /^(Key[WASDV]|Space|Shift|Control|Digit)/.test(c)
      }
      if (e.repeat) return /^(Key[WASD]|Space|Shift|Control)/.test(c)
      const now = performance.now() / 1000
      if (c === 'Space') {
        if (now - (lastTap.Space ?? -9) < DOUBLE_TAP) {
          flying = !flying // 双击空格：开/关飞行
          if (flying) {
            jump = null
            grounded = false
            vel.y = Math.max(vel.y, 1.5)
          }
          lastTap.Space = -9
        } else {
          lastTap.Space = now
          if (grounded && !flying) startJump()
        }
      } else if (c === 'KeyW') {
        if (now - (lastTap.KeyW ?? -9) < DOUBLE_TAP) sprint = true
        lastTap.KeyW = now
      } else if (c === 'ControlLeft' || c === 'ControlRight') sprint = true
      else if (c === 'KeyV') {
        api.setView(view === 'fp' ? 'back' : view === 'back' ? 'front' : 'fp')
      } else if (/^Digit[0-9]$/.test(c)) {
        const d = +c.slice(5)
        const e = emotes[d === 0 ? 9 : d - 1]
        if (e && grounded && !flying) {
          stopEmote()
          emote = { name: e.name, e, t: 0 }
          const a = acts[e.name]
          a.reset().setEffectiveWeight(1).fadeIn(0.25).play()
          if (base) acts[base].fadeOut(0.25)
          base = null
        }
      } else if (!/^(Key[ASD]|Shift)/.test(c)) return false
      keys.add(c)
      hud?.(api.help())
      return true
    },
    update(dt) {
      if (!api.active || !mixer) return
      const crouchKey = keys.has('ShiftLeft') || keys.has('ShiftRight')
      // ---- 输入 → 期望速度（以相机水平朝向为准）
      const ix = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
      const iz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
      const fx = Math.sin(yaw), fz = Math.cos(yaw)
      let wx = fz * 0 + (-fz) * ix + fx * iz // 右 = (-fz, 0, fx)
      let wz = fx * ix + fz * iz
      const il = Math.hypot(wx, wz)
      if (il > 1e-6) {
        wx /= il
        wz /= il
      }
      if (il > 0 && emote) stopEmote()
      if (!iz || iz < 0) sprint = keys.has('ControlLeft') || keys.has('ControlRight')
      if (flying) {
        const iy = (keys.has('Space') ? 1 : 0) - (crouchKey ? 1 : 0)
        // 按住移动（水平或升降）越久越快：每 2 秒翻倍，松手归零
        flyHold = il || iy ? flyHold + dt : 0
        boost = Math.min(FLY_MAX_BOOST, Math.pow(2, flyHold / 2))
        const top = (sprint ? FLY_SPRINT : FLY) * boost
        const ax = (il ? 10 : 4) * boost // 有输入时加速，松手后阻尼减速
        vel.x = approach(vel.x, wx * top * (il ? 1 : 0), ax * dt * Math.max(1, Math.abs(vel.x)))
        vel.z = approach(vel.z, wz * top * (il ? 1 : 0), ax * dt * Math.max(1, Math.abs(vel.z)))
        vel.y = approach(vel.y, iy * FLY_V * (sprint ? 1.8 : 1) * boost, (iy ? 12 : 6) * boost * dt)
      } else {
        flyHold = 0
        boost = 1
        const top = crouchKey ? CROUCH : sprint ? RUN : WALK
        const acc = grounded ? (il ? 14 : 18) : 4
        vel.x = approach(vel.x, wx * top * (il ? 1 : 0), acc * dt)
        vel.z = approach(vel.z, wz * top * (il ? 1 : 0), acc * dt)
      }
      // ---- 移动 + 碰撞
      move(dt, crouchKey)
      // ---- 朝向：第一人称跟镜头；第三人称转向移动方向
      const hs = Math.hypot(vel.x, vel.z)
      const want = view === 'fp' ? yaw : hs > 0.2 ? Math.atan2(vel.x, vel.z) : charYaw
      charYaw += angleTo(charYaw, want) * Math.min(1, dt * (view === 'fp' ? 20 : 8))
      // ---- 动作
      animate(dt, hs, crouchKey)
      mixer.update(dt)
      flyPose(hs)
      if (flyW.v > 0) uprightHead(flyW.v)
      if (jump && jump.phase !== 'land' && !base?.startsWith('hand/') && !jump.k?.startsWith('hand/')) {
        // 腾空高度交给物理，片段里 Hips 往上抬的部分去掉（只保留蓄力下蹲）
        const hips = character.model.getObjectByName('Hips')
        if (hips) hips.position.y = Math.min(hips.position.y, 0.905)
      }
      faceBlink(dt)
      if (emote) emote.t += dt
      character.model.position.copy(p)
      character.model.rotation.set(0, charYaw - (emote?.e.yaw || 0), 0)
      // 头发/裙摆/尾巴随动；舞蹈里截的特色动作自带烘焙物理，渐变关掉
      // 「物理」：头发/裙摆从静止姿势按身体运动算；「K帧」：用动作里的关键帧（舞蹈片段带烘焙物理，移动片段是静止的）
      springs.weight = approach(springs.weight, character.physics ? 1 : 0, dt * 3)
      character.model.updateMatrixWorld(true)
      springs.update(dt)
      placeCamera(dt)
      const hk = `${flying}|${Math.floor(boost)}`
      if (api._lastHelp !== hk) {
        api._lastHelp = hk
        hud?.(api.help())
      }
    },
  }

  // 重力一直加（站着时由地面顶回来，这样踩空/走下坡会自然掉下去）；按胶囊半径的一半分步走，防高速穿墙
  function move(dt, crouch) {
    if (!flying) vel.y -= G * dt
    const vy0 = vel.y
    let dx = vel.x * dt * M, dy = vel.y * dt * M, dz = vel.z * dt * M
    const r = CAP_R * M
    let dist = Math.hypot(dx, dy, dz)
    if (collider && dist > r) {
      // 一帧走得比半径还远（飞行加速）：先沿运动方向打一条射线，别穿过薄墙
      _v.set(dx, dy, dz).divideScalar(dist)
      const hit = collider.raycast(_s0.set(p.x, p.y + (crouch ? CAP_H_CROUCH : CAP_H) * M * 0.5, p.z), _v, dist + r)
      if (hit < dist + r) {
        const k = Math.max(0, hit - r) / dist
        dx *= k
        dy *= k
        dz *= k
        dist *= k
      }
    }
    const n = collider ? Math.min(24, Math.max(1, Math.ceil(dist / (r * 0.5)))) : 1
    let onGround = false
    for (let i = 0; i < n; i++) {
      p.x += dx / n
      p.y += dy / n
      p.z += dz / n
      if (collider && collide(crouch)) onGround = true
    }
    // 台面/水面 y = 0 一直当地面
    if (p.y <= 0) {
      p.y = 0
      onGround = true
    }
    // 走下台阶/下坡：刚才还站着、没在跳，就往下吸附到地面
    if (!onGround && grounded && !flying && !jump && collider) {
      const d = collider.raycast(_s0.set(p.x, p.y + r, p.z), _v.set(0, -1, 0), r + SNAP * M)
      if (d < Infinity) {
        p.y = Math.max(0, p.y + r - d)
        collide(crouch)
        onGround = true
      }
    }
    if (onGround && vel.y <= 0) {
      vel.y = 0
      if (!grounded) {
        grounded = true
        if (flying) flying = false // 飞到地面就落地（和 MC 一样）
        land(vy0)
      }
    } else if (!onGround && !flying) grounded = false
  }
  // 胶囊和场景求交，把角色推出来；返回是否踩在地上
  function collide(crouch) {
    const r = CAP_R * M
    const h = (crouch ? CAP_H_CROUCH : CAP_H) * M
    _s0.set(p.x, p.y + r, p.z)
    _s1.set(p.x, p.y + h - r, p.z)
    const c = collider.capsule(_s0, _s1, r, contact)
    if (!c.hit) return false
    p.set(_s0.x, _s0.y - r, _s0.z)
    if (c.down < -0.5 && vel.y > 0) vel.y = 0 // 撞头
    if (c.wall.lengthSq() > 0) {
      // 撞墙：去掉朝墙的速度分量（贴墙滑动）
      const vn = vel.x * c.wall.x + vel.z * c.wall.z
      if (vn < 0) {
        vel.x -= c.wall.x * vn
        vel.z -= c.wall.z * vn
      }
    }
    return c.up > 0.55
  }

  // 跳：起跳（一次）→ 空中（循环到落地）→ 落地（一次），每种风格都按这三段走
  function playOnce(slot, timeScale = 1, fadeDur = 0.12) {
    const k = key(slot)
    const a = k && acts[k]
    if (!a) return null
    a.reset().setEffectiveWeight(1).fadeIn(fadeDur).play()
    a.timeScale = timeScale
    if (base && base !== k) acts[base].fadeOut(fadeDur)
    if (jump?.k && jump.k !== k) acts[jump.k].fadeOut(fadeDur)
    base = null
    return k
  }
  function startJump() {
    grounded = false
    vel.y = JUMP_V
    stopEmote()
    const k = key('jump_start')
    jump = { phase: 'up', k: playOnce('jump_start', k?.startsWith('motifect/') ? 1.6 : k?.startsWith('ual/') ? 2.6 : 1.3) }
  }
  function land(vy) {
    if (jump || vy < -4) {
      jump = { phase: 'land', k: playOnce(jump ? 'jump_land' : 'fall_land', 1.3, 0.1) }
    }
  }
  function stopEmote() {
    if (!emote) return
    acts[emote.name].fadeOut(0.25)
    emote = null
    base = null
  }

  function animate(dt, hs, crouch) {
    if (jump) {
      const a = jump.k && acts[jump.k]
      const done = !a || a.time >= a.getClip().duration - 0.02 || !a.isRunning()
      if (jump.phase === 'up' && done) {
        // 空中保持（循环），直到落地
        const k = key('jump_air')
        if (k) {
          acts[k].reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(0.1).play()
          if (a && a !== acts[k]) a.fadeOut(0.1)
        }
        jump = { phase: 'air', k }
      }
      if (jump.phase === 'land' && (done || hs > 0.6)) {
        a?.fadeOut(0.25)
        jump = null
        base = null
      } else return
    }
    if (emote) {
      const a = acts[emote.name]
      if (!a.isRunning() || a.time >= a.getClip().duration - 0.05) stopEmote()
      else return
    }
    if (flying) {
      fade('idle', 0.35, 0.6)
      return
    }
    if (!grounded) {
      fade('idle', 0.3)
      return
    }
    // 角色坐标系里的速度：前（+）后（-），左右
    const cf = Math.sin(charYaw), cz = Math.cos(charYaw)
    const vf = vel.x * cf + vel.z * cz
    const vs = vel.x * cz - vel.z * cf // + = 她的左边
    if (crouch) {
      if (hs < 0.15) fade('crouch', 0.3)
      else fade(vf >= 0 ? 'crouch_fwd' : 'crouch_back', 0.25, rate(vf >= 0 ? 'crouch_fwd' : 'crouch_back', hs))
      return
    }
    if (hs < 0.15) {
      idleAlt += dt
      fade(idleAlt % 24 < 16 ? 'idle' : 'idle2', 0.5)
      return
    }
    idleAlt = 0
    const run = hs > (WALK + RUN) / 2
    let name
    if (Math.abs(vf) >= Math.abs(vs)) name = vf >= 0 ? (run ? 'run' : 'walk') : run ? 'run_back' : 'walk_back'
    else name = vs > 0 ? (run ? 'run_l' : 'walk_l') : run ? 'run_r' : 'walk_r'
    fade(name, 0.25, rate(name, hs))
  }
  // 按片段原速度缩放播放速率，脚步不打滑
  function rate(slot, speed) {
    const k = key(slot)
    const [pack, name] = (k || '/').split('/')
    const s = metas[pack]?.[name]?.speed
    const clipSpeed = s ? Math.hypot(s[0], s[1]) : 1
    return THREE.MathUtils.clamp(speed / Math.max(0.2, clipSpeed), 0.5, 2.7)
  }

  // 飞行姿势：在 idle 上叠加——小腿向后弯、脚尖绷直、身体随速度前倾、手臂微微张开（少女飞行的样子）
  const flyW = { v: 0 }
  function flyPose(hs) {
    flyW.v = approach(flyW.v, flying ? 1 : 0, 0.05)
    if (flyW.v <= 0) return
    const w = flyW.v
    const lean = Math.min(1, hs / FLY_SPRINT)
    const rot = (name, x, y = 0, z = 0) => {
      const b = character.model.getObjectByName(name)
      if (!b) return
      _q.setFromEuler(_e.set(x * w, y * w, z * w))
      b.quaternion.multiply(_q)
    }
    const t = performance.now() / 1000
    rot('Hips', 0.25 + 0.55 * lean)
    rot('UpperLegL', -0.35 - 0.1 * Math.sin(t * 2.1))
    rot('UpperLegR', -0.15 - 0.1 * Math.sin(t * 2.1 + 1.3))
    rot('LowerLegL', 1.15 + 0.12 * Math.sin(t * 2.1 + 0.4))
    rot('LowerLegR', 0.75 + 0.12 * Math.sin(t * 2.1 + 1.7))
    rot('FootL', 0.5)
    rot('FootR', 0.5)
    rot('UpperArmL', 0, 0, -0.35 - 0.1 * Math.sin(t * 1.7))
    rot('UpperArmR', 0, 0, 0.35 + 0.1 * Math.sin(t * 1.7))
  }

  // 飞行时身体前倾，脖子和头往回抬，让头保持竖直、看向前方（超人式）。
  // 不然第一人称的眼睛跟着头一起低下去，水平看出去就是从头顶/刘海里面穿出去
  const _up = new THREE.Vector3()
  const _qa = new THREE.Quaternion()
  const _qp = new THREE.Quaternion()
  const _qi = new THREE.Quaternion()
  function uprightHead(w) {
    const hk = headLocal()
    const head = character.model.getObjectByName('Head')
    if (!hk || !head) return
    for (const [name, k] of [['Neck', 0.45], ['Head', 1]]) {
      const b = character.model.getObjectByName(name)
      if (!b) continue
      b.updateWorldMatrix(true, false)
      head.updateWorldMatrix(false, false)
      _up.copy(hk.up).transformDirection(head.matrixWorld)
      _qa.setFromUnitVectors(_up, _v.set(0, 1, 0)).slerp(_qi, 1 - w * k)
      // 世界空间旋转 → 骨骼本地：local' = P⁻¹ · q · P · local
      b.parent.getWorldQuaternion(_qp)
      b.quaternion.premultiply(_qp.clone().invert().multiply(_qa).multiply(_qp))
      b.updateMatrixWorld(true)
    }
  }

  // 玩家模式下没有表情轨：保持睁眼，偶尔眨眼（v2c 驱动：眨眼 = 7×まばたき，睁眼 = 20）
  function faceBlink(dt) {
    const u = character.material?.uniforms
    if (!u) return
    blink.next -= dt
    if (blink.next <= 0 && blink.t < 0) blink.t = 0
    let eye = 20
    if (blink.t >= 0) {
      blink.t += dt
      const k = blink.t / 0.16
      const b = k < 0.5 ? k * 2 : 2 - k * 2
      if (k >= 1) {
        blink.t = -1
        blink.next = 2 + Math.random() * 3.5
      } else eye = Math.max(0.01, b) * 7
    }
    u.uFaceEyeR.value = eye
    u.uFaceEyeL.value = eye
    u.uFaceMouth.value = 0
    u.uFaceIrisR.value.set(0, 0)
    u.uFaceIrisL.value.set(0, 0)
    // 特色动作带表情：v2c 段用当时的表情轨，水做的段用导出的逐帧值，旧动作固定笑脸
    const e = emote?.e
    if (!e) return
    if (e.dance && character.face) character.face.apply(character.material, e.dance[0] + emote.t)
    else {
      const f = e.meta?.face ? e.meta.face[Math.min(e.meta.face.length - 1, Math.round(emote.t * 30))] : e.meta?.face_fixed
      if (f) {
        u.uFaceEyeR.value = f[0]
        u.uFaceEyeL.value = f[1]
        u.uFaceMouth.value = f[2]
        u.uFaceIrisR.value.set(f[3], f[4])
        u.uFaceIrisL.value.set(f[5], f[6])
        u.uFaceIrisScale.value = f[7]
      }
    }
  }

  // 头骨本地坐标里的眼睛位置和裁剪球心：在绑定姿势（站直、面朝 +Z）下按世界方向量好再换到头骨本地
  let headK = null
  function headLocal() {
    if (headK) return headK
    let mesh = null
    character.model.traverse((o) => {
      if (!mesh && o.isSkinnedMesh) mesh = o
    })
    const i = mesh ? mesh.skeleton.bones.findIndex((b) => b.name === 'Head') : -1
    if (i < 0) return null
    // 静止姿势下：头骨世界矩阵 = 网格世界矩阵 × boneInverse⁻¹。临时把角色放回原点、朝 +Z 量一次
    const m = character.model
    const pos0 = m.position.clone(), rot0 = m.rotation.clone()
    m.position.set(0, 0, 0)
    m.rotation.set(0, 0, 0)
    m.updateMatrixWorld(true)
    const W = mesh.matrixWorld.clone()
    m.position.copy(pos0)
    m.rotation.copy(rot0)
    m.updateMatrixWorld(true)
    const inv = mesh.skeleton.boneInverses[i]
    const toLocal = new THREE.Matrix4().multiplyMatrices(inv, W.clone().invert())
    const headRest = new THREE.Vector3().applyMatrix4(new THREE.Matrix4().copy(toLocal).invert())
    const at = (up, fwd) => headRest.clone().add(new THREE.Vector3(0, up * M, fwd * M)).applyMatrix4(toLocal)
    headK = { eye: at(0.06, 0.1), clip: at(0.08, 0.03), up: new THREE.Vector3(0, 1, 0).transformDirection(toLocal) }
    return headK
  }
  const _eye = new THREE.Vector3()
  const _clip = new THREE.Vector3()
  const _v2 = new THREE.Vector3()
  function placeCamera(dt = 0) {
    const cp = Math.cos(pitch)
    const dir = _v.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp)
    camera.up.set(0, 1, 0)
    if (view === 'fp') {
      character.model.updateMatrixWorld(true)
      const head = character.model.getObjectByName('Head')
      const hk = head && headLocal()
      let eye, c
      if (hk) {
        // 眼睛和裁剪球都绑在头骨上（骨骼本地坐标），身体前倾（飞行姿势、鞠躬）时跟着头一起转，相机不会陷进后脑/头发里
        eye = _eye.copy(hk.eye).applyMatrix4(head.matrixWorld)
        c = _clip.copy(hk.clip).applyMatrix4(head.matrixWorld)
      } else {
        eye = _eye.copy(p).add(_clip.set(0, 1.45 * M, 0))
        c = _clip.copy(eye)
      }
      camera.position.copy(eye)
      camera.lookAt(_v2.copy(eye).add(dir))
      camera.fov = 72
      camera.near = 0.04 * M
      // 只裁掉头部（含刘海、耳朵），低头能看到身体、抬手能看到手；球心略靠前，把相机周围也包进去（甩到脸前的头发不会糊在镜头上）
      HEAD_CLIP.uHeadClip.value.set(c.x, c.y, c.z, 0.2 * M)
      character.group.visible = true
    } else {
      const pivot = p.clone().add(new THREE.Vector3(0, 1.15 * M, 0))
      const s = view === 'back' ? -1 : 1
      // 相机被墙/建筑挡住就拉近（瞬间拉近，慢慢退回）
      let want = camDist * M
      if (collider) {
        const out = _s1.copy(dir).multiplyScalar(s)
        const hit = collider.raycast(pivot, out, want + 0.3 * M)
        if (hit < Infinity) want = Math.max(0.35 * M, hit - 0.3 * M)
      }
      camCur = want < camCur || !dt ? want : approach(camCur, want, dt * 4 * M + (want - camCur) * Math.min(1, dt * 6))
      camera.position.copy(pivot).addScaledVector(dir, s * camCur)
      camera.position.y = Math.max(camera.position.y, 0.3 * M)
      camera.lookAt(pivot)
      camera.fov = 50
      camera.near = 0.1 * M
      HEAD_CLIP.uHeadClip.value.w = 0
      character.group.visible = true
    }
    camera.far = 80000
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }

  return api
}
