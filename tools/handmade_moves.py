# hand-made anime-girl locomotion for the v2c Character_Rig (original keyframes, CC0 for this project)
#   blender -b LetMeGo-dschan_v2c.blend --python handmade_moves.py -- <out.glb> <out_meta.json>
# Poses are authored as rotations about the rig's world axes (she faces -Y, her left is +X, up is +Z) relative to the
# parent, composed down the chain; the body is then grounded every frame (lowest ankle back to its rest height) unless
# the clip is airborne. Style: knock-kneed stance, small bouncy steps, penguin hands, elbows-out run, "yatta!" jump.
import bpy, sys, json, math, numpy as np
from mathutils import Matrix, Vector

a = sys.argv[sys.argv.index('--') + 1:]
OUT, META = a[0], a[1]
scene = bpy.context.scene
arm = bpy.data.objects['Character_Rig']
for o in list(bpy.data.objects):
    if o != arm: bpy.data.objects.remove(o, do_unlink=True)
ad = arm.animation_data_create(); ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
TB = arm.data.bones
ORDER = [b.name for b in TB]
REST = {b.name: b.matrix_local.copy() for b in TB}
REL = {b.name: (REST[b.parent.name].inverted() @ REST[b.name]) if b.parent else REST[b.name] for b in TB}
ANKLE = TB['Foot.L'].head_local.z

D = math.radians
def rx(d): return Matrix.Rotation(D(d), 3, 'X')    # + leans a vertical bone forward; - swings a hanging limb forward
def ry(d): return Matrix.Rotation(D(d), 3, 'Y')    # + tips the top toward her left (+X)
def rz(d): return Matrix.Rotation(D(d), 3, 'Z')    # + turns her toward her left
I3 = Matrix.Identity(3)
def S(x): return math.sin(x)
def C(x): return math.cos(x)
def pos(x): return max(0.0, x)

def base(p, t):
    """shared cute details: slightly knock-kneed legs, relaxed fingers-in arms"""
    p['UpperLeg.L'] = p.get('UpperLeg.L', I3) @ ry(3); p['UpperLeg.R'] = p.get('UpperLeg.R', I3) @ ry(-3)
    p['LowerLeg.L'] = p.get('LowerLeg.L', I3) @ ry(-4); p['LowerLeg.R'] = p.get('LowerLeg.R', I3) @ ry(4)
    return p

def legs(p, thL, thR, kL, kR, footL=0, footR=0):
    p['UpperLeg.L'] = rx(-thL); p['UpperLeg.R'] = rx(-thR)
    p['LowerLeg.L'] = rx(kL); p['LowerLeg.R'] = rx(kR)
    p['Foot.L'] = rx(footL); p['Foot.R'] = rx(footR)

def arms(p, swL, swR, outL, outR, elL, elR, wristOutL=0, wristOutR=0, inL=0, inR=0):
    # the rest pose is an A-pose (arms ~55 deg out): out < 0 brings the upper arm in toward the body;
    # the forearm first bends at the elbow (pitch) and then turns in toward her centre (in > 0)
    p['UpperArm.L'] = rx(-swL) @ ry(-outL); p['UpperArm.R'] = rx(-swR) @ ry(outR)
    p['LowerArm.L'] = rz(-inL) @ rx(-elL); p['LowerArm.R'] = rz(inR) @ rx(-elR)
    p['Hand.L'] = ry(-wristOutL); p['Hand.R'] = ry(wristOutR)

def idle(f, n):
    ph = 2 * math.pi * f / n; p = {}; off = Vector((0.018 * S(ph), 0, 0))
    p['Hips'] = ry(2.5 * S(ph)) @ rz(2 * S(ph))
    p['Spine'] = ry(-2.5 * S(ph)) @ rx(-1.0 + 1.2 * S(2 * ph))
    p['Chest'] = ry(-1.0 * S(ph)) @ rx(1.0 * S(2 * ph + 0.5))
    p['Head'] = ry(7 * S(ph + 0.8)) @ rx(3 + 2 * S(2 * ph + 1.2))
    wL, wR = pos(S(ph)), pos(-S(ph))
    legs(p, 2 + 3 * wR, 2 + 3 * wL, 4 + 10 * wR, 4 + 10 * wL, -3 - 5 * wR, -3 - 5 * wL)
    # hands together in front of the skirt
    arms(p, 14, 14, -34, -34, 72 + 3 * S(ph), 72 - 3 * S(ph), 6, 6, 38, 38)
    return base(p, f), off, True

