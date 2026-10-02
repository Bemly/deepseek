# retarget humanoid BVH clips (Motifect locomotion pack) onto the v2c Character_Rig and export them as one glTF
#   blender -b LetMeGo-dschan_v2c.blend --python retarget_bvh.py -- <bvh_dir> <out.glb> <out_meta.json> [name=file.bvh ...]
# Per bone the target copies the source's world-space rotation *change* from its rest pose; the source T-pose is
# mapped onto the rig's A-pose by a per-bone direction correction. Hips translation is scaled by leg length and the
# horizontal drift is removed (clips play in place); the original travel speed is written to the meta json so the
# player can move her at the speed the feet expect. Each clip becomes one NLA track -> one glTF animation.
import bpy, sys, os, json, re, numpy as np
from mathutils import Matrix, Quaternion, Vector

a = sys.argv[sys.argv.index('--') + 1:]
BVH_DIR, OUT, META = a[0], a[1], a[2]
CLIPS = dict(x.split('=', 1) for x in a[3:])

MAP = {'Hips': 'Hips', 'Spine1': 'Spine', 'Spine2': 'Chest', 'Chest': 'UpperChest', 'Neck1': 'Neck', 'Head': 'Head'}
for s, t in (('Left', 'L'), ('Right', 'R')):
    MAP.update({f'{s}Shoulder': f'Shoulder.{t}', f'{s}Arm': f'UpperArm.{t}', f'{s}ForeArm': f'LowerArm.{t}', f'{s}Hand': f'Hand.{t}',
                f'{s}Leg': f'UpperLeg.{t}', f'{s}Shin': f'LowerLeg.{t}', f'{s}Foot': f'Foot.{t}', f'{s}ToeBase': f'Toes.{t}'})
    for f, g in (('Thumb', 'Thumb'), ('Index', 'Index'), ('Middle', 'Middle'), ('Ring', 'Ring'), ('Pinky', 'Little')):
        for i in (1, 2, 3): MAP[f'{s}Hand{f}{i}'] = f'{g}{i}.{t}'

scene = bpy.context.scene
arm = bpy.data.objects['Character_Rig']
for o in list(bpy.data.objects):
    if o != arm: bpy.data.objects.remove(o, do_unlink=True)
for s in list(bpy.data.scenes):
    if s != scene: bpy.data.scenes.remove(s)
if arm.animation_data: arm.animation_data.action = None; [arm.animation_data.nla_tracks.remove(t) for t in list(arm.animation_data.nla_tracks)]
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
TB = arm.data.bones
ORDER = [b.name for b in TB]  # parents come before children in Blender's bone list
REST = {b.name: b.matrix_local.copy() for b in TB}
REL = {b.name: (REST[b.parent.name].inverted() @ REST[b.name]) if b.parent else REST[b.name] for b in TB}
T_ANKLE = TB['Hips'].head_local.z - TB['Foot.L'].head_local.z      # 0.80 m

meta = {}
def frame_time(path):
    for line in open(path):
        if line.startswith('Frame Time:'): return float(line.split(':')[1])
    return 1 / 30

