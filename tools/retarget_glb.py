# retarget clips from a humanoid glTF/FBX animation library (e.g. Quaternius Universal Animation Library, Unreal
# mannequin naming) onto the v2c Character_Rig, one glTF animation per clip.
#   blender -b LetMeGo-dschan_v2c.blend --python retarget_glb.py -- <src.glb|fbx> <out.glb> <out_meta.json> slot=SourceAction ...
# Same method as retarget_bvh.py: per bone the world-space rotation change from the source rest is copied, arms/hands/
# feet get a rest-direction correction (T/A-pose differences), the source is turned to face the rig's -Y, the hips are
# scaled by leg length and kept in place; travel speed goes to the meta json.
import bpy, sys, json, re, math, numpy as np
from mathutils import Matrix, Vector

a = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, META = a[0], a[1], a[2]
CLIPS = dict(x.split('=', 1) for x in a[3:])

MAP = {'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Chest', 'spine_03': 'UpperChest', 'neck_01': 'Neck', 'Head': 'Head'}
for s in ('l', 'r'):
    t = s.upper()
    MAP.update({f'clavicle_{s}': f'Shoulder.{t}', f'upperarm_{s}': f'UpperArm.{t}', f'lowerarm_{s}': f'LowerArm.{t}', f'hand_{s}': f'Hand.{t}',
                f'thigh_{s}': f'UpperLeg.{t}', f'calf_{s}': f'LowerLeg.{t}', f'foot_{s}': f'Foot.{t}', f'ball_{s}': f'Toes.{t}'})
    for f, g in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Little')):
        for i in (1, 2, 3): MAP[f'{f}_0{i}_{s}'] = f'{g}{i}.{t}'

scene = bpy.context.scene
scene.render.fps = 30; scene.render.fps_base = 1.0
arm = bpy.data.objects['Character_Rig']
for o in list(bpy.data.objects):
    if o != arm: bpy.data.objects.remove(o, do_unlink=True)
for s in list(bpy.data.scenes):
    if s != scene: bpy.data.scenes.remove(s)
ad = arm.animation_data_create(); ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
TB = arm.data.bones
ORDER = [b.name for b in TB]
REST = {b.name: b.matrix_local.copy() for b in TB}
REL = {b.name: (REST[b.parent.name].inverted() @ REST[b.name]) if b.parent else REST[b.name] for b in TB}
T_ANKLE = TB['Hips'].head_local.z - TB['Foot.L'].head_local.z
T_ANKLE_H = TB['Foot.L'].head_local.z

before = set(bpy.data.objects)
if SRC.lower().endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=SRC, automatic_bone_orientation=False)
else: bpy.ops.import_scene.gltf(filepath=SRC)
src = next(o for o in bpy.data.objects if o not in before and o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o not in before and o != src: bpy.data.objects.remove(o, do_unlink=True)
src.animation_data_create()
SB = src.data.bones
mw0 = src.matrix_world.copy()
# turn the source so its toes point along the rig's forward (-Y)
src.animation_data.action = None
for pb in src.pose.bones: pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
def wpos(name, rest=True): return mw0 @ (SB[name].head_local if rest else src.pose.bones[name].head)
fwd = (wpos('ball_l') + wpos('ball_r')) / 2 - (wpos('foot_l') + wpos('foot_r')) / 2; fwd.z = 0; fwd.normalize()
TURN = Vector((0, -1, 0)).rotation_difference(fwd).inverted().to_matrix()
REST_W = {s: (mw0.to_3x3() @ SB[s].matrix_local.to_3x3()).normalized() for s in MAP if s in SB}
A = {s: TURN @ REST_W[s] for s in REST_W}
k = T_ANKLE / (wpos('pelvis').z - wpos('foot_l').z)
R = {}
for s, t in MAP.items():
    if s not in A: continue
    if not re.search(r'clavicle|arm|hand|thumb|index|middle|ring|pinky|foot|ball', s): R[s] = Matrix.Identity(3); continue
    ds = (TURN @ (mw0.to_3x3() @ (SB[s].tail_local - SB[s].head_local))).normalized(); dt = (TB[t].tail_local - TB[t].head_local).normalized()
    R[s] = dt.rotation_difference(ds).to_matrix()
inv = {v: s for s, v in MAP.items() if s in A}

meta = {}
for slot, act_name in CLIPS.items():
    act_src = bpy.data.actions[act_name]
    src.animation_data.action = act_src
    if hasattr(src.animation_data, 'action_slot') and act_src.slots: src.animation_data.action_slot = act_src.slots[0]
    f0, f1 = (int(round(x)) for x in act_src.frame_range); F = list(range(f0, f1 + 1))
    S = {s: [] for s in A}; hips = []; ankle = []
    for f in F:
        scene.frame_set(f); mw = src.matrix_world
        for s in A: S[s].append(TURN @ (mw @ src.pose.bones[s].matrix).to_3x3().normalized())
        hips.append(TURN @ (mw @ src.pose.bones['pelvis'].head))
        ankle.append(min((TURN @ (mw @ src.pose.bones[n].head)).z for n in ('foot_l', 'foot_r')))
    hips = np.array([list(h) for h in hips]); t = (np.array(F) - F[0]) / 30.0
    vel = [0.0, 0.0]
    if len(F) > 2:
        for ax in (0, 1):
            c = np.polyfit(t, hips[:, ax], 1); vel[ax] = float(c[0]) * k; hips[:, ax] -= np.polyval(c, t)
    hips[:, 2] -= min(ankle)
    act = bpy.data.actions.new(slot); act.use_fake_user = True
    ad.action = act
    keys = {}
    for i in range(len(F)):
        M = {}
        for b in ORDER:
            bone = TB[b]; Mb = (M[bone.parent.name] @ REL[b]) if bone.parent else REST[b].copy()
            s = inv.get(b)
            if s is not None:
                rot = S[s][i] @ A[s].inverted() @ R[s] @ REST[b].to_3x3()
                loc = Mb.translation.copy()
                if b == 'Hips': loc = Vector((REST[b].translation.x + hips[i][0] * k, REST[b].translation.y + hips[i][1] * k, T_ANKLE_H + hips[i][2] * k))
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
    tr = ad.nla_tracks.new(); tr.name = slot; st = tr.strips.new(slot, 1, act); st.action_frame_end = len(F)
    meta[slot] = {'src': act_name, 'frames': len(F), 'fps': 30, 'duration': round((len(F) - 1) / 30, 4), 'speed': [round(vel[0], 4), round(-vel[1], 4)]}
    print('CLIP', slot, meta[slot], flush=True)

bpy.data.objects.remove(src, do_unlink=True)
scene.frame_start = 1; scene.frame_end = max(m['frames'] for m in meta.values())
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_optimize_animation_size=True, export_skins=True, export_morph=False, export_def_bones=False,
    export_materials='NONE', export_cameras=False, export_lights=False, export_yup=True, export_extras=False)
json.dump(meta, open(META, 'w'), ensure_ascii=False, indent=1)
print('EXPORTED', OUT, list(meta))
