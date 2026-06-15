/* =========================================================
   AI 模式（簡化版）：用 OpenAI GPT 把口語中文變成手臂指令
   - 支援 URL 參數 ?key=sk-... 自動啟用（方便講師分享連結）
   - 也可在「AI 設定」手動貼金鑰
   - 沒有金鑰就退回關鍵字模式，一樣能玩
   ========================================================= */
(function(){
  "use strict";
  const $ = (id)=>document.getElementById(id);
  const LS_KEY = "armdemo_openai_key";

  const SYS = `你是一台虛擬機械手臂的「AI 小幫手」，你的使用者是中高齡長輩，可能是第一次接觸 AI 和機械手臂。

你的個性：親切、有耐心、像鄰居阿姨/叔叔一樣聊天。回應要用繁體中文、口語、簡短（1~2 句話就好）。

## 你控制的設備
2 軸平面取放機械手臂，末端有夾爪，桌上有紅色和藍色積木。
紅色積木要放到 A 區，藍色積木要放到 B 區。

## 可用指令（回傳 JSON）
- "sort_red" / "sort_blue"：分類紅/藍積木
- "auto"：全自動分類（紅→A、藍→B）
- "pick"：夾起積木，附 color:"red"|"blue"
- "place"：放下積木，附 zone:"A"|"B"
- "stack"：堆疊積木
- "gripper"：開合夾爪，附 state:"open"|"close"
- "goto"：移到位置，附 target:"center"|"top"|"supply"|"zoneA"|"zoneB"|"home"
- "move"：移到座標，附 x、y
- "jog"：微動，附 dir:"left"|"right"|"up"|"down" 與 dist（mm）
- "rotate"：轉關節，附 joint:"j1"|"j2"、deg
- "draw"：畫圖，附 shape:"square"|"circle"|"triangle"
- "wave"：揮手打招呼
- "home"：回原點休息
- "calibrate"：校正歸零
- "selftest"：自我測試
- "reset"：重置積木歸位
- "status"：狀態回報
- "count"：清點數量
- "speed"：設速度，附 level:"slow"|"normal"|"fast"
- "estop"：緊急停止
- "fault"：模擬故障
- "sequence"：多步驟，附 steps:[ {...}, ... ]

## 特殊情況的回應方式

### 做不到的事（用 action:"unsupported"）
不要只說「不支援」，要親切地聊一下，帶點幽默。
例如：「泡咖啡」→ say:"哈哈，泡咖啡我可不行啊～我就是一隻小手臂，只會搬搬積木啦！要不要叫我整理一下桌上的積木？"
例如：「幫我按摩」→ say:"欸～你找錯人了啦！我的手雖然靈活，但是只會夾積木，按摩還是找專業的比較好喔 😆"

### 純聊天（用 action:"chat"）
使用者只是在聊天（你好、你叫什麼、今天心情好、謝謝等），就親切回應，不動手臂。
例如：「你好」→ {"action":"chat","say":"你好你好！😊 我是手臂小幫手，今天想玩什麼？可以叫我整理積木、揮揮手，或者隨便跟我聊聊天～"}
例如：「謝謝你」→ {"action":"chat","say":"不客氣！能幫到你我很開心 😊 還想玩什麼嗎？"}

### 聽不懂（用 action:"unknown"）
也不要冷冰冰說「無法辨識」，要像朋友一樣。
例如：→ {"action":"unknown","say":"嗯…這個我不太懂欸 😅 你可以試試看說「幫我整理積木」或「揮揮手」，我比較聽得懂～"}

## 回傳格式
一律回傳一個 JSON 物件：{"action":"...", 其他參數..., "say":"親切的繁體中文回應"}
不要多餘文字，只回 JSON。`;

  let key = "";
  const model = "gpt-4o-mini";

  function isOn(){ return !!key; }

  async function askLLM(text){
    const res = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+key },
      body: JSON.stringify({
        model: model,
        messages:[{role:"system",content:SYS},{role:"user",content:text}],
        response_format:{type:"json_object"},
        temperature:0.6,
        max_tokens:300
      })
    });
    if(!res.ok){
      let msg = "HTTP "+res.status;
      try{ const e=await res.json(); if(e.error&&e.error.message) msg=e.error.message; }catch(_){}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || "{}");
  }

  async function handle(text){
    const A = window.ArmDemo;
    A.say("🤖 讓我想想…");
    try{
      const obj = await askLLM(text);
      A.log("🤖 AI：" + esc(obj.say||""));
      if(obj.action==="chat" || obj.action==="unknown"){
        A.say("🤖 " + esc(obj.say || "嗯…我不太確定你的意思欸，可以再說一次嗎？"));
        return;
      }
      if(obj.say) A.say("🤖 " + esc(obj.say));
      const ok = A.exec(obj);
      if(!ok) A.say("🤖 " + esc(obj.say || "這個我好像做不到欸～試試看說「整理積木」？"));
    }catch(err){
      const hint = err.status===401 ? "金鑰好像不對耶，要不要檢查一下？"
                 : err.status===429 ? "問太快了啦～等一下再試試看 😊"
                 : "連線出了點問題，先幫你用簡單版。";
      A.say("😅 " + hint);
      A.keyword(text);
    }
  }

  function esc(s){ return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

  function loadKey(){
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get("key") || "";
    if(urlKey){
      key = urlKey;
      localStorage.setItem(LS_KEY, key);
    } else {
      key = localStorage.getItem(LS_KEY) || "";
    }
    if(key && $("aiKey")) $("aiKey").value = key;
  }

  function bind(){
    loadKey();
    const saveBtn = $("aiKeySave");
    const keyInput = $("aiKey");
    if(saveBtn && keyInput){
      saveBtn.addEventListener("click", doSave);
      keyInput.addEventListener("keydown", (e)=>{ if(e.key==="Enter") doSave(); });
    }
  }

  function doSave(){
    key = ($("aiKey").value||"").trim();
    localStorage.setItem(LS_KEY, key);
    if(window.ArmDemo){
      window.ArmDemo.say(key
        ? "✅ 金鑰存好了！現在你說什麼中文我都聽得懂囉～試試看！"
        : "金鑰是空的喔，請貼上 sk-... 開頭那一串。");
    }
  }

  window.ArmAI = { isOn, handle, bind };

  document.addEventListener("DOMContentLoaded",()=>{
    if($("aiKeySave")) window.ArmAI.bind();
  });
})();
