# models/ + 舞蹈数据（二进制放本地，不进仓库）

播放器「模型·blend版」（默认）加载：

- `./models/dschan-blend.glb` — v2c 的 `Character_FullDetail` + `Character_Rig`
  （unlit 烘焙材质 + Draco，描边 modifier 已摘除，介意描边以后再加壳）
- `./data/dance-30fps.{json,bin}` — `BadBadWater_VMD` 按 30fps 采样
  （174 骨骼四元数 + Hips 位移 + 15 脸部 props；脸部暂存不用）

来源（本机可复现）：

```bash
# mesh+rig（Draco）
blender -b <rigged.blend> --python /tmp/export_bind.py -- public/models/dschan-blend.glb
# 舞蹈（30fps，纯 fcurve 求值）
blender -b <v2c.blend> --python /tmp/sample_dance.py -- public/data/dance-30fps.bin public/data/dance-30fps.json
```

`*.glb` 与 `dance-30fps.bin` 已在 `.gitignore`；`dance-30fps.json`（2.8K 头信息）进仓库。
文件缺失时播放器自动回退到身高参考占位，不报错挡路。
