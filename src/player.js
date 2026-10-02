// 玩家模式：角色脱离舞蹈（歌曲/场景时间轴照走），由第一人称 / 第三人称镜头控制。只动角色和相机，不碰场景。
//   WASD 前后左右 · 空格 跳 · 按住 Shift 蹲 · Ctrl 或双击 W 跑
//   双击空格 进入/退出飞行（像 MC）：飞行时按住空格上升、Shift 下降，有加速度和阻尼
//   V 切换 第一人称 / 背后第三人称 / 正面第三人称 · 1–8 特色动作 · 鼠标看（点画面锁定指针，Esc 释放）
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

export function createPlayer({ character, camera, canvas, hud }) {
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
    _debug: () => ({ flyW: flyW.v, flying, grounded, view, base, jump: jump && `${jump.phase}:${jump.k}`, emote: emote?.name, p: p.toArray().map((x) => +x.toFixed(1)) }),
    get view() {
      return view
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
      const v = { fp: '第一人称', back: '背后', front: '正面' }[view]
      const keyOf = (i) => (i < 9 ? String(i + 1) : i === 9 ? '0' : null)
      return `${v} · ${STYLES[style].label}${flying ? ` · 飞行中${boost >= 2 ? ` ×${Math.floor(boost)}` : ''}` : ''} ｜ WASD 移动 · 空格 跳 · Shift 蹲 · Ctrl/双击W 跑 · 双击空格 飞行 · V 视角 · 点画面锁定鼠标\n特色动作：${emotes
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
        view = view === 'fp' ? 'back' : view === 'back' ? 'front' : 'fp'
        hud?.(api.help())
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
        if (!grounded) vel.y -= G * dt
      }
      p.x += vel.x * dt * M
      p.z += vel.z * dt * M
      p.y += vel.y * dt * M
      if (p.y <= 0) {
        p.y = 0
        if (!grounded && vel.y <= 0) {
          grounded = true
          if (flying) flying = false // 飞到地面就落地（和 MC 一样）
          land(vel.y)
        }
        vel.y = Math.max(0, vel.y)
      } else if (!flying && grounded && p.y > 0.01) grounded = false
      // ---- 朝向：第一人称跟镜头；第三人称转向移动方向
      const hs = Math.hypot(vel.x, vel.z)
      const want = view === 'fp' ? yaw : hs > 0.2 ? Math.atan2(vel.x, vel.z) : charYaw
      charYaw += angleTo(charYaw, want) * Math.min(1, dt * (view === 'fp' ? 20 : 8))
      // ---- 动作
      animate(dt, hs, crouchKey)
      mixer.update(dt)
      flyPose(hs)
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
      placeCamera()
      const hk = `${flying}|${Math.floor(boost)}`
      if (api._lastHelp !== hk) {
        api._lastHelp = hk
        hud?.(api.help())
      }
    },
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

  function placeCamera() {
    const cp = Math.cos(pitch)
    const dir = _v.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp)
    camera.up.set(0, 1, 0)
    if (view === 'fp') {
      character.model.updateMatrixWorld(true)
      const head = character.model.getObjectByName('Head')
      const eye = head ? head.getWorldPosition(new THREE.Vector3()) : p.clone().add(new THREE.Vector3(0, 1.45 * M, 0))
      eye.y += 0.06 * M
      eye.addScaledVector(new THREE.Vector3(Math.sin(charYaw), 0, Math.cos(charYaw)), 0.1 * M)
      camera.position.copy(eye)
      camera.lookAt(eye.clone().add(dir))
      camera.fov = 72
      camera.near = 0.04 * M
      // 只裁掉头部（含刘海、耳朵），低头能看到身体、抬手能看到手
      const c = head ? head.getWorldPosition(new THREE.Vector3()) : eye
      HEAD_CLIP.uHeadClip.value.set(c.x, c.y + 0.09 * M, c.z, 0.17 * M)
      character.group.visible = true
    } else {
      const pivot = p.clone().add(new THREE.Vector3(0, 1.15 * M, 0))
      const dist = 3.4 * M
      const s = view === 'back' ? -1 : 1
      camera.position.copy(pivot).addScaledVector(dir, s * dist)
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
