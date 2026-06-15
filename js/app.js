/* =========================================================
   App：畫面切換、字級調整、各攤位的延遲啟動
   ========================================================= */
(function(){
  "use strict";
  const $ = (id)=>document.getElementById(id);

  const TITLES = {
    home:"AI 機械手臂 × 資安防護",
    arm:"🦾 控制虛擬機械手臂",
    scam:"🎣 詐騙信件大考驗",
    password:"🔐 密碼健檢機",
    safety:"🛡️ 帶得走的防身術"
  };

  function show(name){
    document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
    const el=$("screen-"+name);
    if(!el){ return; }
    el.classList.add("active");
    $("topbarTitle").textContent = TITLES[name] || TITLES.home;
    window.scrollTo({top:0,behavior:"smooth"});

    // 延遲啟動，第一次進入才初始化
    if(name==="arm" && window.ArmDemo && !window.ArmDemo.isStarted()){ window.ArmDemo.init(); }
    if(name==="scam" && window.Games && !window.Games._scamStarted){ window.Games.initScam(); window.Games._scamStarted=true; }
    if(name==="password" && window.Games && !window.Games._pwStarted){ window.Games.initPw(); window.Games._pwStarted=true; }

    location.hash = name==="home" ? "" : name;
  }

  // 首頁卡片
  document.querySelectorAll(".menu-card[data-go]").forEach(c=>{
    c.addEventListener("click",()=>show(c.dataset.go));
  });
  $("homeBtn").addEventListener("click",()=>show("home"));

  // 字級調整
  let fs=19;
  const setFs=(v)=>{ fs=Math.max(16,Math.min(26,v)); document.documentElement.style.setProperty("--fs",fs+"px"); };
  $("fontUp").addEventListener("click",()=>setFs(fs+2));
  $("fontDown").addEventListener("click",()=>setFs(fs-2));

  // 支援用網址 #hash 直接開到某攤位（方便分享）
  const start = (location.hash||"").replace("#","");
  if(start && TITLES[start]) show(start); else show("home");
})();
