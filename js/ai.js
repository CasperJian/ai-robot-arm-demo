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

  const SYS = `你是一支虛擬機械手臂的控制大腦。使用者會用口語中文下指令，你要判斷他想做哪一個動作，並「只」回傳一個 JSON 物件，不要任何多餘文字或說明。
可用的 action：
- "sort_red"：把紅色積木放到 A 區
- "sort_blue"：把藍色積木放到 B 區
- "auto"：全自動把紅色分到 A 區、藍色分到 B 區
- "wave"：揮手打招呼
- "home"：回到原點休息
- "fault"：模擬故障
- "move"：移動到座標，需附 x、y（數字，x 介於 40~780，y 介於 120~440）
- "unknown"：完全聽不懂時
回傳格式：{"action":"...","x":<可省略的數字>,"y":<可省略的數字>,"say":"<用繁體中文跟使用者說一句你聽懂了什麼，親切一點>"}
範例：
使用者「幫我把紅色的收到左邊那一格」→ {"action":"sort_red","say":"好的，我把紅色積木放到 A 區！"}
使用者「手臂移到中間偏上」→ {"action":"move","x":410,"y":250,"say":"好，我把手臂移到中間偏上的位置。"}
使用者「跟大家打個招呼」→ {"action":"wave","say":"嗨～大家好！👋"}`;

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
    A.say(`🤖 <b>AI 思考中…</b><br><span class="ai-step">把「${escapeHtml(text)}」交給 GPT 翻譯成手臂指令…</span>`);
    try{
      const obj = await askLLM(text);
      const pretty = JSON.stringify(obj);
      const ok = A.exec(obj);
      if(ok){
        A.say(`🤖 ${escapeHtml(obj.say || "收到！")}<br>
               <span class="ai-step">自然語言 → AI 翻譯 → 結構化指令：<code>${escapeHtml(pretty)}</code></span>`);
      }else{
        A.say(`🤖 ${escapeHtml(obj.say || "這個我不太會做")}<br>
               <span class="ai-step">AI 回了：<code>${escapeHtml(pretty)}</code>，但不是我會的動作。試試「分類」「揮手」「回家」。</span>`);
      }
    }catch(err){
      let hint = "";
      if(err.status===401) hint = "金鑰好像不對，請再確認一次。";
      else if(err.status===429) hint = "額度用完或太頻繁了，稍等一下再試。";
      else hint = "連線出了點問題。";
      A.say(`⚠️ AI 連線失敗：${escapeHtml(err.message||"")}<br>
             <span class="ai-step">${hint} 先幫你改用「關鍵字模式」執行這句。</span>`);
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
