// 场景状态 = 歌曲时间的纯函数。
// 任意时刻 computeState(t) 得到同一组数值，所以拖进度条、倒放、逐帧渲染都能对上。
import { SONG, TOOL_CALLS, EVENTS, sectionAt, lyricAt } from './lyrics.js'
import { hash1, smooth, clamp01 } from './world/util.js'

// 关键帧轨道：[[时间, 值], ...]，相邻关键帧之间 smoothstep 过渡
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i][0]) {
      const [t0, v0] = keys[i - 1]
      const [t1, v1] = keys[i]
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0))
    }
  }
  return keys[keys.length - 1][1]
}

const E = EVENTS
const FALL_END = E.systemFall + 0.75

const TRACKS = {
  // 城市窗户亮灯比例
  city: [[0, 0.03], [12, 0.05], [21.5, 0.12], [22.16, 0.14], [26, 0.8], [51.2, 0.85], [52, 1], [E.systemFall, 1], [FALL_END, 1], [E.systemBack, 1], [100.9, 1], [102.4, 0.4], [103.14, 1], [122, 1], [127.2, 0.35]],
  // 城市亮灯的扫描波前（0 → 1 从左到右）
  cityWave: [[E.cityWake, 0], [E.cityWake + 3.4, 1]],
  // 楼顶霓虹、招牌
  neon: [[0, 0.0], [21.9, 0.05], [22.16, 0.15], [40.3, 0.3], [43.6, 0.9], [51.44, 1], [100.9, 1], [102.4, 0.25], [103.14, 1.25], [121.8, 1.25], [127.2, 0.45]],
  // 海面荧光（"My screen is glowing like a midnight sea"）
  sea: [[0, 0.08], [E.seaGlow - 0.6, 0.08], [E.seaGlow + 1.8, 0.85], [51.2, 0.85], [52, 1], [93.9, 1], [95, 1.25], [100.9, 0.6], [103.14, 1.35], [127.2, 0.7]],
  // 舞台后方 JSON 全息环
  holo: [[0, 0], [25.34, 0], [27.2, 1], [121.8, 1], [126, 0.2]],
  // 天空鲸
  whales: [[0, 0], [49.5, 0], [53.5, 1], [E.systemFall, 1], [FALL_END, 0.35], [E.systemBack, 0.35], [81.2, 1], [127.2, 1]],
  // 舞台主光
  stage: [[0, 0.55], [21.9, 0.7], [51.2, 0.8], [52, 1], [100.9, 1], [101.6, 0.55], [103.14, 1.1], [122, 1.1], [127.2, 0.7]],
  // 摇头灯摆幅（"let the air swing in four-four time"）
  swing: [[0, 0], [E.swing, 0], [E.swing + 1.2, 1], [E.systemFall, 1], [FALL_END, 0.15], [E.systemBack, 1], [100.9, 0.3], [103.14, 1.25], [122, 1.25], [127.2, 0.4]],
  // 光束可见度
  beams: [[0, 0.25], [21.9, 0.35], [47.8, 0.45], [51.44, 1], [100.9, 1], [101.6, 0.2], [103.14, 1.2], [127.2, 0.5]],
  // 低音提琴发光（"The bass goes walking"）
  bass: [[0, 0], [E.bassWalk - 0.2, 0], [E.bassWalk + 0.2, 1], [40.3, 1], [41.2, 0.15], [127, 0.15]],
  // 酒杯液面（"I'll pour some wine"）
  wine: [[0, 0.08], [E.pourWine - 0.2, 0.08], [E.pourWine + 1.4, 0.62], [127, 0.62]],
  // 小桌台灯
  table: [[0, 0.35], [44.1, 0.35], [44.8, 1], [51.4, 0.55], [127, 0.55]],
  // "So let me go" 屏息
  hush: [[0, 0], [100.7, 0], [101.4, 1], [102.9, 1], [103.14, 0]],
  // 整体曝光
  exposure: [[0, 0.9], [22, 0.97], [51.44, 1.0], [100.9, 1.0], [101.6, 0.82], [103.14, 1.08], [123.5, 1.05], [127.2, 0.7]],
  // 放飞的 JSON 符号（"The JSON's free"）
  glyphs: [[0, 0], [93.6, 0], [95, 0.5], [E.jsonFree, 0.5], [E.jsonFree + 0.8, 1], [121.8, 1], [126, 0]],
  // 桥上车流
  traffic: [[0, 0.15], [22.16, 0.15], [25, 1], [127, 1]],
}

const SCHEDULE = buildPacketSchedule()

