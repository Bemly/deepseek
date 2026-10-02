// 自行导入动作：VMD（MMD）/ VRMA（VRoid）/ BVH / FBX / GLB，在浏览器里重定向到 v2c 骨架，放进「导入」风格的槽位或做成特色动作。
// 文件只存在你自己的浏览器（IndexedDB），不上传、不进仓库——给那些禁止再分发的动作（ゆきはね式、VRoid 官方 VRMA 等）用。
//
// VMD：tools/vmd_solver.py（MMD 解算器）的 JS 移植——MMD 骨骼链合成、A-pose 手臂/手指修正、足ＩＫ解析两段 IK、センター位移。
//      需要骨架在 Blender 里的静止数据 public/data/rig-rest.json（tools/export_rig_rest.py）。
// 其他：通用骨架重定向——每根骨骼复制源动作相对静止姿势的世界旋转变化，手臂/手/脚做 T-pose→A-pose 方向修正，
//      VRMA 用文件里的 humanoid 映射，其余按层级从手、脚往上认（不依赖命名），髋部按腿长缩放、原地化。
import * as THREE from 'three'

const FPS = 30
const MMD_SCALE = 0.085 // MMD 单位 → 米（和 vmd_solver.py 一致）
const ARM_A = THREE.MathUtils.degToRad(40)
export const IMPORT_SLOTS = [
  ['idle', '待机'], ['walk', '走'], ['run', '跑'], ['walk_back', '后退'], ['walk_l', '左移'], ['walk_r', '右移'],
  ['jump_start', '起跳'], ['jump_air', '空中'], ['jump_land', '落地'], ['crouch', '蹲'], ['crouch_fwd', '蹲走'],
  ['emote', '特色动作'], ['none', '不用'],
]
const DEFAULT_SPEED = { walk: 1.1, run: 3.0, walk_back: 0.8, walk_l: 0.8, walk_r: 0.8, crouch_fwd: 0.8 }
const VROID_LABELS = { '01': '全身展示', '02': '打招呼', '03': '比耶', '04': '发射', '05': '转圈', '06': '模特姿势', '07': '屈伸' }

const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n)
const V = (a) => new THREE.Vector3(a[0], a[1], a[2])
const b2tQ = (q) => new THREE.Quaternion(q.x, q.z, -q.y, q.w) // Blender(Z 上) → three(Y 上)：(x,y,z)→(x,z,-y)
const b2tV = (v) => new THREE.Vector3(v.x, v.z, -v.y)
const qmul = (a, b) => a.clone().multiply(b)
const qinv = (a) => a.clone().invert()

// ---------------- 目标骨架（three 模型空间的绑定姿势）----------------
function rigInfo(model) {
  let skinned = null
  model.traverse((o) => {
    if (o.isSkinnedMesh && !skinned) skinned = o
  })
  const sk = skinned.skeleton
  const bones = {}
  sk.bones.forEach((b, i) => {
    const m = sk.boneInverses[i].clone().invert() // 模型空间的绑定矩阵
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    m.decompose(pos, q, s)
    bones[b.name] = { bone: b, pos, q, m }
  })
  // 父子（只认骨骼）
  for (const [n, r] of Object.entries(bones)) r.parent = r.bone.parent?.isBone ? r.bone.parent.name : null
  const order = sk.bones.map((b) => b.name).sort((a, b) => depth(bones, a) - depth(bones, b))
  return { bones, order }
}
function depth(bones, n) {
  let d = 0
  while (bones[n]?.parent) {
    n = bones[n].parent
    d++
  }
  return d
}

