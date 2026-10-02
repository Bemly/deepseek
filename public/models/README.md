# models/ — 角色模型（二进制放本地，不进仓库）

播放器「模型·blend版」（默认）加载 `./models/dschan-blend.glb`：

- 当前：第③步占位，用 blender 侧已导出的便携版
  `blender/meshy-models/output/01a0c1da-toon/character-01a0c1da-toon-portable.glb`
  拷过来改名即可（`*.glb` 已在 `.gitignore`）。
- 第④步：`BadBadWater_VMD` 舞蹈烘焙完成后，替换为带动作的版本，文件名不变，
  播放器 `character.update(t)` 会按歌曲时间驱动。
