/* =========================================================
   小遊戲：詐騙信件大考驗 + 密碼健檢機
   ========================================================= */
(function(){
  "use strict";
  const $ = (id)=>document.getElementById(id);

  /* ---------------- 詐騙信件大考驗 ---------------- */
  const QUIZ = [
    {
      channel:"📧 電子郵件",
      fields:[["寄件人","IT-Support@company-tw.com"],["主旨","緊急！您的密碼已過期"]],
      body:"請立即點擊下方連結更新密碼，否則帳號將在 12 小時後停用。\nhttp://company-tw-login.com/reset",
      answer:"fake",
      clues:[
        "網域是「company-tw.com」，不是公司真正的官方網域。",
        "「緊急」＋「立即」＋「12 小時」＝ 經典恐慌三件套。",
        "正常 IT 不會用 Email 叫你點連結改密碼。"
      ],
      tip:"記住：急的都是假的。"
    },
    {
      channel:"📱 手機簡訊",
      fields:[["來自","+886 9XX-XXX-XXX"]],
      body:"【宅配通知】您的包裹地址不完整無法派送，請點此補件：\nhttps://t.cn/delivery-tw",
      answer:"fake",
      clues:[
        "真正的物流不會用陌生短網址（t.cn 是對岸短網址）。",
        "用「包裹無法派送」製造緊張，誘你點連結。",
        "正確做法：直接上官方網站，用單號自己查。"
      ],
      tip:"不明連結，看到也不要點。"
    },
    {
      channel:"📧 電子郵件",
      fields:[["寄件人","service@goog1e.com"],["主旨","您的帳號有異常登入"]],
      body:"偵測到您的帳號在國外登入，若非本人操作，請點擊連結確認身分。",
      answer:"fake",
      clues:[
        "仔細看寄件人：「goog1e」用的是數字 1，不是字母 L —— 假冒 Google。",
        "詐騙最愛模仿大公司，網址只差一個字。",
        "看到連結先把滑鼠移上去（不要點），確認真實網址。"
      ],
      tip:"大公司網址只差一個字，多半是假的。"
    },
    {
      channel:"💬 LINE 訊息",
      fields:[["來自","「老闆」"]],
      body:"我現在在開會不方便講電話，公司急需一筆款項，你先幫我匯到這個帳號，我等等再跟你說明。",
      answer:"fake",
      clues:[
        "冒充長官、用「開會不方便講電話」避免你求證。",
        "只要「急著要你匯款」，幾乎都是詐騙。",
        "正確做法：當面或打他「你本來就知道的」電話確認。"
      ],
      tip:"一提到匯款，先掛掉、再回撥確認。"
    },
    {
      channel:"📧 電子郵件",
      fields:[["寄件人","noreply@invoice.taipower.com.tw"],["主旨","您的 6 月電費電子帳單"]],
      body:"親愛的用戶您好，您本期電費為 NT$1,280，可至台電官網或便利商店繳納。如有疑問請洽客服 1911。",
      answer:"real",
      clues:[
        "沒有催你「立即點連結」，也沒有要你的密碼。",
        "金額合理、提供官方客服電話，語氣正常。",
        "不過保險起見，還是自己上官網或用 App 核對最安全。"
      ],
      tip:"真信通常不急、不要密碼、有正常聯絡方式。"
    },
    {
      channel:"📞 電話",
      fields:[["來電","自稱「健保局」"]],
      body:"您涉及一起健保卡盜用案，我們已通報檢警，請配合提供您的銀行帳號與密碼以證明清白，否則將凍結帳戶。",
      answer:"fake",
      clues:[
        "公務機關「絕對不會」用電話要你的銀行帳號或密碼。",
        "用「涉案、凍結帳戶」恐嚇，是假冒公務員的標準手法。",
        "掛掉電話，直接打 165 反詐騙專線求證。"
      ],
      tip:"假冒公務員是台灣詐騙 TOP 3，掛掉打 165。"
    }
  ];

  let qi=0, score=0, answered=false;

  function renderQuiz(){
    answered=false;
    const q=QUIZ[qi];
    $("scamCount").textContent=`第 ${qi+1} / ${QUIZ.length} 題`;
    $("scamScore").textContent=`答對 ${score} 題`;
    let html=`<div class="scam-channel">${q.channel}</div>`;
    for(const [k,v] of q.fields){
      html+=`<div class="scam-field"><span class="k">${k}：</span>${esc(v)}</div>`;
    }
    html+=`<div class="scam-body">${esc(q.body)}</div>`;
    $("scamCard").innerHTML=html;
    $("scamChoices").hidden=false;
    document.querySelectorAll(".judge-btn").forEach(b=>b.disabled=false);
    $("scamFeedback").hidden=true;
    $("scamResult").hidden=true;
    $("scamCard").hidden=false;
  }

  function judge(ans){
    if(answered) return;
    answered=true;
    const q=QUIZ[qi];
    const correct = (ans===q.answer);
    if(correct) score++;
    document.querySelectorAll(".judge-btn").forEach(b=>b.disabled=true);
    const v=$("fbVerdict"), ex=$("fbExplain");
    const truth = q.answer==="fake" ? "這是「詐騙」⚠️" : "這封是「真的」👍";
    v.className = "fb-verdict " + (correct?"ok":"no");
    v.textContent = correct ? `答對了！${truth}` : `可惜～答錯了。${truth}`;
    let clueHtml = `<b>破綻 / 重點：</b>`;
    for(const c of q.clues){ clueHtml += `<span class="clue">🔎 ${esc(c)}</span>`; }
    clueHtml += `<span class="clue" style="color:#e76f1d;font-weight:800;">💡 ${esc(q.tip)}</span>`;
    ex.innerHTML=clueHtml;
    $("scamScore").textContent=`答對 ${score} 題`;
    $("scamFeedback").hidden=false;
    $("scamNext").textContent = (qi<QUIZ.length-1) ? "下一題 ➡️" : "看結果 🎉";
  }

  function nextQ(){
    if(qi<QUIZ.length-1){ qi++; renderQuiz(); }
    else{ showResult(); }
  }

  function showResult(){
    $("scamCard").hidden=true;
    $("scamChoices").hidden=true;
    $("scamFeedback").hidden=true;
    const r=$("scamResult");
    let msg,tip;
    const pct=score/QUIZ.length;
    if(pct===1){ msg="太厲害了！防詐高手 🏆"; tip="你已經有很強的警覺心，記得也提醒身邊的家人朋友。"; }
    else if(pct>=0.6){ msg="不錯喔！再小心一點就滿分 👍"; tip="多數詐騙都靠「製造緊張」，看到急件先深呼吸三秒。"; }
    else{ msg="沒關係，今天學到就賺到 💪"; tip="只要記住一句話：「急的都是假的」，就能擋掉大半詐騙。"; }
    r.innerHTML=`
      <div class="big-score">${score} / ${QUIZ.length}</div>
      <div class="res-msg">${msg}</div>
      <div class="res-tip">${tip}</div>
      <button class="retry-btn" id="scamRetry">🔄 再玩一次</button>`;
    r.hidden=false;
    $("scamRetry").addEventListener("click",()=>{qi=0;score=0;renderQuiz();});
  }

  function esc(s){return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}

  function initScam(){
    qi=0;score=0;renderQuiz();
    $("scamChoices").addEventListener("click",(e)=>{
      const b=e.target.closest(".judge-btn"); if(!b)return; judge(b.dataset.ans);
    });
    $("scamNext").addEventListener("click",nextQ);
  }

  /* ---------------- 密碼健檢機 ---------------- */
  const WORST=["123456","123456789","12345678","password","qwerty123","qwerty","111111","abc123","000000","iloveyou","admin","letmein","12345","1234567890"];

  function checkPw(){
    const v=$("pwInput").value;
    const has={
      len: v.length>=12,
      case: /[a-z]/.test(v)&&/[A-Z]/.test(v),
      num: /\d/.test(v),
      sym: /[^A-Za-z0-9]/.test(v),
      common: v.length>0 && !WORST.includes(v.toLowerCase())
    };
    setChk("chkLen",has.len);
    setChk("chkCase",has.case);
    setChk("chkNum",has.num);
    setChk("chkSym",has.sym);
    setChk("chkCommon",has.common);

    let pts = (has.len?2:0)+(has.case?1:0)+(has.num?1:0)+(has.sym?1:0);
    if(v.length>=16) pts++;
    if(!has.common) pts=0;               // 在爛密碼榜：直接歸零
    const pct = Math.min(100, Math.round(pts/6*100));
    const fill=$("pwFill"), verdict=$("pwVerdict");

    if(v.length===0){ fill.style.width="0"; verdict.textContent="等你輸入…"; verdict.style.color="#5e7186"; return; }

    fill.style.width=pct+"%";
    let label,color;
    if(!has.common){ label="😱 這是最常被破解的爛密碼！"; color="#e05a4b"; fill.style.width="100%"; }
    else if(pts<=2){ label="🔴 太弱了，很容易被猜到"; color="#e05a4b"; }
    else if(pts<=4){ label="🟡 普通，還可以更強"; color="#ff8c42"; }
    else{ label="🟢 很安全，給你一個讚！"; color="#2e9e5b"; }
    fill.style.background=color;
    verdict.textContent=label; verdict.style.color=color;
  }
  function setChk(id,ok){
    const li=$(id);
    li.classList.toggle("pass",ok);
    li.querySelector(".chk-icon").textContent = ok?"✅":"⬜";
  }
  function initPw(){ $("pwInput").addEventListener("input",checkPw); checkPw(); }

  /* ---------------- 對外 ---------------- */
  window.Games = {
    initScam,
    initPw,
    _scamStarted:false,
    _pwStarted:false
  };
})();