// 给定每根骨骼的「模型空间旋转变化」（相对绑定姿势），逐帧算本地四元数，生成 AnimationClip
function bakeClip(name, rig, frames, deltaAt, hipsAt) {
  const tracks = {}
  const times = new Float32Array(frames).map((_, i) => i / FPS)
  const names = new Set()
  const W = {}
  const out = {}
  for (let f = 0; f < frames; f++) {
    const D = deltaAt(f) // Map 骨骼名(three) → 四元数（模型空间的变化）
    for (const n of rig.order) {
      const r = rig.bones[n]
      const d = D.get(n) || (r.parent ? W[`d:${r.parent}`] : new THREE.Quaternion())
      W[`d:${n}`] = d
      W[n] = qmul(d, r.q) // 模型空间旋转
      const pw = r.parent ? W[r.parent] : new THREE.Quaternion()
      const local = qmul(qinv(pw), W[n])
      const arr = (out[n] ||= new Float32Array(frames * 4))
      const prev = f ? new THREE.Quaternion().fromArray(arr, (f - 1) * 4) : null
      if (prev && prev.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w)
      local.toArray(arr, f * 4)
      names.add(n)
    }
    if (hipsAt) {
      const h = rig.bones.Hips
      const pr = h.parent ? rig.bones[h.parent] : null
      const want = h.pos.clone().add(hipsAt(f)) // 模型空间
      const local = pr ? want.applyMatrix4(pr.m.clone().invert()) : want
      ;(tracks.hipsPos ||= new Float32Array(frames * 3)).set([local.x, local.y, local.z], f * 3)
    }
  }
  const kt = [...names].map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, out[n]))
  if (tracks.hipsPos) kt.push(new THREE.VectorKeyframeTrack('Hips.position', times, tracks.hipsPos))
  return new THREE.AnimationClip(name, (frames - 1) / FPS, kt)
}

// 原地化：去掉髋部水平方向的线性漂移，返回速度（米/秒，前进为正）
function inPlace(hips) {
  const n = hips.length
  if (n < 3) return 0
  const t = hips.map((_, i) => i / FPS)
  const fit = (k) => {
    const mt = t.reduce((a, b) => a + b) / n, mv = hips.reduce((a, h) => a + h.getComponent(k), 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (t[i] - mt) * (hips[i].getComponent(k) - mv)
      den += (t[i] - mt) ** 2
    }
    const s = num / den
    return [s, mv - s * mt]
  }
  const [sx, bx] = fit(0), [sz, bz] = fit(2)
  hips.forEach((h, i) => {
    h.x -= sx * t[i] + bx
    h.z -= sz * t[i] + bz
  })
  return sz // 模型空间 +Z = 她的前方
}

// ---------------- VMD ----------------
function parseVMD(buf) {
  const dv = new DataView(buf)
  const sj = new TextDecoder('shift-jis')
  const n = dv.getUint32(50, true)
  const tracks = new Map()
  let maxF = 0
  for (let i = 0, o = 54; i < n; i++, o += 111) {
    const raw = new Uint8Array(buf, o, 15)
    const end = raw.indexOf(0)
    const name = sj.decode(raw.subarray(0, end < 0 ? 15 : end))
    const f = dv.getUint32(o + 15, true)
    const p = [0, 1, 2].map((k) => dv.getFloat32(o + 19 + k * 4, true))
    const q = [0, 1, 2, 3].map((k) => dv.getFloat32(o + 31 + k * 4, true))
    if (!tracks.has(name)) tracks.set(name, [])
    tracks.get(name).push({ f, p, q })
    maxF = Math.max(maxF, f)
  }
  for (const k of tracks.values()) k.sort((a, b) => a.f - b.f)
  return { tracks, frames: maxF + 1 }
}
function vmdTrack(vmd, name, NF) {
  const keys = vmd.tracks.get(name)
  const Q = [], P = []
  if (!keys) {
    for (let f = 0; f < NF; f++) {
      Q.push(new THREE.Quaternion())
      P.push(new THREE.Vector3())
    }
    return { Q, P, has: false }
  }
  // MMD（左手系 x,y,z,w）→ Blender：q=(w,-x,-z,-y)，p=(x,z,y)
  const kq = keys.map((k) => new THREE.Quaternion(-k.q[0], -k.q[2], -k.q[1], k.q[3]))
  const kp = keys.map((k) => new THREE.Vector3(k.p[0], k.p[2], k.p[1]))
  for (let i = 1; i < kq.length; i++) if (kq[i].dot(kq[i - 1]) < 0) kq[i].set(-kq[i].x, -kq[i].y, -kq[i].z, -kq[i].w)
  let j = 0
  for (let f = 0; f < NF; f++) {
    while (j + 1 < keys.length && keys[j + 1].f <= f) j++
    const a = keys[j], b = keys[Math.min(j + 1, keys.length - 1)]
    const t = b.f > a.f ? THREE.MathUtils.clamp((f - a.f) / (b.f - a.f), 0, 1) : 0
    Q.push(kq[j].clone().slerp(kq[Math.min(j + 1, kq.length - 1)], t))
    P.push(kp[j].clone().lerp(kp[Math.min(j + 1, kp.length - 1)], t))
  }
  return { Q, P, has: true }
}
// frame_q(y, z)：y 轴 = y，z 轴 ⟂ y，x = y×z
function frameQ(y, z) {
  y = y.clone().normalize()
  z = z.clone().addScaledVector(y, -z.dot(y)).normalize()
  const x = new THREE.Vector3().crossVectors(y, z)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}