def walk(f, n):                      # n frames = one stride (two steps)
    ph = 2 * math.pi * f / n; p = {}
    th = 24 * S(ph); kL = 8 + 42 * pos(C(ph - 0.35)) ** 1.4; kR = 8 + 42 * pos(C(ph + math.pi - 0.35)) ** 1.4
    legs(p, th + 4, -th + 4, kL, kR, -0.6 * th - 0.4 * kL + 6, 0.6 * th - 0.4 * kR + 6)
    p['Hips'] = ry(3.5 * S(ph)) @ rz(6 * S(ph)) @ rx(2)
    p['Spine'] = rz(-5 * S(ph)) @ ry(-2 * S(ph)) @ rx(3)
    p['Chest'] = rz(-2 * S(ph))
    p['Head'] = rz(2 * S(ph)) @ ry(4 * S(ph + 0.5)) @ rx(-2 + 2.5 * C(2 * ph))
    # small arm swing, elbows soft, penguin hands flared out
    arms(p, -12 * S(ph) + 4, 12 * S(ph) + 4, -14, -14, 30 + 8 * S(ph), 30 - 8 * S(ph), 30, 30, 10, 10)
    off = Vector((0.012 * S(ph), 0, 0.022 * C(2 * ph)))
    return base(p, f), off, True

def run(f, n):
    ph = 2 * math.pi * f / n; p = {}
    th = 34 * S(ph); kL = 20 + 80 * pos(C(ph - 0.5)) ** 1.2; kR = 20 + 80 * pos(C(ph + math.pi - 0.5)) ** 1.2
    legs(p, th + 10, -th + 10, kL, kR, -0.5 * th - 0.35 * kL + 10, 0.5 * th - 0.35 * kR + 10)
    p['Hips'] = rx(9) @ rz(7 * S(ph)) @ ry(3 * S(ph))
    p['Spine'] = rx(4) @ rz(-6 * S(ph))
    p['Chest'] = rz(-3 * S(ph))
    p['Head'] = rx(-8) @ ry(3 * S(ph + 0.4))
    # girly run: elbows out, forearms swinging across, hands flapping
    arms(p, -26 * S(ph) + 6, 26 * S(ph) + 6, -18, -18, 90 + 10 * S(ph), 90 - 10 * S(ph), 30 + 12 * S(2 * ph), 30 - 12 * S(2 * ph), 28, 28)
    off = Vector((0, 0, 0.035 * C(2 * ph)))
    return base(p, f), off, True

def jump_start(f, n):
    k = math.sin(0.5 * math.pi * min(1, f / max(1, n - 1)))
    p = {}; legs(p, 38 * k, 38 * k, 70 * k, 70 * k, -26 * k, -26 * k)
    p['Hips'] = rx(16 * k); p['Spine'] = rx(8 * k); p['Head'] = rx(-10 * k)
    arms(p, -30 * k, -30 * k, 8, 8, 25, 25, 15, 15)
    return base(p, f), Vector((0, 0, 0)), True

def jump_air(f, n):
    ph = 2 * math.pi * f / n; p = {}
    legs(p, 8, -12, 95, 70, 30, 25)                       # calves tucked back
    p['Hips'] = rx(-6); p['Spine'] = rx(-4); p['Chest'] = rx(-4)
    p['Head'] = rx(-12) @ ry(6 * S(ph))
    up = 115 + 6 * S(ph)
    arms(p, 20, 20, up, up, 25, 25, 10, 10)                # "yatta!" arms up and out
    return base(p, f), Vector((0, 0, 0)), False

def jump_land(f, n):
    k = 1 - f / max(1, n - 1); k = k * k
    p = {}; legs(p, 30 * k, 30 * k, 60 * k, 60 * k, -22 * k, -22 * k)
    p['Hips'] = rx(12 * k); p['Spine'] = rx(6 * k)
    arms(p, 10 * k, 10 * k, 30 * k, 30 * k, 30 * k + 10, 30 * k + 10, 15, 15)
    return base(p, f), Vector((0, 0, 0)), True

def crouch(f, n):
    ph = 2 * math.pi * f / n; p = {}
    legs(p, 105, 105, 145, 145, -40, -40)
    p['UpperLeg.L'] = p['UpperLeg.L'] @ ry(10); p['UpperLeg.R'] = p['UpperLeg.R'] @ ry(-10)   # knees a little apart
    p['Hips'] = rx(18) @ ry(2 * S(ph)); p['Spine'] = rx(12); p['Chest'] = rx(6)
    p['Head'] = rx(-14) @ ry(8 * S(ph + 0.7))
    arms(p, 48, 48, -6, -6, 38, 38, 0, 0)                    # hands resting on the knees
    return p, Vector((0, 0, 0)), True

def crouch_fwd(f, n):
    ph = 2 * math.pi * f / n; p = {}
    th = 14 * S(ph)
    legs(p, 98 + th, 98 - th, 138 - 10 * pos(C(ph)), 138 - 10 * pos(-C(ph)), -38, -38)
    p['Hips'] = rx(18) @ ry(5 * S(ph)) @ rz(6 * S(ph)); p['Spine'] = rx(10) @ ry(-3 * S(ph))
    p['Head'] = rx(-12) @ ry(-4 * S(ph))
    arms(p, 40, 40, 4, 4, 45, 45, 0, 0)
    return p, Vector((0.02 * S(ph), 0, 0.012 * C(2 * ph))), True

