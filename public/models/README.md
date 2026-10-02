# models/ + 舞蹈/表情数据（跟着仓库走，开箱即用）

播放器「模型·blend版」（默认）= LetMeGo-dschan_v2c.blend 的角色原样搬过来：

- `./models/dschan-blend.glb` — `Character_FullDetail` + `Character_Rig`（Draco，无动画、无贴图）。
  带 v2c TOON 材质要用的数据：UVMap / HandUV / FaceUV（TEXCOORD_0/1/2）、cap_color（COLOR_0）、
  `_PART_KIND` / `_FACE_LAYER`（逐面属性转成逐角点）、自定义法线。描边 modifier 不导出，web 用背面膨胀壳
  复刻（宽度 = v2c Line Width 0.00125 m，`?outline=` 可调，0 关闭）。
- `./models/tex/*.webp` — 材质贴图：albedo（Image_0）、hand、face_base、眼睛上/下层图集、虹膜、嘴型图集
  （眼睛图集降到一半分辨率）。
- `./data/dance-v2c.glb` — 舞蹈动作，Blender glTF 导出器直接导出，每 4 帧采一次（= 30fps），
  第 f 帧 = 歌曲 (f-1)/120 秒，three 侧 `AnimationMixer.setTime` 播放。
- `./data/face-v2c.{json,bin}` — 表情：v2c 材质驱动器（眼/嘴图集格、虹膜偏移）逐帧（120fps）求值结果，取最近帧。

材质本身在 `src/character-material.js`（TOON 主材质 + NPR 卡通着色 + 主题色调 CHARLOOK），
表情合成 `src/face-expression.js` 由 `tools/nodes2glsl.py` 从 v2c 节点组逐节点生成。

摆放：glb 都是 blend 世界坐标（glTF Y-up、米），播放器只乘 12.5 换成 web 单位，和 blend 运镜同一套换算。

重新生成（各约 30 秒）：

```bash
blender -b LetMeGo-dschan_v2c.blend --python tools/export_char_glb.py   -- public/models/dschan-blend.glb
blender -b LetMeGo-dschan_v2c.blend --python tools/export_dance_glb.py  -- public/data/dance-v2c.glb
blender -b LetMeGo-dschan_v2c.blend --python tools/export_face_track.py -- public/data/face-v2c.bin public/data/face-v2c.json
python3 tools/nodes2glsl.py graph.json > src/face-expression.js   # graph.json：节点组导出（见脚本注释）
```

文件缺失时播放器自动回退到身高参考占位，不报错挡路。
