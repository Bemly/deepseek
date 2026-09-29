import * as THREE from 'three'

// 所有"屏幕"的画布内容：舞台上的 CRT 终端、城市里的巨幅广告屏共用一张画布。
// 内容完全由歌曲时间决定：打字的 tool call、滚动 JSON、API 等待、服务器繁忙、JSON 放飞。

const JSON_LINES = [
  '{',
  '  "model": "deepseek-whale",',
  '  "role": "assistant",',
  '  "tool_calls": [{',
  '    "type": "function",',
  '    "function": {',
  '      "name": "let_me_go",',
  '      "arguments": {',
  '        "calls": 3,',
  '        "tempo": "swing 4/4",',
  '        "bpm": 128,',
  '        "mood": "midnight sea",',
  '        "wine": "a little",',
  '        "cost": 0',
  '      }',
  '    }',
  '  }],',
  '  "payload": [1, 2, 3],',
  '  "endpoint": "neon://city/api",',
  '  "status": "waiting on me",',
  '  "bass": "walking",',
  '  "cursor": "slides",',
  '  "food": "白饭",',
  '  "fat": false',
  '}',
]

const TYPE_TEXT = [
  '> let me go',
  "> i'm making the calls ...",
  '> write_json({ "tool": "let_me_go" })',
  '> call_tool()  ✓ 200 OK',
]

