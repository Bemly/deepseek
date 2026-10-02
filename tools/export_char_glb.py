# export the v2c character (Character_FullDetail + Character_Rig) for the web player, no animation, no textures
#   blender -b LetMeGo-dschan_v2c.blend --python export_char_glb.py -- <out.glb>
# The TOON material is ported to three.js (src/character-material.js), so the mesh carries what it needs:
#   UVMap / HandUV / FaceUV (TEXCOORD_0/1/2), cap_color (COLOR_0), _PART_KIND / _FACE_LAYER (custom attributes),
#   custom split normals. part_kind / face_layer are per-face in Blender -> copied to per-corner floats for glTF.
import bpy, sys, numpy as np
out = sys.argv[sys.argv.index('--') + 1]
arm = bpy.data.objects['Character_Rig']; ob = bpy.data.objects['Character_FullDetail']
for o in list(bpy.data.objects):
    if o not in (arm, ob): bpy.data.objects.remove(o, do_unlink=True)
for m in list(ob.modifiers):
    if m.type != 'ARMATURE': ob.modifiers.remove(m)           # outline is redone in the web (backface shell)
me = ob.data
loop_poly = np.empty(len(me.loops), np.int32)
for p in me.polygons: loop_poly[p.loop_start:p.loop_start + p.loop_total] = p.index
for src, dst in (('part_kind', '_part_kind'), ('face_layer', '_face_layer')):
    a = me.attributes[src]; v = np.empty(len(a.data), np.float32 if a.data_type == 'FLOAT' else np.int32); a.data.foreach_get('value', v)
    c = me.attributes.new(dst, 'FLOAT', 'CORNER'); c.data.foreach_set('value', v[loop_poly].astype(np.float32))
# keep the mesh light: one plain material slot, textures ship separately
mat = bpy.data.materials.new('DS_TOON_WEB'); me.materials.clear(); me.materials.append(mat)
bpy.context.scene.frame_set(1)
arm.data.pose_position = 'REST'
for o in bpy.context.view_layer.objects: o.select_set(o in (arm, ob))
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=False,
    export_skins=True, export_morph=False, export_attributes=True, export_texcoords=True, export_normals=True,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='EXPORT', export_image_format='NONE',
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_draco_position_quantization=16, export_draco_normal_quantization=12, export_draco_texcoord_quantization=14,
    export_draco_color_quantization=8, export_draco_generic_quantization=8, export_yup=True, export_extras=False)
print('EXPORTED', out)