// 副歌/终段每两小节额外补一发，保证画面持续有"调用"在飞
function buildPacketSchedule() {
  const beat = 60 / SONG.bpm
  const calls = TOOL_CALLS.map((t) => ({ t }))
  const ranges = [[52, 76], [81.2, 86], [104, 121.4]]
  for (const [a, b] of ranges) {
    const first = Math.ceil((a - SONG.beatOffset) / (beat * 8))
    for (let k = first; ; k++) {
      const t = SONG.beatOffset + k * beat * 8
      if (t > b) break
      if (!calls.some((c) => Math.abs(c.t - t) < 0.3)) calls.push({ t })
    }
  }
  calls.sort((x, y) => x.t - y.t)
  return calls.map((c, i) => ({ t: c.t, target: Math.floor(hash1(i * 3.7 + 1) * 1e6) }))
}
export const PACKET_FLIGHT = 1.35
export const PACKET_HIT = 1.6

// 终段烟花：每两拍一发，交替左右
const FIREWORKS = (() => {
  const beat = 60 / SONG.bpm
  const list = []
  for (let t = E.breach + 1.2; t < 121.2; t += beat * 2) list.push(t)
  list.push(E.swingOn, E.swingOn + beat, E.swingOn + beat * 1.5)
  return list.map((t, i) => ({ t, seed: i }))
})()
export const FIREWORK_LIFE = 3.2

export function computeState(t) {
  const s = {}
  s.t = t
  s.section = sectionAt(t)
  s.lyric = lyricAt(t)
  for (const k in TRACKS) s[k] = track(TRACKS[k], t)

  // 节拍（128 BPM 摇摆）
  const b = ((t - SONG.beatOffset) * SONG.bpm) / 60
  s.beat = b
  s.beatFrac = b - Math.floor(b)
  s.beatPulse = Math.exp(-s.beatFrac * 5)
  s.bar = b / 4
  s.barPulse = Math.exp(-((b / 4) - Math.floor(b / 4)) * 4 * 1.2)
  const energetic = s.section === 'chorus' || s.section === 'finale' || s.section === 'recover' || s.section === 'solo'
  s.pulse = s.beatPulse * (energetic ? 1 : s.section === 'intro' || s.section === 'hush' ? 0.25 : 0.55)

  // 系统崩溃（"when the system falls"）：从右往左一路灭掉，然后在 "I'll call the tool" 瞬间恢复
  s.fall = t >= E.systemFall && t < E.systemBack ? clamp01((t - E.systemFall) / 0.75) : 0
  s.recoverFlash = t >= E.systemBack ? Math.exp(-(t - E.systemBack) * 3) : 0
  let glitch = 0
  if (t >= 76.54 && t < 77.1) glitch = 0.35
  if (t >= E.systemFall - 0.2 && t < E.systemBack) glitch = 0.55 + 0.45 * Math.max(0, Math.sin(t * 37.0) * Math.sin(t * 13.3))
  if (t >= E.systemBack && t < E.systemBack + 0.35) glitch = 0.6 * (1 - (t - E.systemBack) / 0.35)
  s.glitch = glitch

  // 拱门灯泡模式
  if (t < E.cityWake) s.bulbMode = 'fill'
  else if (t >= E.bassWalk && t < 40.34) s.bulbMode = 'walk'
  else if (t >= 76.54 && t < E.systemBack) s.bulbMode = 'blink'
  else if (energetic) s.bulbMode = 'chase'
  else s.bulbMode = 'breathe'
  s.bulbFill = clamp01(t / 21.6)

  // 终端 / 广告牌上显示什么
  if (t >= 76.54 && t < E.systemBack) s.screen = 'busy'
  else if (t >= 32.86 && t < 36.58) s.screen = 'api'
  else if (t >= 93.88 && t < 100.9) s.screen = 'free'
  else if (t < 22.16) s.screen = 'type'
  else s.screen = 'json'
  s.cursor = clamp01((t - E.cursorSlide) / 1.1) * (t < 40.6 ? 1 : 0)
  s.apiWait = t >= E.apiWaiting && t < 36.8 ? 1 : 0

  // 工具调用光束
  s.packets = []
  for (let i = 0; i < SCHEDULE.length; i++) {
    const c = SCHEDULE[i]
    const age = t - c.t
    if (age < 0 || age > PACKET_FLIGHT + PACKET_HIT) continue
    s.packets.push({ id: i, target: c.target, p: Math.min(1, age / PACKET_FLIGHT), hit: age > PACKET_FLIGHT ? age - PACKET_FLIGHT : -1 })
  }

  // 巨鲸跃海
  s.breach = t >= E.breach - 0.4 && t < E.breach + 9 ? t - (E.breach - 0.4) : -1

  // 烟花
  s.fireworks = []
  for (const f of FIREWORKS) {
    const age = t - f.t
    if (age >= 0 && age < FIREWORK_LIFE) s.fireworks.push({ seed: f.seed, age })
  }

  // 结尾 "and swing it on" 全场一闪
  s.finaleFlash = t >= E.swingOn ? Math.exp(-(t - E.swingOn) * 1.8) : 0
  return s
}
