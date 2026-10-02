import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createWorld } from './world/index.js'
import { createPostFX } from './postfx.js'
import { loadBlendCamera, updateBlendCamera } from './blend-camera.js'
import { createCharacter } from './character.js'
import { createPlayer } from './player.js'
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
  renderer.shadowMap.type = THREE.PCFShadowMap
  const prFor = (q) => Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'ultra' ? 2 : 1.5)
  renderer.setPixelRatio(prFor(quality))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 80000)
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 90000)
  // 运镜：默认 blend 版（v2c 的 DS_Cam / DS_CamOrtho），手动才用机位按钮/漫游
  const camSel = $('cam')
  const camMode = () =>
    params.get('cam') || store.get('ds-stage-cam') || camSel.value || 'blend'
  let blendCam = null
  let blendCamFailed = false
  loadBlendCamera(params.get('cambase') || './data/camera-blend-v3.json')
    .then((d) => (blendCam = d))
    .catch((err) => {
      blendCamFailed = true
      console.warn('[cam] blend 运镜加载失败，回退手动：', err)
    })
  camSel.value = camMode()
  // 生成是同步的，先让"正在生成场景…"画出来
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  const world = createWorld(renderer, { quality, initial: params.get('theme') || defaults.theme }).attach(scene)
  const post = createPostFX(renderer, scene, camera, { bloom: params.get('bloom') !== '0', world })

  // 运镜模式切换：blend（默认，v2c 运镜）/ manual（机位按钮 + 漫游）
  function setCamMode(m) {
    camSel.value = m
    store.set('ds-stage-cam', m)
    if (m === 'manual') {
      camera.near = 1
      camera.updateProjectionMatrix()
      post.setCamera(camera)
    } else {
      $('tour').checked = false
    }
  }
  camSel.onchange = () => setCamMode(camSel.value)
  // 渲染管线：默认 blend 版（v2c 合成），simple 只做对比
  const pipeSel = $('pipe')
  // 默认 web 版（换了存储键，之前存过的 blend 选择不再顶替默认）
  pipeSel.value = params.get('pipe') || store.get('ds-stage-pipe2') || 'web'
  post.setPipeline(pipeSel.value)
  pipeSel.onchange = () => {
    post.setPipeline(pipeSel.value)
    store.set('ds-stage-pipe2', pipeSel.value)
  }
  $('tour').addEventListener('change', (e) => {
    if (e.target.checked) setCamMode('manual')
  })

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
  // 模型：默认 blend 版（v2c 三渲二角色），只在预览里出现，不碰场景
  const character = createCharacter(scene)
  post.setCharacter(character)
  // 玩家模式：第一人称按钮 → 角色脱离舞蹈，WASD/空格/Shift 控制（歌曲和场景时间轴照走）
  const player = createPlayer({
    character,
    camera,
    canvas,
    hud: (text) => {
      $('playerHud').hidden = !text
      $('playerHud').textContent = text
    },
  })
  window.__player = player // 调试/自动化用
  window.__character = character
  $('fpBtn').onclick = async () => {
    if (player.active) player.exit()
    else {
      modelSel.value = 'blend'
      applyModelMode()
      await player.enter()
      canvas.requestPointerLock?.()
    }
    $('fpBtn').classList.toggle('on', player.active)
    $('fpBtn').textContent = player.active ? '退出第一人称' : '第一人称'
    $('fpBtn').blur()
  }
  canvas.addEventListener('click', () => {
    if (player.active && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()
  })
  document.addEventListener('mousemove', (e) => {
    if (player.active && document.pointerLockElement === canvas) player.onMouse(e.movementX, e.movementY)
  })
  const modelSel = $('model')
  modelSel.value =
    params.get('model') ||
    (params.get('ref') === '0' ? 'hidden' : store.get('ds-stage-model') || 'blend')
  function applyModelMode() {
    const m = modelSel.value
    store.set('ds-stage-model', m)
    const wantChar = m === 'blend'
    character.group.visible = wantChar && character.ready
    // blend 文件缺失时（ fresh clone）用身高参考占位并提示
    ref.visible = m === 'ref' || (wantChar && (character.failed || !character.ready))
  }
  modelSel.onchange = applyModelMode
  character
    .load(
      params.get('modelbase') || './models/dschan-blend.glb',
      params.get('dance') || './data/dance-v2c.glb',
      parseFloat(params.get('outline') ?? 'NaN'),
    )
    .then(applyModelMode)
    .catch((err) => {
      character.failed = true
      console.warn('[model] blend 模型加载失败（public/models/dschan-blend.glb 缺失？），用身高参考占位：', err)
      applyModelMode()
    })
  applyModelMode()

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxDistance = 6000
  controls.target.set(0, 15, 0)

  function setView(key) {
    const v = typeof key === 'object' ? key : VIEWS[key]
    if (!v) return
    setCamMode('manual', true)
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
  // blend 运镜默认接管相机时不预置手动视角
  if (camSel.value === 'manual') setView(params.get('view') || 'front')

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

  // 手动飞行：WASD 前后左右，空格上，Shift 下（只在手动运镜时生效；blend 运镜由歌曲时间接管）
  const fly = new Set()
  const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'])
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return
    if (player.active && player.onKey(e, true)) {
      e.preventDefault()
      return
    }
    if (FLY_KEYS.has(e.code)) {
      e.preventDefault()
      if (!e.repeat) {
        fly.add(e.code)
        if ($('tour').checked) $('tour').checked = false // 一接管就停漫游
      }
      return
    }
    if (e.code === 'KeyP') togglePlay()
    else if (e.code === 'ArrowRight') setTime(clock + 5)
    else if (e.code === 'ArrowLeft') setTime(clock - 5)
    else if (e.key === 'h' || e.key === 'H') $('ui').classList.toggle('hidden')
    else if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      const th = world.themes[+e.code.slice(5) - 1]
      if (th) themeButtons[+e.code.slice(5) - 1].click()
    } else if (/^[1-7]$/.test(e.key)) setView(Object.keys(VIEWS)[+e.key - 1])
  })
  window.addEventListener('keyup', (e) => {
    if (player.active) player.onKey(e, false)
    fly.delete(e.code)
    if (!fly.size) flyStart = 0
  })
  window.addEventListener('blur', () => {
    fly.clear()
    flyStart = 0
  })

  const _fwd = new THREE.Vector3()
  const _right = new THREE.Vector3()
  const _up = new THREE.Vector3(0, 1, 0)
  const FLY_SPEED = 60 // MMD 单位/秒（起步速度，按住每 2 秒翻倍，上限 32 倍）
  const FLY_MAX_BOOST = 32
  let flyStart = 0
  function flyStep(dt) {
    if (!fly.size) return
    if (!flyStart) flyStart = performance.now()
    const boost = Math.min(FLY_MAX_BOOST, Math.pow(2, (performance.now() - flyStart) / 2000))
    camera.getWorldDirection(_fwd)
    _fwd.y = 0
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1)
    _fwd.normalize()
    _right.crossVectors(_fwd, _up)
    const mx = (fly.has('KeyD') ? 1 : 0) - (fly.has('KeyA') ? 1 : 0)
    const mz = (fly.has('KeyW') ? 1 : 0) - (fly.has('KeyS') ? 1 : 0)
    const my = (fly.has('Space') ? 1 : 0) - (fly.has('ShiftLeft') || fly.has('ShiftRight') ? 1 : 0)
    if (!mx && !mz && !my) return
    const sp = FLY_SPEED * boost * dt
    camera.position.addScaledVector(_fwd, mz * sp)
    camera.position.addScaledVector(_right, mx * sp)
    camera.position.y += my * sp
    controls.target.addScaledVector(_fwd, mz * sp)
    controls.target.addScaledVector(_right, mx * sp)
    controls.target.y += my * sp
  }

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
  world.compile(renderer, scene, orthoCam)
  $('loading')?.remove()

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
    if (modelSel.value === 'blend') {
      character.group.visible = character.ready
      ref.visible = !character.ready
    }
    let activeCam = camera
    if (player.active) {
      player.update(dt)
      post.setCamera(camera)
    } else if (blendCam && camSel.value === 'blend' && !$('tour').checked) {
      activeCam = updateBlendCamera(blendCam, clock, camera, orthoCam, camera.aspect)
      post.setCamera(activeCam)
    } else {
      if ($('tour').checked) post.setCamera(camera)
      else flyStep(dt)
      controls.update()
    }
    const s = world.update(clock, activeCam)
    // 角色只跟歌曲时间走（和 world.update 同哲学），不碰场景；在 world 之后更新以便跟随主题过渡
    character.update(clock, world)
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
    // 自动截图模式下不跑动画循环，只在 renderAt 时渲染
    if (!params.has('capture')) requestAnimationFrame(frame)
  }

  // 给自动化截图用：渲染指定时刻的一帧
  window.__stage = {
    world,
    renderer,
    camera,
    orthoCam,
    setView,
    setCamMode,
    // 玩家模式下按当前状态渲染一帧（自动化截图用）
    renderPlayer(dt = 0) {
      if (!player.active) return
      player.update(dt)
      post.setCamera(camera)
      const s = world.update(clock, camera)
      character.update(clock, world)
      post.render(s)
    },
    renderAt(t, view, theme) {
      if (view) setView(view)
      if (theme) world.setTheme(theme)
      clock = t
      let cam = camera
      if (blendCam && camSel.value === 'blend' && !view) {
        cam = updateBlendCamera(blendCam, t, camera, orthoCam, camera.aspect)
        post.setCamera(cam)
      } else {
        controls.update()
        post.setCamera(camera)
      }
      const s = world.update(t, cam)
      character.update(t, world)
      post.render(s)
      return s.section
    },
  }
  if (params.has('autoplay')) togglePlay(true)
  requestAnimationFrame(frame)
}

main()
