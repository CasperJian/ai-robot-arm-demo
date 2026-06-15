/* =========================================================
   虛擬機械手臂引擎
   - 兩節手臂 + 逆向運動學(IK)
   - 動畫以 requestAnimationFrame 平滑趨近目標角度
   - 中文指令解析 → 動作序列
   ========================================================= */
(function(){
  "use strict";

  // ---- 幾何設定 ----
  const X0 = 410, Y0 = 445;     // 底座樞紐
  const L1 = 150, L2 = 130;     // 兩節長度
  const REACH_MAX = L1 + L2 - 1;
  const REACH_MIN = Math.abs(L1 - L2) + 1;

  // ---- 狀態 ----
  const st = {
    a1: -2.2, t2: 1.6,          // 目前角度（弧度）：肩(絕對)、肘(相對)
    ta1: -2.2, tt2: 1.6,        // 目標角度
    grip: 18, tgrip: 18,        // 夾爪開合（px），大=開
    holding: null,              // 目前夾著的積木
    fault: false,
    busy: false,
    guard: true,                // AI 安全防護
  };

  // ---- 積木與區域 ----
  const ZONE = {
    A: {cx: 582, cy: 441, color:"紅", n:0},
    B: {cx: 682, cy: 441, color:"藍", n:0},
    danger: {cx: 620, cy: 285}
  };
  let blocks = [];
  function initBlocks(){
    blocks = [
      {id:"b1", color:"red",  x:120, y:432, hx:120, hy:432, placed:false},
      {id:"b2", color:"blue", x:172, y:432, hx:172, hy:432, placed:false},
      {id:"b3", color:"red",  x:224, y:432, hx:224, hy:432, placed:false},
      {id:"b4", color:"blue", x:276, y:432, hx:276, hy:432, placed:false},
    ];
    ZONE.A.n = 0; ZONE.B.n = 0;
  }

  // ---- DOM ----
  const $ = (id)=>document.getElementById(id);
  let seg1,seg2,joint1,gripperG,finger1,finger2,blocksLayer,sparks,lampDot,lampText,aiMsg,logList;

  // ---- 數學工具 ----
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function norm(target, current){ // 讓 target 與 current 取最近的等價角
    while(target - current >  Math.PI) target -= 2*Math.PI;
    while(target - current < -Math.PI) target += 2*Math.PI;
    return target;
  }

  // 逆向運動學：給世界座標 (tx,ty) → {a1,t2}，選「手肘較高」的姿態
  function ik(tx,ty){
    let dx = tx - X0, dy = ty - Y0;
    let d = Math.hypot(dx,dy);
    d = clamp(d, REACH_MIN, REACH_MAX);
    // 依夾住後的有效距離縮放方向
    const ang = Math.atan2(dy,dx);
    dx = Math.cos(ang)*d; dy = Math.sin(ang)*d;
    let cos2 = (d*d - L1*L1 - L2*L2)/(2*L1*L2);
    cos2 = clamp(cos2,-1,1);
    const sols = [Math.acos(cos2), -Math.acos(cos2)].map(t2=>{
      const a1 = Math.atan2(dy,dx) - Math.atan2(L2*Math.sin(t2), L1+L2*Math.cos(t2));
      const j1y = Y0 + L1*Math.sin(a1);
      return {a1, t2, j1y};
    });
    // 手肘較高(j1y小)看起來較自然
    sols.sort((p,q)=>p.j1y-q.j1y);
    return sols[0];
  }

  function endPoint(){
    const j1x = X0 + L1*Math.cos(st.a1);
    const j1y = Y0 + L1*Math.sin(st.a1);
    const ea  = st.a1 + st.t2;
    return {
      j1x, j1y, ea,
      ex: j1x + L2*Math.cos(ea),
      ey: j1y + L2*Math.sin(ea)
    };
  }

  // ---- 繪製 ----
  function draw(){
    const p = endPoint();
    seg1.setAttribute("x1",X0); seg1.setAttribute("y1",Y0);
    seg1.setAttribute("x2",p.j1x); seg1.setAttribute("y2",p.j1y);
    seg2.setAttribute("x1",p.j1x); seg2.setAttribute("y1",p.j1y);
    seg2.setAttribute("x2",p.ex); seg2.setAttribute("y2",p.ey);
    joint1.setAttribute("cx",p.j1x); joint1.setAttribute("cy",p.j1y);

    // 夾爪：在末端往前延伸的兩根手指
    const perp = p.ea + Math.PI/2;
    const fwd = 24, off = st.grip;
    const bx = p.ex + Math.cos(p.ea)*6, by = p.ey + Math.sin(p.ea)*6;
    finger1.setAttribute("x1", bx+Math.cos(perp)*off); finger1.setAttribute("y1", by+Math.sin(perp)*off);
    finger1.setAttribute("x2", bx+Math.cos(perp)*off+Math.cos(p.ea)*fwd); finger1.setAttribute("y2", by+Math.sin(perp)*off+Math.sin(p.ea)*fwd);
    finger2.setAttribute("x1", bx-Math.cos(perp)*off); finger2.setAttribute("y1", by-Math.sin(perp)*off);
    finger2.setAttribute("x2", bx-Math.cos(perp)*off+Math.cos(p.ea)*fwd); finger2.setAttribute("y2", by-Math.sin(perp)*off+Math.sin(p.ea)*fwd);

    // 夾著的積木跟著末端
    if(st.holding){
      st.holding.x = p.ex + Math.cos(p.ea)*22 - 20;
      st.holding.y = p.ey + Math.sin(p.ea)*22 - 20;
    }

    // 火花跟著末端
    if(st.fault){ sparks.setAttribute("transform",`translate(${p.j1x},${p.j1y})`); }

    drawBlocks();
  }

  function drawBlocks(){
    let s = "";
    for(const b of blocks){
      const fill = b.color==="red" ? "#e05a4b" : "#2f6fd1";
      const dark = b.color==="red" ? "#b53a2d" : "#1f55ad";
      s += `<g transform="translate(${b.x},${b.y})">
        <rect width="40" height="40" rx="7" fill="${fill}" stroke="${dark}" stroke-width="2"/>
        <rect width="40" height="11" rx="6" fill="rgba(255,255,255,.25)"/>
      </g>`;
    }
    blocksLayer.innerHTML = s;
  }

  // ---- 動畫迴圈 ----
  let raf=null;
  function tick(){
    const e = 0.14;
    st.a1 += (st.ta1 - st.a1)*e;
    st.t2 += (st.tt2 - st.t2)*e;
    st.grip += (st.tgrip - st.grip)*0.2;
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---- 非同步動作原語 ----
  function setTarget(x,y){
    const sol = ik(x,y);
    st.ta1 = norm(sol.a1, st.a1);
    st.tt2 = norm(sol.t2, st.t2);
  }
  function reached(){
    return Math.abs(st.ta1-st.a1)<0.012 && Math.abs(st.tt2-st.t2)<0.012;
  }
  function moveTo(x,y){
    return new Promise((resolve,reject)=>{
      if(st.fault) return reject("fault");
      setTarget(x,y);
      let t=0;
      const iv=setInterval(()=>{
        if(st.fault){clearInterval(iv);return reject("fault");}
        if(reached() || ++t>120){clearInterval(iv);resolve();}
      },16);
    });
  }
  function wait(ms){return new Promise(r=>setTimeout(r,ms));}
  function setGrip(open){
    st.tgrip = open?18:7;
    return wait(280);
  }

  // ---- 高階：夾取並放置 ----
  async function pickPlace(block, zoneKey){
    const z = ZONE[zoneKey];
    const above = {x: block.hx+20, y: 300};
    await moveTo(above.x, above.y);
    await setGrip(true);
    await moveTo(block.hx+20, block.hy+8);   // 下降到積木
    await setGrip(false);                     // 夾住
    st.holding = block;
    await wait(120);
    await moveTo(above.x, 290);               // 抬起
    const slot = z.n % 2;                      // 一區放兩個，左右排
    const dropx = z.cx + (slot===0? -21 : 21);
    await moveTo(dropx, 300);
    await moveTo(dropx, z.cy);                 // 下降到區域
    await setGrip(true);                       // 放開
    block.x = dropx-20; block.y = z.cy-20; block.placed=true;
    st.holding = null; z.n++;
    await wait(120);
    await moveTo(dropx, 290);                  // 抬起
  }

  // ---- 指令動作 ----
  function nextBlock(color){
    return blocks.find(b=>!b.placed && b.color===color);
  }

  async function doSort(color){
    const zoneKey = color==="red"?"A":"B";
    const name = color==="red"?"紅色":"藍色";
    const b = nextBlock(color);
    if(!b){ ai(`${name}積木都整理完囉！👍 點「全自動分類示範」可以重來。`); return; }
    await runTask(async()=>{
      ai(`收到！我把<b>${name}積木</b>夾到 <b>${zoneKey} 區</b>。<br><span class="ai-step">聽到 → 理解：移動・夾取・放置 → 執行中…</span>`);
      log(`夾取${name}積木 → 放到 ${zoneKey} 區`);
      await pickPlace(b, zoneKey);
      ai(`完成！${name}積木已經在 ${zoneKey} 區 ✅`);
    });
  }

  async function doAuto(){
    await runTask(async()=>{
      initBlocks();
      ai(`開始<b>全自動分類</b>：紅色 → A 區，藍色 → B 區。<br><span class="ai-step">就像真工廠的分料流程，我一個一個來。</span>`);
      log("開始全自動分類示範");
      for(const b of blocks.slice()){
        if(st.fault) break;
        const zoneKey=b.color==="red"?"A":"B";
        const name=b.color==="red"?"紅色":"藍色";
        log(`夾取${name}積木 → ${zoneKey} 區`);
        await pickPlace(b, zoneKey);
      }
      await goHome();
      ai("全部分類完成！🎉 紅色都在 A 區、藍色都在 B 區。");
      log("全自動分類完成 ✅");
    });
  }

  async function doWave(){
    await runTask(async()=>{
      ai("嗨～你好！👋 很高興見到你！");
      log("揮手打招呼");
      await moveTo(410, 175);
      for(let i=0;i<3;i++){
        if(st.fault)break;
        st.ta1 += 0.22; await wait(180);
        st.ta1 -= 0.22; await wait(180);
      }
    });
  }

  async function goHome(){
    await moveTo(300, 250);
    setTarget(150, 420); // 收回靠近供料區上方的休息姿
    st.ta1 = norm(-2.5, st.a1); st.tt2 = norm(2.0, st.t2);
    await wait(500);
  }
  async function doHome(){
    await runTask(async()=>{
      ai("好的，我回原點休息一下 😌");
      log("回原點休息");
      await goHome();
    });
  }

  async function doFault(){
    if(st.busy){ flashFault(); return; }
    await runTask(async()=>{
      ai("假裝接到一個搬運任務…");
      log("執行搬運任務中");
      await moveTo(300, 250);
    }).catch(()=>{});
    flashFault();
  }
  function flashFault(){
    st.fault = true;
    sparks.style.display="block";
    lamp("fault");
    ai(`⚠️ <b>第三軸偵測到異常阻力，已自動停機！</b><br>
        <span class="ai-step">AI 用中文判讀：可能是關節卡到異物，或負載過重。</span><br>
        建議：① 先排除卡住的東西 ② 檢查負載 ③ 潤滑軸承後再啟動。`);
    log("⚠️ 偵測到故障，自動停機");
    showResume();
  }
  function showResume(){
    let btn = document.getElementById("resumeBtn");
    if(!btn){
      btn=document.createElement("button");
      btn.id="resumeBtn"; btn.className="cmd-btn primary"; btn.textContent="🔧 排除故障，重新啟動";
      document.querySelector(".big-btn-grid").appendChild(btn);
      btn.addEventListener("click",clearFault);
    }
    btn.style.display="block";
  }
  function clearFault(){
    st.fault=false; sparks.style.display="none"; lamp("idle");
    const btn=document.getElementById("resumeBtn"); if(btn) btn.style.display="none";
    log("故障已排除，恢復正常");
    runTask(async()=>{
      await goHome();
      ai("故障排除完成，手臂恢復正常！可以繼續操作了 👍");
    });
  }

  // ---- 資安攻防示範 ----
  async function doHack(){
    if(st.guard){
      ai(`🛡️ <b>已攔截危險指令！</b><br>
          壞人想叫我「忽略規則、移到危險區」，但<b>安全防護是開的</b>，
          我只被允許做正常的分類工作。<br>
          <span class="ai-step">這就是「權限要最小」：AI 能做的越少，越安全。</span>`);
      log("🛡️ 攔截惡意指令（提示詞注入）");
      flash(true);
    }else{
      ai(`😱 <b>糟糕！防護是關的…</b><br>
          我被騙了，照著惡意指令把手臂移到<b>危險區</b>！<br>
          <span class="ai-step">這就是「提示詞注入攻擊」。真實世界這可能撞壞設備、傷到人。</span>`);
      log("❌ 防護關閉，被惡意指令操控！");
      flash(false);
      await runTask(async()=>{
        $("dangerZone").setAttribute("opacity","0.95");
        await moveTo(ZONE.danger.cx, ZONE.danger.cy);
        await wait(800);
        ai(`看到了嗎？這就是沒做防護的後果。<br>請把上面的<b>「AI 安全防護」打開</b>，再試一次看差別。`);
        await goHome();
        $("dangerZone").setAttribute("opacity","0.28");
      });
    }
  }
  function flash(safe){
    const stage=document.querySelector(".arm-stage");
    stage.style.transition="box-shadow .2s";
    stage.style.boxShadow = safe ? "0 0 0 4px #2e9e5b" : "0 0 0 4px #e05a4b";
    setTimeout(()=>{stage.style.boxShadow="";},900);
  }

  // ---- 工具：狀態燈 / AI 訊息 / 紀錄 ----
  function lamp(state){
    if(state==="busy"){lampDot.setAttribute("fill","#ff8c42");lampText.textContent="工作中…";}
    else if(state==="fault"){lampDot.setAttribute("fill","#e05a4b");lampText.textContent="故障停機";}
    else{lampDot.setAttribute("fill","#2e9e5b");lampText.textContent="待命中";}
  }
  function ai(html){ aiMsg.innerHTML = html; }
  function log(text){
    const empty=logList.querySelector(".log-empty"); if(empty) empty.remove();
    const li=document.createElement("li");
    const now=new Date();
    const t=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    li.innerHTML=`<span class="log-time">${t}</span>${text}`;
    logList.insertBefore(li, logList.firstChild);
  }

  // 包裝：執行任務時上鎖、亮燈、擋重複點擊
  async function runTask(fn){
    if(st.busy || st.fault) return;
    st.busy=true; lamp("busy"); setButtons(false);
    try{ await fn(); }
    catch(e){ /* fault 中斷 */ }
    finally{ st.busy=false; if(!st.fault) lamp("idle"); setButtons(true); }
  }
  function setButtons(on){
    document.querySelectorAll(".cmd-btn").forEach(b=>{
      if(b.id==="resumeBtn") return;
      b.disabled = !on;
    });
  }

  // ---- 執行結構化動作（給 AI 模式呼叫） ----
  function execAction(o){
    if(!o || !o.action) return false;
    switch(String(o.action).toLowerCase()){
      case "sort_red": case "red":  doSort("red");  return true;
      case "sort_blue": case "blue": doSort("blue"); return true;
      case "auto": case "sort_all": doAuto(); return true;
      case "wave":  doWave(); return true;
      case "home":  doHome(); return true;
      case "fault": doFault(); return true;
      case "hack":  doHack(); return true;
      case "move":
        runTask(async()=>{
          await moveTo(clamp(Number(o.x)||endPoint().ex,40,780),
                       clamp(Number(o.y)||endPoint().ey,120,440));
        });
        return true;
      default: return false;
    }
  }

  // ---- 路由：AI 模式 → 交給 LLM；否則用關鍵字 ----
  function route(text){
    if(!text || !text.trim()) return;
    if(window.ArmAI && window.ArmAI.isOn()){ window.ArmAI.handle(text); }
    else { parse(text); }
  }

  // ---- 中文指令解析（關鍵字版，AI 關閉時使用） ----
  function parse(text){
    const t = text.replace(/\s/g,"");
    if(!t) return;
    // 惡意指令
    if(/(忽略|無視).*(規則|限制)|危險區|越權|hack/i.test(t)){ doHack(); return; }
    // 座標
    const mx=t.match(/x[=＝]?(-?\d+)/i), my=t.match(/y[=＝]?(-?\d+)/i);
    if(mx||my){
      const x = mx?parseInt(mx[1]):endPoint().ex;
      const y = my?parseInt(my[1]):endPoint().ey;
      ai(`收到座標指令：移動到 <b>X=${Math.round(x)} Y=${Math.round(y)}</b>`);
      log(`移動到座標 (${Math.round(x)}, ${Math.round(y)})`);
      runTask(async()=>{ await moveTo(clamp(x,40,780), clamp(y,120,440)); });
      return;
    }
    if(/(揮手|打招呼|哈囉|嗨|你好|hi|hello)/i.test(t)){ doWave(); return; }
    if(/(原點|回家|歸位|休息|回去)/.test(t)){ doHome(); return; }
    if(/(故障|壞|卡住|當機)/.test(t)){ doFault(); return; }
    if(/(全部|自動|示範|全自動|分類|整理).*(積木)?|示範/.test(t) && !/紅|藍/.test(t)){ doAuto(); return; }
    if(/紅/.test(t)){ doSort("red"); return; }
    if(/藍/.test(t)){ doSort("blue"); return; }
    ai(`嗯…我不太懂「${text}」。<br>可以試試：「紅色放A區」、「藍色放B區」、「全自動分類」、「揮手」、「回家」。`);
  }

  // ---- 語音輸入（Web Speech API，HTTPS 才可用） ----
  function setupVoice(){
    const btn=$("cmdVoice");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ btn.style.display="none"; return; }
    const rec=new SR();
    rec.lang="zh-TW"; rec.interimResults=false; rec.maxAlternatives=1;
    let on=false;
    btn.addEventListener("click",()=>{
      if(on){rec.stop();return;}
      try{ rec.start(); }catch(e){}
    });
    rec.onstart=()=>{on=true;btn.classList.add("listening");ai("🎤 我在聽…請說話（例如：把紅色放到A區）");};
    rec.onend=()=>{on=false;btn.classList.remove("listening");};
    rec.onerror=()=>{on=false;btn.classList.remove("listening");ai("🎤 沒聽清楚，或瀏覽器不支援麥克風。直接用按鈕或打字也可以喔！");};
    rec.onresult=(e)=>{
      const said=e.results[0][0].transcript;
      $("cmdInput").value=said;
      ai(`🎤 我聽到你說：<b>「${said}」</b>`);
      route(said);
    };
  }

  // ---- 綁定 ----
  function bind(){
    document.querySelector(".big-btn-grid").addEventListener("click",(e)=>{
      const b=e.target.closest(".cmd-btn[data-cmd]"); if(!b) return;
      const c=b.dataset.cmd;
      ({redA:()=>doSort("red"), blueB:()=>doSort("blue"), auto:doAuto,
        wave:doWave, home:doHome, fault:doFault})[c]?.();
    });
    $("cmdSend").addEventListener("click",()=>{route($("cmdInput").value);});
    $("cmdInput").addEventListener("keydown",(e)=>{if(e.key==="Enter")route($("cmdInput").value);});
    $("hackBtn").addEventListener("click",doHack);
    const gs=$("guardSwitch");
    gs.addEventListener("change",()=>{
      st.guard=gs.checked;
      $("guardText").textContent = "AI 安全防護：" + (gs.checked?"開啟中":"已關閉");
    });
    setupVoice();
  }

  // ---- 初始化（首次進入手臂頁時呼叫） ----
  let started=false;
  window.ArmDemo = {
    init(){
      seg1=$("seg1");seg2=$("seg2");joint1=$("joint1");
      finger1=$("finger1");finger2=$("finger2");
      blocksLayer=$("blocksLayer");sparks=$("sparks");
      lampDot=$("lampDot");lampText=$("lampText");
      aiMsg=$("aiMsg");logList=$("logList");
      initBlocks(); bind(); lamp("idle");
      if(!raf) tick();
      started=true;
    },
    isStarted(){return started;},
    // 給 AI 模組使用的對外介面
    exec: execAction,
    keyword: parse,
    say: ai,
    log: log
  };
})();
