// 头发 / 裙摆 / 尾巴 / 耳朵 / 呆毛的简易弹簧骨（类似 VRM SpringBone）。「物理」模式下舞蹈和自由控制都用它
// （从静止姿势出发，按身体运动实时算），「K帧」模式下用动画里的关键帧（舞蹈里 Blender 烘焙好的）。
// 每条链从根到梢做 verlet：尾端被动画方向拉回（刚度）、带阻尼和重力，长度固定，再和身体碰撞。
// 身体碰撞体不是手填的几个球：加载时按模型网格本身拟合（fitBody）——每根身体骨骼取主要绑在它上面的顶点，
// 沿主轴切片，每片的截面用一排球填满（躯干截面扁，会放 2–3 个球），所以头发贴着后背/肩膀、裙摆被腿顶开都和真模型一致。
// 静止姿势里本来就贴着/略陷进身体的关节（发根、裙腰）记下这个余量，不会被一直往外弹。
import * as THREE from 'three'

const M = 12.5 // 1 m = 12.5 web 单位
const PARAMS = [
  // 前缀           刚度  阻尼   重力（m/s²） 跟随（身体局部晃动有多少直接带走） 粗细半径（m） 迎风（每 m/s 移动速度给多少 m/s² 的向后阻力） 旧算法
  // 头发和呆毛用旧算法（按头部总位移的比例跟随、无迎风、碰撞推开全算速度）：新算法让头发几乎不动，用户要求退回
  [/^Hair/, 22.0, 0.5, 3.0, 0.92, 0.012, 0, true],
  [/^Skirt/, 26.0, 0.5, 2.0, 0.92, 0.015, 0.2],
  // 鲸鱼尾巴：比头发软、更重，跑动时小幅摆、转身/急停会甩过去（再软就会左右乱甩）
  [/^Tail/, 12.0, 0.35, 2.0, 0.85, 0.03, 0.3],
  [/^Ear/, 30.0, 0.55, 0.5, 0.9, 0.01, 0.15],
  [/^Ahoge/, 24.0, 0.45, 0.3, 0.85, 0.005, 0, true],
]
const WIND_MAX = 15 // m/s：再快（飞行加速）阻力也不再变大，头发保持向后飘而不是被扯直抽动
// 参与碰撞的身体骨骼；手指/脚趾/眼睛的顶点并到最近的这些骨骼上
const BODY = /^(Hips|Spine|Chest|UpperChest|Neck|Head|Shoulder[LR]|UpperArm[LR]|LowerArm[LR]|Hand[LR]|UpperLeg[LR]|LowerLeg[LR]|Foot[LR])$/

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _pq = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _s = new THREE.Vector3()

const _root = new THREE.Vector3()
const _lastRoot = new THREE.Vector3()
const _move = new THREE.Vector3()
const _windDir = new THREE.Vector3()
const _pre = new THREE.Vector3()

