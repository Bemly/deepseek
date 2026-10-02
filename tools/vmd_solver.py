import bpy, numpy as np, sys, math, struct, time
from mathutils import Quaternion, Vector, Matrix
argv=sys.argv[sys.argv.index('--')+1:]
VMD=argv[0]; OUT=argv[1]; FMAX=int(argv[2]) if len(argv)>2 else -1
SCALE=0.085; ARM_A=math.radians(40)
t0=time.time()
# ---------- VMD parse
d=open(VMD,'rb').read(); o=50
n=struct.unpack_from('<I',d,o)[0]; o+=4
dt=np.dtype([('name','S15'),('frame','<u4'),('pos','<f4',3),('rot','<f4',4),('interp','u1',64)])
B=np.frombuffer(d,dtype=dt,count=n,offset=o)
names=np.array([x.split(b'\0')[0].decode('shift_jis','replace') for x in B['name']])
NF=int(B['frame'].max())+1 if FMAX<0 else FMAX
frames=np.arange(NF)
def track(nm):
    m=names==nm
    if not m.any(): return np.tile([1,0,0,0],(NF,1)).astype(float),np.zeros((NF,3))
    f=B['frame'][m].astype(float); o_=np.argsort(f,kind='stable'); f=f[o_]
    q=B['rot'][m][o_].astype(float); p=B['pos'][m][o_].astype(float)
    # MMD (x,y,z,w) left-handed -> Blender (w,-x,-z,-y); pos (x,z,y)
    qb=np.stack([q[:,3],-q[:,0],-q[:,2],-q[:,1]],1); pb=np.stack([p[:,0],p[:,2],p[:,1]],1)
    # dedupe frames
    f,ui=np.unique(f,return_index=True); qb=qb[ui]; pb=pb[ui]
    for i in range(1,len(qb)):
        if (qb[i]*qb[i-1]).sum()<0: qb[i]=-qb[i]
    idx=np.clip(np.searchsorted(f,frames,side='right')-1,0,len(f)-1); nx=np.clip(idx+1,0,len(f)-1)
    span=np.maximum(f[nx]-f[idx],1e-9); t=np.clip((frames-f[idx])/span,0,1)[:,None]; t[nx==idx]=0
    Q=qb[idx]*(1-t)+qb[nx]*t; Q/=np.linalg.norm(Q,axis=1,keepdims=True)
    P=pb[idx]*(1-t)+pb[nx]*t
    return Q,P
def qmul(a,b):
    w1,x1,y1,z1=a.T; w2,x2,y2,z2=b.T
    return np.stack([w1*w2-x1*x2-y1*y2-z1*z2, w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2],1)
def qinv(a): return a*np.array([1,-1,-1,-1])
def qrot(q,v):
    qv=np.concatenate([np.zeros((len(v),1)),v],1); return qmul(qmul(q,qv),qinv(q))[:,1:]
def qconst(qq): return np.tile(np.array([qq.w,qq.x,qq.y,qq.z]),(NF,1))
Q={};P={}
def get(nm):
    if nm not in Q: Q[nm],P[nm]=track(nm)
    return Q[nm]
G={}
G['center']=get('センター')
G['lower']=qmul(qmul(G['center'],get('腰')),get('下半身'))
G['upper']=qmul(qmul(G['center'],get('腰')),get('上半身'))
G['upper2']=qmul(G['upper'],get('上半身2'))
G['neck']=qmul(G['upper2'],get('首')); G['head']=qmul(G['neck'],get('頭'))
fing={'Thumb':['親指０','親指１','親指２'],'Index':['人指１','人指２','人指３'],'Middle':['中指１','中指２','中指３'],'Ring':['薬指１','薬指２','薬指３'],'Little':['小指１','小指２','小指３']}
for sd,jp in (('L','左'),('R','右')):
    G['sh'+sd]=qmul(qmul(G['upper2'],get(jp+'肩P')),get(jp+'肩'))
    G['arm'+sd]=qmul(qmul(G['sh'+sd],get(jp+'肩C')),get(jp+'腕'))
    G['elb'+sd]=qmul(qmul(qmul(G['arm'+sd],get(jp+'腕捩')),get(jp+'ひじ')),get(jp+'ひじ+'))
    G['wr'+sd]=qmul(qmul(G['elb'+sd],get(jp+'手捩')),get(jp+'手首'))
    for f,js in fing.items():
        g=G['wr'+sd]
        for i,j in enumerate(js):
            g=qmul(g,get(jp+j)); G[f'{f}{i+1}.{sd}']=g
    G['ik'+sd]=get(jp+'足ＩＫ'); P['ik'+sd]=P[jp+'足ＩＫ']
