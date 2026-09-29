import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createWorld } from './world/index.js'
import { createPostFX } from './postfx.js'
import { SONG, SECTIONS, DEMO_THEME_SCHEDULE } from './lyrics.js'

// 预览页：播放歌曲、拖进度、切机位看场景。MMD 模型不在这里加载——
// 把 createWorld / world.update(t) 接到你自己的 MMD 播放器里即可（见 README）。

const params = new URLSearchParams(location.search)
const defaults = window.__STAGE_DEFAULTS__ || {}
const $ = (id) => document.getElementById(id)
const store = {
  get(k) {
    try { return localStorage.getItem(k) } catch { return null }
  },
  set(k, v) {
    try { localStorage.setItem(k, v) } catch { /* 隐私模式等情况下存不了，忽略 */ }
  },
}

const VIEWS = {
  front: { label: '正面', pos: [0, 17, 80], target: [0, 15, 0], fov: 38 },
  close: { label: '近景', pos: [-20, 12, 36], target: [0, 13, 0], fov: 30 },
  wide: { label: '全景', pos: [0, 60, 330], target: [0, 90, -800], fov: 46 },
  city: { label: '城市', pos: [8, 30, 70], target: [300, 900, -5000], fov: 32 },
  side: { label: '侧面', pos: [118, 26, 58], target: [0, 18, -8], fov: 40 },
  back: { label: '背面', pos: [-40, 40, -110], target: [0, 12, 40], fov: 44 },
  crane: { label: '俯瞰', pos: [260, 340, 420], target: [0, 0, -500], fov: 42 },
}

async function loadFonts() {
  if (!document.fonts) return
  const wants = ['400 64px Pacifico', '400 64px Monoton', '600 32px "JetBrains Mono"']
  await Promise.race([Promise.all(wants.map((f) => document.fonts.load(f).catch(() => null))), new Promise((r) => setTimeout(r, 2500))])
}