export function createSpringBones(model) {
  let rootReady = false
  const isChain = (n) => PARAMS.some(([re]) => re.test(n))
  const joints = [] // 按链从根到梢
  model.traverse((o) => {
    if (!o.isBone || !isChain(o.name) || (o.parent && isChain(o.parent.name))) return
    const p = PARAMS.find(([re]) => re.test(o.name))
    let b = o
    let prevLen = 0.1 * M
    while (b) {
      const child = b.children.find((c) => c.isBone)
      // 尾端（本地）：有子骨用子骨位置，梢骨沿父骨长度延长
      const tailLocal = child ? child.position.clone() : new THREE.Vector3(0, prevLen / (b.getWorldScale(_s).x || 1), 0)
      joints.push({ bone: b, tailLocal, len: 0, stiff: p[1], drag: p[2], grav: p[3], follow: p[4], jr: p[5] * M, wind: p[6], legacy: !!p[7], slack: null, restQ: b.quaternion.clone(), cur: new THREE.Vector3(), prev: new THREE.Vector3(), lastHead: new THREE.Vector3(), ready: false })
      prevLen = tailLocal.length() * (b.getWorldScale(_s).x || 1)
      b = child
    }
  })
  const colliders = fitBody(model, isChain)
  // 静止姿势下每个关节已经陷进各碰撞球多少（发根、裙腰本来就贴着身体）→ 当余量，不然会被一直往外弹
  model.updateMatrixWorld(true)
  placeColliders(colliders)
  for (const j of joints) {
    const b = j.bone
    b.parent.matrixWorld.decompose(_a, _pq, _s)
    const head = b.getWorldPosition(_a)
    const tail = _v.copy(j.tailLocal).multiply(_s).applyQuaternion(_q.copy(_pq).multiply(b.quaternion)).add(head)
    j.slack = new Float32Array(colliders.length)
    colliders.forEach((c, i) => {
      // 碰撞只作用在关节尾端，余量也按尾端算
      const pen = c.rw + j.jr - tail.distanceTo(c.p)
      if (pen > 0) j.slack[i] = pen + 0.003 * M
    })
  }

  const api = {
    weight: 1, // 0 = 关（舞蹈片段自带烘焙物理时）
    count: joints.length,
    colliders, // 调试用：拟合出的身体碰撞球
    joints,
    reset() {
      for (const j of joints) j.ready = false
      rootReady = false
    },
    update(dt) {
      if (!joints.length) return
      // 角色整体平移（走/跑/飞）：所有关节原样带走，不产生甩动；只把速度换成迎风阻力。
      // 以前按 92% 跟随，飞行加速到上百 m/s 时每帧剩下的 8% 也有几十厘米，头发就会被扯得来回抽。
      model.getWorldPosition(_root)
      if (!rootReady) _lastRoot.copy(_root)
      _move.copy(_root).sub(_lastRoot)
      _lastRoot.copy(_root)
      const raw = dt
      const speed = rootReady && raw > 1e-4 ? _move.length() / raw / M : 0 // m/s
      rootReady = true
      _windDir.copy(_move).normalize().negate()
      const windA = Math.min(speed, WIND_MAX)
      dt = Math.min(dt, 1 / 30)
      placeColliders(colliders)
      for (const j of joints) {
        const b = j.bone
        // 物理从静止姿势算（不叠在关键帧的头发动作上）
        if (api.weight > 0) b.quaternion.slerp(j.restQ, api.weight)
        b.parent.updateWorldMatrix(true, false)
        // 动画给的世界朝向（父世界 × 本地动画旋转）
        b.parent.matrixWorld.decompose(_a, _pq, _s)
        _q.copy(_pq).multiply(b.quaternion)
        const head = b.getWorldPosition(_a)
        const tailAnim = _v.copy(j.tailLocal).multiply(_s).applyQuaternion(_q).add(head)
        j.len = tailAnim.distanceTo(head)
        if (!j.ready || api.weight <= 0) {
          j.cur.copy(tailAnim)
          j.prev.copy(tailAnim)
          j.lastHead.copy(head)
          j.ready = true
          continue
        }
        // 整体平移全部带走；身体自己的晃动/转身（相对整体平移的部分）按跟随比例带走，剩下的产生甩动
        const moved = j.legacy
          ? _b.copy(head).sub(j.lastHead).multiplyScalar(j.follow)
          : _b.copy(head).sub(j.lastHead).sub(_move).multiplyScalar(j.follow).add(_move)
        j.cur.add(moved)
        j.prev.add(moved)
        j.lastHead.copy(head)
        // verlet：惯性 + 拉回动画方向 + 重力
        const next = _b.copy(j.cur).sub(j.prev).multiplyScalar(1 - j.drag)
        next.add(j.cur)
        next.addScaledVector(_s.copy(tailAnim).sub(j.cur), Math.min(1, j.stiff * dt))
        next.y -= j.grav * M * dt * dt
        if (windA > 0.05 && j.wind > 0) next.addScaledVector(_windDir, j.wind * windA * M * dt * dt)
        // 长度约束 + 身体碰撞（推出去之后再拉回骨长，最多来回三遍）
        next.sub(head).setLength(j.len).add(head)
        _pre.copy(next)
        for (let it = 0; it < 3; it++) {
          let hit = false
          for (let i = 0; i < colliders.length; i++) {
            const c = colliders[i]
            const R = c.rw + j.jr - j.slack[i]
            if (R <= 0) continue
            const d2 = next.distanceToSquared(c.p)
            if (d2 >= R * R) continue
            const d = Math.sqrt(d2)
            if (d > 1e-6) next.sub(c.p).multiplyScalar(R / d).add(c.p)
            hit = true
          }
          if (!hit) break
          next.sub(head).setLength(j.len).add(head)
        }
        // 被身体推开的位移只有一半算进速度（verlet 里 cur−prev 就是速度）：全算会弹开再被拉回、来回抽；
        // 全不算头发会一直贴着身体蹭，被腿/手臂扫到时反而更跳
        if (j.legacy) j.prev.copy(j.cur)
        else j.prev.copy(j.cur).addScaledVector(_pre.sub(next).negate(), 0.5)
        j.cur.copy(next)
        // 把骨骼从动画方向转到模拟方向（按权重）
        const from = tailAnim.sub(head).normalize()
        const to = _s.copy(j.cur).sub(head).normalize()
        _q2.setFromUnitVectors(from, to)
        if (api.weight < 1) _q2.slerp(new THREE.Quaternion(), 1 - api.weight)
        const world = _q2.multiply(_q)
        b.quaternion.copy(_pq.invert().multiply(world))
        b.updateMatrixWorld(true)
      }
    },
  }
  return api
}

