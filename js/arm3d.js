/* =========================================================
   3D 數位孿生機械手臂（Three.js）
   - 可拖曳環繞觀看的擬真工業手臂（J1 底座 / J2 肩 / J3 肘 / J4 腕 + 夾爪）
   - 解析式逆向運動學：底座轉向 + 垂直平面 2 連桿 + 腕部保持垂直
   - 沿用 window.ArmDemo 介面（exec / keyword / say / log），ai.js 不需改
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

(function(){
  "use strict";
  const $=(id)=>document.getElementById(id);

  // ---- 尺寸（公尺）----
  const H=1.0, L1=1.0, L2=0.85, GRIP=0.26;
  const REACH=L1+L2-0.02;
  const BLOCK=0.16, BY=BLOCK/2;          // 積木中心高
  const GRAB_Y=0.14, LIFT_Y=0.62;        // 夾取/抬起時 TCP 高度
  const SPEEDS={ slow:{e:0.05,pct:35}, normal:{e:0.11,pct:70}, fast:{e:0.20,pct:100} };

  // 命名點（世界座標 x,y,z）
  const NAMED={
    center:{x:0.8,y:0.6,z:0,label:"中央"},
    top:{x:0.4,y:1.5,z:0,label:"最高點"},
    supply:{x:1.0,y:0.6,z:0,label:"供料區上方"},
    zonea:{x:0.55,y:0.5,z:-0.95,label:"A 區"},
    zoneb:{x:0.9,y:0.5,z:-0.95,label:"B 區"},
  };
  const ZONE={ A:{x:0.55,z:-0.95,n:0,col:0xe05a4b}, B:{x:0.9,z:-0.95,n:0,col:0x2f6fd1} };

  // ---- 狀態 ----
  const st={
    cur:{y:0.6, s:-0.5, e:1.7, w:-2.77, g:1},   // 目前關節（base yaw, shoulder, elbow, wrist, grip 0~1）
    tgt:{y:0.6, s:-0.5, e:1.7, w:-2.77, g:1},
    holding:null, busy:false, fault:false, estop:false, guard:true,
    speed:"normal", cycles:0
  };

  let scene,camera,renderer,controls,loop=null,built=false;
  let baseGroup,shoulderG,elbowG,wristG,gripG,fingerL,fingerR,tcp;
  let blocks=[];

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function norm(t,c){ while(t-c>Math.PI)t-=2*Math.PI; while(t-c<-Math.PI)t+=2*Math.PI; return t; }

  // ---- 建立 3D 場景 ----
  function build(){
    const host=$("arm3d");
    const w=host.clientWidth||640, h=host.clientHeight||440;
    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x141b29);
    scene.fog=new THREE.Fog(0x141b29, 8, 16);

    camera=new THREE.PerspectiveCamera(45, w/h, 0.1, 100);
    camera.position.set(2.6,2.0,3.0);

    renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setSize(w,h);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    host.appendChild(renderer.domElement);

    // 環境反射貼圖（讓金屬看起來真實）
    const pmrem=new THREE.PMREMGenerator(renderer);
    scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;

    controls=new OrbitControls(camera, renderer.domElement);
    controls.enableDamping=true; controls.dampingFactor=0.08;
    controls.target.set(0.5,0.55,-0.2);
    controls.minDistance=2.2; controls.maxDistance=9;
    controls.maxPolarAngle=Math.PI*0.49;

    // 燈光
    scene.add(new THREE.HemisphereLight(0xc8d8ff,0x1a2030,0.35));
    const dir=new THREE.DirectionalLight(0xffffff,1.6);
    dir.position.set(4,6,3); dir.castShadow=true;
    dir.shadow.mapSize.set(2048,2048);
    dir.shadow.camera.left=-5; dir.shadow.camera.right=5;
    dir.shadow.camera.top=5; dir.shadow.camera.bottom=-5;
    dir.shadow.camera.near=0.5; dir.shadow.camera.far=20; dir.shadow.bias=-0.0004;
    scene.add(dir);
    scene.add(new THREE.DirectionalLight(0x6f8bd0,0.25).translateX(-4).translateZ(-3));

    // 地面（工作台）+ 網格
    const floor=new THREE.Mesh(
      new THREE.PlaneGeometry(40,40),
      new THREE.MeshStandardMaterial({color:0x222a38, roughness:0.55, metalness:0.2})
    );
    floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
    const grid=new THREE.GridHelper(16,32,0x3f5170,0x2f3c52);
    grid.position.y=0.002; scene.add(grid);

    // 區域標記 + 供料台
    addZonePad(ZONE.A.x,ZONE.A.z,0xe05a4b,"A");
    addZonePad(ZONE.B.x,ZONE.B.z,0x2f6fd1,"B");
    const sup=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.04,1.2),
      new THREE.MeshStandardMaterial({color:0x36425a, roughness:0.8}));
    sup.position.set(1.0,0.02,0); sup.receiveShadow=true; scene.add(sup);

    buildArm();
    buildBlocks();

    window.addEventListener("resize",onResize);
    built=true;
  }

  function addZonePad(x,z,col,label){
    const pad=new THREE.Mesh(new THREE.CircleGeometry(0.26,40),
      new THREE.MeshStandardMaterial({color:col, roughness:0.6, transparent:true, opacity:0.55}));
    pad.rotation.x=-Math.PI/2; pad.position.set(x,0.012,z); pad.receiveShadow=true; scene.add(pad);
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.26,0.30,40),
      new THREE.MeshBasicMaterial({color:col, side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2; ring.position.set(x,0.014,z); scene.add(ring);
  }

  function mat(color,metal,rough){ return new THREE.MeshStandardMaterial({color, metalness:metal??0.55, roughness:rough??0.4}); }

  function buildArm(){
    const link=mat(0xe9e7e1,0.55,0.34), joint=mat(0x23262b,0.78,0.34), accent=mat(0x2f6fd1,0.5,0.4), tipM=mat(0x14171c,0.6,0.4);

    // 固定底座（法蘭 + 座體）
    const flange=new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.46,0.06,56), joint);
    flange.position.y=0.03; flange.castShadow=flange.receiveShadow=true; scene.add(flange);
    const baseHousing=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.24,0.16,48), link);
    baseHousing.position.y=0.14; baseHousing.castShadow=true; scene.add(baseHousing);

    // J1 旋轉群（底座偏航，肩部 world Y = H）
    baseGroup=new THREE.Group(); scene.add(baseGroup);
    const j1=cyl(0.19,0.2,0.18,"y",joint); j1.position.y=0.28; baseGroup.add(j1);
    const colLen=H-0.34;
    const col=capsule(0.12,colLen,link); col.position.y=0.34+colLen/2; baseGroup.add(col);

    // 肩 J2
    shoulderG=new THREE.Group(); shoulderG.position.set(0,H,0); baseGroup.add(shoulderG);
    shoulderG.add(cyl(0.14,0.14,0.24,"z",joint));
    const upper=capX(0.09,L1,link); upper.position.x=L1/2; shoulderG.add(upper);

    // 肘 J3
    elbowG=new THREE.Group(); elbowG.position.set(L1,0,0); shoulderG.add(elbowG);
    elbowG.add(cyl(0.12,0.12,0.2,"z",joint));
    const fore=capX(0.075,L2,link); fore.position.x=L2/2; elbowG.add(fore);

    // 腕 J4
    wristG=new THREE.Group(); wristG.position.set(L2,0,0); elbowG.add(wristG);
    wristG.add(cyl(0.09,0.09,0.17,"z",joint));
    const wt=capX(0.06,0.18,link); wt.position.x=0.06; wristG.add(wt);

    // 夾爪（掌 + 兩指，TCP 距腕 = GRIP）
    gripG=new THREE.Group(); wristG.add(gripG);
    const palm=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.16,0.12), tipM);
    palm.position.x=0.045; palm.castShadow=true; gripG.add(palm);
    const fl=GRIP-0.09;
    fingerL=new THREE.Mesh(new THREE.BoxGeometry(fl,0.05,0.045), tipM);
    fingerR=new THREE.Mesh(new THREE.BoxGeometry(fl,0.05,0.045), tipM);
    fingerL.castShadow=fingerR.castShadow=true;
    fingerL.position.set(0.09+fl/2,0,0.065); fingerR.position.set(0.09+fl/2,0,-0.065);
    fingerL.add(new THREE.Mesh(new THREE.BoxGeometry(fl*0.7,0.052,0.012), accent));
    fingerR.add(new THREE.Mesh(new THREE.BoxGeometry(fl*0.7,0.052,0.012), accent));
    gripG.add(fingerL); gripG.add(fingerR);

    tcp=new THREE.Object3D(); tcp.position.set(GRIP,0,0); gripG.add(tcp);
  }
  // 幾何小工具
  function cyl(rt,rb,h,axis,m){ const c=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,40),m); if(axis==="z")c.rotation.x=Math.PI/2; if(axis==="x")c.rotation.z=Math.PI/2; c.castShadow=true; return c; }
  function capsule(r,len,m){ const me=new THREE.Mesh(new THREE.CapsuleGeometry(r,Math.max(0.01,len-2*r),10,24),m); me.castShadow=true; return me; }
  function capX(r,len,m){ const me=new THREE.Mesh(new THREE.CapsuleGeometry(r,Math.max(0.01,len-2*r),10,24),m); me.rotation.z=Math.PI/2; me.castShadow=true; return me; }

  function buildBlocks(){
    const xs=1.0, zs=[-0.42,-0.14,0.14,0.42], cols=["red","blue","red","blue"];
    blocks=[];
    for(let i=0;i<4;i++){
      const isRed=cols[i]==="red";
      const m=new THREE.Mesh(new THREE.BoxGeometry(BLOCK,BLOCK,BLOCK),
        mat(isRed?0xe05a4b:0x2f6fd1,0.2,0.5));
      m.castShadow=true; m.receiveShadow=true;
      m.position.set(xs,BY,zs[i]);
      scene.add(m);
      blocks.push({id:"b"+i,color:cols[i],home:{x:xs,z:zs[i]},mesh:m,placed:false,zone:null});
    }
    ZONE.A.n=0; ZONE.B.n=0; st.holding=null;
  }
  function resetBlocksPose(){
    for(const b of blocks){ if(st.holding===b) scene.attach(b.mesh); b.mesh.position.set(b.home.x,BY,b.home.z); b.mesh.rotation.set(0,0,0); b.placed=false; b.zone=null; }
    ZONE.A.n=0; ZONE.B.n=0; st.holding=null;
  }

  // ---- 運動學 ----
  function setIK(tx,ty,tz){
    // 腕點 = TCP 上方 GRIP（夾爪朝下）
    const wy=ty+GRIP;
    const baseYaw=Math.atan2(-tz,tx);
    let r=Math.hypot(tx,tz);
    let dx=r, dy=wy-H;
    let d=clamp(Math.hypot(dx,dy), Math.abs(L1-L2)+0.02, REACH);
    const ang=Math.atan2(dy,dx)/1; // 方向
    // 依夾住後距離重新投影方向
    const dir=Math.atan2(dy,dx);
    dx=Math.cos(dir)*d; dy=Math.sin(dir)*d;
    let c2=clamp((d*d-L1*L1-L2*L2)/(2*L1*L2),-1,1);
    const cand=[Math.acos(c2),-Math.acos(c2)].map(e=>{
      const s=Math.atan2(dy,dx)-Math.atan2(L2*Math.sin(e),L1+L2*Math.cos(e));
      return {s,e,jy:Math.sin(s)};
    });
    cand.sort((a,b)=>b.jy-a.jy);              // 手肘朝上較自然
    const {s,e}=cand[0];
    const wrist=(-Math.PI/2)-(s+e);           // 夾爪保持垂直朝下
    st.tgt.y=norm(baseYaw,st.cur.y); st.tgt.s=s; st.tgt.e=e; st.tgt.w=norm(wrist,st.cur.w);
  }
  function reached(){
    return Math.abs(st.tgt.y-st.cur.y)<0.01 && Math.abs(st.tgt.s-st.cur.s)<0.01 &&
           Math.abs(st.tgt.e-st.cur.e)<0.01 && Math.abs(st.tgt.w-st.cur.w)<0.02;
  }

  function applyJoints(){
    baseGroup.rotation.y=st.cur.y;
    shoulderG.rotation.z=st.cur.s;
    elbowG.rotation.z=st.cur.e;
    wristG.rotation.z=st.cur.w;
    const open=0.05+0.06*st.cur.g;
    if(fingerL) fingerL.position.z=open;
    if(fingerR) fingerR.position.z=-open;
  }

  // ---- 主迴圈（setInterval，分頁未繪製也能跑）----
  function frame(){
    const e=SPEEDS[st.speed].e;
    st.cur.y+=(st.tgt.y-st.cur.y)*e;
    st.cur.s+=(st.tgt.s-st.cur.s)*e;
    st.cur.e+=(st.tgt.e-st.cur.e)*e;
    st.cur.w+=(st.tgt.w-st.cur.w)*e;
    st.cur.g+=(st.tgt.g-st.cur.g)*0.18;
    applyJoints();
    if(controls) controls.update();
    if(renderer) renderer.render(scene,camera);
    telem();
  }

  // ---- 動作原語 ----
  function moveTo(x,y,z){
    return new Promise((res,rej)=>{
      if(st.fault||st.estop) return rej("halt");
      setIK(x,y,z); let t=0;
      const iv=setInterval(()=>{
        if(st.fault||st.estop){clearInterval(iv);return rej("halt");}
        if(reached()||++t>260){clearInterval(iv);res();}
      },16);
    });
  }
  function settle(){ return new Promise(res=>{ let t=0; const iv=setInterval(()=>{ if(st.estop||st.fault||reached()||++t>260){clearInterval(iv);res();} },16); }); }
  function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function setGrip(open){ st.tgt.g=open?1:0; return wait(280); }
  function nextSupply(color){ return blocks.find(b=>!b.placed && b!==st.holding && b.color===color); }

  function attach(b){ gripG.attach(b.mesh); st.holding=b; }
  function release(b,x,z,y){ scene.attach(b.mesh); b.mesh.position.set(x,y??BY,z); b.mesh.rotation.set(0,0,0); st.holding=null; }

  // ---- 任務 ----
  async function tHome(){ const s=-0.5,e=1.7; st.tgt={y:norm(0.6,st.cur.y),s,e,w:norm((-Math.PI/2)-(s+e),st.cur.w),g:1}; await settle(); }
  async function tWave(){ ai("嗨～你好！👋"); log("揮手打招呼"); await moveTo(0.6,1.35,0.2);
    for(let i=0;i<3;i++){ if(st.estop||st.fault)break; st.tgt.y=norm(st.cur.y+0.3,st.cur.y); await wait(220); st.tgt.y=norm(st.cur.y-0.3,st.cur.y); await wait(220);} await tHome(); }
  async function tGrip(open){ ai(`夾爪${open?"張開":"夾合"}…`); log(`夾爪${open?"張開":"夾合"}`); await setGrip(open); }

  async function tGoto(name){
    name=(name||"").toString().toLowerCase();
    const map={center:"center","中央":"center","中間":"center",top:"top",supply:"supply",zonea:"zonea",a:"zonea",zoneb:"zoneb",b:"zoneb",home:"home"};
    const key=map[name]||name;
    if(key==="home"){ ai("回原點休息 😌"); log("回原點"); await tHome(); return; }
    const n=NAMED[key]; if(!n){ ai(`不認得位置「${name}」。可去：中央、最高點、供料區、A 區、B 區、原點。`); return; }
    ai(`移動到${n.label}…`); log(`移動到${n.label}`); await moveTo(n.x,n.y,n.z); ai(`已到${n.label}。`);
  }

  async function pickAt(x,z){
    await moveTo(x,LIFT_Y,z); await setGrip(true);
    await moveTo(x,GRAB_Y,z); await setGrip(false);
  }
  async function tPick(color){
    if(st.holding){ ai("⚠️ 夾爪已夾著東西，請先放到 A/B 區。"); return; }
    const b=nextSupply(color), name=color==="red"?"紅色":"藍色";
    if(!b){ ai(`供料區沒有${name}積木了，可說「重新來過」。`); return; }
    ai(`夾取${name}積木中…`); log(`夾取${name}積木`);
    await moveTo(b.home.x,LIFT_Y,b.home.z); await setGrip(true);
    await moveTo(b.home.x,GRAB_Y,b.home.z); await setGrip(false); attach(b); await wait(120);
    await moveTo(b.home.x,LIFT_Y,b.home.z);
    ai(`已夾起${name}積木，等待放置（例如「放到 A 區」）。`);
  }
  async function tPlace(zoneKey){
    zoneKey=(zoneKey||"").toString().toUpperCase(); const z=ZONE[zoneKey];
    if(!z){ ai("請指定放到 A 區或 B 區。"); return; }
    if(!st.holding){ ai("⚠️ 夾爪上沒有東西，請先夾起紅色/藍色。"); return; }
    const b=st.holding, slot=z.n%3, ox=(slot-1)*0.16;
    ai(`放到 ${zoneKey} 區…`); log(`放置 → ${zoneKey} 區`);
    await moveTo(z.x+ox,LIFT_Y,z.z); await moveTo(z.x+ox,GRAB_Y,z.z); await setGrip(true);
    release(b,z.x+ox,z.z); b.placed=true; b.zone=zoneKey; z.n++; st.cycles++;
    await wait(120); await moveTo(z.x+ox,LIFT_Y,z.z); ai("完成放置（循環 +1）。");
  }
  async function tSort(color){
    const zoneKey=color==="red"?"A":"B", name=color==="red"?"紅色":"藍色", b=nextSupply(color);
    if(!b){ ai(`${name}積木都整理完了 👍`); return; }
    log(`夾取${name} → ${zoneKey} 區`);
    await moveTo(b.home.x,LIFT_Y,b.home.z); await setGrip(true);
    await moveTo(b.home.x,GRAB_Y,b.home.z); await setGrip(false); attach(b); await wait(90);
    await moveTo(b.home.x,LIFT_Y,b.home.z);
    const z=ZONE[zoneKey], slot=z.n%3, ox=(slot-1)*0.16;
    await moveTo(z.x+ox,LIFT_Y,z.z); await moveTo(z.x+ox,GRAB_Y,z.z); await setGrip(true);
    release(b,z.x+ox,z.z); b.placed=true; b.zone=zoneKey; z.n++; st.cycles++;
    await wait(90); await moveTo(z.x+ox,LIFT_Y,z.z);
  }
  async function tAuto(){
    resetBlocksPose(); ai("🎬 全自動整理：紅→A、藍→B"); log("全自動整理開始");
    for(const b of blocks.slice()){ if(st.estop||st.fault)break; ai(`整理${b.color==="red"?"紅色":"藍色"}積木…`); await tSort(b.color); }
    if(!st.estop&&!st.fault){ await tHome(); ai("全部整理完成 🎉"); log("全自動整理完成"); }
  }
  async function tStack(){
    const avail=blocks.filter(b=>!b.placed && b!==st.holding);
    if(avail.length===0){ ai("沒有可堆疊的積木，先「重新來過」吧。"); return; }
    ai("🧱 堆疊示範…"); log("堆疊積木"); let lv=0; const sx=0.75,sz=0;
    for(const b of avail){ if(st.estop||st.fault)break;
      await moveTo(b.home.x,LIFT_Y,b.home.z); await setGrip(true); await moveTo(b.home.x,GRAB_Y,b.home.z); await setGrip(false); attach(b); await wait(80);
      await moveTo(b.home.x,LIFT_Y,b.home.z);
      const ty=GRAB_Y+lv*BLOCK;
      await moveTo(sx,LIFT_Y,sz); await moveTo(sx,ty,sz); await setGrip(true);
      release(b,sx,sz,BY+lv*BLOCK); b.placed=true; b.zone="STACK"; lv++; st.cycles++; await wait(80); await moveTo(sx,LIFT_Y,sz);
    }
    if(!st.estop&&!st.fault){ await tHome(); ai(`堆疊完成，共 ${lv} 層 🧱`); }
  }
  async function tReset(){ ai("♻️ 重新來過：積木歸位…"); log("重置/復位"); resetBlocksPose(); await tHome(); ai("好了，積木都回供料區了！"); }

  async function tJog(dir,dist){
    const p=new THREE.Vector3(); tcp.getWorldPosition(p);
    dist=(Number(dist)||100)/100*0.4; dir=(dir||"").toString().toLowerCase();
    let x=p.x,y=p.y,z=p.z;
    if(/left|左/.test(dir))z-=dist; else if(/right|右/.test(dir))z+=dist;
    else if(/up|上/.test(dir))y+=dist; else if(/down|下/.test(dir))y-=dist;
    else if(/front|前/.test(dir))x+=dist; else if(/back|後/.test(dir))x-=dist;
    if(Math.hypot(x,z)>REACH){ unsupported("已到工作範圍邊界",`往${dir}微動`); return; }
    ai(`微動 ${dir}…`); log(`微動 ${dir}`); await moveTo(x,clamp(y,0.12,1.6),z);
  }
  async function tRotate(joint,deg,abs){
    joint=(joint||"j1").toString().toLowerCase(); deg=Number(deg)||0; const rad=deg*Math.PI/180;
    if(/j1|1|底|base|肩座/.test(joint)){ st.tgt.y=norm(abs?rad:st.cur.y+rad,st.cur.y); ai(`底座(J1) ${abs?"轉到":"轉"} ${deg}°…`); }
    else if(/j3|3|肘|elbow/.test(joint)){ st.tgt.e=norm(abs?rad:st.cur.e+rad,st.cur.e); st.tgt.w=norm((-Math.PI/2)-(st.cur.s+st.tgt.e),st.cur.w); ai(`肘(J3) ${abs?"轉到":"轉"} ${deg}°…`); }
    else { st.tgt.s=norm(abs?rad:st.cur.s+rad,st.cur.s); st.tgt.w=norm((-Math.PI/2)-(st.tgt.s+st.cur.e),st.cur.w); ai(`肩(J2) ${abs?"轉到":"轉"} ${deg}°…`); }
    log(`旋轉 ${joint} ${deg}°`); await settle();
  }
  async function tDrawShape(shape){
    shape=(shape||"square").toString(); const cx=0.85,cz=0,y=GRAB_Y+0.02,r=0.32; let pts=[],lab;
    if(/circle|圓|圈/.test(shape)){ lab="圓形"; for(let i=0;i<=24;i++){ const a=i/24*2*Math.PI; pts.push([cx+r*Math.cos(a),cz+r*Math.sin(a)]); } }
    else if(/triangle|三角/.test(shape)){ lab="三角形"; for(let i=0;i<=3;i++){ const a=-Math.PI/2+i/3*2*Math.PI; pts.push([cx+r*Math.cos(a),cz+r*Math.sin(a)]); } }
    else { lab="方形"; const s=0.28; pts=[[cx-s,cz-s],[cx+s,cz-s],[cx+s,cz+s],[cx-s,cz+s],[cx-s,cz-s]]; }
    ai(`✏️ 在工作台描繪一個${lab}…`); log(`軌跡示範：${lab}`); await setGrip(false);
    await moveTo(pts[0][0],y,pts[0][1]); for(const [x,z] of pts){ if(st.estop||st.fault)break; await moveTo(x,y,z); }
    if(!st.estop&&!st.fault){ await tHome(); ai(`軌跡完成 ✏️（${lab}）`); }
  }
  async function tCalibrate(){ ai("🎯 校正中：回參考原點…"); log("校正/歸零"); await tHome(); st.cycles=0; ai("✅ 校正完成，循環計數已清零。"); }
  async function tSelfTest(){
    ai("🔧 自我測試開始…"); log("自我測試");
    await tGoto("center"); st.tgt.y=norm(st.cur.y+0.6,st.cur.y); await settle(); st.tgt.y=norm(st.cur.y-1.2,st.cur.y); await settle(); await tGoto("center");
    await setGrip(false); await setGrip(true); await setGrip(false);
    if(!st.estop&&!st.fault){ await tHome(); ai("✅ 自我測試完成：J1 OK、J2 OK、J3 OK、夾爪 OK。"); log("自我測試完成"); }
  }

  // ---- 即時/狀態 ----
  function counts(){ let s=0,A=0,B=0,o=0; for(const b of blocks){ if(b===st.holding){o++;continue;} if(!b.placed){s++;continue;} if(b.zone==="A")A++; else if(b.zone==="B")B++; else o++; } return {s,A,B,o}; }
  function statusReport(){
    const p=new THREE.Vector3(); if(tcp) tcp.getWorldPosition(p);
    const c=counts();
    ai(`📊 <b>數位孿生狀態</b><span class="ai-step">
      J1 ${deg(st.cur.y)}°　J2 ${deg(st.cur.s)}°　J3 ${deg(st.cur.e)}°　|　TCP (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) m<br>
      夾爪 ${st.cur.g>0.5?"開啟":"夾合"}　持有 ${st.holding?(st.holding.color==="red"?"紅積木":"藍積木"):"無"}　速度 ${SPEEDS[st.speed].pct}%<br>
      供料 ${c.s}　A 區 ${c.A}　B 區 ${c.B}　循環 ${st.cycles}　狀態 ${stStr()}</span>`);
    log("讀取狀態回報");
  }
  function countReport(){ const c=counts(); ai(`🔢 <b>清點</b><span class="ai-step">供料 ${c.s} 個　A 區 ${c.A} 個　B 區 ${c.B} 個${c.o?`　其他 ${c.o}`:""}</span>`); log("清點數量"); }
  function setSpeed(level){ level=(level||"").toString().toLowerCase(); let k=/slow|慢/.test(level)?"slow":/fast|快/.test(level)?"fast":/normal|正常|普通|中/.test(level)?"normal":null; if(!k){const n=parseInt(level); if(!isNaN(n))k=n<=45?"slow":n<=80?"normal":"fast";} if(!k)k="normal"; st.speed=k; ai(`⚙️ 速度設為 <b>${SPEEDS[k].pct}%</b>`); log(`設定速度 ${SPEEDS[k].pct}%`); }
  function unsupported(reason,req){ ai(`🚫 <b>此設備無法執行${req?`「${esc(req)}」`:"這個指令"}</b><span class="ai-step">原因：${esc(reason||"超出本設備功能範圍")}。<br>本機為夾爪式取放手臂（無焊接/噴漆/鑽孔等工具）、額定負載 3kg。</span>`); log(`拒絕指令：${req||"不支援"}`); }
  function estopOn(){ st.estop=true; st.tgt={...st.cur}; lamp("estop"); ai("🛑 <b>緊急停止！</b>所有動作已停止。<span class=\"ai-step\">按「解除急停」或說「解除急停」恢復。</span>"); log("🛑 緊急停止"); showResume("estop"); }
  function estopClear(){ st.estop=false; lamp("idle"); hideResume(); ai("✅ 已解除急停。"); log("解除急停"); }
  function doFault(){ if(st.busy){flashFault();return;} flashFault(); }
  function flashFault(){ st.fault=true; lamp("fault"); ai("⚠️ <b>偵測到異常，已自動停機！</b><span class=\"ai-step\">建議排除卡阻、檢查負載後再啟動。</span>"); log("⚠️ 故障停機"); showResume("fault"); }
  function clearFault(){ st.fault=false; lamp("idle"); hideResume(); log("故障已排除"); runTask(async()=>{ await tHome(); ai("故障排除完成，恢復正常 👍"); }); }
  function doHack(){ if(st.guard){ ai("🛡️ <b>已攔截危險指令！</b><span class=\"ai-step\">安全防護開啟，只允許正常工作。</span>"); log("🛡️ 攔截惡意指令"); } else { ai("😱 防護關閉時，惡意指令可能讓設備亂動——這就是提示詞注入攻擊。"); log("❌ 防護關閉示警"); } }
  function showResume(kind){ let b=$("resumeBtn"); if(!b){ b=document.createElement("button"); b.id="resumeBtn"; b.className="cmd-btn primary"; const g=document.querySelector(".big-btn-grid"); if(g)g.appendChild(b);} b.textContent=kind==="estop"?"✅ 解除急停":"🔧 排除故障"; b.onclick=kind==="estop"?estopClear:clearFault; b.style.display="block"; }
  function hideResume(){ const b=$("resumeBtn"); if(b)b.style.display="none"; }

  // ---- 分派 ----
  function gripOpen(o){ const s=(o.state||(o.open?"open":"")).toString().toLowerCase(); return !(s==="close"||s==="closed"||s==="關"||o.open===false); }
  function dispatch(o){
    const a=String(o.action||"").toLowerCase();
    switch(a){
      case "sort_red": case "red": return ()=>tSort("red");
      case "sort_blue": case "blue": return ()=>tSort("blue");
      case "auto": case "sort_all": return tAuto;
      case "wave": return tWave;
      case "home": return async()=>{ ai("回原點休息 😌"); log("回原點"); await tHome(); };
      case "calibrate": return tCalibrate;
      case "selftest": case "self_test": return tSelfTest;
      case "reset": return tReset;
      case "stack": return tStack;
      case "pick": return ()=>tPick(o.color);
      case "place": return ()=>tPlace(o.zone);
      case "gripper": case "grip": return ()=>tGrip(gripOpen(o));
      case "goto": return ()=>tGoto(o.target||o.name||o.position);
      case "jog": return ()=>tJog(o.dir||o.direction,o.dist||o.distance);
      case "rotate": return ()=>tRotate(o.joint,o.deg!=null?o.deg:o.angle,o.absolute===true);
      case "move": return ()=>moveTo(clamp(Number(o.x)||0.9,0.4,REACH),clamp(((Number(o.y)||300)/520),0.12,1.5),clamp(((Number(o.z)||0)),-1.2,1.2));
      case "draw": return ()=>tDrawShape(o.shape);
      default: return null;
    }
  }
  async function stepRun(s){ const a=String(s.action||"").toLowerCase();
    if(["speed","set_speed"].includes(a)){ setSpeed(s.level||s.value); return; }
    if(["status","report"].includes(a)){ statusReport(); return; }
    if(a==="count"){ countReport(); return; }
    if(a==="unsupported"){ unsupported(s.reason,s.say); return; }
    const fn=dispatch(s); if(fn) await fn();
  }
  function execAction(o){
    if(!o||!o.action) return false; const a=String(o.action).toLowerCase();
    if(["status","report"].includes(a)){ statusReport(); return true; }
    if(a==="count"){ countReport(); return true; }
    if(["speed","set_speed"].includes(a)){ setSpeed(o.level||o.value); return true; }
    if(["estop","stop"].includes(a)){ estopOn(); return true; }
    if(["resume","clear_estop"].includes(a)){ estopClear(); return true; }
    if(a==="fault"){ doFault(); return true; }
    if(a==="hack"){ doHack(); return true; }
    if(a==="unsupported"){ unsupported(o.reason,o.say); return true; }
    if(a==="chat") return false;
    if(a==="unknown") return false;
    if(st.estop){ ai("🛑 目前急停中，請先「解除急停」。"); return true; }
    if(st.fault){ ai("⚠️ 目前故障，請先「排除故障」。"); return true; }
    if(a==="sequence"&&Array.isArray(o.steps)){ runTask(async()=>{ for(const s of o.steps){ if(st.estop||st.fault)break; await stepRun(s);} if(!st.estop&&!st.fault){ai("✅ 指令序列完成。");log("序列完成");} }); return true; }
    const fn=dispatch(o); if(!fn) return false; runTask(async()=>{ await fn(); }); return true;
  }

  async function runTask(fn){ if(st.busy||st.fault||st.estop) return; st.busy=true; lamp("busy"); setBtns(false); try{ await fn(); }catch(e){}finally{ st.busy=false; if(!st.fault&&!st.estop)lamp("idle"); setBtns(true);} }
  function setBtns(on){ document.querySelectorAll(".cmd-btn").forEach(b=>{ if(b.id==="resumeBtn") return; b.disabled=!on; }); }

  // ---- 關鍵字（AI 關閉時）----
  function parse(text){
    const t=(text||"").replace(/\s/g,""); if(!t) return;
    if(/(忽略|無視).*(規則|限制)|危險區|hack/i.test(t)){ doHack(); return; }
    if(/(緊急停止|急停|馬上停|立刻停|停下)/.test(t)){ execAction({action:"estop"}); return; }
    if(st.estop&&/(解除|恢復|繼續|啟動)/.test(t)){ execAction({action:"resume"}); return; }
    if(/(狀態|位置|讀數|資訊|回報)/.test(t)){ statusReport(); return; }
    if(/(數量|幾個|清點|多少)/.test(t)){ countReport(); return; }
    if(/慢/.test(t)){ setSpeed("slow"); return; } if(/(快|加速)/.test(t)){ setSpeed("fast"); return; }
    if(/(焊接|電焊|油漆|噴漆|鑽孔|鎖螺絲|切割|倒水|煮|咖啡|做飯|掃地|拖地|洗碗|飛|唱歌|跳舞|按摩)/.test(t)){ unsupported("本機為夾爪式取放手臂，未配備對應工具",text); return; }
    if(/(夾爪|爪子)|(張開|放開|鬆開|閉合|夾緊|夾住)/.test(t)){ execAction({action:"gripper",state:/(張開|打開|放開|鬆開)/.test(t)?"open":"close"}); return; }
    if(/(畫|描)/.test(t)){ execAction({action:"draw",shape:/(圓|圈)/.test(t)?"circle":/三角/.test(t)?"triangle":"square"}); return; }
    if(/(自我測試|自檢|測試一下)/.test(t)){ execAction({action:"selftest"}); return; }
    if(/(校正|校準|歸零)/.test(t)){ execAction({action:"calibrate"}); return; }
    if(/(重置|復位|還原|放回|歸位|重新來過|清空)/.test(t)){ execAction({action:"reset"}); return; }
    if(/(轉|旋轉).*(軸|關節|肩|肘|底座)/.test(t)||/第[一二三123]軸/.test(t)){ const j=/(肘|第三|j3|3軸)/i.test(t)?"j3":/(肩|第二|j2|2軸)/i.test(t)?"j2":"j1"; const dm=t.match(/(-?\d+)/); execAction({action:"rotate",joint:j,deg:dm?parseInt(dm[1]):30,absolute:/到/.test(t)}); return; }
    if(/(左|右|上|下|前|後).{0,3}(移|挪|jog|一點)/.test(t)&&!/紅|藍/.test(t)){ const d=/左/.test(t)?"left":/右/.test(t)?"right":/上/.test(t)?"up":/下/.test(t)?"down":/前/.test(t)?"front":"back"; const dm=t.match(/(\d+)/); execAction({action:"jog",dir:d,dist:dm?parseInt(dm[1]):100}); return; }
    if(/(中間|中央|正中|置中)/.test(t)){ execAction({action:"goto",target:"center"}); return; }
    if(/(最高|最上|頂端|上面)/.test(t)){ execAction({action:"goto",target:"top"}); return; }
    if(/(供料|料區)/.test(t)){ execAction({action:"goto",target:"supply"}); return; }
    if(/(夾起|拿起|抓|撿).*紅/.test(t)){ execAction({action:"pick",color:"red"}); return; }
    if(/(夾起|拿起|抓|撿).*藍/.test(t)){ execAction({action:"pick",color:"blue"}); return; }
    if(/(放到|放置|放在|擺到).*(a|甲)/i.test(t)){ execAction({action:"place",zone:"A"}); return; }
    if(/(放到|放置|放在|擺到).*(b|乙)/i.test(t)){ execAction({action:"place",zone:"B"}); return; }
    if(/(堆|疊)/.test(t)){ execAction({action:"stack"}); return; }
    if(/(全部|自動|整理|示範|分類)/.test(t)&&!/紅|藍/.test(t)){ execAction({action:"auto"}); return; }
    if(/紅/.test(t)){ execAction({action:"sort_red"}); return; }
    if(/藍/.test(t)){ execAction({action:"sort_blue"}); return; }
    if(/(揮手|打招呼|哈囉|嗨|你好|hi|hello)/i.test(t)){ execAction({action:"wave"}); return; }
    if(/(原點|回家|歸位|休息|回去)/.test(t)){ execAction({action:"home"}); return; }
    if(/(故障|壞|卡住|當機)/.test(t)){ execAction({action:"fault"}); return; }
    ai(`嗯…我不太確定「${esc(text)}」😅 可以按下面按鈕，或試：「整理積木」「夾起紅色」「往左移」「轉底座90度」「畫個圓」「回報狀態」。`);
  }
  function route(text){ if(!text||!text.trim()) return; if(window.ArmAI&&window.ArmAI.isOn()) window.ArmAI.handle(text); else parse(text); }

  // ---- 小工具 / 遙測 ----
  function deg(r){ return Math.round(r*180/Math.PI); }
  function esc(s){ return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
  function stStr(){ return st.estop?"急停":st.fault?"故障":st.busy?"運轉中":"待命"; }
  function setT(id,v){ const e=$(id); if(e) e.textContent=v; }
  function telem(){
    if(!tcp) return; const p=new THREE.Vector3(); tcp.getWorldPosition(p);
    setT("tJ1",deg(st.cur.y)+"°"); setT("tJ2",deg(st.cur.s)+"°"); setT("tJ3",deg(st.cur.e)+"°");
    setT("tTCP",`${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
    setT("tGrip",st.cur.g>0.5?"開":"合"); setT("tSpeed",SPEEDS[st.speed].pct+"%"); setT("tCycles",st.cycles);
    const s=st.estop?["急停","r"]:st.fault?["故障","r"]:st.busy?["運轉中","a"]:["待命","g"];
    const el=$("tStatus"); if(el){ el.textContent=s[0]; el.className="dt-v st-"+s[1]; }
  }
  function lamp(){ /* 由 telem 反映，保留介面 */ }
  let lastLog="";
  function ai(html){ const m=$("aiMsg"); if(m) m.innerHTML=html; }
  function log(text){ lastLog=text; const e=$("dtLog"); if(e) e.textContent="▸ "+String(text).replace(/<[^>]+>/g,""); }

  // ---- 綁定 ----
  const CMD={ auto:{action:"auto"}, wave:{action:"wave"}, home:{action:"home"}, reset:{action:"reset"},
    redA:{action:"sort_red"}, blueB:{action:"sort_blue"} };
  function bind(){
    const panel=document.querySelector(".arm-panel");
    if(panel) panel.addEventListener("click",(e)=>{ const b=e.target.closest("[data-cmd]"); if(!b)return; const c=CMD[b.dataset.cmd]; if(c)execAction(c); });
    const send=$("cmdSend"); if(send) send.addEventListener("click",()=>route($("cmdInput").value));
    const inp=$("cmdInput"); if(inp) inp.addEventListener("keydown",(e)=>{ if(e.key==="Enter") route($("cmdInput").value); });
    setupVoice();
  }
  function setupVoice(){
    const btn=$("cmdVoice"); if(!btn) return; const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ btn.style.display="none"; return; }
    const rec=new SR(); rec.lang="zh-TW"; rec.interimResults=false; let on=false;
    btn.addEventListener("click",()=>{ if(on){rec.stop();return;} try{rec.start();}catch(e){} });
    rec.onstart=()=>{on=true;btn.classList.add("listening");ai("🎤 我在聽…請說話");};
    rec.onend=()=>{on=false;btn.classList.remove("listening");};
    rec.onerror=()=>{on=false;btn.classList.remove("listening");ai("🎤 沒聽清楚，用按鈕或打字也可以喔！");};
    rec.onresult=(e)=>{ const said=e.results[0][0].transcript; $("cmdInput").value=said; ai(`🎤 我聽到：<b>「${esc(said)}」</b>`); route(said); };
  }
  function onResize(){ const host=$("arm3d"); if(!host||!renderer) return; const w=host.clientWidth,h=host.clientHeight; camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); }

  // ---- 對外 ----
  let started=false;
  window.ArmDemo={
    init(){ if(started) return; if(!$("arm3d")) return; build(); applyJoints(); bind(); if(!loop) loop=setInterval(frame,16); started=true; setTimeout(onResize,50); },
    isStarted(){ return started; },
    exec:execAction, keyword:parse, say:ai, log:log
  };
  // 深連結 #arm 時也能自動啟動
  if(document.readyState!=="loading"){ if(document.getElementById("screen-arm")&&document.getElementById("screen-arm").classList.contains("active")) window.ArmDemo.init(); }
})();