for name, fn in CLIPS.items():
    path = os.path.join(BVH_DIR, fn); ft = frame_time(path)
    bpy.ops.import_anim.bvh(filepath=path, axis_forward='-Z', axis_up='Y', global_scale=1.0, rotate_mode='NATIVE', update_scene_fps=False, update_scene_duration=False)
    src = bpy.context.object; src.select_set(False)
    fr = [int(x) for x in src.animation_data.action.frame_range]; F = list(range(fr[0], fr[1] + 1))
    SB = src.data.bones
    k = T_ANKLE / (SB['Hips'].head_local.z - SB['LeftFoot'].head_local.z)
    A = {s: SB[s].matrix_local.to_3x3() for s in MAP if s in SB}
    # T-pose -> A-pose: rotate the target rest direction onto the source rest direction (world)
    R = {}
    for s, t in MAP.items():
        if s not in SB: continue
        # torso / head / legs stand upright in both rests (and the BVH importer points Hips/Head tails at an arbitrary
        # child), so only arms, hands, fingers and feet get the T-pose -> A-pose direction correction
        if not re.search(r'Shoulder|Arm|Hand|Foot|Toe', s): R[s] = Matrix.Identity(3); continue
        ds = (SB[s].tail_local - SB[s].head_local).normalized(); dt = (TB[t].tail_local - TB[t].head_local).normalized()
        R[s] = dt.rotation_difference(ds).to_matrix()
    # sample the source world rotations + hips position
    S = {s: [] for s in A}; hips = []; ankle = []
    for f in F:
        scene.frame_set(f)
        mw = src.matrix_world
        for s in A: S[s].append((mw @ src.pose.bones[s].matrix).to_3x3())
        hips.append(mw @ src.pose.bones['Hips'].head)
        ankle.append(min((mw @ src.pose.bones[n].head).z for n in ('LeftFoot', 'RightFoot')))
    hips = np.array([list(h) for h in hips]); t = (np.array(F) - F[0]) * ft
    # remove horizontal drift (in-place), keep the oscillation; travel speed for the player
    vel = [0.0, 0.0]
    for ax in (0, 1):
        c = np.polyfit(t, hips[:, ax], 1); vel[ax] = float(c[0]) * k; hips[:, ax] -= np.polyval(c, t)
    # height: hips above the planted ankle, scaled, on top of her ankle height (the floor stays at z = 0)
    T_ANKLE_H = TB['Foot.L'].head_local.z
    hips[:, 2] = (hips[:, 2] - min(ankle)) * 1.0
    # build the action
    act = bpy.data.actions.new(name); act.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = act
    keys = {}
    for i, f in enumerate(F):
        M = {}
        for b in ORDER:
            bone = TB[b]
            Mb = (M[bone.parent.name] @ REL[b]) if bone.parent else REST[b].copy()
            s = next((x for x, y in MAP.items() if y == b and x in A), None)
            if s is not None:
                rot = S[s][i] @ A[s].inverted() @ R[s] @ REST[b].to_3x3()
                loc = Mb.translation.copy()
                if b == 'Hips': loc = Vector((REST[b].translation.x + hips[i][0] * k, REST[b].translation.y + hips[i][1] * k, T_ANKLE_H + hips[i][2] * k))
                Mb = Matrix.Translation(loc) @ rot.to_4x4()
                basis = (M[bone.parent.name] @ REL[b]).inverted() @ Mb
                q = basis.to_quaternion(); prev = keys.get(b, [None])[-1] if keys.get(b) else None
                if prev is not None and q.dot(prev[0]) < 0: q.negate()
                keys.setdefault(b, []).append((q, basis.translation.copy()))
            M[b] = Mb
    tt = np.array(F, np.float32) - F[0] + 1           # clip frames 1..N at the clip's own rate (time = (f-1)*ft)
    for b, ks in keys.items():
        pb = f'pose.bones["{b}"]'
        chans = [('rotation_quaternion', i, [q[i] for q, _ in ks]) for i in range(4)]
        if b == 'Hips': chans += [('location', i, [l[i] for _, l in ks]) for i in range(3)]
        for prop, idx, vals in chans:
            fc = act.fcurve_ensure_for_datablock(arm, f'{pb}.{prop}', index=idx)
            fc.keyframe_points.add(len(vals)); co = np.empty(len(vals) * 2, np.float32); co[0::2] = tt; co[1::2] = vals
            fc.keyframe_points.foreach_set('co', co); fc.update()
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 1, act); st.action_frame_end = len(F)
    arm.animation_data.action = None
    meta[name] = {'src': fn, 'frames': len(F), 'fps': round(1 / ft, 3), 'duration': round((len(F) - 1) * ft, 4),
                  'speed': [round(vel[0], 4), round(-vel[1], 4)]}   # m/s in the rig frame: x = her left, y = forward (-Y)
    bpy.data.objects.remove(src, do_unlink=True)
    print('CLIP', name, meta[name], flush=True)

scene.render.fps = 30; scene.render.fps_base = 1.0
scene.frame_start = 1; scene.frame_end = max(m['frames'] for m in meta.values())
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_optimize_animation_size=True, export_skins=True, export_morph=False, export_def_bones=False,
    export_materials='NONE', export_cameras=False, export_lights=False, export_yup=True, export_extras=False)
json.dump(meta, open(META, 'w'), ensure_ascii=False, indent=1)
print('EXPORTED', OUT, len(meta), 'clips')
