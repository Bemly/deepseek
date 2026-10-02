# models/ + 舞蹈数据（跟着仓库走，开箱即用）

播放器「模型·blend版」（默认）加载：

- `./models/dschan-blend.glb` — v2c 的 `Character_FullDetail` + `Character_Rig`（Draco，烘焙颜色贴图在 baseColor，KHR_materials_unlit）。
  描边 modifier 导出时摘除，web 里用背面膨胀壳复刻（`src/character.js` 的 `addOutlineShell`，`?outline=` 调宽度，0 关闭）。
- `./data/dance-v2c.glb` — v2c 的舞蹈动作（Character_Rig 的 active action），Blender glTF 导出器直接导出，
  每 4 帧采一次（= 120fps 时间轴上的 30fps），第 f 帧 = 歌曲 (f-1)/120 秒。three 侧 `AnimationMixer.setTime` 播放。

摆放：两份 glb 都是 blend 世界坐标（glTF Y-up、米），播放器只乘 12.5 换成 web 单位，和 blend 运镜同一套换算。

重新导出舞蹈（约 35 秒）：

```bash
blender -b LetMeGo-dschan_v2c.blend --python tools/export_dance_glb.py -- public/data/dance-v2c.glb
```

文件缺失时播放器自动回退到身高参考占位，不报错挡路。
