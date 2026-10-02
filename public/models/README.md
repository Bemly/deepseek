# models/ + 舞蹈数据（跟着仓库走，开箱即用）

播放器「模型·blend版」（默认）加载：

- `./models/dschan-blend.glb` — v2c 的 `Character_FullDetail` + `Character_Rig`
  （unlit 烘焙材质 + Draco；描边 modifier 导出时摘除，web 里用背面膨胀壳复刻，见 `src/character.js` 的 `addOutlineShell`，`?outline=` 可调宽度，0 关闭）
- `./data/dance-30fps.{json,bin}` — `BadBadWater_VMD` 按 30fps 采样
  （174 骨骼四元数 + Hips 位移 + 15 脸部 props；脸部暂存不用）

来源（本机可复现）：

```bash
# mesh+rig（Draco）
blender -b <rigged.blend> --python /tmp/export_bind.py -- public/models/dschan-blend.glb
# 舞蹈（30fps，纯 fcurve 求值）
blender -b <v2c.blend> --python /tmp/sample_dance.py -- public/data/dance-30fps.bin public/data/dance-30fps.json
```

文件缺失时播放器自动回退到身高参考占位，不报错挡路。
