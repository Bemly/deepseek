// 自由控制的场景碰撞：直接用当前主题里的实体网格（不改场景，只读它的几何和矩阵）。
//   - 哪些算实体：不透明、写深度、没有 alphaTest 的网格（树叶、花瓣、光束、云雾这类透明/镂空贴片可以穿过），
//     粒子和会游动的鲸鱼不算。
//   - 每个几何体懒建一棵 BVH（three-mesh-bvh，indirect 模式不改原几何的索引），实例化网格共用同一棵，
//     按实例矩阵把三角形变到世界空间再算。
//   - 粗筛：普通网格用世界包围盒，实例化网格用每个实例的包围盒（建表时快照一次）。
// 对外：
//   capsule(start, end, r)  胶囊体和场景的重叠 → 把胶囊推出来 + 接触法线（判断站地/撞头/撞墙）
//   raycast(origin, dir, far)  最近交点距离（防高速穿墙、第三人称相机避障、贴地）
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

const SKIP = /particles|whales/
const bvhOf = new WeakMap()
const _inv = new THREE.Matrix4()
const _full = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _box = new THREE.Box3()
const _qBox = new THREE.Box3()
const _localBox = new THREE.Box3()
const _toLocal = new THREE.Matrix4()
const _world = new THREE.Matrix4()
const _seg = new THREE.Line3()
const _pTri = new THREE.Vector3()
const _pSeg = new THREE.Vector3()
const _n = new THREE.Vector3()
const _c = new THREE.Vector3()
const _ray = new THREE.Ray()

function solidMaterial(m) {
  return !!m && m.visible !== false && !m.transparent && m.depthWrite !== false && !(m.alphaTest > 0)
}
function isSolid(o) {
  if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return false
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  if (!mats.every(solidMaterial)) return false
  for (let p = o; p; p = p.parent) if (SKIP.test(p.name)) return false
  return true
}
function bvh(geometry) {
  let b = bvhOf.get(geometry)
  if (!b) {
    b = new MeshBVH(geometry, { indirect: true, maxLeafSize: 12 })
    bvhOf.set(geometry, b)
  }
  return b
}