function solveVMD(buf, rest, rig, name) {
  const vmd = parseVMD(buf)
  const NF = Math.max(2, vmd.frames)
  const T = (n) => vmdTrack(vmd, n, NF)
  const cache = {}
  const g = (n) => (cache[n] ||= T(n))
  const Q = (n, f) => g(n).Q[f]
  const R = (n) => rest[n]
  const rdir = (n) => V(R(n).tail).sub(V(R(n).head)).normalize()
  const fing = { Thumb: ['親指０', '親指１', '親指２'], Index: ['人指１', '人指２', '人指３'], Middle: ['中指１', '中指２', '中指３'], Ring: ['薬指１', '薬指２', '薬指３'], Little: ['小指１', '小指２', '小指３'] }
  // 静止姿势修正（Blender 空间）
  const C = {}
  for (const [sd, sg] of [['L', 1], ['R', -1]]) {
    const adir = new THREE.Vector3(sg * Math.cos(ARM_A), 0, -Math.sin(ARM_A))
    C[`Shoulder.${sd}`] = new THREE.Quaternion().setFromUnitVectors(rdir(`Shoulder.${sd}`), new THREE.Vector3(sg, 0, -0.15).normalize())
    C[`UpperArm.${sd}`] = new THREE.Quaternion().setFromUnitVectors(rdir(`UpperArm.${sd}`), adir)
    C[`LowerArm.${sd}`] = new THREE.Quaternion().setFromUnitVectors(rdir(`LowerArm.${sd}`), adir)
    const mdors = new THREE.Vector3(0, 0, 1)
    C[`Hand.${sd}`] = qmul(frameQ(adir, mdors), qinv(frameQ(rdir(`Hand.${sd}`), V(R(`Hand.${sd}`).z))))
    for (const f of Object.keys(fing))
      for (const i of [1, 2, 3]) {
        const bn = `${f}${i}.${sd}`
        if (!R(bn)) continue
        const md = f === 'Thumb' ? adir.clone().add(new THREE.Vector3(0, -1.1, 0)).normalize() : adir
        const mz = f === 'Thumb' ? mdors.clone().add(new THREE.Vector3(0, -0.8, 0)) : mdors
        C[bn] = qmul(frameQ(md, mz), qinv(frameQ(rdir(bn), V(R(bn).z))))
      }
  }
  const legs = {}
  for (const sd of ['L', 'R']) {
    const hip0 = V(R(`UpperLeg.${sd}`).head), knee0 = V(R(`LowerLeg.${sd}`).head), ank0 = V(R(`Foot.${sd}`).head)
    legs[sd] = { hip0, knee0, ank0, L1: knee0.distanceTo(hip0), L2: ank0.distanceTo(knee0),
      thRest: frameQ(knee0.clone().sub(hip0), new THREE.Vector3(0, -1, 0)), shRest: frameQ(ank0.clone().sub(knee0), new THREE.Vector3(0, -1, 0)) }
  }
  const hipsHead = V(R('Hips').head)
  // センター位移 → 原地化 + 速度（全ての親）
  const hipsT = g('センター').P.map((p) => p.clone().multiplyScalar(MMD_SCALE))
  const tt = hipsT.map((_, i) => i / FPS)
  const slope = (arr, k) => {
    const n = arr.length, mt = tt.reduce((a, b) => a + b) / n, mv = arr.reduce((a, v) => a + v.getComponent(k), 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (tt[i] - mt) * (arr[i].getComponent(k) - mv)
      den += (tt[i] - mt) ** 2
    }
    return [num / den, mv - (num / den) * mt]
  }
  const drift = [slope(hipsT, 0), slope(hipsT, 1)]
  hipsT.forEach((h, i) => {
    h.x -= drift[0][0] * tt[i] + drift[0][1]
    h.y -= drift[1][0] * tt[i] + drift[1][1]
  })
  const mother = g('全ての親').P.map((p) => p.clone().multiplyScalar(MMD_SCALE))
  const speedFwd = -(slope(mother, 1)[0] + drift[1][0]) // rig 面向 -Y
  const SRC = { Hips: 'lower', Spine: 'upper', Chest: 'upper2', UpperChest: 'upper2', Neck: 'neck', Head: 'head' }
  for (const sd of ['L', 'R']) {
    Object.assign(SRC, { [`Shoulder.${sd}`]: `sh${sd}`, [`UpperArm.${sd}`]: `arm${sd}`, [`LowerArm.${sd}`]: `elb${sd}`, [`Hand.${sd}`]: `wr${sd}` })
    for (const f of Object.keys(fing)) for (const i of [1, 2, 3]) SRC[`${f}${i}.${sd}`] = `${f}${i}.${sd}`
  }
  const deltaB = (f) => {
    const G = {}
    G.center = Q('センター', f)
    const waist = qmul(G.center, Q('腰', f))
    G.lower = qmul(waist, Q('下半身', f))
    G.upper = qmul(waist, Q('上半身', f))
    G.upper2 = qmul(G.upper, Q('上半身2', f))
    G.neck = qmul(G.upper2, Q('首', f))
    G.head = qmul(G.neck, Q('頭', f))
    for (const [sd, jp] of [['L', '左'], ['R', '右']]) {
      G[`sh${sd}`] = qmul(qmul(G.upper2, Q(`${jp}肩P`, f)), Q(`${jp}肩`, f))
      G[`arm${sd}`] = qmul(qmul(G[`sh${sd}`], Q(`${jp}肩C`, f)), Q(`${jp}腕`, f))
      G[`elb${sd}`] = qmul(qmul(qmul(G[`arm${sd}`], Q(`${jp}腕捩`, f)), Q(`${jp}ひじ`, f)), Q(`${jp}ひじ+`, f))
      G[`wr${sd}`] = qmul(qmul(G[`elb${sd}`], Q(`${jp}手捩`, f)), Q(`${jp}手首`, f))
      for (const [fn, js] of Object.entries(fing)) {
        let q = G[`wr${sd}`]
        js.forEach((j, i) => {
          q = qmul(q, Q(jp + j, f))
          G[`${fn}${i + 1}.${sd}`] = q
        })
      }
    }
    const D = new Map()
    for (const [b, s] of Object.entries(SRC)) if (R(b) && G[s]) D.set(b, qmul(G[s], C[b] || new THREE.Quaternion()))
    // 足ＩＫ：两段解析 IK（膝盖朝向 = 足ＩＫ前方 + 腰前方）
    const dh = D.get('Hips')
    for (const [sd, jp] of [['L', '左'], ['R', '右']]) {
      const L = legs[sd]
      const hip = hipsHead.clone().add(hipsT[f]).add(L.hip0.clone().sub(hipsHead).applyQuaternion(dh))
      const tgt = L.ank0.clone().add(g(`${jp}足ＩＫ`).P[f].clone().multiplyScalar(MMD_SCALE))
      const dv = tgt.clone().sub(hip)
      const dist = dv.length(), Lt = L.L1 + L.L2, soft = 0.06, da = Lt * (1 - soft)
      let dc = dist > da ? da + soft * Lt * (1 - Math.exp(-(dist - da) / (soft * Lt))) : dist
      dc = Math.min(dc, Lt * 0.9995)
      const u = dv.clone().divideScalar(dist || 1)
      const ikq = Q(`${jp}足ＩＫ`, f)
      const fwd = new THREE.Vector3(0, -1, 0).applyQuaternion(ikq).add(new THREE.Vector3(0, -1, 0).applyQuaternion(dh))
      const pole = fwd.addScaledVector(u, -fwd.dot(u)).normalize()
      const cosA = THREE.MathUtils.clamp((L.L1 ** 2 + dc ** 2 - L.L2 ** 2) / (2 * L.L1 * dc), -1, 1)
      const A = Math.acos(cosA)
      const knee = hip.clone().addScaledVector(u, L.L1 * cosA).addScaledVector(pole, L.L1 * Math.sin(A))
      const tgtc = hip.clone().addScaledVector(u, dc)
      D.set(`UpperLeg.${sd}`, qmul(frameQ(knee.clone().sub(hip), pole), qinv(L.thRest)))
      D.set(`LowerLeg.${sd}`, qmul(frameQ(tgtc.clone().sub(knee), pole), qinv(L.shRest)))
      D.set(`Foot.${sd}`, ikq.clone())
      D.set(`Toes.${sd}`, ikq.clone())
    }
    return D
  }
  const clip = bakeClip(
    name, rig, NF,
    (f) => {
      const out = new Map()
      for (const [b, q] of deltaB(f)) out.set(sanitize(b), b2tQ(q))
      return out
    },
    (f) => b2tV(hipsT[f]),
  )
  return { clip, speed: speedFwd }
}