cpos=P['センター']
print('parsed',time.time()-t0,flush=True)
# ---------- our rig rest
ao=bpy.data.objects['Character_Rig']; arm=ao.data
rest={b.name:b.matrix_local.copy() for b in arm.bones}
def rq(nm): return rest[nm].to_quaternion()
def rdir(nm): b=arm.bones[nm]; return (b.tail_local-b.head_local).normalized()
def frame_q(y,z):
    y=Vector(y).normalized(); z=Vector(z); z=(z-z.dot(y)*y).normalized(); x=y.cross(z)
    return Matrix((x,y,z)).transposed().to_quaternion()
C={}
for sd,sg in (('L',1),('R',-1)):
    adir=Vector((sg*math.cos(ARM_A),0,-math.sin(ARM_A)))
    C['Shoulder.'+sd]=rdir('Shoulder.'+sd).rotation_difference(Vector((sg,0,-0.15)).normalized())
    C['UpperArm.'+sd]=rdir('UpperArm.'+sd).rotation_difference(adir)
    C['LowerArm.'+sd]=rdir('LowerArm.'+sd).rotation_difference(adir)
    hdors=rest['Hand.'+sd].to_3x3().col[2]
    mdors=Vector((0,0,1))
    Fo=frame_q(rdir('Hand.'+sd),hdors); Fm=frame_q(adir,mdors)
    C['Hand.'+sd]=Fm@Fo.inverted()
    for f in fing:
        for i in (1,2,3):
            bn=f'{f}{i}.{sd}'; zo=rest[bn].to_3x3().col[2]
            if f=='Thumb': md=(adir+Vector((0,-1.1,0))).normalized(); mz=(mdors+Vector((0,-0.8,0)))
            else: md=adir; mz=mdors
            C[bn]=frame_q(md,mz)@frame_q(rdir(bn),zo).inverted()
# mapping our bone -> MMD global key
SRC={'Hips':'lower','Spine':'upper','Chest':'upper2','UpperChest':'upper2','Neck':'neck','Head':'head'}
for sd in 'LR':
    SRC.update({'Shoulder.'+sd:'sh'+sd,'UpperArm.'+sd:'arm'+sd,'LowerArm.'+sd:'elb'+sd,'Hand.'+sd:'wr'+sd})
    for f in fing:
        for i in (1,2,3): SRC[f'{f}{i}.{sd}']=f'{f}{i}.{sd}'
delta={}
order=[b.name for b in arm.bones]  # parents come before children in Blender's bone list? ensure by depth sort
order.sort(key=lambda n: len(arm.bones[n].parent_recursive))
ident=np.tile([1.0,0,0,0],(NF,1))
for nm in order:
    b=arm.bones[nm]
    if nm in SRC:
        c=C.get(nm,Quaternion()); delta[nm]=qmul(G[SRC[nm]],qconst(c))
    else:
        delta[nm]=delta[b.parent.name] if b.parent else ident
