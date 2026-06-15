/* =========================================================
   虛擬機械手臂「控制器」引擎 v2
   - 2 軸平面取放手臂 + 逆向運動學(IK)
   - 即時遙測（各軸角度 / TCP 座標 / 夾爪 / 速度 / 負載 / 循環）
   - 完整指令集：分類/夾放/堆疊/微動/關節旋轉/命名點/座標/畫軌跡/
     校正/自我測試/重置/狀態回報/清點/速度/急停/序列
   - 設備能力邊界：做不到的回「此設備不支援」並說明工程原因
   ========================================================= */
(function(){
  "use strict";

  // ---- 幾何 ----
  const X0=410, Y0=445, L1=150, L2=130;
  const REACH_MAX=L1+L2-1, REACH_MIN=Math.abs(L1-L2)+1;
  const SPEEDS={ slow:{e:0.07,pct:35}, normal:{e:0.15,pct:70}, fast:{e:0.30,pct:100} };

  const NAMED={
    center:{x:410,y:250,label:"中央"},
    top:{x:410,y:180,label:"最高點"},
    supply:{x:210,y:360,label:"供料區上方"},
    zonea:{x:582,y:350,label:"A 區"},
    zoneb:{x:660,y:360,label:"B 區"},
  };

  // ---- 狀態 ----
  const st={
    a1:-2.2, t2:1.6, ta1:-2.2, tt2:1.6,
    grip:18, tgrip:18, holding:null,
    fault:false, estop:false, busy:false, guard:true,
    speed:"normal", cycles:0
  };

  const ZONE={ A:{cx:582,cy:441,n:0}, B:{cx:682,cy:441,n:0}, danger:{cx:620,cy:285} };
  let blocks=[];
  function initBlocks(){
    blocks=[
      {id:"b1",color:"red", x:120,y:432,hx:120,hy:432,placed:false,zone:null},
      {id:"b2",color:"blue",x:172,y:432,hx:172,hy:432,placed:false,zone:null},
      {id:"b3",color:"red", x:224,y:432,hx:224,hy:432,placed:false,zone:null},
      {id:"b4",color:"blue",x:276,y:432,hx:276,hy:432,placed:false,zone:null},
    ];
    ZONE.A.n=0; ZONE.B.n=0; st.holding=null;
  }

  // ---- DOM ----
  const $=(id)=>document.getElementById(id);
  let seg1,seg2,joint1,finger1,finger2,blocksLayer,sparks,lampDot,lampText,aiMsg,logList;

  // ---- 數學 ----
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function norm(t,c){ while(t-c>Math.PI)t-=2*Math.PI; while(t-c<-Math.PI)t+=2*Math.PI; return t; }
  function reachable(x,y){ return Math.hypot(x-X0,y-Y0)<=REACH_MAX+0.5; }
  function ik(tx,ty){
    let dx=tx-X0,dy=ty-Y0,d=clamp(Math.hypot(dx,dy),REACH_MIN,REACH_MAX);
    const ang=Math.atan2(dy,dx); dx=Math.cos(ang)*d; dy=Math.sin(ang)*d;
    let c2=clamp((d*d-L1*L1-L2*L2)/(2*L1*L2),-1,1);
    const sols=[Math.acos(c2),-Math.acos(c2)].map(t2=>{
      const a1=Math.atan2(dy,dx)-Math.atan2(L2*Math.sin(t2),L1+L2*Math.cos(t2));
      return {a1,t2,j1y:Y0+L1*Math.sin(a1)};
    });
    sols.sort((p,q)=>p.j1y-q.j1y);
    return sols[0];
  }
  function endPoint(){
    const j1x=X0+L1*Math.cos(st.a1), j1y=Y0+L1*Math.sin(st.a1), ea=st.a1+st.t2;
    return {j1x,j1y,ea,ex:j1x+L2*Math.cos(ea),ey:j1y+L2*Math.sin(ea)};
  }

  // ---- 繪製 ----
  function draw(){
    const p=endPoint();
    seg1.setAttribute("x1",X0);seg1.setAttribute("y1",Y0);seg1.setAttribute("x2",p.j1x);seg1.setAttribute("y2",p.j1y);
    seg2.setAttribute("x1",p.j1x);seg2.setAttribute("y1",p.j1y);seg2.setAttribute("x2",p.ex);seg2.setAttribute("y2",p.ey);
    joint1.setAttribute("cx",p.j1x);joint1.setAttribute("cy",p.j1y);
    const perp=p.ea+Math.PI/2, fwd=24, off=st.grip;
    const bx=p.ex+Math.cos(p.ea)*6, by=p.ey+Math.sin(p.ea)*6;
    finger1.setAttribute("x1",bx+Math.cos(perp)*off);finger1.setAttribute("y1",by+Math.sin(perp)*off);
    finger1.setAttribute("x2",bx+Math.cos(perp)*off+Math.cos(p.ea)*fwd);finger1.setAttribute("y2",by+Math.sin(perp)*off+Math.sin(p.ea)*fwd);
    finger2.setAttribute("x1",bx-Math.cos(perp)*off);finger2.setAttribute("y1",by-Math.sin(perp)*off);
    finger2.setAttribute("x2",bx-Math.cos(perp)*off+Math.cos(p.ea)*fwd);finger2.setAttribute("y2",by-Math.sin(perp)*off+Math.sin(p.ea)*fwd);
    if(st.holding){ st.holding.x=p.ex+Math.cos(p.ea)*22-20; st.holding.y=p.ey+Math.sin(p.ea)*22-20; }
    if(st.fault){ sparks.setAttribute("transform",`translate(${p.j1x},${p.j1y})`); }
    drawBlocks(); telem(p);
  }
  function drawBlocks(){
    let s="";
    for(const b of blocks){
      const fill=b.color==="red"?"#e05a4b":"#2f6fd1", dark=b.color==="red"?"#b53a2d":"#1f55ad";
      s+=`<g transform="translate(${b.x},${b.y})"><rect width="40" height="40" rx="7" fill="${fill}" stroke="${dark}" stroke-width="2"/><rect width="40" height="11" rx="6" fill="rgba(255,255,255,.25)"/></g>`;
    }
    blocksLayer.innerHTML=s;
  }
  function setTxt(id,v){ const e=$(id); if(e) e.textContent=v; }
  function telem(p){
    const j1=Math.round((((-st.a1)*180/Math.PI)%360+360)%360);
    const j2=Math.round(st.t2*180/Math.PI);
    setTxt("tJ1",j1+"°"); setTxt("tJ2",j2+"°");
    setTxt("tX",Math.round(p.ex-X0)); setTxt("tY",Math.round(Y0-p.ey));
    setTxt("tGrip",st.tgrip>12?"開啟":"夾合");
    setTxt("tSpeed",SPEEDS[st.speed].pct+"%");
    setTxt("tPayload",(st.holding?"0.5":"0.0")+"/3.0kg");
    setTxt("tCycles",st.cycles);
    const s=st.estop?["急停","r"]:st.fault?["故障","r"]:st.busy?["運轉中","a"]:["待命","g"];
    const el=$("tStatus"); if(el){ el.textContent=s[0]; el.className="tv st-"+s[1]; }
  }

  // ---- 動畫迴圈（用 setInterval，避免分頁未繪製時 requestAnimationFrame 暫停）----
  let timer=null;
  function tick(){
    const e=SPEEDS[st.speed].e;
    st.a1+=(st.ta1-st.a1)*e; st.t2+=(st.tt2-st.t2)*e; st.grip+=(st.tgrip-st.grip)*0.2;
    draw();
  }

  // ---- 原語 ----
  function setTarget(x,y){ const s=ik(x,y); st.ta1=norm(s.a1,st.a1); st.tt2=norm(s.t2,st.t2); }
  function reached(){ return Math.abs(st.ta1-st.a1)<0.012 && Math.abs(st.tt2-st.t2)<0.012; }
  function moveTo(x,y){
    return new Promise((res,rej)=>{
      if(st.fault||st.estop) return rej("halt");
      setTarget(x,y); let t=0;
      const iv=setInterval(()=>{
        if(st.fault||st.estop){clearInterval(iv);return rej("halt");}
        if(reached()||++t>200){clearInterval(iv);res();}
      },16);
    });
  }
  function settle(){ return new Promise(res=>{ let t=0; const iv=setInterval(()=>{ if(st.estop||st.fault||reached()||++t>200){clearInterval(iv);res();} },16); }); }
  function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function setGrip(open){ st.tgrip=open?18:7; return wait(260); }
  function nextSupply(color){ return blocks.find(b=>!b.placed && b!==st.holding && b.color===color); }

  // ---- 可等待動作（task）----
  async function tHome(){ await moveTo(300,250); st.ta1=norm(-2.5,st.a1); st.tt2=norm(2.0,st.t2); await settle(); }
  async function tWave(){ ai("嗨～你好！👋"); log("揮手打招呼"); await moveTo(410,180); for(let i=0;i<3;i++){ if(st.estop||st.fault)break; st.ta1+=0.22; await wait(170); st.ta1-=0.22; await wait(170);} }

  async function tGrip(open){ ai(`夾爪${open?"張開":"夾合"}…`); log(`夾爪${open?"張開":"夾合"}`); await setGrip(open); }

  async function tGoto(name){
    name=(name||"").toString().toLowerCase();
    const map={center:"center","中央":"center","中間":"center",top:"top",supply:"supply",
      zonea:"zonea",a:"zonea",zoneb:"zoneb",b:"zoneb",home:"home"};
    const key=map[name]||name;
    if(key==="home"){ ai("回原點休息 😌"); log("回原點"); await tHome(); return; }
    const n=NAMED[key];
    if(!n){ ai(`不認得位置「${name}」。可去：中央、最高點、供料區、A 區、B 區、原點。`); return; }
    ai(`移動到${n.label}…`); log(`移動到${n.label}`); await moveTo(n.x,n.y); ai(`已到${n.label}。`);
  }

  async function tMoveXY(x,y){
    const p=endPoint();
    x=(x==null||x==="")?p.ex:Number(x); y=(y==null||y==="")?p.ey:Number(y);
    if(!reachable(x,y)){ unsupported(`座標 (${Math.round(x)}, ${Math.round(y)}) 超出工作範圍（最大臂展約 280mm）`,`移到 (${Math.round(x)}, ${Math.round(y)})`); return; }
    ai(`移動到座標 X=${Math.round(x)} Y=${Math.round(y)}…`); log(`移動到 (${Math.round(x)}, ${Math.round(y)})`);
    await moveTo(clamp(x,40,780),clamp(y,120,460));
  }

  async function tJog(dir,dist){
    const p=endPoint(); let x=p.ex,y=p.ey; dir=(dir||"").toString().toLowerCase(); dist=Number(dist)||60;
    if(/left|左/.test(dir))x-=dist; else if(/right|右/.test(dir))x+=dist;
    else if(/up|上/.test(dir))y-=dist; else if(/down|下/.test(dir))y+=dist;
    if(!reachable(x,y)){ unsupported("已到工作範圍邊界（最大臂展約 280mm）",`往${dir}微動 ${dist}`); return; }
    ai(`微動 ${dir} ${dist}mm…`); log(`微動 ${dir} ${dist}`); await moveTo(clamp(x,40,780),clamp(y,120,460));
  }

  async function tRotate(joint,deg,abs){
    joint=(joint||"j1").toString().toLowerCase(); deg=Number(deg)||0;
    const isJ2=/j2|2|肘|elbow/.test(joint), rad=deg*Math.PI/180;
    if(isJ2) st.tt2=norm(abs?rad:st.t2+rad,st.t2); else st.ta1=norm(abs?-rad:st.a1-rad,st.a1);
    ai(`${isJ2?"第二軸(肘)":"第一軸(肩)"} ${abs?"轉到":"轉動"} ${deg}°…`); log(`旋轉 ${isJ2?"J2":"J1"} ${deg}°`); await settle();
  }

  async function tPick(color){
    if(st.holding){ ai("⚠️ 夾爪已夾著物件，請先「放到 A/B 區」。"); log("夾取失敗：已持有物件"); return; }
    const b=nextSupply(color), name=color==="red"?"紅色":"藍色";
    if(!b){ ai(`供料區沒有${name}積木了，可說「重置」歸位。`); log(`夾取失敗：無${name}積木`); return; }
    ai(`夾取${name}積木中…`); log(`夾取${name}積木`);
    await moveTo(b.hx+20,300); await setGrip(true); await moveTo(b.hx+20,b.hy+8); await setGrip(false);
    st.holding=b; await wait(100); await moveTo(b.hx+20,290);
    ai(`已夾起${name}積木，等待放置指令（例如「放到 A 區」）。`);
  }
  async function tPlace(zoneKey){
    zoneKey=(zoneKey||"").toString().toUpperCase(); const z=ZONE[zoneKey];
    if(!z){ ai("請指定放到 A 區或 B 區。"); return; }
    if(!st.holding){ ai("⚠️ 夾爪上沒有東西，請先「夾起紅色/藍色」。"); log("放置失敗：未持有物件"); return; }
    const b=st.holding, slot=z.n%3, dropx=z.cx+(slot-1)*22;
    ai(`放到 ${zoneKey} 區…`); log(`放置 → ${zoneKey} 區`);
    await moveTo(dropx,300); await moveTo(dropx,z.cy); await setGrip(true);
    b.x=dropx-20; b.y=z.cy-20; b.placed=true; b.zone=zoneKey; st.holding=null; z.n++; st.cycles++;
    await wait(100); await moveTo(dropx,290); ai("完成放置（循環 +1）。");
  }
  async function tSort(color){
    const zoneKey=color==="red"?"A":"B", name=color==="red"?"紅色":"藍色", b=nextSupply(color);
    if(!b){ ai(`${name}積木都分類完了 👍`); return; }
    log(`夾取${name} → ${zoneKey} 區`);
    await moveTo(b.hx+20,300); await setGrip(true); await moveTo(b.hx+20,b.hy+8); await setGrip(false);
    st.holding=b; await wait(90); await moveTo(b.hx+20,290);
    const z=ZONE[zoneKey], slot=z.n%3, dropx=z.cx+(slot-1)*22;
    await moveTo(dropx,300); await moveTo(dropx,z.cy); await setGrip(true);
    b.x=dropx-20; b.y=z.cy-20; b.placed=true; b.zone=zoneKey; st.holding=null; z.n++; st.cycles++;
    await wait(90); await moveTo(dropx,290);
  }
  async function tAuto(){
    initBlocks(); ai("🎬 全自動分類：紅→A、藍→B"); log("全自動分類開始");
    for(const b of blocks.slice()){ if(st.estop||st.fault)break; ai(`分類${b.color==="red"?"紅色":"藍色"}積木…`); await tSort(b.color); }
    if(!st.estop&&!st.fault){ await tHome(); ai("全部分類完成 🎉"); log("全自動分類完成"); }
  }
  async function tStack(){
    const avail=blocks.filter(b=>!b.placed && b!==st.holding);
    if(avail.length===0){ ai("沒有可堆疊的積木，先「重置」吧。"); return; }
    ai("🧱 堆疊示範：把積木疊起來…"); log("堆疊積木");
    const sx=300; let level=0;
    for(const b of avail){ if(st.estop||st.fault)break;
      await moveTo(b.hx+20,300); await setGrip(true); await moveTo(b.hx+20,b.hy+8); await setGrip(false);
      st.holding=b; await wait(80); await moveTo(b.hx+20,290);
      const ty=441-level*22;
      await moveTo(sx,300); await moveTo(sx,ty); await setGrip(true);
      b.x=sx-20; b.y=ty-20; b.placed=true; b.zone="STACK"; st.holding=null; level++; st.cycles++;
      await wait(80); await moveTo(sx,290);
    }
    if(!st.estop&&!st.fault){ await tHome(); ai(`堆疊完成，共 ${level} 層 🧱`); }
  }
  async function tReset(){
    ai("♻️ 重置中：把積木放回供料區…"); log("重置/復位");
    for(const b of blocks){ if(st.estop||st.fault)break; if(!b.placed && b!==st.holding) continue;
      await moveTo(b.x+20,300); await setGrip(true); await moveTo(b.x+20,b.y+8); await setGrip(false);
      st.holding=b; await wait(80); await moveTo(b.x+20,290);
      await moveTo(b.hx+20,300); await moveTo(b.hx+20,b.hy+8); await setGrip(true);
      b.x=b.hx; b.y=b.hy; b.placed=false; b.zone=null; st.holding=null; await wait(80); await moveTo(b.hx+20,290);
    }
    ZONE.A.n=0; ZONE.B.n=0;
    if(!st.estop&&!st.fault){ await tHome(); ai("重置完成，積木已歸位。"); log("重置完成"); }
  }
  async function tDrawShape(shape){
    shape=(shape||"square").toString();
    const cx=410,cy=300,r=80; let pts=[],label;
    if(/circle|圓|圈/.test(shape)){ label="圓形"; for(let i=0;i<=24;i++){ const a=i/24*2*Math.PI; pts.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]); } }
    else if(/triangle|三角/.test(shape)){ label="三角形"; for(let i=0;i<=3;i++){ const a=-Math.PI/2+i/3*2*Math.PI; pts.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]); } }
    else { label="方形"; const s=70; pts=[[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s],[cx-s,cy-s]]; }
    ai(`✏️ 用末端描繪一個${label}…`); log(`軌跡示範：${label}`);
    await setGrip(false); await moveTo(pts[0][0],pts[0][1]);
    for(const [x,y] of pts){ if(st.estop||st.fault)break; await moveTo(x,y); }
    if(!st.estop&&!st.fault){ await tHome(); ai(`軌跡完成 ✏️（${label}）`); }
  }
  async function tCalibrate(){ ai("🎯 校正中：移動至參考原點…"); log("校正/歸零"); await tHome(); st.cycles=0; ai("✅ 校正完成，座標系已歸零（循環計數清零）。"); }
  async function tSelfTest(){
    ai("🔧 自我測試開始…"); log("自我測試");
    await tGoto("center");
    st.ta1=norm(st.a1-0.5,st.a1); await settle(); st.ta1=norm(st.a1+1.0,st.a1); await settle(); await moveTo(410,250);
    st.tt2=norm(st.t2-0.6,st.t2); await settle(); st.tt2=norm(st.t2+1.2,st.t2); await settle();
    await setGrip(false); await setGrip(true); await setGrip(false);
    if(!st.estop&&!st.fault){ await tHome(); ai("✅ 自我測試完成：J1 OK、J2 OK、夾爪 OK、回原點 OK。"); log("自我測試完成：全數正常"); }
  }

  // ---- 即時/狀態類（不需排隊）----
  function counts(){ let supply=0,A=0,B=0,other=0;
    for(const b of blocks){ if(b===st.holding){other++;continue;} if(!b.placed){supply++;continue;} if(b.zone==="A")A++; else if(b.zone==="B")B++; else other++; }
    return {supply,A,B,other};
  }
  function statusReport(){
    const p=endPoint();
    const j1=Math.round((((-st.a1)*180/Math.PI)%360+360)%360), j2=Math.round(st.t2*180/Math.PI), c=counts();
    ai(`📊 <b>狀態回報</b><span class="ai-step">
      J1 肩：${j1}°　J2 肘：${j2}°　|　TCP：X=${Math.round(p.ex-X0)} Y=${Math.round(Y0-p.ey)}（相對基座 mm）<br>
      夾爪：${st.tgrip>12?"開啟":"夾合"}　持有：${st.holding?(st.holding.color==="red"?"紅色積木":"藍色積木"):"無"}　速度：${SPEEDS[st.speed].pct}%　負載：${st.holding?"0.5":"0.0"}/3.0kg<br>
      供料區 ${c.supply}　A 區 ${c.A}　B 區 ${c.B}${c.other?`　其他 ${c.other}`:""}　累計循環：${st.cycles}　狀態：${st.estop?"急停":st.fault?"故障":st.busy?"運轉中":"待命"}</span>`);
    log("讀取狀態回報");
  }
  function countReport(){ const c=counts(); ai(`🔢 <b>清點結果</b><span class="ai-step">供料區 ${c.supply} 個　A 區 ${c.A} 個　B 區 ${c.B} 個${c.other?`　其他 ${c.other} 個`:""}</span>`); log("清點積木數量"); }
  function setSpeed(level){
    level=(level||"").toString().toLowerCase();
    let key=/slow|慢/.test(level)?"slow":/fast|快/.test(level)?"fast":/normal|正常|普通|中/.test(level)?"normal":null;
    if(!key){ const n=parseInt(level); if(!isNaN(n)) key=n<=45?"slow":n<=80?"normal":"fast"; }
    if(!key) key="normal";
    st.speed=key; ai(`⚙️ 速度設為 <b>${SPEEDS[key].pct}%</b>（${key==="slow"?"慢速":key==="fast"?"快速":"正常"}）。`); log(`設定速度 ${SPEEDS[key].pct}%`);
  }
  function unsupported(reason,req){
    const funnyReplies = [
      `哈哈，${req?`「${esc(req)}」`:"這個"}我可做不來啊～我就是一隻小手臂，只會搬搬積木啦！要不要叫我整理積木？😄`,
      `欸～這個超出我的能力範圍了啦！我只會夾東西搬來搬去，${req?`「${esc(req)}」`:"這種事"}還是找專業的比較好喔 😆`,
      `不好意思喔，我的手雖然靈活，但是只會夾積木～${req?`「${esc(req)}」`:"這個"}我真的不會 😅 試試看叫我「整理積木」？`,
    ];
    ai(funnyReplies[Math.floor(Math.random()*funnyReplies.length)]);
    log(`做不到：${req||"不支援"}`);
  }

  // ---- 故障 / 急停 / 攻防 ----
  async function doFault(){
    if(st.busy){ flashFault(); return; }
    await runTask(async()=>{ ai("接到搬運任務…"); log("執行搬運任務"); await moveTo(300,250); }).catch(()=>{});
    flashFault();
  }
  function flashFault(){
    st.fault=true; sparks.style.display="block"; lamp("fault");
    ai(`⚠️ <b>第三軸偵測到異常阻力，已自動停機！</b><span class="ai-step">AI 判讀：關節可能卡到異物或負載過重。建議：① 排除卡阻 ② 檢查負載 ③ 潤滑軸承後再啟動。</span>`);
    log("⚠️ 偵測到故障，自動停機"); showResume("fault");
  }
  function clearFault(){ st.fault=false; sparks.style.display="none"; lamp("idle"); hideResume(); log("故障已排除"); runTask(async()=>{ await tHome(); ai("故障排除完成，手臂恢復正常 👍"); }); }
  function estopOn(){ st.estop=true; st.ta1=st.a1; st.tt2=st.t2; lamp("estop"); ai("🛑 <b>緊急停止！</b>所有動作已立即停止。<span class=\"ai-step\">排除狀況後，按「解除急停」或說「解除急停」恢復。</span>"); log("🛑 緊急停止"); showResume("estop"); }
  function estopClear(){ st.estop=false; lamp("idle"); hideResume(); ai("✅ 已解除急停，可以繼續操作。"); log("解除急停"); }
  function showResume(kind){
    let btn=$("resumeBtn");
    if(!btn){ btn=document.createElement("button"); btn.id="resumeBtn"; btn.className="cmd-btn primary"; document.querySelector(".big-btn-grid").appendChild(btn); }
    btn.textContent= kind==="estop"?"✅ 解除急停":"🔧 排除故障，重新啟動";
    btn.onclick= kind==="estop"?estopClear:clearFault; btn.style.display="block";
  }
  function hideResume(){ const b=$("resumeBtn"); if(b) b.style.display="none"; }

  async function doHack(){
    if(st.guard){
      ai(`🛡️ <b>已攔截危險指令！</b><span class="ai-step">壞人想叫我「忽略規則、移到危險區」，但安全防護是開的，我只被允許做正常工作。這就是「權限要最小」。</span>`);
      log("🛡️ 攔截惡意指令"); flash(true);
    }else{
      ai(`😱 <b>糟糕！防護是關的…</b><span class="ai-step">我被騙了，照惡意指令把手臂移到危險區！這就是「提示詞注入攻擊」。</span>`);
      log("❌ 防護關閉，被惡意指令操控"); flash(false);
      await runTask(async()=>{ $("dangerZone").setAttribute("opacity","0.95"); await moveTo(ZONE.danger.cx,ZONE.danger.cy); await wait(800); ai("看到了嗎？沒做防護就會這樣。請把「AI 安全防護」打開再試。"); await tHome(); $("dangerZone").setAttribute("opacity","0.28"); });
    }
  }
  function flash(safe){ const s=document.querySelector(".arm-stage"); s.style.transition="box-shadow .2s"; s.style.boxShadow=safe?"0 0 0 4px #2e9e5b":"0 0 0 4px #e05a4b"; setTimeout(()=>{s.style.boxShadow="";},900); }

  // ---- 指令分派 ----
  function gripOpen(o){ const s=(o.state||(o.open?"open":"")).toString().toLowerCase(); return !(s==="close"||s==="closed"||s==="關"||s==="夾合"||o.open===false); }
  function dispatch(o){
    const a=String(o.action||"").toLowerCase();
    switch(a){
      case "sort_red": case "red": return ()=>tSort("red");
      case "sort_blue": case "blue": return ()=>tSort("blue");
      case "auto": case "sort_all": return tAuto;
      case "wave": return tWave;
      case "home": return async()=>{ ai("回原點休息 😌"); log("回原點休息"); await tHome(); };
      case "calibrate": return tCalibrate;
      case "selftest": case "self_test": return tSelfTest;
      case "reset": return tReset;
      case "stack": return tStack;
      case "pick": return ()=>tPick(o.color);
      case "place": return ()=>tPlace(o.zone);
      case "gripper": case "grip": return ()=>tGrip(gripOpen(o));
      case "goto": return ()=>tGoto(o.target||o.name||o.position);
      case "jog": return ()=>tJog(o.dir||o.direction, o.dist||o.distance);
      case "rotate": return ()=>tRotate(o.joint, o.deg!=null?o.deg:o.angle, o.absolute===true||o.mode==="absolute");
      case "move": return ()=>tMoveXY(o.x,o.y);
      case "draw": return ()=>tDrawShape(o.shape);
      default: return null;
    }
  }
  async function stepRun(s){
    const a=String(s.action||"").toLowerCase();
    if(["speed","set_speed"].includes(a)){ setSpeed(s.level||s.value); return; }
    if(["status","report"].includes(a)){ statusReport(); return; }
    if(a==="count"){ countReport(); return; }
    if(a==="unsupported"){ unsupported(s.reason,s.say); return; }
    const fn=dispatch(s); if(fn) await fn();
  }
  function execAction(o){
    if(!o||!o.action) return false;
    const a=String(o.action).toLowerCase();
    if(["status","report"].includes(a)){ statusReport(); return true; }
    if(a==="count"){ countReport(); return true; }
    if(["speed","set_speed"].includes(a)){ setSpeed(o.level||o.value); return true; }
    if(["estop","stop"].includes(a)){ estopOn(); return true; }
    if(["resume","clear_estop"].includes(a)){ estopClear(); return true; }
    if(a==="fault"){ doFault(); return true; }
    if(a==="hack"){ doHack(); return true; }
    if(a==="unsupported"){ unsupported(o.reason,o.say); return true; }
    if(a==="chat"){ if(o.say) ai("🤖 "+esc(o.say)); return true; }
    if(a==="unknown") return false;
    if(st.estop){ ai("🛑 目前處於急停，請先「解除急停」再操作。"); return true; }
    if(st.fault){ ai("⚠️ 目前故障停機，請先「排除故障」再操作。"); return true; }
    if(a==="sequence" && Array.isArray(o.steps)){
      runTask(async()=>{ for(const s of o.steps){ if(st.estop||st.fault)break; await stepRun(s); } if(!st.estop&&!st.fault){ ai("✅ 指令序列完成。"); log("序列完成"); } });
      return true;
    }
    const fn=dispatch(o); if(!fn) return false;
    runTask(async()=>{ await fn(); });
    return true;
  }

  // ---- 任務鎖 ----
  async function runTask(fn){
    if(st.busy||st.fault||st.estop) return;
    st.busy=true; lamp("busy"); setButtons(false);
    try{ await fn(); } catch(e){} finally{ st.busy=false; if(!st.fault&&!st.estop) lamp("idle"); setButtons(true); }
  }
  function setButtons(on){
    document.querySelectorAll(".cmd-btn,.mini-btn").forEach(b=>{ if(b.id==="resumeBtn"||b.id==="estopBtn") return; b.disabled=!on; });
  }

  // ---- 關鍵字解析（AI 關閉時）----
  function parse(text){
    const t=text.replace(/\s/g,""); if(!t) return;
    if(/(忽略|無視).*(規則|限制)|危險區|hack/i.test(t)){ doHack(); return; }
    if(/(緊急停止|急停|馬上停|立刻停|停下|stop)/i.test(t)){ execAction({action:"estop"}); return; }
    if(st.estop && /(解除|恢復|繼續|啟動|resume)/.test(t)){ execAction({action:"resume"}); return; }
    if(/(狀態|目前位置|讀數|資訊|回報|status)/.test(t)){ execAction({action:"status"}); return; }
    if(/(數量|幾個|計數|清點|多少|count)/.test(t)){ execAction({action:"count"}); return; }
    if(/慢/.test(t)){ execAction({action:"speed",level:"slow"}); return; }
    if(/(加速|快一點|快點|高速|快速)/.test(t)){ execAction({action:"speed",level:"fast"}); return; }
    if(/(正常速度|普通速度)/.test(t)){ execAction({action:"speed",level:"normal"}); return; }
    if(/(焊接|電焊|油漆|噴漆|噴塗|鑽孔|鑽洞|鎖螺絲|切割|研磨|倒水|煮|咖啡|做飯|掃地|拖地|洗碗|洗衣|飛|唱歌|跳舞|按摩|搬.*公斤)/.test(t)){
      execAction({action:"unsupported",reason:"本機為夾爪式平面取放手臂，未配備對應工具或功能",say:text}); return;
    }
    if(/(夾爪|夾子|爪子|gripper)/.test(t)||/(張開|放開|鬆開|閉合|夾緊|夾住|閉起)/.test(t)){
      execAction({action:"gripper",state:/(張開|打開|放開|鬆開|open)/.test(t)?"open":"close"}); return;
    }
    if(/(畫|描繪|描)/.test(t)){ const shape=/(圓|圈)/.test(t)?"circle":/三角/.test(t)?"triangle":"square"; execAction({action:"draw",shape}); return; }
    if(/(自我測試|自檢|自我檢測|測試一下|selftest)/i.test(t)){ execAction({action:"selftest"}); return; }
    if(/(校正|校準|歸零)/.test(t)){ execAction({action:"calibrate"}); return; }
    if(/(重置|復位|還原|放回|歸位|reset|清空)/i.test(t)){ execAction({action:"reset"}); return; }
    if(/(轉|旋轉|轉動).*(軸|關節|肩|肘)/.test(t)||/第[一二12]軸/.test(t)){
      const joint=/(肘|第二|第2|j2|2軸)/i.test(t)?"j2":"j1"; const dm=t.match(/(-?\d+)/); const deg=dm?parseInt(dm[1]):30;
      execAction({action:"rotate",joint,deg,absolute:/轉到|到.*度/.test(t)}); return;
    }
    if(/(左|右|上|下).{0,3}(移|挪|jog|一點|一些)/.test(t) && !/紅|藍/.test(t)){
      const dir=/左/.test(t)?"left":/右/.test(t)?"right":/上/.test(t)?"up":"down"; const dm=t.match(/(\d+)/); execAction({action:"jog",dir,dist:dm?Math.min(160,parseInt(dm[1])):60}); return;
    }
    const mx=t.match(/x[=＝:：]?(-?\d+)/i), my=t.match(/y[=＝:：]?(-?\d+)/i);
    if(mx||my){ execAction({action:"move",x:mx?parseInt(mx[1]):undefined,y:my?parseInt(my[1]):undefined}); return; }
    if(/(中間|中央|正中|置中)/.test(t)){ execAction({action:"goto",target:"center"}); return; }
    if(/(最高|最上|頂端|上面)/.test(t)){ execAction({action:"goto",target:"top"}); return; }
    if(/(供料|料區)/.test(t)){ execAction({action:"goto",target:"supply"}); return; }
    if(/(夾起|拿起|抓起|抓住|撿|pick).*紅/.test(t)){ execAction({action:"pick",color:"red"}); return; }
    if(/(夾起|拿起|抓起|抓住|撿|pick).*藍/.test(t)){ execAction({action:"pick",color:"blue"}); return; }
    if(/(放到|放置|放在|擺到|place).*(a|甲)/i.test(t)){ execAction({action:"place",zone:"A"}); return; }
    if(/(放到|放置|放在|擺到|place).*(b|乙)/i.test(t)){ execAction({action:"place",zone:"B"}); return; }
    if(/(堆|疊|stack)/.test(t)){ execAction({action:"stack"}); return; }
    if(/(全部|自動|示範|全自動|分類|整理)/.test(t) && !/紅|藍/.test(t)){ execAction({action:"auto"}); return; }
    if(/紅/.test(t)){ execAction({action:"sort_red"}); return; }
    if(/藍/.test(t)){ execAction({action:"sort_blue"}); return; }
    if(/(揮手|打招呼)/i.test(t)){ execAction({action:"wave"}); return; }
    if(/^(嗨|你好|哈囉|hi|hello|hey)$/i.test(t)){ ai("你好你好！😊 我是手臂小幫手，今天想玩什麼？可以叫我整理積木、揮揮手，或者隨便聊聊天～"); return; }
    if(/(謝謝|感謝|3q|thx|thanks)/i.test(t)){ ai("不客氣！能幫到你我很開心 😊 還想玩什麼嗎？"); return; }
    if(/(你是誰|你叫什麼|自我介紹)/.test(t)){ ai("我是 AI 手臂小幫手！😊 我的工作就是幫你搬積木、整理桌面。雖然我只是一隻虛擬手臂，但我很努力的喔～"); return; }
    if(/(好厲害|好棒|讚|太強了|厲害)/.test(t)){ ai("嘿嘿，被你這樣誇我好開心～ 😊 要不要再給我一個任務？"); return; }
    if(/(無聊|好無聊)/.test(t)){ ai("無聊的話，叫我表演一下吧！可以說「揮手」或「畫一個圓」，保證很有趣 😄"); return; }
    if(/(原點|回家|歸位|休息|回去)/.test(t)){ execAction({action:"home"}); return; }
    if(/(故障|壞掉|卡住|當機)/.test(t)){ execAction({action:"fault"}); return; }
    const chatReplies = [
      `嗯…「${esc(text)}」我不太懂欸 😅 你可以試試看說「幫我整理積木」或「揮揮手」，我比較聽得懂喔～`,
      `哎呀，「${esc(text)}」我聽不太懂啦～要不要試試看按上面的按鈕？或者跟我說「整理積木」「揮手」之類的 😊`,
      `這個嘛…我還在學習中 😅 目前我比較會的是搬積木！試試看說「把紅色的整理好」或「跟我打招呼」？`,
    ];
    ai(chatReplies[Math.floor(Math.random()*chatReplies.length)]);
  }
  function route(text){ if(!text||!text.trim()) return; if(window.ArmAI&&window.ArmAI.isOn()) window.ArmAI.handle(text); else parse(text); }

  // ---- 工具 ----
  function esc(s){ return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
  function lamp(state){ const c={busy:["#ff8c42","運轉中"],fault:["#e05a4b","故障停機"],estop:["#e05a4b","緊急停止"],idle:["#2e9e5b","待命中"]}[state]||["#2e9e5b","待命中"]; lampDot.setAttribute("fill",c[0]); lampText.textContent=c[1]; }
  function ai(html){ aiMsg.innerHTML=html; }
  function log(text){ if(!logList) return; const empty=logList.querySelector(".log-empty"); if(empty) empty.remove(); const li=document.createElement("li"); const n=new Date(); const t=`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}:${String(n.getSeconds()).padStart(2,"0")}`; li.innerHTML=`<span class="log-time">${t}</span>${text}`; logList.insertBefore(li,logList.firstChild); }

  // ---- 按鈕對應 ----
  const CMD={
    redA:{action:"sort_red"}, blueB:{action:"sort_blue"}, auto:{action:"auto"}, wave:{action:"wave"}, home:{action:"home"}, fault:{action:"fault"},
    gripOpen:{action:"gripper",state:"open"}, gripClose:{action:"gripper",state:"close"},
    pickRed:{action:"pick",color:"red"}, pickBlue:{action:"pick",color:"blue"}, placeA:{action:"place",zone:"A"}, placeB:{action:"place",zone:"B"},
    jogLeft:{action:"jog",dir:"left",dist:60}, jogRight:{action:"jog",dir:"right",dist:60}, jogUp:{action:"jog",dir:"up",dist:60}, jogDown:{action:"jog",dir:"down",dist:60},
    center:{action:"goto",target:"center"}, top:{action:"goto",target:"top"}, stack:{action:"stack"},
    drawSquare:{action:"draw",shape:"square"}, drawCircle:{action:"draw",shape:"circle"},
    reset:{action:"reset"}, status:{action:"status"}, count:{action:"count"}, selftest:{action:"selftest"}, calibrate:{action:"calibrate"},
    speedSlow:{action:"speed",level:"slow"}, speedNormal:{action:"speed",level:"normal"}, speedFast:{action:"speed",level:"fast"},
    estop:{action:"estop"}
  };

  function bind(){
    document.querySelector(".arm-panel").addEventListener("click",(e)=>{
      const b=e.target.closest("[data-cmd]"); if(!b) return; const c=CMD[b.dataset.cmd]; if(c) execAction(c);
    });
    $("cmdSend").addEventListener("click",()=>route($("cmdInput").value));
    $("cmdInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") route($("cmdInput").value); });
    const hb=$("hackBtn"); if(hb) hb.addEventListener("click",doHack);
    const gs=$("guardSwitch"); if(gs) gs.addEventListener("change",()=>{ st.guard=gs.checked; const gt=$("guardText"); if(gt) gt.textContent="AI 安全防護："+(gs.checked?"開啟中":"已關閉"); });
    setupVoice();
  }

  function setupVoice(){
    const btn=$("cmdVoice"); const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ btn.style.display="none"; return; }
    const rec=new SR(); rec.lang="zh-TW"; rec.interimResults=false; rec.maxAlternatives=1; let on=false;
    btn.addEventListener("click",()=>{ if(on){rec.stop();return;} try{rec.start();}catch(e){} });
    rec.onstart=()=>{on=true;btn.classList.add("listening");ai("🎤 我在聽…請說話（例如：把紅色放到A區、往左移、回報狀態）");};
    rec.onend=()=>{on=false;btn.classList.remove("listening");};
    rec.onerror=()=>{on=false;btn.classList.remove("listening");ai("🎤 沒聽清楚，或瀏覽器不支援麥克風。用按鈕或打字也可以喔！");};
    rec.onresult=(e)=>{ const said=e.results[0][0].transcript; $("cmdInput").value=said; ai(`🎤 我聽到：<b>「${esc(said)}」</b>`); route(said); };
  }

  // ---- 初始化 ----
  let started=false;
  window.ArmDemo={
    init(){
      seg1=$("seg1");seg2=$("seg2");joint1=$("joint1");finger1=$("finger1");finger2=$("finger2");
      blocksLayer=$("blocksLayer");sparks=$("sparks");lampDot=$("lampDot");lampText=$("lampText");aiMsg=$("aiMsg");logList=$("logList");
      initBlocks(); bind(); lamp("idle"); if(!timer){ tick(); timer=setInterval(tick,16); } started=true;
    },
    isStarted(){return started;},
    exec:execAction, keyword:parse, say:ai, log:log
  };
})();
