# special moves (emotes) for the web player, exported onto the v2c Character_Rig as one glTF + face tracks
#   blender -b LetMeGo-dschan_v2c.blend --python export_emotes.py -- <bbw.blend> <toon.blend> <out.glb> <out.json>
# - 我的悲伤是水做的 (BadBadWater blend, same 177-bone rig): cut segments of its dance action
# - the earlier toon version's 27-bone rig moves (Wave, Heart_Gesture): retargeted by world-space rotation deltas
# Face: the v2c material drivers are evaluated per frame for the BadBadWater segments (its action carries the MMD
# face props); the retargeted toon moves get a fixed smile. All clips are 30 fps, played in place by the player.
import bpy, sys, json, numpy as np
from mathutils import Matrix, Vector

a = sys.argv[sys.argv.index('--') + 1:]
BBW, TOON, OUT, META = a
BBW_SEG = {'emote_bbw_chorus': (59.5, 65.5, '水·副歌'), 'emote_bbw_handsup': (46.0, 51.0, '水·举手')}
TOON_MOVES = {'emote_wave': ('Wave', '挥手', (20, 11)), 'emote_heart': ('Heart_Gesture', '比心', (15, 11))}   # face (eye, mouth) cells
FACE_CH = ['FACE_EyeR', 'FACE_EyeL', 'FACE_Mouth', 'FACE_IrisR_dx', 'FACE_IrisR_dy', 'FACE_IrisL_dx', 'FACE_IrisL_dy', 'FACE_IrisScale']

scene = bpy.context.scene
arm = bpy.data.objects['Character_Rig']; mesh = bpy.data.objects['Character_FullDetail']
for o in list(bpy.data.objects):
    if o not in (arm, mesh): bpy.data.objects.remove(o, do_unlink=True)
for m in list(mesh.modifiers): mesh.modifiers.remove(m)          # the mesh only stays so the material drivers evaluate
for s in list(bpy.data.scenes):
    if s != scene: bpy.data.scenes.remove(s)
ad = arm.animation_data_create(); ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
nt = bpy.data.materials['TOON • Full Detail / 高模统一材质'].node_tree
scene.render.fps = 30; scene.render.fps_base = 1.0                 # both sources are 30 fps
meta = {}

# ---------- 我的悲伤是水做的: same rig, cut segments
with bpy.data.libraries.load(BBW) as (src, dst): dst.actions = ['BadBadWater_VMD']
bbw = dst.actions[0]; bbw.use_fake_user = True
for name, (t0, t1, label) in BBW_SEG.items():
    f0, f1 = int(round(t0 * 30)) + 1, int(round(t1 * 30)) + 1
    ad.action = bbw
    face = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f); face.append([round(nt.nodes[c].outputs[0].default_value, 3) for c in FACE_CH])
    ad.action = None
    tr = ad.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, f0, bbw); st.action_frame_start = f0; st.action_frame_end = f1
    st.frame_start = 1; st.frame_end = f1 - f0 + 1
    meta[name] = {'label': label, 'src': f'BadBadWater_VMD {t0}-{t1}s', 'face': face}
    print('BBW', name, f0, f1, flush=True)

# ---------- earlier toon rig: retarget
with bpy.data.libraries.load(TOON) as (src, dst):
    dst.objects = ['Character_Rig']; dst.actions = [m for m, _, _ in TOON_MOVES.values()]
old = dst.objects[0]; scene.collection.objects.link(old)
MAP = {'Hips': 'Hips', 'Spine': 'Spine', 'Chest': 'Chest', 'Neck': 'Neck', 'Head': 'Head'}
for s in ('L', 'R'):
    MAP.update({f'Clavicle.{s}': f'Shoulder.{s}', f'UpperArm.{s}': f'UpperArm.{s}', f'Forearm.{s}': f'LowerArm.{s}', f'Hand.{s}': f'Hand.{s}',
                f'Thigh.{s}': f'UpperLeg.{s}', f'Shin.{s}': f'LowerLeg.{s}', f'Foot.{s}': f'Foot.{s}'})
