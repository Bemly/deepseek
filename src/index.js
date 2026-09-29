// 对外入口：接进你自己的 MMD 播放器时只需要这几个
export { createWorld } from './world/index.js'
export { createPostFX } from './postfx.js'
export { computeState } from './state.js'
export { LYRICS, SECTIONS, TOOL_CALLS, EVENTS, SONG, lyricAt, sectionAt } from './lyrics.js'
