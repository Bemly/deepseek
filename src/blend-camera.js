// blend 运镜：`pipeline/camera120_v3.json`（LetMeGo-dschan_v2c.blend 的 DS_Cam / DS_CamOrtho）在 web 里的复刻。
// 只读歌曲时间，不碰场景：纯函数 update(t) → 把 persp / ortho 相机摆到对应位置。默认启用。
//
// 坐标换算（见 blender 侧 r_keys.py 的 T3）：web(x,y,z) → blend(x*0.08, -z*0.08, y*0.08)，
// 所以 blend(bx,by,bz) → web(bx/0.08, bz/0.08, -by/0.08)，即米 → MMD 单位 ×12.5 并交换 Y/Z。
// 正交段（77.2–80.2s 系统崩溃 / 101.7–103.1s 屏息）用真正的 OrthographicCamera，
// oscale 按"可见宽度（blend 米）"理解：halfW = oscale*12.5/2（若实测 framing 不对，把 ORTHO_IS_WIDTH 置 false 即为高度）。
// clip（blend 的 clip_start，米）同样 ×12.5 作为 near——正交大 clip 会切掉前景是 blend 原意。

export const BLEND_FPS = 120
const S = 1 / 0.08 // 12.5
const ORTHO_IS_WIDTH = true

export function blendToWeb([bx, by, bz]) {
  return [bx * S, bz * S, -by * S]
}

let cache = null

export async function loadBlendCamera(url = './data/camera-blend-v3.json') {
  if (cache) return cache
  const res = await fetch(url)
  if (!res.ok) throw new Error(`blend camera not found: ${url} (${res.status})`)
  const json = await res.json()
  const frames = json.frames
  const n = frames.length
  const pos = new Float32Array(n * 3)
  const tgt = new Float32Array(n * 3)
  const fov = new Float32Array(n)
  const oscale = new Float32Array(n)
  const clip = new Float32Array(n)
  const ortho = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    const p = blendToWeb(f.pos)
    const g = blendToWeb(f.tgt)
    pos.set(p, i * 3)
    tgt.set(g, i * 3)
    fov[i] = f.fov
    oscale[i] = f.oscale
    clip[i] = f.clip ?? 0.1
    ortho[i] = f.ortho ? 1 : 0
  }
  cache = { fps: json.fps || BLEND_FPS, n, pos, tgt, fov, oscale, clip, ortho }
  return cache
}

const _p = [0, 0, 0]
const _g = [0, 0, 0]

function sample(data, t) {
  const { fps, n, pos, tgt, fov, oscale, clip, ortho } = data
  const x = Math.max(0, Math.min(n - 1, t * fps))
  const i0 = Math.floor(x)
  const i1 = Math.min(n - 1, i0 + 1)
  const w = x - i0
  for (let k = 0; k < 3; k++) {
    _p[k] = pos[i0 * 3 + k] + (pos[i1 * 3 + k] - pos[i0 * 3 + k]) * w
    _g[k] = tgt[i0 * 3 + k] + (tgt[i1 * 3 + k] - tgt[i0 * 3 + k]) * w
  }
  return {
    fov: fov[i0] + (fov[i1] - fov[i0]) * w,
    oscale: oscale[i0] + (oscale[i1] - oscale[i0]) * w,
    clip: clip[i0] + (clip[i1] - clip[i0]) * w,
    ortho: w < 0.5 ? !!ortho[i0] : !!ortho[i1],
  }
}

// 把 t 秒处的 blend 运镜应用到 persp / ortho 相机，返回当前该用的那台。纯函数，不碰场景。
export function updateBlendCamera(data, t, persp, orthoCam, aspect) {
  const s = sample(data, t)
  if (!s.ortho) {
    persp.position.set(_p[0], _p[1], _p[2])
    persp.up.set(0, 1, 0)
    persp.lookAt(_g[0], _g[1], _g[2])
    persp.fov = s.fov
    persp.aspect = aspect
    persp.near = Math.max(0.5, s.clip * S)
    persp.far = 80000
    persp.updateProjectionMatrix()
    persp.updateMatrixWorld()
    return persp
  }
  const halfW = (s.oscale * S) / 2
  const halfH = ORTHO_IS_WIDTH ? halfW / aspect : (s.oscale * S) / 2
  const hw = ORTHO_IS_WIDTH ? halfW : halfH * aspect
  orthoCam.left = -hw
  orthoCam.right = hw
  orthoCam.top = halfH
  orthoCam.bottom = -halfH
  orthoCam.near = Math.max(0.5, s.clip * S)
  orthoCam.far = 90000
  orthoCam.position.set(_p[0], _p[1], _p[2])
  orthoCam.up.set(0, 1, 0)
  orthoCam.lookAt(_g[0], _g[1], _g[2])
  orthoCam.updateProjectionMatrix()
  orthoCam.updateMatrixWorld()
  return orthoCam
}
