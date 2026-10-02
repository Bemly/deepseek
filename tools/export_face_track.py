# sample the v2c face drivers (FACE_EyeR/EyeL/Mouth/Iris*/IrisScale value nodes of the TOON material) at every frame (120 fps)
#   blender -b LetMeGo-dschan_v2c.blend --python export_face_track.py -- <out.bin> <out.json>
# Cell indices are piecewise (integer part = atlas strip), so the player uses the nearest frame, never interpolates.
import bpy, sys, json, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]; OUT_BIN, OUT_JSON = a[0], a[1]
arm = bpy.data.objects['Character_Rig']; ob = bpy.data.objects['Character_FullDetail']
for o in list(bpy.data.objects):
    if o not in (arm, ob): bpy.data.objects.remove(o, do_unlink=True)
for m in list(ob.modifiers): ob.modifiers.remove(m)        # drivers only need the rig; skip skinning the 1M-vertex mesh
nt = bpy.data.materials['TOON • Full Detail / 高模统一材质'].node_tree
CH = ['FACE_EyeR', 'FACE_EyeL', 'FACE_Mouth', 'FACE_IrisR_dx', 'FACE_IrisR_dy', 'FACE_IrisL_dx', 'FACE_IrisL_dy', 'FACE_IrisScale']
sc = bpy.context.scene; F0, F1 = sc.frame_start, sc.frame_end
data = np.zeros((F1 - F0 + 1, len(CH)), np.float32)
dg = bpy.context.evaluated_depsgraph_get()
for f in range(F0, F1 + 1):
    sc.frame_set(f)
    for d in nt.animation_data.drivers: pass
    data[f - F0] = [nt.nodes[c].outputs[0].default_value for c in CH]
data.tofile(OUT_BIN)
json.dump({'fps': sc.render.fps, 'first': F0, 'frames': int(data.shape[0]), 'channels': CH,
           'note': 'v2c face drivers sampled every frame; frame f = song (f-1)/fps s'}, open(OUT_JSON, 'w'), ensure_ascii=False)
print('FACE', data.shape, 'ranges', [(c, float(data[:, i].min()), float(data[:, i].max())) for i, c in enumerate(CH)])