# ---------- hips translation & leg IK
hips_t=cpos*SCALE
def v3(v): return np.array(v[:3],float)
hips_head=v3(arm.bones['Hips'].head_local)
for sd in 'LR':
    hip0=v3(arm.bones['UpperLeg.'+sd].head_local); knee0=v3(arm.bones['LowerLeg.'+sd].head_local)
    ank0=v3(arm.bones['Foot.'+sd].head_local)
    L1=np.linalg.norm(knee0-hip0); L2=np.linalg.norm(ank0-knee0)
    hip=hips_head+hips_t+qrot(delta['Hips'],np.tile(hip0-hips_head,(NF,1)))
    tgt=ank0+P['ik'+sd]*SCALE
    dv=tgt-hip; dist=np.linalg.norm(dv,axis=1); Lt=(L1+L2); soft=0.06; da=Lt*(1-soft)
    dist_c=np.where(dist>da, da+soft*Lt*(1-np.exp(-(dist-da)/(soft*Lt))), dist); dist_c=np.minimum(dist_c,Lt*0.9995)
    u=dv/dist[:,None]; tgt_c=hip+u*dist_c[:,None]
    fwd=qrot(G['ik'+sd],np.tile([0,-1.0,0],(NF,1)))+qrot(delta['Hips'],np.tile([0,-1.0,0],(NF,1)))
    pole=fwd-(fwd*u).sum(1,keepdims=True)*u; pole/=np.linalg.norm(pole,axis=1,keepdims=True)+1e-9
    cosA=np.clip((L1**2+dist_c**2-L2**2)/(2*L1*dist_c),-1,1); A=np.arccos(cosA)
    knee=hip+u*(L1*cosA)[:,None]+pole*(L1*np.sin(A))[:,None]
    # rest frames: dir + side normal (cross with forward)
    def fr(dirs,poles):
        y=dirs/np.linalg.norm(dirs,axis=1,keepdims=True); z=poles-(poles*y).sum(1,keepdims=True)*y; z/=np.linalg.norm(z,axis=1,keepdims=True)+1e-9
        x=np.cross(y,z); M=np.stack([x,y,z],2)
        return np.array([Matrix(m.tolist()).to_quaternion()[:] for m in M])
    rest_fwd=np.array([[0,-1.0,0]])
    th_rest=fr((knee0-hip0)[None],rest_fwd); sh_rest=fr((ank0-knee0)[None],rest_fwd)
    th_now=fr(knee-hip,pole); sh_now=fr(tgt_c-knee,pole)
    delta['UpperLeg.'+sd]=qmul(th_now,qinv(np.tile(th_rest,(NF,1))))
    delta['LowerLeg.'+sd]=qmul(sh_now,qinv(np.tile(sh_rest,(NF,1))))
    delta['Foot.'+sd]=G['ik'+sd]
    delta['Toes.'+sd]=delta['Foot.'+sd]
# children of changed bones that follow parents (tail, skirt, hair etc.) already set from parents computed earlier -> recompute following bones after legs
for nm in order:
    b=arm.bones[nm]
    if nm not in SRC and not nm.startswith(('UpperLeg','LowerLeg','Foot','Toes')) and b.parent:
        delta[nm]=delta[b.parent.name]
print('solved',time.time()-t0,flush=True)
def slerp_arr(a,b,t):
    b=np.where(((a*b).sum(1)<0)[:,None],-b,b); r=a*(1-t)+b*t; return r/np.linalg.norm(r,axis=1,keepdims=True)
def lag(q,alpha):
    out=q.copy()
    for i in range(1,len(q)):
        a=out[i-1]; b=q[i]
        if (a*b).sum()<0: b=-b
        r=a*(1-alpha)+b*alpha; out[i]=r/np.linalg.norm(r)
    return out
def qavg(a,b):
    b=np.where(((a*b).sum(1)<0)[:,None],-b,b); r=a+b; return r/np.linalg.norm(r,axis=1,keepdims=True)
SEC=set()
chains={}
for b in arm.bones:
    base=b.name.rsplit('.',1)[0] if b.name[-1].isdigit() else None
