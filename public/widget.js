(() => {
  // ✅ Guard: když se skript načte 2×, nic nedělej
  if (window.__AIPROCES_WIDGET_LOADED__) return;
  window.__AIPROCES_WIDGET_LOADED__ = true;

  // ✅ Kde běží backend (Netlify functions)
  const BASE = "https://sales-chatbot-demo.netlify.app";
  const ENDPOINT_DEMO = `${BASE}/.netlify/functions/search-demo`;
  const ENDPOINT_SCRAPE = `${BASE}/.netlify/functions/scrape`;
  const ENDPOINT_LEAD = `${BASE}/.netlify/functions/lead`;

  // ===== CSS (minimální – můžeš později nahradit plnou verzí) =====
  const css = `
  :root{
    --cb-bg:#06101f; --cb-panel:#071a2f; --cb-stroke:rgba(255,255,255,.10);
    --cb-text:rgba(255,255,255,.92); --cb-muted:rgba(255,255,255,.65);
    --cb-cyan:#26d7ff; --cb-cyan2:#00a8ff;
    --cb-shadow: 0 24px 70px rgba(0,0,0,.45);
  }
  .cb-hidden{display:none!important;}
  #cbSideTab{
    position:fixed; right:14px; top:45%; transform:translateY(-50%);
    z-index:999999; display:flex; align-items:center; gap:10px;
    padding:10px 12px; border-radius:999px;
    border:1px solid rgba(38,215,255,.22);
    background:linear-gradient(90deg, rgba(38,215,255,.14), rgba(0,168,255,.10));
    box-shadow:0 14px 40px rgba(0,0,0,.35);
    backdrop-filter:blur(8px);
    cursor:pointer; user-select:none;
    max-width:min(360px, calc(100vw - 34px));
  }
  #cbSideTab .cbSideIcon{
    width:34px; height:34px; border-radius:12px; display:flex; align-items:center; justify-content:center;
    border:1px solid rgba(38,215,255,.26);
    background:radial-gradient(circle at 30% 30%, rgba(38,215,255,.92), rgba(0,168,255,.88));
    box-shadow:0 12px 28px rgba(0,0,0,.35);
    flex:0 0 auto;
  }
  #cbSideTab .cbSideText{display:flex; flex-direction:column; gap:2px; line-height:1.15; min-width:0;}
  #cbSideTab .cbSideText b{font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--cb-text)}
  #cbSideTab .cbSideText span{font-size:11.5px; color:rgba(255,255,255,.72); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  #cbSideTab .cbSideArrow{
    margin-left:4px; width:22px; height:22px; border-radius:999px;
    display:flex; align-items:center; justify-content:center;
    border:1px solid rgba(255,255,255,.14);
    background:rgba(0,0,0,.18);
    flex:0 0 auto;
  }
  #cbOverlay{
    position:fixed; inset:0; background:rgba(0,0,0,.35); backdrop-filter:blur(2px);
    z-index:999998; display:none;
  }
  #cbOverlay.open{display:block;}
  #cbPanel{
    position:fixed; right:18px; bottom:18px;
    width:min(420px, calc(100vw - 36px));
    height:min(680px, calc(100vh - 36px));
    border-radius:18px; border:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(7,26,47,.98), rgba(5,16,31,.98));
    box-shadow:var(--cb-shadow);
    overflow:hidden; z-index:999999; display:none;
  }
  #cbPanel.open{display:block;}
  #cbTop{display:flex; justify-content:flex-end; padding:10px 10px 0 10px;}
  #cbClose{
    width:34px; height:34px; border-radius:12px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    color:rgba(255,255,255,.85);
    cursor:pointer;
  }
  #cbChat{padding:12px; display:flex; flex-direction:column; gap:10px; overflow:auto; height:calc(100% - 64px);}
  .cbMsg{max-width:88%; padding:10px 12px; border-radius:16px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.04);
    white-space:pre-wrap; word-break:break-word; font-size:13.5px; line-height:1.35; color:var(--cb-text)}
  .cbMsg.user{align-self:flex-end; background:rgba(38,215,255,.10); border-color:rgba(38,215,255,.18);}
  .cbMsg.bot{align-self:flex-start;}
  .cbRow{position:absolute; left:0; right:0; bottom:0; display:flex; gap:10px; padding:12px; border-top:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.16);}
  #cbInput{flex:1; padding:12px; border-radius:14px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.04); color:var(--cb-text); outline:none; font-size:14px;}
  #cbSend{padding:12px 14px; border-radius:14px; border:1px solid rgba(38,215,255,.26); background:linear-gradient(90deg, rgba(38,215,255,.95), rgba(0,168,255,.90)); color:#00131f; font-weight:900; cursor:pointer;}
  @media (max-width:520px){
    #cbSideTab{right:10px; top:auto; bottom:90px; transform:none; max-width:calc(100vw - 20px);}
  }`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ===== DOM =====
  const sideTab = document.createElement("div");
  sideTab.id = "cbSideTab";
  sideTab.innerHTML = `
    <div class="cbSideIcon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M9 3h6" stroke="#00131f" stroke-width="2" stroke-linecap="round"/>
        <path d="M12 3v3" stroke="#00131f" stroke-width="2" stroke-linecap="round"/>
        <rect x="5" y="7" width="14" height="12" rx="4" stroke="#00131f" stroke-width="2"/>
        <path d="M9 12h.01M15 12h.01" stroke="#00131f" stroke-width="3" stroke-linecap="round"/>
        <path d="M8.5 16c1 .8 2.3 1.2 3.5 1.2s2.5-.4 3.5-1.2" stroke="#00131f" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="cbSideText">
      <b>Vyzkoušejte demo chatbota</b>
      <span>pro vaši firmu • klikněte zde</span>
    </div>
    <div class="cbSideArrow" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M9 18l6-6-6-6" stroke="rgba(255,255,255,.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  `;

  // dedupe (kdyby se to někde injektlo 2×)
  document.querySelectorAll("#cbSideTab").forEach((el, i) => { if (i > 0) el.remove(); });

  const overlay = document.createElement("div");
  overlay.id = "cbOverlay";

  const panel = document.createElement("div");
  panel.id = "cbPanel";
  panel.innerHTML = `
    <div id="cbTop"><button id="cbClose" aria-label="Zavřít">✕</button></div>
    <div id="cbChat"></div>
    <div class="cbRow">
      <input id="cbInput" placeholder="Napište dotaz…" autocomplete="off" />
      <button id="cbSend">Odeslat</button>
    </div>
  `;

  document.body.appendChild(sideTab);
  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  const cbChat = panel.querySelector("#cbChat");
  const cbInput = panel.querySelector("#cbInput");
  const cbSend = panel.querySelector("#cbSend");
  const cbClose = panel.querySelector("#cbClose");

  function addMsg(role, text){
    const d = document.createElement("div");
    d.className = "cbMsg " + (role === "user" ? "user" : "bot");
    d.textContent = text;
    cbChat.appendChild(d);
    cbChat.scrollTop = cbChat.scrollHeight;
  }

  function openPanel(){
    sideTab.classList.add("cb-hidden");
    panel.classList.add("open");
    overlay.classList.add("open");
    if(!cbChat.dataset.inited){
      cbChat.dataset.inited = "1";
      addMsg("bot", "Dobrý den 👋");
      addMsg("bot", "Toto je demo. Napište doménu (např. dachmantechnik.cz) a pak se ptejte jako zákazník.");
    }
    setTimeout(() => cbInput.focus(), 50);
  }
  function closePanel(){
    panel.classList.remove("open");
    overlay.classList.remove("open");
    sideTab.classList.remove("cb-hidden");
  }

  sideTab.addEventListener("click", openPanel);
  overlay.addEventListener("click", closePanel);
  cbClose.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e)=>{ if(e.key === "Escape") closePanel(); });

  // ===== DEMO logika (zjednodušená: jen volá tvůj search-demo) =====
  let sending = false;
  async function askDemoAI(message){
    const r = await fetch(ENDPOINT_DEMO, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body: JSON.stringify({ message })
    });
    const d = await r.json().catch(()=>({}));
    if(!d.ok) throw new Error(d.error || "search-demo failed");
    return d.answer || "";
  }

  async function send(){
    const t = (cbInput.value || "").trim();
    if(!t || sending) return;
    cbInput.value = "";
    addMsg("user", t);
    cbSend.disabled = true;
    sending = true;
    try{
      const ans = await askDemoAI(t);
      addMsg("bot", ans);
    }catch(e){
      addMsg("bot", "Omlouváme se, něco se nepovedlo. Zkuste to prosím znovu.");
    }finally{
      cbSend.disabled = false;
      sending = false;
      cbInput.focus();
    }
  }
  cbSend.addEventListener("click", send);
  cbInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") send(); });

})();