// 碰撞球跟着骨骼走：世界球心、世界半径
function placeColliders(colliders) {
  for (const c of colliders) {
    c.p.copy(c.c).applyMatrix4(c.bone.matrixWorld)
    c.rw = c.r * c.bone.matrixWorld.getMaxScaleOnAxis()
  }
}

// 按网格拟合身体碰撞球（骨骼本地坐标）。顶点归到权重最大的骨骼（往上找到 BODY 里的那根）；
// 带了头发/裙摆等链权重的顶点不算（它们自己就是被碰撞的那一方）。
function fitBody(model, isChain) {
  let mesh = null
  model.traverse((o) => {
    if (!mesh && o.isSkinnedMesh && !o.name.endsWith('__outline')) mesh = o
  })
  if (!mesh) return []
  const { bones, boneInverses } = mesh.skeleton
  const g = mesh.geometry
  const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight
  const owner = bones.map((b) => {
    if (isChain(b.name)) return -1
    for (let x = b; x && x.isBone; x = x.parent) if (BODY.test(x.name)) return bones.indexOf(x)
    return -1
  })
  const chain = bones.map((b) => isChain(b.name))
  const toBone = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(boneInverses[i], mesh.bindMatrix))
  const pts = bones.map(() => [])
  const stride = Math.max(1, Math.floor(pos.count / 250000))
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += stride) {
    let best = -1, bw = 0, cw = 0
    for (let k = 0; k < 4; k++) {
      const idx = si.getComponent(i, k), w = sw.getComponent(i, k)
      if (chain[idx]) cw += w
      if (w > bw) {
        bw = w
        best = idx
      }
    }
    if (cw > 0.05 || best < 0) continue
    const o = owner[best]
    if (o < 0) continue
    v.fromBufferAttribute(pos, i).applyMatrix4(toBone[o])
    pts[o].push(v.x, v.y, v.z)
  }
  const out = []
  pts.forEach((P, bi) => {
    const n = P.length / 3
    if (n < 40) return
    // 主轴（PCA）
    const mean = new THREE.Vector3()
    for (let i = 0; i < P.length; i += 3) mean.x += P[i], mean.y += P[i + 1], mean.z += P[i + 2]
    mean.divideScalar(n)
    const C = [0, 0, 0, 0, 0, 0] // xx xy xz yy yz zz
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i] - mean.x, y = P[i + 1] - mean.y, z = P[i + 2] - mean.z
      C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z
    }
    // 切片方向用骨骼本身的走向（指向主子骨），不用点云主轴：腰、肩这种又短又宽的部位主轴是横的，会切歪
    const e1 = boneAxis(bones[bi]) || eigen3(C)[0]
    // 截面里的两个方向：点云投到截面上的主方向
    const Cp = projectCov(C, e1)
    const [e2, e3] = eigen3(Cp)
    const T = new Float32Array(n), U = new Float32Array(n), W = new Float32Array(n)
    for (let i = 0, k = 0; i < P.length; i += 3, k++) {
      v.set(P[i] - mean.x, P[i + 1] - mean.y, P[i + 2] - mean.z)
      T[k] = v.dot(e1)
      U[k] = v.dot(e2)
      W[k] = v.dot(e3)
    }
    const q = (arr, f) => {
      const s = Float32Array.from(arr).sort()
      return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]
    }
    const t0 = q(T, 0.02), t1 = q(T, 0.98)
    const r0 = Math.max(1e-4, Math.min(q(U, 0.95) - q(U, 0.05), q(W, 0.95) - q(W, 0.05)) / 2)
    const K = THREE.MathUtils.clamp(Math.round((t1 - t0) / r0) + 1, 1, 10)
    for (let s = 0; s < K; s++) {
      const a = t0 + ((t1 - t0) * s) / K, b = t0 + ((t1 - t0) * (s + 1)) / K
      const us = [], ws = []
      for (let k = 0; k < n; k++) if (T[k] >= a && T[k] <= b) us.push(U[k]), ws.push(W[k])
      if (us.length < 12) continue
      // 截面范围：头（含整块的后脑头发、发饰）取得更满，身体其它部位去掉衣服褶边这类零星外凸
      const lo = bones[bi].name === 'Head' ? 0.015 : 0.04
      const u0 = q(us, lo), u1 = q(us, 1 - lo), w0 = q(ws, lo), w1 = q(ws, 1 - lo)
      const hu = (u1 - u0) / 2, hw = (w1 - w0) / 2
      const long = hu >= hw ? e2 : e3
      const ext = Math.max(hu, hw)
      // 截面接近圆：一个球取两个半轴的平均；扁的截面：沿长轴排一串短半轴大小的球
      const round = ext / Math.max(1e-4, Math.min(hu, hw)) < 1.3
      const r = Math.max(1e-4, round ? (hu + hw) / 2 : Math.min(hu, hw))
      const m = round ? 1 : Math.max(2, Math.round(ext / r))
      const base = mean.clone().addScaledVector(e1, (a + b) / 2).addScaledVector(e2, (u0 + u1) / 2).addScaledVector(e3, (w0 + w1) / 2)
      for (let j = 0; j < m; j++) {
        const off = m === 1 ? 0 : -(ext - r) + (2 * (ext - r) * j) / (m - 1)
        out.push({ bone: bones[bi], c: base.clone().addScaledVector(long, off), r, p: new THREE.Vector3(), rw: 0 })
      }
    }
  })
  return out
}
// 对称 3×3 矩阵的特征向量（Jacobi），按特征值从大到小
function eigen3([xx, xy, xz, yy, yz, zz]) {
  const a = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]]
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q]
    if (off < 1e-20) break
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
  }
  return [0, 1, 2]
    .sort((i, j) => a[j][j] - a[i][i])
    .map((i) => new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize())
}

