// 头发 / 裙摆 / 尾巴 / 耳朵 / 呆毛的简易弹簧骨（类似 VRM SpringBone）。「物理」模式下舞蹈和自由控制都用它
// （从静止姿势出发，按身体运动实时算），「K帧」模式下用动画里的关键帧（舞蹈里 Blender 烘焙好的）。
// 每条链从根到梢做 verlet：尾端被动画方向拉回（刚度）、带阻尼和重力，长度固定，再用几个球体推开避免穿进身体。
import * as THREE from 'three'

const M = 12.5 // 1 m = 12.5 web 单位
const PARAMS = [
  // 前缀           刚度  阻尼   重力（m/s²） 跟随（根部平移有多少直接带走，越大越不"飘"）
  [/^Hair/, 22.0, 0.5, 3.0, 0.92],
  [/^Skirt/, 26.0, 0.5, 2.0, 0.92],
  [/^Tail/, 10.0, 0.4, 1.0, 0.85],
  [/^Ear/, 30.0, 0.55, 0.5, 0.9],
  [/^Ahoge/, 24.0, 0.45, 0.3, 0.85],
]
// 碰撞球（骨骼名、半径 m、沿骨骼方向的偏移比例）
const COLLIDERS = [
  ['Head', 0.105, 0.45],
  ['UpperChest', 0.12, 0.4],
  ['Chest', 0.11, 0.3],
  ['Hips', 0.13, 0.2],
  ['UpperLegL', 0.075, 0.35],
  ['UpperLegR', 0.075, 0.35],
]

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _pq = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _s = new THREE.Vector3()

export function createSpringBones(model) {
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
      joints.push({ bone: b, tailLocal, len: 0, stiff: p[1], drag: p[2], grav: p[3], follow: p[4], restQ: b.quaternion.clone(), cur: new THREE.Vector3(), prev: new THREE.Vector3(), lastHead: new THREE.Vector3(), ready: false })
      prevLen = tailLocal.length() * (b.getWorldScale(_s).x || 1)
      b = child
    }
  })
  const colliders = COLLIDERS.map(([n, r, off]) => ({ bone: model.getObjectByName(n), r: r * M, off })).filter((c) => c.bone)

  const api = {
    weight: 1, // 0 = 关（舞蹈片段自带烘焙物理时）
    count: joints.length,
    reset() {
      for (const j of joints) j.ready = false
    },
    update(dt) {
      if (!joints.length) return
      dt = Math.min(dt, 1 / 30)
      // 碰撞球的世界位置
      for (const c of colliders) {
        c.bone.getWorldPosition(c.p || (c.p = new THREE.Vector3()))
        const child = c.bone.children.find((x) => x.isBone)
        if (child) c.p.lerp(child.getWorldPosition(_v), c.off)
      }
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
        // 根部平移的大部分直接带走（不然跑起来头发被拖成水平），剩下的才产生甩动
        const moved = _b.copy(head).sub(j.lastHead).multiplyScalar(j.follow)
        j.cur.add(moved)
        j.prev.add(moved)
        j.lastHead.copy(head)
        // verlet：惯性 + 拉回动画方向 + 重力
        const next = _b.copy(j.cur).sub(j.prev).multiplyScalar(1 - j.drag)
        next.add(j.cur)
        next.addScaledVector(_s.copy(tailAnim).sub(j.cur), Math.min(1, j.stiff * dt))
        next.y -= j.grav * M * dt * dt
        // 长度约束 + 碰撞
        next.sub(head).setLength(j.len).add(head)
        for (const c of colliders) {
          const d = next.distanceTo(c.p)
          if (d < c.r) next.sub(c.p).setLength(c.r).add(c.p).sub(head).setLength(j.len).add(head)
        }
        j.prev.copy(j.cur)
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