TB = arm.data.bones; SB = old.data.bones
ORDER = [b.name for b in TB]
REST = {b.name: b.matrix_local.copy() for b in TB}
REL = {b.name: (REST[b.parent.name].inverted() @ REST[b.name]) if b.parent else REST[b.name] for b in TB}
omw = old.matrix_world
A = {s: (omw.to_3x3() @ SB[s].matrix_local.to_3x3()).normalized() for s in MAP if s in SB}
R = {}
for s, t in MAP.items():
    if s not in SB: continue
    if not any(k in s for k in ('Clavicle', 'Arm', 'Hand', 'Foot')): R[s] = Matrix.Identity(3); continue
    ds = (omw.to_3x3() @ (SB[s].tail_local - SB[s].head_local)).normalized(); dt = (TB[t].tail_local - TB[t].head_local).normalized()
    R[s] = dt.rotation_difference(ds).to_matrix()
hip0 = (omw @ SB['Hips'].head_local); k = (TB['Hips'].head_local.z - TB['Foot.L'].head_local.z) / max(1e-6, (omw @ SB['Hips'].head_local).z - (omw @ SB['Foot.L'].head_local).z)
inv = {v: s for s, v in MAP.items() if s in A}
for name, (act_name, label, (eye, mouth)) in TOON_MOVES.items():
    src_act = bpy.data.actions[act_name]
    old.animation_data_create(); old.animation_data.action = src_act
    F = list(range(int(src_act.frame_range[0]), int(src_act.frame_range[1]) + 1))
    S = {s: [] for s in A}; hips = []
    for f in F:
        scene.frame_set(f)
        for s in A: S[s].append((omw @ old.pose.bones[s].matrix).to_3x3().normalized())
        hips.append(omw @ old.pose.bones['Hips'].head)
    act = bpy.data.actions.new(name); act.use_fake_user = True
    ad.action = act
    keys = {}
    for i, f in enumerate(F):
        M = {}
        for b in ORDER:
            bone = TB[b]; Mb = (M[bone.parent.name] @ REL[b]) if bone.parent else REST[b].copy()
            s = inv.get(b)
            if s is not None:
                rot = S[s][i] @ A[s].inverted() @ R[s] @ REST[b].to_3x3()
                loc = Mb.translation.copy()
                if b == 'Hips':
                    d = (hips[i] - hips[0]) * k; loc = REST[b].translation + Vector((0, 0, d.z))   # in place, keep the bob (relative to the first frame)
                Mb = Matrix.Translation(loc) @ rot.to_4x4()
                basis = (M[bone.parent.name] @ REL[b]).inverted() @ Mb
                q = basis.to_quaternion(); prev = keys[b][-1][0] if keys.get(b) else None
                if prev is not None and q.dot(prev) < 0: q.negate()
                keys.setdefault(b, []).append((q, basis.translation.copy()))
            M[b] = Mb
    tt = np.arange(1, len(F) + 1, dtype=np.float32)
    for b, ks in keys.items():
        chans = [('rotation_quaternion', j, [q[j] for q, _ in ks]) for j in range(4)]
        if b == 'Hips': chans += [('location', j, [l[j] for _, l in ks]) for j in range(3)]
        for prop, idx, vals in chans:
            fc = act.fcurve_ensure_for_datablock(arm, f'pose.bones["{b}"].{prop}', index=idx)
            fc.keyframe_points.add(len(vals)); co = np.empty(len(vals) * 2, np.float32); co[0::2] = tt; co[1::2] = vals
            fc.keyframe_points.foreach_set('co', co); fc.update()
    ad.action = None
    tr = ad.nla_tracks.new(); tr.name = name; st = tr.strips.new(name, 1, act); st.action_frame_end = len(F)
    meta[name] = {'label': label, 'src': f'character-01a0c1da-toon.blend {act_name}', 'face_fixed': [eye, eye, mouth, 0, 0, 0, 0, 1]}
    print('TOON', name, len(F), flush=True)
bpy.data.objects.remove(old, do_unlink=True)

scene.frame_start = 1; scene.frame_end = 400
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_optimize_animation_size=True, export_skins=True, export_morph=False, export_def_bones=False,
    export_materials='NONE', export_cameras=False, export_lights=False, export_yup=True, export_extras=False)
json.dump(meta, open(META, 'w'), ensure_ascii=False)
print('EXPORTED', OUT, list(meta))
