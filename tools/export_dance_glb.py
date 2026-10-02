# export the v2c dance (Character_Rig action) as an armature-only glTF, sampled every 4 frames (= 30 fps of the 120 fps timeline)
#   blender -b LetMeGo-dschan_v2c.blend --python export_dance_glb.py -- <out.glb>
# Blender's exporter does the Z-up -> Y-up and bone-axis conversion, so three.js plays it with AnimationMixer as-is.
import bpy, sys
out = sys.argv[sys.argv.index('--') + 1]
arm = bpy.data.objects['Character_Rig']
# only the skeleton matters here: drop the 1M-vertex mesh and the scenery so sampling each frame is cheap (file is not saved)
for o in list(bpy.data.objects):
    if o != arm: bpy.data.objects.remove(o, do_unlink=True)
for s in list(bpy.data.scenes):
    if s != bpy.context.scene: bpy.data.scenes.remove(s)
arm.select_set(True); bpy.context.view_layer.objects.active = arm
# the active action is named BadBadWater_VMD for legacy reasons; it is the Let Me Go dance
sc = bpy.context.scene
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=True,
    export_frame_range=True, export_frame_step=4, export_force_sampling=True, export_animation_mode='ACTIVE_ACTIONS',
    export_optimize_animation_size=True, export_skins=True, export_morph=False, export_def_bones=False,
    export_extras=False, export_cameras=False, export_lights=False, export_materials='NONE', export_yup=True)
print('EXPORTED', out, sc.frame_start, sc.frame_end, sc.render.fps)