export function createWorldCollider(world) {
  const themes = new Map() // 主题名 → 实体列表

  function build(name) {
    const th = world.parts.themes[name]
    const list = []
    if (!th) return list
    th.root.updateMatrixWorld(true)
    th.root.traverse((o) => {
      if (!isSolid(o)) return
      const g = o.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      const e = { mesh: o, chain: [], boxes: null, ids: null, all: null }
      for (let p = o; p && p !== th.root; p = p.parent) e.chain.push(p)
      if (o.isInstancedMesh) {
        const boxes = []
        const ids = []
        const all = new THREE.Box3()
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, _m)
          _box.copy(g.boundingBox).applyMatrix4(_m)
          if (_box.isEmpty() || _box.max.distanceToSquared(_box.min) < 1e-8) continue // 缩放成 0 的隐藏实例
          boxes.push(_box.min.x, _box.min.y, _box.min.z, _box.max.x, _box.max.y, _box.max.z)
          ids.push(i)
          all.union(_box)
        }
        if (!ids.length) return
        e.boxes = new Float32Array(boxes)
        e.ids = ids
        e.all = all
      }
      list.push(e)
    })
    themes.set(name, list)
    return list
  }
  const visible = (e) => e.chain.every((p) => p.visible)
  function current() {
    const name = world.applied || world.theme
    return themes.get(name) || build(name)
  }

  // 对每个和世界包围盒 q 相交的（网格, 实例）调用 fn(entry, 世界矩阵)
  function candidates(q, fn) {
    for (const e of current()) {
      if (!visible(e)) continue
      const mesh = e.mesh
      if (!e.boxes) {
        _box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
        if (_box.intersectsBox(q)) fn(e, mesh.matrixWorld)
        continue
      }
      _inv.copy(mesh.matrixWorld).invert()
      const lb = _box.copy(q).applyMatrix4(_inv) // 查询框变到网格空间（保守）
      if (!lb.intersectsBox(e.all)) continue
      const x0 = lb.min.x, y0 = lb.min.y, z0 = lb.min.z, x1 = lb.max.x, y1 = lb.max.y, z1 = lb.max.z
      const B = e.boxes
      for (let j = 0; j < e.ids.length; j++) {
        const k = j * 6
        if (B[k] > x1 || B[k + 3] < x0 || B[k + 1] > y1 || B[k + 4] < y0 || B[k + 2] > z1 || B[k + 5] < z0) continue
        mesh.getMatrixAt(e.ids[j], _m)
        fn(e, _full.multiplyMatrices(mesh.matrixWorld, _m))
      }
    }
  }

  const api = {
    // 胶囊体（线段 start→end，半径 r，世界单位）与场景的穿透：原地修改 start/end，把胶囊推出来。
    // out.up = 接触法线 y 的最大值（> 0.55 = 踩在地上），out.down = 最小值（< -0.5 = 撞头），out.wall = 墙的平均法线
    capsule(start, end, r, out = { hit: false, up: -1, down: 1, wall: new THREE.Vector3() }) {
      out.hit = false
      out.up = -1
      out.down = 1
      out.wall.set(0, 0, 0)
      for (let iter = 0; iter < 3; iter++) {
        let moved = false
        _seg.set(start, end)
        const q = _qBox.makeEmpty().expandByPoint(start).expandByPoint(end).expandByScalar(r)
        const qCopy = q.clone()
        candidates(qCopy, (e, mw) => {
          _world.copy(mw)
          _toLocal.copy(mw).invert()
          _localBox.copy(qCopy).applyMatrix4(_toLocal)
          bvh(e.mesh.geometry).shapecast({
            intersectsBounds: (box) => box.intersectsBox(_localBox),
            intersectsTriangle: (tri) => {
              tri.a.applyMatrix4(_world)
              tri.b.applyMatrix4(_world)
              tri.c.applyMatrix4(_world)
              tri.needsUpdate = true
              const d = tri.closestPointToSegment(_seg, _pTri, _pSeg)
              if (d >= r) return false
              if (d > 1e-5) _n.subVectors(_pSeg, _pTri).divideScalar(d)
              else {
                // 线段穿过三角形：沿三角形法线往胶囊中心那一侧推
                tri.getNormal(_n)
                _c.addVectors(start, end).multiplyScalar(0.5).sub(_pTri)
                if (_n.dot(_c) < 0) _n.negate()
              }
              const push = r - d
              start.addScaledVector(_n, push)
              end.addScaledVector(_n, push)
              _seg.set(start, end)
              out.hit = moved = true
              out.debug?.add(e.mesh) // 调试：记下碰到的网格
              out.up = Math.max(out.up, _n.y)
              out.down = Math.min(out.down, _n.y)
              if (Math.abs(_n.y) < 0.55) out.wall.add(_n)
              return false
            },
          })
        })
        if (!moved) break
      }
      if (out.wall.lengthSq() > 1e-8) out.wall.normalize()
      return out
    },
    // 射线最近交点的距离（世界单位），没打到返回 Infinity
    raycast(origin, dir, far) {
      let best = far
      const end = _c.copy(origin).addScaledVector(dir, far)
      const q = new THREE.Box3().expandByPoint(origin).expandByPoint(end)
      candidates(q, (e, mw) => {
        _toLocal.copy(mw).invert()
        _ray.set(origin, dir).applyMatrix4(_toLocal)
        const h = bvh(e.mesh.geometry).raycastFirst(_ray, THREE.DoubleSide)
        if (!h) return
        const d = h.point.applyMatrix4(mw).distanceTo(origin)
        if (d < best) best = d
      })
      return best < far ? best : Infinity
    },
    // 预热：空闲时把 p 附近的几何体先建好 BVH，避免第一次碰到时卡一下
    warm(p, radius) {
      const todo = []
      const q = new THREE.Box3().setFromCenterAndSize(p, new THREE.Vector3(radius, radius, radius).multiplyScalar(2))
      candidates(q, (e) => {
        if (!bvhOf.has(e.mesh.geometry) && !todo.includes(e.mesh.geometry)) todo.push(e.mesh.geometry)
      })
      const step = () => {
        const t0 = performance.now()
        while (todo.length && performance.now() - t0 < 8) bvh(todo.shift())
        if (todo.length) (window.requestIdleCallback || setTimeout)(step)
      }
      step()
    },
    get count() {
      return current().length
    },
  }
  return api
}