async function main() {
  await loadFonts()
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const quality = params.get('q') || store.get('ds-stage-q') || (coarse ? 'low' : 'high')
  $('quality').value = quality
  const canvas = $('c')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const prFor = (q) => Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'ultra' ? 2 : 1.5)
  renderer.setPixelRatio(prFor(quality))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 80000)
  const world = createWorld(renderer, { quality, initial: params.get('theme') || defaults.theme }).attach(scene)
  const post = createPostFX(renderer, scene, camera, { bloom: params.get('bloom') !== '0', world })

  // 身高参考：20 单位高的全息人形（MMD 角色大约这么高），只在预览里出现
  const ref = new THREE.Group()
  {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.6, 1.2), transparent: true, opacity: 0.28, depthWrite: false })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 9, 6, 16), mat)
    body.position.y = 8.3
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.9, 20, 16), mat)
    head.position.y = 17.2
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(4.6, 6, 24, 1, true), mat)
    skirt.position.y = 7.5
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 1.6), transparent: true, opacity: 0.6, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.08
    ref.add(body, head, skirt, ring)
  }
  scene.add(ref)
  $('ref').onchange = (e) => (ref.visible = e.target.checked)
  if (params.get('ref') === '0') {
    ref.visible = false
    $('ref').checked = false
  }

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxDistance = 6000
  controls.target.set(0, 15, 0)

  function setView(key) {
    const v = typeof key === 'object' ? key : VIEWS[key]
    if (!v) return
    camera.position.set(...v.pos)
    controls.target.set(...v.target)
    camera.fov = v.fov
    camera.updateProjectionMatrix()
    controls.update()
    document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.key === key))
  }
  Object.entries(VIEWS).forEach(([key, v], i) => {
    const b = document.createElement('button')
    b.textContent = v.label
    b.title = `快捷键 ${i + 1}`
    b.dataset.key = key
    b.onclick = () => {
      $('tour').checked = false
      setView(key)
    }
    $('views').appendChild(b)
  })
  setView(params.get('view') || 'front')

  // ---------- 时间轴 ----------
  const audio = new Audio()
  audio.preload = 'auto'
  audio.src = params.get('audio') || defaults.audio || './audio/let-me-go.mp3'
  let audioOk = false
  audio.addEventListener('canplay', () => (audioOk = true))
  audio.addEventListener('error', () => {
    audioOk = false
    $('fileLabel').hidden = false
  })
  $('file').onchange = (e) => {
    const f = e.target.files[0]
    if (!f) return
    audio.src = URL.createObjectURL(f)
    $('fileLabel').hidden = true
  }

  let playing = false
  let clock = parseFloat(params.get('t') || store.get('ds-stage-t') || defaults.t || '0') || 0
  store.set('ds-stage-t', '')
  let lastNow = performance.now()
  const seekEl = $('seek')
  seekEl.max = SONG.duration

  function setTime(t) {
    clock = Math.max(0, Math.min(SONG.duration, t))
    if (audioOk) audio.currentTime = clock
  }
  function togglePlay(force) {
    playing = force ?? !playing
    $('play').textContent = playing ? '❚❚' : '▶'
    if (playing && audioOk) {
      audio.currentTime = clock
      audio.play().catch(() => {})
    } else audio.pause()
  }
  $('play').onclick = () => togglePlay()
  seekEl.oninput = () => setTime(parseFloat(seekEl.value))

  // 段落刻度
  SECTIONS.forEach((s, k) => {
    const x = (s.t / SONG.duration) * 100
    const i = document.createElement('i')
    i.style.left = `${x}%`
    $('marks').append(i)
    // 挨得太近的段落只画刻度不写名字
    const next = SECTIONS[k + 1]
    if (next && next.t - s.t < 7) return
    const b = document.createElement('b')
    b.style.left = `${x}%`
    b.textContent = s.name
    $('marks').append(b)
  })

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return
    if (e.code === 'Space') {
      e.preventDefault()
      togglePlay()
    } else if (e.code === 'ArrowRight') setTime(clock + 5)
    else if (e.code === 'ArrowLeft') setTime(clock - 5)
    else if (e.key === 'h' || e.key === 'H') $('ui').classList.toggle('hidden')
    else if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      const th = world.themes[+e.code.slice(5) - 1]
      if (th) themeButtons[+e.code.slice(5) - 1].click()
    } else if (/^[1-7]$/.test(e.key)) setView(Object.keys(VIEWS)[+e.key - 1])
  })

  $('quality').onchange = (e) => {
    // 画质影响反射分辨率等初始化参数，存起来后重新加载
    store.set('ds-stage-q', e.target.value)
    store.set('ds-stage-t', clock.toFixed(2))
    const u = new URL(location.href)
    u.searchParams.delete('q')
    u.searchParams.delete('t')
    location.replace(u.toString())
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    post.setSize(w, h)
    world.setSize(w, h, renderer.getPixelRatio())
  }
  window.addEventListener('resize', resize)
  resize()
  world.compile(renderer, scene, camera)

  // ---------- 主题 ----------
  const themeButtons = []
  world.themes.forEach((th, i) => {
    const b = document.createElement('button')
    b.textContent = th.label
    b.dataset.theme = th.name
    b.title = `切换到「${th.label}」（Shift+${i + 1}）`
    b.onclick = () => {
      $('auto').checked = false
      world.setSchedule(null)
      world.transitionTo(th.name)
    }
    $('themes').appendChild(b)
    themeButtons.push(b)
  })
  const demo = DEMO_THEME_SCHEDULE.filter((e) => world.themes.some((th) => th.name === e.theme))
  $('auto').onchange = (e) => world.setSchedule(e.target.checked ? demo : null)
  if (params.get('auto') === '1') {
    $('auto').checked = true
    world.setSchedule(demo)
  }

  if (params.get('ui') === '0') $('ui').classList.add('hidden')

  // 漫游：绕舞台慢慢转，高度随段落起伏
  function tour(t) {
    const a = t * 0.06 + 0.3
    const r = 110 + 60 * Math.sin(t * 0.05)
    camera.position.set(Math.sin(a) * r, 18 + 30 * (0.5 + 0.5 * Math.sin(t * 0.07)), Math.cos(a) * r - 12)
    controls.target.set(0, 16, -12)
    camera.fov = 42
    camera.updateProjectionMatrix()
  }

  let lastLyric = null
  function frame(now) {
    const dt = Math.min(0.1, (now - lastNow) / 1000)
    lastNow = now
    if (playing) {
      if (audioOk && !audio.paused) clock = audio.currentTime
      else clock += dt
      if (clock >= SONG.duration) togglePlay(false)
    }
    if ($('tour').checked) tour(clock)
    controls.update()
    const s = world.update(clock, camera)
    post.render(s)

    seekEl.value = clock
    $('time').textContent = `${Math.floor(clock / 60)}:${(clock % 60).toFixed(1).padStart(4, '0')}`
    $('section').textContent = s.section
    const shown = world.mix ? world.mix.b : world.theme
    themeButtons.forEach((b) => b.classList.toggle('on', b.dataset.theme === shown))
    const text = $('showLyric').checked && s.lyric ? s.lyric.text : ''
    if (text !== lastLyric) {
      $('lyric').textContent = text
      lastLyric = text
    }
    requestAnimationFrame(frame)
  }

  // 给自动化截图用：渲染指定时刻的一帧
  window.__stage = {
    world,
    renderer,
    camera,
    setView,
    renderAt(t, view, theme) {
      if (view) setView(view)
      if (theme) world.setTheme(theme)
      clock = t
      controls.update()
      const s = world.update(t, camera)
      post.render(s)
      return s.section
    },
  }
  if (params.has('autoplay')) togglePlay(true)
  requestAnimationFrame(frame)
}

main()