// ---------------- 通用骨架（VRMA / BVH / FBX / GLB）----------------
const VRM_MAP = { hips: 'Hips', spine: 'Spine', chest: 'Chest', upperChest: 'UpperChest', neck: 'Neck', head: 'Head' }
for (const [s, t] of [['left', 'L'], ['right', 'R']]) {
  Object.assign(VRM_MAP, { [`${s}Shoulder`]: `Shoulder.${t}`, [`${s}UpperArm`]: `UpperArm.${t}`, [`${s}LowerArm`]: `LowerArm.${t}`, [`${s}Hand`]: `Hand.${t}`,
    [`${s}UpperLeg`]: `UpperLeg.${t}`, [`${s}LowerLeg`]: `LowerLeg.${t}`, [`${s}Foot`]: `Foot.${t}`, [`${s}Toes`]: `Toes.${t}`,
    [`${s}ThumbMetacarpal`]: `Thumb1.${t}`, [`${s}ThumbProximal`]: `Thumb2.${t}`, [`${s}ThumbDistal`]: `Thumb3.${t}` })
  for (const [f, g] of [['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Little', 'Little']])
    Object.assign(VRM_MAP, { [`${s}${f}Proximal`]: `${g}1.${t}`, [`${s}${f}Intermediate`]: `${g}2.${t}`, [`${s}${f}Distal`]: `${g}3.${t}` })
}
const side = (n) => (/left|(^|[_.\s:])l([_.\s]|$)|_l_|bip_l|\.l$/i.test(n) ? 'L' : /right|(^|[_.\s:])r([_.\s]|$)|_r_|bip_r|\.r$/i.test(n) ? 'R' : null)
// 按层级认骨骼：髋 → 头（脊柱链），手 → 前臂 → 上臂 → 肩，脚 → 小腿 → 大腿，手指按名字
function guessHumanoid(root) {
  const all = []
  root.traverse((o) => {
    if (o.isBone || o.type === 'Object3D' || o.isGroup) all.push(o)
  })
  const nm = (o) => o.name.replace(/^.*:/, '')
  const find = (re, sd) => all.find((o) => re.test(nm(o)) && (!sd || side(nm(o)) === sd))
  const map = new Map()
  const hips = find(/^(hips?|pelvis)$/i) || find(/hips?$|pelvis/i)
  const head = find(/^head$/i) || find(/(^|_)head$/i)
  if (!hips || !head) return null
  map.set(hips, 'Hips')
  const chain = []
  for (let o = head.parent; o && o !== hips; o = o.parent) chain.unshift(o)
  map.set(head, 'Head')
  const neck = chain.length && /neck/i.test(nm(chain[chain.length - 1])) ? chain.pop() : null
  if (neck) map.set(neck, 'Neck')
  ;['Spine', 'Chest', 'UpperChest'].forEach((t, i) => chain[i] && map.set(chain[i], t))
  for (const sd of ['L', 'R']) {
    const hand = find(/hand$|wrist$|^hand/i, sd)
    if (hand) {
      map.set(hand, `Hand.${sd}`)
      const fore = hand.parent, upper = fore?.parent, sh = upper?.parent
      if (fore) map.set(fore, `LowerArm.${sd}`)
      if (upper) map.set(upper, `UpperArm.${sd}`)
      if (sh && !chain.includes(sh) && sh !== neck && /shoulder|clavicle|collar/i.test(nm(sh))) map.set(sh, `Shoulder.${sd}`)
      for (const [re, g] of [[/thumb/i, 'Thumb'], [/index/i, 'Index'], [/middle/i, 'Middle'], [/ring/i, 'Ring'], [/pinky|little/i, 'Little']]) {
        const roots = hand.children.filter((c) => re.test(nm(c)))
        let o = roots[0], i = 1
        while (o && i <= 3) {
          map.set(o, `${g}${i}.${sd}`)
          o = o.children.find((c) => re.test(nm(c)))
          i++
        }
      }
    }
    const foot = find(/foot$|ankle$|^foot/i, sd)
    if (foot) {
      map.set(foot, `Foot.${sd}`)
      if (foot.parent) map.set(foot.parent, `LowerLeg.${sd}`)
      if (foot.parent?.parent) map.set(foot.parent.parent, `UpperLeg.${sd}`)
      const toe = foot.children.find((c) => /toe|ball/i.test(nm(c)))
      if (toe) map.set(toe, `Toes.${sd}`)
    }
  }
  return map
}
function retargetSkeleton(root, clip, humanMap, rig, name) {
  // humanMap: Map(源 Object3D → 我们的骨骼名（Blender 名）)
  const mixer = new THREE.AnimationMixer(root)
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const wq = (o) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))
  const wp = (o) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))
  const entries = [...humanMap.entries()].filter(([, t]) => rig.bones[sanitize(t)])
  const byT = Object.fromEntries(entries.map(([o, t]) => [t, o]))
  // 静止（动画开始前的节点姿势）
  const restQ = new Map(entries.map(([o]) => [o, wq(o)]))
  const restP = new Map(entries.map(([o]) => [o, wp(o)]))
  // 朝向：源的脚尖方向对齐到我们的 +Z（glTF 里她面向 +Z）
  let fwd = new THREE.Vector3(0, 0, 1)
  if (byT['Toes.L'] && byT['Foot.L']) fwd = restP.get(byT['Toes.L']).clone().sub(restP.get(byT['Foot.L'])).setY(0).normalize()
  const turn = new THREE.Quaternion().setFromUnitVectors(fwd.lengthSq() > 0.5 ? fwd : new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1))
  // 方向修正（手臂/手/手指/脚）：我们的静止方向 → 源的静止方向
  const corr = new Map()
  const tdir = (t) => {
    const b = rig.bones[sanitize(t)]
    const child = Object.values(rig.bones).find((r) => r.parent === sanitize(t))
    return child ? child.pos.clone().sub(b.pos).normalize() : null
  }
  for (const [o, t] of entries) {
    if (!/Shoulder|Arm|Hand|Thumb|Index|Middle|Ring|Little|Foot|Toes/.test(t)) continue
    const child = o.children.find((c) => humanMap.has(c)) || o.children[0]
    const d = tdir(t)
    if (!child || !d) continue
    const s = wp(child).sub(restP.get(o)).applyQuaternion(turn).normalize()
    corr.set(o, new THREE.Quaternion().setFromUnitVectors(d, s))
  }
  const hipsO = byT.Hips
  const ankle = (P) => Math.min(...['Foot.L', 'Foot.R'].filter((t) => byT[t]).map((t) => P(byT[t]).y))
  const srcLeg = restP.get(hipsO).y - ankle((o) => restP.get(o))
  const tgtLeg = rig.bones.Hips.pos.y - Math.min(rig.bones.FootL.pos.y, rig.bones.FootR.pos.y)
  const k = srcLeg > 1e-6 ? tgtLeg / srcLeg : 1
  const action = mixer.clipAction(clip).play()
  const NF = Math.max(2, Math.round(clip.duration * FPS) + 1)
  const S = [], hips = [], ank = []
  for (let f = 0; f < NF; f++) {
    mixer.setTime(Math.min(clip.duration, f / FPS))
    root.updateMatrixWorld(true)
    const m = new Map()
    for (const [o] of entries) m.set(o, wq(o))
    S.push(m)
    hips.push(wp(hipsO).applyQuaternion(turn))
    ank.push(ankle((o) => wp(o)))
  }
  action.stop()
  const minAnk = Math.min(...ank)
  const hipsOff = hips.map((h) => new THREE.Vector3(h.x * k, (h.y - minAnk) * k - (rig.bones.Hips.pos.y - Math.min(rig.bones.FootL.pos.y, rig.bones.FootR.pos.y)), h.z * k))
  const speed = inPlace(hipsOff)
  const tInv = turn.clone().invert()
  const clipOut = bakeClip(
    name, rig, NF,
    (f) => {
      const out = new Map()
      for (const [o, t] of entries) {
        const d = turn.clone().multiply(S[f].get(o)).multiply(restQ.get(o).clone().invert()).multiply(tInv)
        if (corr.has(o)) d.multiply(corr.get(o))
        out.set(sanitize(t), d)
      }
      return out
    },
    (f) => hipsOff[f],
  )
  return { clip: clipOut, speed }
}

