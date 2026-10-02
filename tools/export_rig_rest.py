# rest data of the v2c Character_Rig in Blender armature space, for the in-browser VMD solver (src/motion-import.js)
#   blender -b LetMeGo-dschan_v2c.blend --python export_rig_rest.py -- <out.json>
import bpy, sys, json
out = sys.argv[sys.argv.index('--') + 1]
arm = bpy.data.objects['Character_Rig'].data
r = lambda v: [round(x, 6) for x in v]
data = {}
for b in arm.bones:
    m = b.matrix_local
    data[b.name] = {'head': r(b.head_local), 'tail': r(b.tail_local), 'x': r(m.col[0][:3]), 'y': r(m.col[1][:3]), 'z': r(m.col[2][:3]), 'parent': b.parent.name if b.parent else None}
json.dump(data, open(out, 'w'))
print('RIG', len(data))