for nm in order:
    if nm.startswith(('HairBack','HairSide')):
        k=int(nm.rsplit('.',1)[1]); w=min(0.45+0.12*(k-1),0.8)
        tgt=slerp_arr(delta['Head'],delta['UpperChest'],w); delta[nm]=lag(tgt,0.30-0.04*(k-1)); SEC.add(nm)
    elif nm.startswith('HairFront'):
        k=int(nm.rsplit('.',1)[1]); tgt=slerp_arr(delta['Head'],delta['UpperChest'],0.25+0.15*(k-1)); delta[nm]=lag(tgt,0.4); SEC.add(nm)
    elif nm.startswith(('Ahoge','Ear')):
        k=int(nm.rsplit('.',1)[1]); delta[nm]=lag(delta['Head'],0.55 if k==1 else 0.4); SEC.add(nm)
    elif nm.startswith('Tail'):
        k=int(nm[4:]); delta[nm]=lag(delta['Hips'],max(0.45-0.06*(k-1),0.15)); SEC.add(nm)
legavg=qavg(delta['UpperLeg.L'],delta['UpperLeg.R'])
SKW={'F':(legavg,0.45),'FL':(delta['UpperLeg.L'],0.45),'FR':(delta['UpperLeg.R'],0.45),'L':(delta['UpperLeg.L'],0.3),'R':(delta['UpperLeg.R'],0.3),
     'BL':(delta['UpperLeg.L'],0.15),'BR':(delta['UpperLeg.R'],0.15),'B':(legavg,0.1)}
for nm in order:
    if nm.startswith('Skirt_'):
        side=nm[6:].split('.')[0]; k=int(nm.rsplit('.',1)[1]); lq,w=SKW[side]
        tgt=slerp_arr(delta['Hips'],lq,w*(1.0 if k==1 else 1.15)); delta[nm]=lag(tgt,0.5 if k==1 else 0.4); SEC.add(nm)
print('secondary',len(SEC),time.time()-t0,flush=True)
# ---------- local quats & write action
act=bpy.data.actions.new('BadBadWater_VMD'); act.use_fake_user=True
ao.animation_data_create(); ao.animation_data.action=act
slot=ao.animation_data.action_slot
if slot is None:
    slot=act.slots.new(id_type='OBJECT',name=ao.name); ao.animation_data.action_slot=slot
layer=act.layers.new('Layer') if len(act.layers)==0 else act.layers[0]
strip=layer.strips.new(type='KEYFRAME') if len(layer.strips)==0 else layer.strips[0]
cb=strip.channelbag(slot,ensure=True)
fr_=np.arange(NF,dtype=np.float32)+1
def write(path,idx,vals,group):
    fc=cb.fcurves.new(path,index=idx); fc.keyframe_points.add(NF)
    co=np.empty(NF*2,np.float32); co[0::2]=fr_; co[1::2]=vals
    fc.keyframe_points.foreach_set('co',co); fc.keyframe_points.foreach_set('interpolation',np.ones(NF,np.int32)); fc.update()
for pb in ao.pose.bones: pb.rotation_mode='QUATERNION'
nb=0
for nm in order:
    b=arm.bones[nm]
    if not (nm in SRC or nm in SEC or nm.startswith(('UpperLeg','LowerLeg','Foot'))): continue
    R=np.tile(np.array(rq(nm)[:]),(NF,1))
    dp=delta[b.parent.name] if b.parent else ident
    ql=qmul(qmul(qinv(R),qmul(qinv(dp),delta[nm])),R)
    for i in range(1,NF):
        pass
    sgn=np.sign(ql[:,0:1]); sgn[sgn==0]=1; ql*=sgn
    for k in range(4): write(f'pose.bones["{nm}"].rotation_quaternion',k,ql[:,k].astype(np.float32),nm)
    nb+=1
# hips location (local frame of Hips rest)
Rh=rest['Hips'].to_3x3().inverted()
loc=np.array([Rh@Vector(v) for v in hips_t])
for k in range(3): write('pose.bones["Hips"].location',k,loc[:,k].astype(np.float32),'Hips')
sc=bpy.context.scene; sc.frame_start=1; sc.frame_end=NF; sc.render.fps=30
print('written bones',nb,'frames',NF,time.time()-t0,flush=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('SAVED',OUT)
