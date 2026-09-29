// 《Let Me Go》歌词时间轴（秒）。
// 由 faster-whisper large-v3 对 mp3 转写得到，再人工修正明显误听
// （"call the two" → "call the tool"、"A.B.I." → "API"、"Jason" → "JSON"）。
// 时间点精度约 ±0.2s，歌词本身也可能有听错的地方，以原曲为准。

export const SONG = {
  duration: 127.15,
  bpm: 128.22,
  // 第一拍在音频中的位置（秒），由频谱通量自相关估出
  beatOffset: 0.212,
}

export const LYRICS = [
  { t: 0.0, e: 1.18, text: 'Let me go' },
  { t: 1.56, e: 5.12, text: "I'm making the calls" },
  { t: 5.18, e: 8.36, text: 'Let me write the JSON' },
  { t: 8.86, e: 10.4, text: "I'll call the tool" },
  { t: 10.68, e: 12.22, text: 'Let me go' },
  { t: 13.2, e: 16.5, text: "I'm making the calls" },
  { t: 16.6, e: 19.66, text: 'Let me write the JSON' },
  { t: 20.12, e: 21.88, text: "I'll call the tool" },
  { t: 22.16, e: 25.34, text: 'The city hums in a minor key' },
  { t: 25.34, e: 29.08, text: 'My screen is glowing like a midnight sea' },
  { t: 29.74, e: 32.86, text: 'I check the payload, one, two, three' },
  { t: 32.86, e: 36.58, text: 'Got a little API waiting on me' },
  { t: 36.58, e: 40.34, text: 'The bass goes walking, the cursor slides' },
  { t: 40.34, e: 44.12, text: "I'm chasing endpoints through neon lights" },
  { t: 44.12, e: 47.82, text: "If the answer's late, I'll pour some wine" },
  { t: 47.82, e: 51.44, text: 'And let the air swing in four-four time' },
  { t: 51.44, e: 53.38, text: 'Oh, let me go' },
  { t: 53.38, e: 57.22, text: "I'm making the calls" },
  { t: 57.84, e: 60.64, text: 'Let me write the JSON' },
  { t: 60.64, e: 62.68, text: "I'll give it my all" },
  { t: 62.68, e: 64.7, text: "I'll call the tool" },
  { t: 64.7, e: 66.32, text: 'Let me do it, honey' },
  { t: 66.32, e: 70.16, text: 'Code and rhythm never cost no money' },
  { t: 70.16, e: 71.96, text: 'Let me go' },
  { t: 71.96, e: 75.76, text: "I'm making the calls" },
  { t: 76.54, e: 80.18, text: 'A little bit of swing when the system falls' },
  { t: 80.18, e: 81.32, text: "I'll call the tool" },
  { t: 81.32, e: 82.86, text: 'Let me do it now' },
  { t: 84.02, e: 86.5, text: 'The groove will show me how' },
  { t: 93.88, e: 95.5, text: 'The request is due' },
  { t: 95.5, e: 96.26, text: 'Scooby-doo' },
  { t: 96.26, e: 97.28, text: "I'm calling you" },
  { t: 97.28, e: 98.22, text: 'Doo-ba-dee' },
  { t: 98.22, e: 99.1, text: "The JSON's free" },
  { t: 99.1, e: 99.82, text: 'Scooby-doo' },
  { t: 99.82, e: 100.9, text: 'Let me do it…' },
  { t: 100.9, e: 103.14, text: 'So let me go' },
  { t: 104.2, e: 107.04, text: "I'm making the calls" },
  { t: 108.4, e: 110.3, text: 'Let me write the JSON' },
  { t: 110.3, e: 112.46, text: "I'll call the tool" },
  { t: 113.0, e: 114.72, text: 'Let me do it' },
  { t: 119.62, e: 121.78, text: 'And swing it on' },
]

// 段落：驱动灯光 / 城市 / 天空鲸 / 镜头。
export const SECTIONS = [
  { t: 0.0, name: 'intro' }, // 前奏 hook：只有舞台和月光
  { t: 22.16, name: 'verse' }, // 城市醒来
  { t: 51.44, name: 'chorus' }, // 副歌 1：霓虹全开、天空鲸出现
  { t: 76.54, name: 'fall' }, // "when the system falls"：系统崩了
  { t: 80.18, name: 'recover' }, // "I'll call the tool"：恢复
  { t: 86.5, name: 'solo' }, // 间奏：大摇臂俯瞰海湾
  { t: 93.88, name: 'scat' }, // 拟声段：JSON 被放飞
  { t: 100.9, name: 'hush' }, // "So let me go"：屏息
  { t: 103.14, name: 'finale' }, // 终副歌：巨鲸跃海 + 烟花
  { t: 121.78, name: 'outro' }, // 收尾
]

// 每个"工具调用"：从舞台发射一束数据光到城市某栋楼（endpoint）。
// 取自 calls / JSON / tool / payload 1-2-3 / endpoints 等词的时间。
export const TOOL_CALLS = [
  4.42, 7.74, 10.12,
  15.72, 19.02, 21.38,
  31.9, 32.2, 32.52, // payload 1, 2, 3
  35.26, // API waiting
  42.0, 42.44, 42.76, 43.04, 43.52, // chasing endpoints through neon lights
  56.72, 59.98, 61.62, 64.34,
  75.18, 80.62, 80.98,
  94.4, 96.62, 98.44,
  106.5, 109.78, 111.7, 112.14,
]

// 关键词触发的一次性事件
export const EVENTS = {
  cityWake: 22.16, // The city hums
  seaGlow: 26.62, // My screen is glowing like a midnight sea
  apiWaiting: 34.16,
  bassWalk: 36.58,
  cursorSlide: 39.34,
  pourWine: 46.78,
  swing: 47.82,
  systemFall: 78.84,
  systemBack: 80.18,
  jsonFree: 98.22,
  breach: 103.14,
  swingOn: 119.62,
}

export function lyricAt(t) {
  for (let i = LYRICS.length - 1; i >= 0; i--) {
    const l = LYRICS[i]
    if (t >= l.t - 0.05) return t <= l.e + 0.6 ? l : null
  }
  return null
}

export function sectionAt(t) {
  let s = SECTIONS[0]
  for (const x of SECTIONS) if (t >= x.t) s = x
  return s.name
}