async function retargetFile(file, buf, rig, rest) {
  const ext = file.name.split('.').pop().toLowerCase()
  const base = file.name.replace(/\.[^.]+$/, '')
  if (ext === 'vmd') return [{ ...solveVMD(buf, rest, rig, base), label: base }]
  if (ext === 'bvh') {
    const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js')
    const r = new BVHLoader().parse(new TextDecoder().decode(buf))
    const root = new THREE.Group()
    root.add(r.skeleton.bones[0])
    const map = guessHumanoid(root)
    if (!map) throw new Error('认不出人形骨骼')
    return [{ ...retargetSkeleton(root, r.clip, map, rig, base), label: base }]
  }
  let root, clips, vrmHuman = null
  if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
    root = new FBXLoader().parse(buf, '')
    clips = root.animations
  } else {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const g = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))
    root = g.scene
    clips = g.animations
    const ext = g.parser.json.extensions?.VRMC_vrm_animation
    if (ext?.humanoid?.humanBones) {
      vrmHuman = new Map()
      for (const [hb, { node }] of Object.entries(ext.humanoid.humanBones)) {
        const o = await g.parser.getDependency('node', node)
        if (o && VRM_MAP[hb]) vrmHuman.set(o, VRM_MAP[hb])
      }
    }
  }
  const map = vrmHuman || guessHumanoid(root)
  if (!map) throw new Error('认不出人形骨骼')
  return clips.map((c, i) => ({ ...retargetSkeleton(root, c, map, rig, clips.length > 1 ? c.name || `${base}_${i}` : base), label: clips.length > 1 ? c.name || `${base} ${i + 1}` : base }))
}

