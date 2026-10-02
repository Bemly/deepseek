// 玩家模式：角色脱离舞蹈（歌曲/场景时间轴照走），由第一人称 / 第三人称镜头控制。只动角色和相机，不碰场景。
//   WASD 前后左右 · 空格 跳 · 按住 Shift 蹲 · Ctrl 或双击 W 跑
//   双击空格 进入/退出飞行（像 MC）：飞行时按住空格上升、Shift 下降，有加速度和阻尼
//   V 切换 第一人称 / 背后第三人称 / 正面第三人称 · 1–8 特色动作 · 鼠标看（点画面锁定指针，Esc 释放）
// 头发/裙摆/尾巴/耳朵用弹簧骨随动（springbones.js）。
// 动作：public/data/moves.glb（tools/retarget_bvh.py 把 BVH 重定向到 v2c 骨架，原地播放），速度见 moves.json。
import * as THREE from 'three'
import { createSpringBones } from './springbones.js'

const M = 12.5 // 1 米 = 12.5 web 单位（blend → web）
const G = 20 // 重力 m/s²
const JUMP_V = 6.2 // 起跳速度 → 约 0.95 m 高
const WALK = 1.5, RUN = 3.8, CROUCH = 0.8 // m/s
const FLY = 6, FLY_SPRINT = 14, FLY_V = 5 // m/s
const DOUBLE_TAP = 0.3 // 秒
// jump 片段（jump_standing，30fps）：44 帧前是蹲下蓄力，47 离地，53 腾空最高，59 落地，72 站稳
const JUMP_T = { start: 44 / 30, hold: 53 / 30, land: 59 / 30, end: 72 / 30 }

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
  let view = 'fp'
  let mixer = null
  let acts = {}
  let meta = {}
  let base = null // 当前循环动作名
  let jump = null // { phase: 'up'|'air'|'land', t }
  let emote = null // { name, t }
  let blink = { next: 2, t: -1 }
  let idleAlt = 0
  let emotes = []
  let hipsBind = null
  let springs = null

  function fade(name, dur = 0.22, timeScale = 1) {
    const a = acts[name]
    if (!a) return
    a.timeScale = timeScale
    if (base === name) return
    const prev = base && acts[base]
    a.reset().setEffectiveWeight(1).fadeIn(dur).play()
    if (prev) prev.fadeOut(dur)
    base = name
  }

  async function load() {
    if (mixer) return
    const [{ GLTFLoader }, info] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      fetch('./data/moves.json').then((r) => r.json()),
    ])
    const g = await new GLTFLoader().loadAsync('./data/moves.glb')
    meta = info
    // Hips 的绑定姿势朝向（算舞蹈片段起点朝向用）
    character.model.traverse((o) => {
      if (o.isSkinnedMesh && !hipsBind) {
        const i = o.skeleton.bones.findIndex((b) => b.name === 'Hips')
        if (i >= 0) hipsBind = new THREE.Quaternion().setFromRotationMatrix(o.skeleton.boneInverses[i].clone().invert())
      }
    })
    mixer = new THREE.AnimationMixer(character.model)
    springs = createSpringBones(character.model)
    api.springs = springs
    for (const clip of g.animations) {
      const a = mixer.clipAction(clip)
      const once = /^(jump|land|crouch_rise)$/.test(clip.name) || clip.name.startsWith('emote_')
      if (once) {
        a.setLoop(THREE.LoopOnce, 1)
        a.clampWhenFinished = true
      }
      acts[clip.name] = a
    }
    // 特色动作：emotes.glb（水做的两段 + 旧三渲二的挥手/比心）+ 从已加载的 v2c 舞蹈里截的四段
    const [eg, emeta] = await Promise.all([
      new GLTFLoader().loadAsync('./data/emotes.glb'),
      fetch('./data/emotes.json').then((r) => r.json()),
    ])
    const clips = Object.fromEntries(eg.animations.map((c) => [c.name, c]))
    for (const e of EMOTES) {
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
    _debug: () => ({ flyW: flyW.v, flying, grounded, view, base, p: p.toArray().map((x) => +x.toFixed(1)) }),
    get view() {
      return view
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
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      hud?.('')
    },
    help() {
      const v = { fp: '第一人称', back: '背后', front: '正面' }[view]
      return `${v}${flying ? ' · 飞行中' : ''} ｜ WASD 移动 · 空格 跳 · Shift 蹲 · Ctrl/双击W 跑 · 双击空格 飞行 · V 视角 · 点画面锁定鼠标\n特色动作：${emotes.map((e, i) => `${i + 1} ${e.label}`).join('  ')}`
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
      } else if (/^Digit[1-9]$/.test(c)) {
        const e = emotes[+c.slice(5) - 1]
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
        const top = sprint ? FLY_SPRINT : FLY
        const ax = il ? 10 : 4 // 有输入时加速，松手后阻尼减速
        vel.x = approach(vel.x, wx * top * (il ? 1 : 0), ax * dt * Math.max(1, Math.abs(vel.x)))
        vel.z = approach(vel.z, wz * top * (il ? 1 : 0), ax * dt * Math.max(1, Math.abs(vel.z)))
        const iy = (keys.has('Space') ? 1 : 0) - (crouchKey ? 1 : 0)
        vel.y = approach(vel.y, iy * FLY_V * (sprint ? 1.8 : 1), (iy ? 12 : 6) * dt)
      } else {
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
      if (jump && jump.phase !== 'land') {
        // 腾空高度交给物理，片段里 Hips 往上抬的部分去掉（只保留蓄力下蹲）
        const hips = character.model.getObjectByName('Hips')
        if (hips) hips.position.y = Math.min(hips.position.y, 0.905)
      }
      faceBlink(dt)
      if (emote) emote.t += dt
      character.model.position.copy(p)
      character.model.rotation.set(0, charYaw - (emote?.e.yaw || 0), 0)
      // 头发/裙摆/尾巴随动；舞蹈里截的特色动作自带烘焙物理，渐变关掉
      const baked = emote && (emote.e.dance || emote.e.name.startsWith('emote_bbw'))
      springs.weight = approach(springs.weight, baked ? 0 : 1, dt * 3)
      character.model.updateMatrixWorld(true)
      springs.update(dt)
      placeCamera()
      if (api._lastHelp !== flying) {
        api._lastHelp = flying
        hud?.(api.help())
      }
    },
  }

  function startJump() {
    grounded = false
    vel.y = JUMP_V
    stopEmote()
    jump = { phase: 'up' }
    const a = acts.jump
    a.reset().setEffectiveWeight(1).play()
    a.time = JUMP_T.start
    a.timeScale = 1.6
    if (base) acts[base].fadeOut(0.12)
    base = null
  }
  function land(vy) {
    if (jump) {
      jump.phase = 'land'
      const a = acts.jump
      a.paused = false
      a.time = Math.max(a.time, JUMP_T.land)
      a.timeScale = 1.4
    } else if (vy < -4) {
      // 从高处落下（飞行/坠落）：落地缓冲
      const a = acts.land
      a.reset().setEffectiveWeight(1).play()
      a.time = 1.25
      a.timeScale = 1.3
      if (base) acts[base].fadeOut(0.1)
      base = null
      jump = { phase: 'land', clip: 'land' }
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
      const a = acts[jump.clip || 'jump']
      if (jump.phase === 'up' && a.time >= JUMP_T.hold) {
        jump.phase = 'air'
        a.paused = true // 空中保持腾空姿势，直到落地
      }
      const end = jump.clip ? 2.6 : JUMP_T.end
      if (jump.phase === 'land' && (a.time >= end || hs > 0.6)) {
        a.fadeOut(0.25)
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
  function rate(name, speed) {
    const s = meta[name]?.speed
    const clipSpeed = s ? Math.hypot(s[0], s[1]) : 1
    return THREE.MathUtils.clamp(speed / Math.max(0.2, clipSpeed), 0.5, 2.4)
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
      character.group.visible = false // 第一人称看不到自己（像 MC）
    } else {
      const pivot = p.clone().add(new THREE.Vector3(0, 1.15 * M, 0))
      const dist = 3.4 * M
      const s = view === 'back' ? -1 : 1
      camera.position.copy(pivot).addScaledVector(dir, s * dist)
      camera.position.y = Math.max(camera.position.y, 0.3 * M)
      camera.lookAt(pivot)
      camera.fov = 50
      camera.near = 0.1 * M
      character.group.visible = true
    }
    camera.far = 80000
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }

  return api
}
