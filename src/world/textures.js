import { canvasTexture, rng } from './util.js'

// 近景道具用的程序化贴图（全部 canvas 现画，不依赖外部图片）

export function woodTexture() {
  const R = rng(42)
  return canvasTexture(256, 1024, (g, w, h) => {
    g.fillStyle = '#6b4428'
    g.fillRect(0, 0, w, h)
    // 纵向木纹（上下可平铺：用整周期的正弦）
    for (let i = 0; i < 260; i++) {
      const x0 = R() * w
      const amp = 1 + R() * 5
      const k = 1 + Math.floor(R() * 3)
      const ph = R() * Math.PI * 2
      const dark = R() < 0.6
      g.strokeStyle = dark ? `rgba(35,18,8,${0.12 + R() * 0.25})` : `rgba(190,130,80,${0.06 + R() * 0.12})`
      g.lineWidth = 0.6 + R() * 2.2
      g.beginPath()
      for (let y = 0; y <= h; y += 8) {
        const x = x0 + Math.sin((y / h) * Math.PI * 2 * k + ph) * amp
        y === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()
    }
    // 几个木节
    for (let i = 0; i < 3; i++) {
      const x = 40 + R() * (w - 80), y = 100 + R() * (h - 200)
      for (let r = 14; r > 2; r -= 2.5) {
        g.strokeStyle = `rgba(40,20,8,${0.25})`
        g.lineWidth = 1.2
        g.beginPath()
        g.ellipse(x, y, r * 0.6, r * 1.8, 0, 0, Math.PI * 2)
        g.stroke()
      }
    }
  }, { repeat: true })
}

export function drawWhale(g, x, y, s, fill, eye = '#0a1230') {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  g.fillStyle = fill
  g.beginPath()
  g.moveTo(-30, 0)
  g.bezierCurveTo(-30, -22, 10, -26, 26, -8)
  g.bezierCurveTo(34, 2, 40, -2, 46, -14)
  g.bezierCurveTo(48, -2, 44, 8, 36, 10)
  g.bezierCurveTo(18, 24, -30, 22, -30, 0)
  g.fill()
  if (eye) {
    g.fillStyle = eye
    g.beginPath()
    g.arc(-16, -4, 3, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

function star(g, x, y, r, rot = 0) {
  g.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * Math.PI * 2
    const rr = i % 2 ? r * 0.28 : r
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr
    i ? g.lineTo(px, py) : g.moveTo(px, py)
  }
  g.closePath()
  g.fill()
}

export function medallionTexture() {
  return canvasTexture(1024, 1024, (g, w) => {
    const c = w / 2
    const grd = g.createRadialGradient(c, c, 50, c, c, c)
    grd.addColorStop(0, '#15306e')
    grd.addColorStop(1, '#0a1638')
    g.fillStyle = grd
    g.fillRect(0, 0, w, w)
    g.strokeStyle = '#d9b36a'
    for (const [r, lw] of [[500, 10], [470, 3], [330, 6], [318, 2]]) {
      g.lineWidth = lw
      g.beginPath()
      g.arc(c, c, r, 0, Math.PI * 2)
      g.stroke()
    }
    // 环形文字
    const text = "LET ME GO  ✦  I'M MAKING THE CALLS  ✦  128 BPM  ✦  SWING IN 4/4  ✦  "
    g.font = '700 46px "Georgia", serif'
    g.fillStyle = '#e8c77e'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const chars = [...text]
    chars.forEach((ch, i) => {
      const a = (i / chars.length) * Math.PI * 2 - Math.PI / 2
      g.save()
      g.translate(c + Math.cos(a) * 400, c + Math.sin(a) * 400)
      g.rotate(a + Math.PI / 2)
      g.fillText(ch, 0, 0)
      g.restore()
    })
    drawWhale(g, c - 10, c + 10, 6.2, '#e3bf72', '#0a1638')
    g.fillStyle = '#f3dca0'
    const R = rng(3)
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2, r = 120 + R() * 170
      star(g, c + Math.cos(a) * r, c + Math.sin(a) * r * 0.9 - 40, 8 + R() * 14, R())
    }
  })
}

export function signTexture() {
  return canvasTexture(2048, 620, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    g.lineJoin = 'round'
    g.lineCap = 'round'
    const neon = (draw, color) => {
      g.shadowColor = color
      for (const [blur, lw, a] of [[60, 26, 0.3], [26, 14, 0.55], [8, 7, 1]]) {
        g.shadowBlur = blur
        g.globalAlpha = a
        g.strokeStyle = color
        g.lineWidth = lw
        draw()
      }
      g.globalAlpha = 1
      g.shadowBlur = 10
      g.strokeStyle = '#ffffff'
      g.lineWidth = 3
      draw()
    }
    g.font = '400 300px "Pacifico", "Brush Script MT", "Segoe Script", cursive'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    neon(() => g.strokeText('Let Me Go', w / 2 + 170, h / 2 + 10), '#ff4fb8')
    // 霓虹鲸鱼（描边）
    neon(() => {
      g.save()
      g.translate(330, h / 2 + 10)
      g.scale(5, 5)
      g.lineWidth = g.lineWidth / 5
      g.beginPath()
      g.moveTo(-30, 0)
      g.bezierCurveTo(-30, -22, 10, -26, 26, -8)
      g.bezierCurveTo(34, 2, 40, -2, 46, -14)
      g.bezierCurveTo(48, -2, 44, 8, 36, 10)
      g.bezierCurveTo(18, 24, -30, 22, -30, 0)
      g.moveTo(-17, -4)
      g.arc(-16, -4, 1.2, 0, Math.PI * 2)
      g.moveTo(-6, -22)
      g.quadraticCurveTo(-10, -34, -2, -40)
      g.moveTo(-6, -22)
      g.quadraticCurveTo(2, -32, 10, -34)
      g.restore()
      g.stroke()
    }, '#39d0ff')
  })
}

export function sheetMusicTexture() {
  const R = rng(9)
  return canvasTexture(512, 360, (g, w, h) => {
    g.fillStyle = '#f4ecd8'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#2a2018'
    g.font = 'italic 700 26px Georgia, serif'
    g.textAlign = 'center'
    g.fillText('Let Me Go — swing', w / 2, 34)
    g.strokeStyle = '#3a2e22'
    for (let s = 0; s < 3; s++) {
      const y0 = 70 + s * 95
      g.lineWidth = 1.2
      for (let l = 0; l < 5; l++) {
        g.beginPath()
        g.moveTo(24, y0 + l * 9)
        g.lineTo(w - 24, y0 + l * 9)
        g.stroke()
      }
      for (let x = 60; x < w - 30; x += 22 + R() * 10) {
        const ny = y0 + Math.floor(R() * 9) * 4.5
        g.beginPath()
        g.ellipse(x, ny, 5, 3.6, -0.4, 0, Math.PI * 2)
        g.fillStyle = '#2a2018'
        g.fill()
        g.beginPath()
        g.moveTo(x + 4.5, ny)
        g.lineTo(x + 4.5, ny - 26)
        g.stroke()
      }
    }
  })
}

export function bottleLabelTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#efe4c8'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#8a6a2a'
    g.lineWidth = 4
    g.strokeRect(10, 10, w - 20, h - 20)
    drawWhale(g, w / 2, 86, 1.6, '#1d3f8a', '#efe4c8')
    g.fillStyle = '#1d2b4a'
    g.textAlign = 'center'
    g.font = '700 38px Georgia, serif'
    g.fillText('MIDNIGHT SEA', w / 2, 170)
    g.font = 'italic 24px Georgia, serif'
    g.fillText('Cabernet · 2026', w / 2, 210)
  })
}

