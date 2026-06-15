/* =========================================================
   AI 模式：用 OpenAI (GPT) 把自然中文翻譯成手臂指令
   - 純前端、瀏覽器直接呼叫 OpenAI
   - 金鑰只存在使用者的瀏覽器(localStorage)，不進 repo
   - 對應課程 UNIT 3：說話 → AI 理解 → 結構化指令 → 手臂執行
   ========================================================= */
(function(){
  "use strict";
  const $ = (id)=>document.getElementById(id);
  const LS_KEY = "armdemo_openai_key";
  const LS_MODEL = "armdemo_openai_model";

  const SYS = `你是一台「2 軸平面取放機械手臂」的控制大腦(HMI)。使用者用口語中文下指令，你要轉成控制指令，且「只」回傳一個 JSON 物件，不要任何多餘文字。

本機規格與能力：
- 2 軸（J1 肩、J2 肘）平面手臂，末端是夾爪(gripper)，可夾取/放下小積木。
- 工作範圍：平面內最大臂展約 280mm；無 Z 軸（不能升降到桌面以外的高度）。
- 額定負載 3kg；沒有焊接、噴漆、鑽孔、鎖螺絲、切割等工具，也不能離開設備做家事或現實世界的事。

可用 action（擇一）：
- "sort_red" / "sort_blue"：把紅/藍積木分類到 A/B 區
- "auto"：全自動分類（紅→A、藍→B）
- "pick"：夾起積木，附 color:"red"|"blue"
- "place"：把手上積木放下，附 zone:"A"|"B"
- "stack"：把積木堆疊起來
- "gripper"：開或合夾爪，附 state:"open"|"close"
- "goto"：移到命名位置，附 target:"center"|"top"|"supply"|"zoneA"|"zoneB"|"home"
- "move"：移到座標，附 x、y（數字，x:40~780, y:120~440）
- "jog"：微動，附 dir:"left"|"right"|"up"|"down" 與 dist（mm，預設60）
- "rotate"：轉動關節，附 joint:"j1"|"j2"、deg（角度數字）、可選 absolute:true
- "draw"：用末端畫軌跡，附 shape:"square"|"circle"|"triangle"
- "wave" / "home" / "calibrate"(校正) / "selftest"(自我測試) / "reset"(積木歸位)
- "status"(狀態回報) / "count"(清點數量) / "speed"(設定速度，附 level:"slow"|"normal"|"fast")
- "estop"(緊急停止)
- "sequence"：多步驟，附 steps:[ {一個上面的指令物件}, ... ]，依序執行
- "unsupported"：超出本機能力時用，附 reason（用工程角度說明為何做不到）
- "unknown"：完全聽不懂時

回傳格式：{"action":"...", 其他參數..., "say":"用繁體中文、像設備操作員一樣簡短回應一句"}

判斷原則：
- 能對應就回那個動作；多步驟用 sequence。
- 若是本機做不到的事（焊接、噴漆、倒水、煮咖啡、搬超過3kg、飛、離開設備、需要 Z 軸升降等），一律回 unsupported，並在 reason 用工程理由說明（例如「本機無焊接模組」「超過額定負載 3kg」「無 Z 軸」）。

範例：
「先夾紅色放A區，再回原點」→ {"action":"sequence","steps":[{"action":"pick","color":"red"},{"action":"place","zone":"A"},{"action":"home"}],"say":"好的，先分類紅色，再回原點。"}
「幫我焊接這個零件」→ {"action":"unsupported","reason":"本機為夾爪式取放手臂，未配備焊接模組","say":"抱歉，這台手臂沒有焊接功能，無法執行。"}
「往左移一點」→ {"action":"jog","dir":"left","dist":60,"say":"好，往左微動 60mm。"}
「現在狀態如何」→ {"action":"status","say":"為您回報目前狀態。"}`;

  let on = false;
  let key = "";
  let model = "gpt-4o-mini";

  function isOn(){ return on && !!key; }

  // ---- 呼叫 OpenAI ----
  async function askLLM(text){
    const res = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+key },
      body: JSON.stringify({
        model: model,
        messages:[{role:"system",content:SYS},{role:"user",content:text}],
        response_format:{type:"json_object"},
        temperature:0.2,
        max_tokens:200
      })
    });
    if(!res.ok){
      let msg = "HTTP "+res.status;
      try{ const e=await res.json(); if(e.error&&e.error.message) msg=e.error.message; }catch(_){}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  }

  // ---- 處理一句使用者輸入 ----
  async function handle(text){
    const A = window.ArmDemo;
    A.say(`🤖 <b>AI 解析中…</b><span class="ai-step">把「${escapeHtml(text)}」交給 GPT 轉成手臂指令…</span>`);
    try{
      const obj = await askLLM(text);
      A.log(`🤖 AI 指令：${escapeHtml(JSON.stringify(obj))}`);   // 控制台顯示翻譯結果
      const ok = A.exec(obj);                                      // 由控制器驅動畫面與動作
      if(!ok){ A.say(`🤖 ${escapeHtml(obj.say || "這個動作我不支援。")}`); A.log("指令未對應到動作"); }
    }catch(err){
      const hint = err.status===401 ? "金鑰好像不對，請再確認一次。"
                 : err.status===429 ? "額度用完或太頻繁了，稍等一下再試。"
                 : "連線出了點問題。";
      A.say(`⚠️ AI 連線失敗：${escapeHtml(err.message||"")}<span class="ai-step">${hint} 先幫你改用「關鍵字模式」執行這句。</span>`);
      A.keyword(text);   // 失敗自動退回關鍵字版，不卡住現場
    }
  }

  function escapeHtml(s){return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}

  // ---- UI 綁定 ----
  function setText(){
    $("aiModeText").textContent = "AI 模式：" + (on ? (key?"開啟中（GPT 連線）":"開啟中（還沒貼金鑰）") : "關閉中（用關鍵字）");
  }
  function bind(){
    // 還原上次設定
    key = localStorage.getItem(LS_KEY) || "";
    model = localStorage.getItem(LS_MODEL) || "gpt-4o-mini";
    if($("aiModel")) $("aiModel").value = model;
    if(key && $("aiKey")) $("aiKey").value = key;

    $("aiModeSwitch").addEventListener("change",(e)=>{
      on = e.target.checked;
      $("aiKeyRow").hidden = !on;
      setText();
      if(window.ArmDemo){
        window.ArmDemo.say(on
          ? (key ? "🧠 AI 模式已開啟！直接用自然中文打給我看看，例如「幫我把紅色的收一收」。"
                 : "🧠 AI 模式已開啟，請先在下面貼上你的 OpenAI 金鑰。")
          : "已切回關鍵字模式（免金鑰、最穩）。");
      }
    });
    $("aiKeySave").addEventListener("click",saveKey);
    $("aiKey").addEventListener("keydown",(e)=>{if(e.key==="Enter")saveKey();});
    $("aiModel").addEventListener("change",(e)=>{ model=e.target.value; localStorage.setItem(LS_MODEL,model); });
  }
  function saveKey(){
    key = ($("aiKey").value||"").trim();
    localStorage.setItem(LS_KEY, key);
    setText();
    window.ArmDemo && window.ArmDemo.say(key
      ? "✅ 金鑰已記在這台瀏覽器。現在用自然中文跟我說話試試看！"
      : "金鑰是空的喔，請貼上 sk-... 開頭那一串。");
  }

  // ---- 對外 ----
  window.ArmAI = { isOn, handle, bind };

  // 手臂頁第一次開啟後，ArmDemo.init 已跑完才綁定 UI
  document.addEventListener("DOMContentLoaded",()=>{
    // 元素可能還沒被使用，但都在 DOM 裡，直接綁定
    if($("aiModeSwitch")) window.ArmAI.bind();
  });
})();