// ---------------- 存储（IndexedDB，只在本机）----------------
const DB = 'ds-motion-import'
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function store(op, val) {
  const d = await db()
  return new Promise((res, rej) => {
    const tx = d.transaction('files', op === 'all' ? 'readonly' : 'readwrite')
    const s = tx.objectStore('files')
    const r = op === 'all' ? s.getAll() : op === 'put' ? s.put(val) : s.delete(val)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
function guessSlot(name) {
  const n = name.toLowerCase()
  if (/vrma_\d+/.test(n)) return 'emote'
  if (/idle|待機|stand|breath|ゆらぎ|wait/.test(n)) return 'idle'
  if (/walk|歩/.test(n)) return /back/.test(n) ? 'walk_back' : 'walk'
  if (/run|走|jog|sprint/.test(n)) return 'run'
  if (/jump/.test(n)) return 'jump_air'
  if (/crouch|squat|しゃが/.test(n)) return 'crouch'
  return 'emote'
}

// ---------------- 面板 ----------------
export function createMotionImport({ player, character, button, panel }) {
  let rig = null, rest = null
  const items = [] // { id, name, slot, clips: [{clip, speed, label}] }
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.vmd,.vrma,.bvh,.fbx,.glb,.gltf' })
  input.hidden = true
  document.body.appendChild(input)
  async function prep() {
    if (!rig) rig = rigInfo(character.model)
    if (!rest) rest = await (await fetch('./data/rig-rest.json')).json()
    await player.ensureLoaded()
  }
  function apply(it) {
    it.clips.forEach((c, i) => {
      if (it.slot === 'none') return
      const slot = it.slot === 'emote' ? `emote_${it.id}_${i}` : it.slot
      const label = it.slot === 'emote' ? (VROID_LABELS[(/vrma_(\d+)/i.exec(it.name) || [])[1]] || c.label).slice(0, 12) : c.label
      player.addImported(slot, c.clip.clone(), { speed: Math.abs(c.speed) > 0.05 ? c.speed : DEFAULT_SPEED[it.slot] || 0, label })
    })
  }
  async function add(file, buf, slot, id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`) {
    await prep()
    const clips = await retargetFile(file, buf, rig, rest)
    const it = { id, name: file.name, slot: slot || guessSlot(file.name), clips }
    items.push(it)
    apply(it)
    return it
  }
  async function restore() {
    const saved = await store('all').catch(() => [])
    for (const s of saved) {
      try {
        await add({ name: s.name }, s.data, s.slot, s.id)
      } catch (err) {
        console.warn('[import] 恢复失败', s.name, err)
      }
    }
    render()
  }
  function render() {
    panel.hidden = !items.length && panel.dataset.open !== '1'
    panel.innerHTML = ''
    const head = document.createElement('div')
    head.className = 'imp-head'
    head.textContent = items.length ? '导入的动作（只存在本机浏览器）' : '还没有导入动作：支持 .vmd .vrma .bvh .fbx .glb'
    const close = Object.assign(document.createElement('button'), { textContent: '×', title: '收起' })
    close.onclick = () => {
      panel.dataset.open = '0'
      panel.hidden = true
    }
    head.append(close)
    panel.append(head)
    for (const it of items) {
      const row = document.createElement('div')
      row.className = 'imp-row'
      const name = Object.assign(document.createElement('span'), { textContent: it.name, title: it.name })
      const sel = document.createElement('select')
      for (const [v, l] of IMPORT_SLOTS) sel.append(Object.assign(document.createElement('option'), { value: v, textContent: l }))
      sel.value = it.slot
      sel.onchange = async () => {
        it.slot = sel.value
        const all = await store('all')
        const s = all.find((x) => x.id === it.id)
        if (s) await store('put', { ...s, slot: it.slot })
        apply(it)
        sel.blur()
      }
      const del = Object.assign(document.createElement('button'), { textContent: '删除' })
      del.onclick = async () => {
        await store('del', it.id)
        items.splice(items.indexOf(it), 1)
        render()
      }
      row.append(name, sel, del)
      panel.append(row)
    }
    const more = Object.assign(document.createElement('button'), { textContent: '＋ 选择文件…', className: 'imp-more' })
    more.onclick = () => input.click()
    panel.append(more)
  }
  input.onchange = async () => {
    for (const file of input.files) {
      const buf = await file.arrayBuffer()
      try {
        const it = await add(file, buf)
        await store('put', { id: it.id, name: file.name, slot: it.slot, data: buf })
      } catch (err) {
        console.warn('[import]', file.name, err)
        alert(`导入失败：${file.name}\n${err.message || err}`)
      }
    }
    input.value = ''
    render()
  }
  button.onclick = () => {
    panel.dataset.open = '1'
    render()
    if (!items.length) input.click()
  }
  return { restore, add, items, render }
}
