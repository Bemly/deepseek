# retarget MMD .vmd motions (walk / run cycles) onto the v2c Character_Rig and export them as one glTF (one animation each)
#   blender -b LetMeGo-dschan_v2c.blend --python tools/retarget_vmd.py -- tools/vmd_solver.py <out.glb> <out_meta.json> name=file.vmd ...
# Re-uses the MMD solver tools/vmd_solver.py (= work/vmd_retarget.py of the toon project) (MMD bone chain -> rig, A-pose arm correction, analytic leg IK from 足ＩＫ).
# Its old secondary-motion block is skipped (hair/skirt are simulated in the web player). Centre drift is removed so the
# clip plays in place; travel speed comes from 全ての親 (+ the removed drift) and goes to the meta json like moves.json.
import bpy, sys, json, re, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
SOLVER, OUT, META = a[0], a[1], a[2]
CLIPS = dict(x.split('=', 1) for x in a[3:])

src = open(SOLVER, encoding='utf-8').read()
src = src[:src.index('# ---------- local quats & write action')] + src[src.index('# ---------- local quats & write action'):src.index('bpy.ops.wm.save_as_mainfile')]
src = src.replace("argv=sys.argv[sys.argv.index('--')+1:]\nVMD=argv[0]; OUT=argv[1]; FMAX=int(argv[2]) if len(argv)>2 else -1", "FMAX=-1")
s0, s1 = src.index('SEC=set()'), src.index("print('secondary'")
src = src[:s0] + 'SEC=set()\n' + src[s1:]
# in place + travel speed, right after the hips translation is computed
src = src.replace("hips_t=cpos*SCALE\n", """hips_t=cpos*SCALE
_tt=np.arange(NF)/30.0
_drift=[np.polyfit(_tt,hips_t[:,k],1) for k in (0,1)]
for k in (0,1): hips_t[:,k]-=np.polyval(_drift[k],_tt)
_mq,_mp=track('全ての親'); _mv=_mp*SCALE
SPEED=[float(np.polyfit(_tt,_mv[:,k],1)[0]+_drift[k][0]) for k in (0,1)]
""", 1)
src = src.replace("act=bpy.data.actions.new('BadBadWater_VMD')", "act=bpy.data.actions.new(NAME)")
assert 'SPEED=' in src and 'actions.new(NAME)' in src

scene = bpy.context.scene
arm = bpy.data.objects['Character_Rig']
for o in list(bpy.data.objects):
    if o != arm: bpy.data.objects.remove(o, do_unlink=True)
ad = arm.animation_data_create(); ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
meta = {}
for name, vmd in CLIPS.items():
    g = {'__name__': 'vmd_solver', 'VMD': vmd, 'NAME': name}
    exec(compile(src, 'vmd_retarget.py', 'exec'), g)
    act = g['act']; nf = g['NF']; sp = g['SPEED']
    act.use_fake_user = True
    arm.animation_data.action = None
    tr = ad.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 1, act); st.action_frame_end = nf
    meta[name] = {'src': vmd.split('/')[-1], 'frames': nf, 'fps': 30, 'duration': round((nf - 1) / 30, 4),
                  'speed': [round(sp[0], 4), round(-sp[1], 4)]}     # x = her left, y = forward (rig faces -Y)
    print('CLIP', name, meta[name], flush=True)

scene.render.fps = 30; scene.render.fps_base = 1.0; scene.frame_start = 1; scene.frame_end = max(m['frames'] for m in meta.values())
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_optimize_animation_size=True, export_skins=True, export_morph=False, export_def_bones=False,
    export_materials='NONE', export_cameras=False, export_lights=False, export_yup=True, export_extras=False)
json.dump(meta, open(META, 'w'), ensure_ascii=False, indent=1)
print('EXPORTED', OUT, list(meta))