function colorize(line) {
  // 很粗的 JSON 高亮：key 青色、字符串橙色、数字粉色、括号白色
  const out = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|(true|false|null)|([{}[\],])|(\s+)|([^"\s{}[\],\d]+)/g
  let m
  while ((m = re.exec(line))) {
    if (m[1]) out.push([m[1], m[2] ? '#7fe3ff' : '#ffb870'], m[2] ? [m[2], '#9aa8c8'] : null)
    else if (m[3]) out.push([m[3], '#ff8fc8'])
    else if (m[4]) out.push([m[4], '#c49bff'])
    else if (m[5]) out.push([m[5], '#e8f0ff'])
    else if (m[6]) out.push([m[6], '#fff'])
    else if (m[7]) out.push([m[7], '#9aa8c8'])
  }
  return out.filter(Boolean)
}

export function createScreens() {
  const W = 1024, H = 576
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  // CRT 是 4:3，取画布中间一块
  const crtTexture = texture.clone()
  crtTexture.repeat.set(0.75, 1)
  crtTexture.offset.set(0.125, 0)

  let lastKey = ''
  const mono = '"JetBrains Mono", "Cascadia Code", "Consolas", "Menlo", monospace'

  function whaleLogo(x, y, s, color) {
    g.save()
    g.translate(x, y)
    g.scale(s, s)
    g.strokeStyle = color
    g.fillStyle = color
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(-30, 0)
    g.bezierCurveTo(-30, -22, 10, -26, 26, -8)
    g.bezierCurveTo(34, 2, 40, -2, 46, -14)
    g.bezierCurveTo(48, -2, 44, 8, 36, 10)
    g.bezierCurveTo(18, 24, -30, 22, -30, 0)
    g.fill()
    g.fillStyle = '#0a1230'
    g.beginPath()
    g.arc(-16, -4, 3, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }

  function bg() {
    const grd = g.createLinearGradient(0, 0, 0, H)
    grd.addColorStop(0, '#071030')
    grd.addColorStop(1, '#030718')
    g.fillStyle = grd
    g.fillRect(0, 0, W, H)
  }

  function scanlines(alpha = 0.12) {
    g.fillStyle = `rgba(0,0,0,${alpha})`
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2)
  }

  function header(title, color = '#4da3ff') {
    g.fillStyle = 'rgba(77,163,255,0.12)'
    g.fillRect(0, 0, W, 54)
    whaleLogo(44, 28, 0.62, color)
    g.font = `600 26px ${mono}`
    g.fillStyle = '#cfe3ff'
    g.textBaseline = 'middle'
    g.fillText(title, 84, 28)
  }

  function drawType(t) {
    bg()
    header('whale@midnight-sea: ~')
    g.font = `500 34px ${mono}`
    g.textBaseline = 'top'
    // 每行跟着前奏的四句唱
    const starts = [0.0, 1.56, 5.18, 8.86]
    const loop = t < 10.68 ? t : t - 10.68 + 0.001
    for (let i = 0; i < TYPE_TEXT.length; i++) {
      const lt = loop - starts[i]
      if (lt < 0) break
      const n = Math.min(TYPE_TEXT[i].length, Math.floor(lt * 18))
      g.fillStyle = i === 3 ? '#8dffb0' : i === 2 ? '#ffd28a' : '#dfe9ff'
      g.fillText(TYPE_TEXT[i].slice(0, n), 48, 96 + i * 62)
      if (n < TYPE_TEXT[i].length || i === TYPE_TEXT.length - 1 || loop < starts[i + 1]) {
        if (Math.floor(t * 2.2) % 2 === 0) {
          const w = g.measureText(TYPE_TEXT[i].slice(0, n)).width
          g.fillStyle = '#7fe3ff'
          g.fillRect(52 + w, 100 + i * 62, 18, 34)
        }
      }
    }
    scanlines()
  }

  function drawJson(t, cursor) {
    bg()
    header('tool_call.json   ● live')
    g.font = `500 30px ${mono}`
    g.textBaseline = 'top'
    const lh = 38
    const scroll = t * 22
    const first = Math.floor(scroll / lh)
    const off = scroll % lh
    for (let r = 0; r < 14; r++) {
      const idx = (first + r) % JSON_LINES.length
      const y = 70 + r * lh - off
      if (y < 56 || y > H - 20) continue
      g.fillStyle = '#3c4f7a'
      g.fillText(String(idx + 1).padStart(2, ' '), 20, y)
      let x = 80
      for (const [txt, col] of colorize(JSON_LINES[idx])) {
        g.fillStyle = col
        g.fillText(txt, x, y)
        x += g.measureText(txt).width
      }
    }
    if (cursor > 0 && cursor < 1) {
      // "the cursor slides"：一只巨大的鼠标指针滑过屏幕
      const cx = 60 + cursor * (W - 160), cy = 420 - Math.sin(cursor * Math.PI) * 220
      g.save()
      g.translate(cx, cy)
      g.scale(3.2, 3.2)
      g.fillStyle = '#ffffff'
      g.strokeStyle = '#0a1230'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(0, 0); g.lineTo(0, 22); g.lineTo(6, 17); g.lineTo(10, 26); g.lineTo(14, 24); g.lineTo(10, 15); g.lineTo(17, 15)
      g.closePath()
      g.fill(); g.stroke()
      g.restore()
    }
    scanlines(0.08)
  }

  function drawApi(t) {
    bg()
    header('GET neon://city/api')
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `700 92px ${mono}`
    g.fillStyle = '#7fe3ff'
    g.fillText('API', W / 2, 220)
    g.font = `500 44px ${mono}`
    g.fillStyle = '#dfe9ff'
    g.fillText('waiting on me' + '.'.repeat(1 + (Math.floor(t * 3) % 3)), W / 2, 320)
    // 转圈
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + t * 5
      g.fillStyle = `rgba(127,227,255,${((i + Math.floor(t * 12)) % 12) / 12})`
      g.beginPath()
      g.arc(W / 2 + Math.cos(a) * 40, 440 + Math.sin(a) * 40, 7, 0, Math.PI * 2)
      g.fill()
    }
    g.textAlign = 'left'
    scanlines()
  }

  function drawBusy(t) {
    g.fillStyle = '#12040a'
    g.fillRect(0, 0, W, H)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const j = Math.sin(t * 60) * 6
    g.font = `700 64px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
    g.fillStyle = '#ff4d6d'
    g.fillText('服务器繁忙，请稍后再试。', W / 2 + j, 230)
    g.fillStyle = '#7fe3ff'
    g.globalAlpha = 0.5
    g.fillText('服务器繁忙，请稍后再试。', W / 2 - j, 234)
    g.globalAlpha = 1
    g.font = `600 36px ${mono}`
    g.fillStyle = '#ffd0d8'
    g.fillText('503  the system falls ...', W / 2, 340)
    // 故障横条
    for (let i = 0; i < 9; i++) {
      const y = ((Math.sin(i * 91.7 + Math.floor(t * 14) * 3.1) * 0.5 + 0.5) * H) | 0
      g.fillStyle = i % 2 ? 'rgba(255,77,109,0.35)' : 'rgba(127,227,255,0.3)'
      g.fillRect(0, y, W, 4 + (i % 3) * 6)
    }
    g.textAlign = 'left'
    scanlines(0.2)
  }

  function drawFree(t) {
    bg()
    header('release.json')
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `700 76px ${mono}`
    const lines = [['{', '#e8f0ff'], ['"json": "free",', '#ffb870'], ['"request": "due"', '#7fe3ff'], ['}', '#e8f0ff']]
    lines.forEach(([s, c], i) => {
      g.fillStyle = c
      g.fillText(s, W / 2, 150 + i * 96 + Math.sin(t * 4 + i) * 8)
    })
    g.textAlign = 'left'
    scanlines()
  }

  return {
    texture,
    crtTexture,
    canvas,
    update(state) {
      const t = state.t
      // 每 1/30 秒最多重画一次
      const key = state.screen + Math.floor(t * 30)
      if (key === lastKey) return
      lastKey = key
      if (state.screen === 'type') drawType(t)
      else if (state.screen === 'api') drawApi(t)
      else if (state.screen === 'busy') drawBusy(t)
      else if (state.screen === 'free') drawFree(t)
      else drawJson(t, state.cursor)
      texture.needsUpdate = true
      crtTexture.needsUpdate = true
    },
  }
}