// 骨骼走向（骨骼本地）：指向主子骨；头这种没有身体子骨的用父骨的走向
const NEXT = { Hips: 'Spine', Spine: 'Chest', Chest: 'UpperChest', UpperChest: 'Neck', Neck: 'Head', Shoulder: 'UpperArm', UpperArm: 'LowerArm', LowerArm: 'Hand', Hand: 'Middle1', UpperLeg: 'LowerLeg', LowerLeg: 'Foot', Foot: 'Toes' }
function boneAxis(bone) {
  const side = bone.name.match(/[LR]$/)?.[0] || ''
  const key = bone.name.replace(/[LR]$/, '')
  const child = NEXT[key] && bone.children.find((c) => c.isBone && c.name === NEXT[key] + side)
  if (child && child.position.lengthSq() > 1e-12) return child.position.clone().normalize()
  if (bone.parent?.isBone && bone.position.lengthSq() > 1e-12) {
    // 自己在父骨里的偏移方向，转到自己的本地坐标
    return bone.position.clone().normalize().applyQuaternion(bone.quaternion.clone().invert())
  }
  return null
}
// 协方差投到垂直于 n 的平面：(I - nnᵀ) C (I - nnᵀ)
function projectCov([xx, xy, xz, yy, yz, zz], n) {
  const C = new THREE.Matrix3().set(xx, xy, xz, xy, yy, yz, xz, yz, zz)
  const P = new THREE.Matrix3().set(1 - n.x * n.x, -n.x * n.y, -n.x * n.z, -n.x * n.y, 1 - n.y * n.y, -n.y * n.z, -n.x * n.z, -n.y * n.z, 1 - n.z * n.z)
  const R = P.clone().multiply(C).multiply(P).elements // 列主序，对称
  return [R[0], R[3], R[6], R[4], R[7], R[8]]
}