def cheer(f, n):                      # emote: bouncy "yay!" with alternating waving arms
    ph = 2 * math.pi * f / (n / 3); p = {}
    b = pos(S(ph))
    legs(p, 6 * b, 6 * b, 14 * b, 14 * b, -8 * b, -8 * b)
    p['Hips'] = ry(4 * S(ph / 2)); p['Spine'] = ry(-4 * S(ph / 2)); p['Head'] = ry(10 * S(ph / 2)) @ rx(-6)
    arms(p, 25, 25, 120 + 25 * S(ph), 120 - 25 * S(ph), 30 + 20 * S(ph), 30 - 20 * S(ph), 15, 15)
    return base(p, f), Vector((0, 0, 0.03 * b)), True

CLIPS = {  # name: (fn, frames, speed m/s forward, loop)
    'idle': (idle, 120, 0.0), 'walk': (walk, 30, 1.0), 'run': (run, 20, 3.0),
    'jump_start': (jump_start, 7, 0.0), 'jump_air': (jump_air, 40, 0.0), 'jump_land': (jump_land, 12, 0.0),
    'crouch': (crouch, 90, 0.0), 'crouch_fwd': (crouch_fwd, 36, 0.7), 'emote_cheer': (cheer, 90, 0.0),
}

meta = {}
for name, (fn, n, speed) in CLIPS.items():
    act = bpy.data.actions.new(name); act.use_fake_user = True
    ad.action = act
    keys = {}
    nf = n + 1 if name not in ('jump_start', 'jump_land') else n   # loops end on the first pose again
    for i in range(nf):
        rel, off, grounded = fn(i % n if nf > n else i, n)
        Dw = {}; M = {}
        for b in ORDER:
            bone = TB[b]; par = bone.parent.name if bone.parent else None
            Dw[b] = (Dw[par] if par else I3) @ rel.get(b, I3)
            Mb = (M[par] @ REL[b]) if par else REST[b].copy()
            rot = Dw[b] @ REST[b].to_3x3()
            loc = Mb.translation.copy()
            if b == 'Hips': loc = REST[b].translation + off
            M[b] = Matrix.Translation(loc) @ rot.to_4x4()
        dz = 0.0
        if grounded: dz = ANKLE - min(M['Foot.L'].translation.z, M['Foot.R'].translation.z)
        # re-solve the chain with the grounded hips so the local bases stay consistent
        Mf = {}
        for b in ORDER:
            bone = TB[b]; par = bone.parent.name if bone.parent else None
            Mb = (Mf[par] @ REL[b]) if par else REST[b].copy()
            rot = Dw[b] @ REST[b].to_3x3()
            loc = Mb.translation.copy()
            if b == 'Hips': loc = REST[b].translation + off + Vector((0, 0, dz))
            Mf[b] = Matrix.Translation(loc) @ rot.to_4x4()
            if b in rel or b == 'Hips' or b in ('UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L', 'LowerLeg.R'):
                basis = ((Mf[par] @ REL[b]).inverted() if par else REST[b].inverted()) @ Mf[b]
                q = basis.to_quaternion(); prev = keys[b][-1][0] if keys.get(b) else None
                if prev is not None and q.dot(prev) < 0: q.negate()
                keys.setdefault(b, []).append((q, basis.translation.copy()))
    tt = np.arange(1, nf + 1, dtype=np.float32)
    for b, ks in keys.items():
        if len(ks) != nf: continue
        chans = [('rotation_quaternion', j, [q[j] for q, _ in ks]) for j in range(4)]
        if b == 'Hips': chans += [('location', j, [l[j] for _, l in ks]) for j in range(3)]
        for prop, idx, vals in chans:
            fc = act.fcurve_ensure_for_datablock(arm, f'pose.bones["{b}"].{prop}', index=idx)
            fc.keyframe_points.add(len(vals)); co = np.empty(len(vals) * 2, np.float32); co[0::2] = tt; co[1::2] = vals
            fc.keyframe_points.foreach_set('co', co); fc.update()
    ad.action = None
    tr = ad.nla_tracks.new(); tr.name = name; st = tr.strips.new(name, 1, act); st.action_frame_end = nf
    meta[name] = {'src': 'handmade (handmade_moves.py)', 'frames': nf, 'fps': 30, 'duration': round((nf - 1) / 30, 4), 'speed': [0.0, speed]}
    print('CLIP', name, meta[name], flush=True)

scene.render.fps = 30; scene.render.fps_base = 1.0; scene.frame_start = 1; scene.frame_end = 200
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_optimize_animation_size=True, export_skins=True, export_morph=False, export_def_bones=False,
    export_materials='NONE', export_cameras=False, export_lights=False, export_yup=True, export_extras=False)
json.dump(meta, open(META, 'w'), ensure_ascii=False, indent=1)
print('EXPORTED', OUT, list(meta))