export function bowlTexture() {
  return canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#f5f7fb'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#2d5fb8'
    g.lineWidth = 5
    g.beginPath()
    g.moveTo(0, 96)
    g.lineTo(w, 96)
    g.stroke()
    g.lineWidth = 3
    g.beginPath()
    for (let x = 0; x <= w; x += 4) g.lineTo(x, 70 + Math.sin((x / w) * Math.PI * 16) * 8)
    g.stroke()
    g.fillStyle = '#2d5fb8'
    for (let i = 0; i < 8; i++) drawWhale(g, 32 + i * 64, 34, 0.35, '#2d5fb8', null)
  })
}

export function riceBumpTexture() {
  const R = rng(11)
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#808080'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 900; i++) {
      g.save()
      g.translate(R() * w, R() * h)
      g.rotate(R() * Math.PI)
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 7)
      grd.addColorStop(0, 'rgba(255,255,255,0.9)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grd
      g.scale(1, 0.45)
      g.beginPath()
      g.arc(0, 0, 7, 0, Math.PI * 2)
      g.fill()
      g.restore()
    }
  }, { srgb: false, repeat: true })
}

export function holoTexture() {
  const lines = [
    '{"tool":"let_me_go","calls":3}',
    '→ POST /v1/chat/completions',
    '{"payload":[1,2,3]}',
    '✓ 200 OK  128 bpm',
    '{"json":"free"}',
    'swing(4/4)  ♪ ♫',
    '{"answer":"late","wine":true}',
    '→ neon://city/api',
  ]
  return canvasTexture(2048, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    g.font = '600 44px "JetBrains Mono", Consolas, Menlo, monospace'
    g.textBaseline = 'middle'
    let x = 10
    let i = 0
    while (x < w) {
      const s = lines[i % lines.length] + '   '
      g.fillStyle = i % 3 === 0 ? '#7fe3ff' : i % 3 === 1 ? '#ff8fd0' : '#e8f0ff'
      g.fillText(s, x, h / 2)
      x += g.measureText(s).width
      i++
    }
    g.fillStyle = 'rgba(127,227,255,0.9)'
    g.fillRect(0, 4, w, 3)
    g.fillRect(0, h - 7, w, 3)
  }, { repeat: true })
}
