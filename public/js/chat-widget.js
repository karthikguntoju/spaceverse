// Chat widget — injects a floating chat popup available across pages
(function(){
  // Avoid duplicate initialization
  if (window.__SpaceverseChatWidget) return;
  window.__SpaceverseChatWidget = true;

  const css = `
  #sv-chat-btn {
      position:fixed; right:20px; bottom:20px; z-index:99999;
      background: rgba(0, 15, 30, 0.7); color:#00f3ff; border: 1px solid rgba(0,243,255,0.4); 
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border-radius:50%; width:64px; height:64px; 
      display:flex; align-items:center; justify-content:center; 
      box-shadow:0 0 20px rgba(0,243,255,0.3), inset 0 0 15px rgba(0,243,255,0.2); 
      cursor:pointer; transition: all 0.3s ease;
  }
  #sv-chat-btn:hover {
      transform: scale(1.1);
      box-shadow:0 0 30px rgba(0,243,255,0.6), inset 0 0 20px rgba(0,243,255,0.4); 
  }
  #sv-chat-btn svg { width: 34px; height: 34px; fill: none; stroke: #00f3ff; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  
  #sv-chat-modal {
      position:fixed; right:20px; bottom:96px; 
      width:420px; max-width:calc(100% - 40px); z-index:99999; 
      background:rgba(10, 15, 25, 0.65); 
      backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
      color:#e2e8f0; border-radius:12px; 
      border: 1px solid rgba(0, 243, 255, 0.3);
      box-shadow: 0 15px 40px rgba(0,0,0,0.6), inset 0 0 20px rgba(0, 243, 255, 0.1); 
      display:none; overflow:hidden;
      font-family: 'Inter', sans-serif;
  }
  #sv-chat-header {
      padding:16px 20px; font-weight:700; 
      background: rgba(0, 0, 0, 0.4); 
      border-bottom: 1px solid rgba(0, 243, 255, 0.2);
      display:flex; justify-content:space-between; align-items:center;
      font-family: 'Orbitron', sans-serif;
      color: #00f3ff;
      letter-spacing: 1px;
      text-shadow: 0 0 10px rgba(0, 243, 255, 0.6);
  }
  #sv-chat-close { background:transparent; border:none; color:inherit; font-size:20px; cursor:pointer; transition: all 0.3s; }
  #sv-chat-close:hover { color: #fff; transform: rotate(90deg); }
  
  #sv-chat-body { padding:16px 20px; max-height:350px; overflow:auto; font-size:14.5px; line-height: 1.6; }
  #sv-chat-input-row { 
      display:flex; padding:16px 20px; gap:12px; 
      background:rgba(0,0,0, 0.2);
      border-top: 1px solid rgba(255, 255, 255, 0.05);
  }
  #sv-chat-input {
      flex:1; padding:12px 14px; border-radius:8px; 
      border:1px solid rgba(255,255,255,0.1); 
      background:rgba(0, 0, 0, 0.4); color:#fff; font-family: 'Inter', sans-serif;
      transition: all 0.3s;
  }
  #sv-chat-input:focus {
      outline: none; border-color: #00f3ff; box-shadow: 0 0 10px rgba(0, 243, 255, 0.2);
  }
  #sv-chat-send {
      padding:10px 18px; border-radius:8px; 
      background:rgba(0, 243, 255, 0.05); color:#00f3ff; 
      border:1px solid #00f3ff; cursor:pointer; font-weight: 600;
      font-family: 'Orbitron', sans-serif; text-transform: uppercase;
      box-shadow: 0 0 10px rgba(0, 243, 255, 0.2); transition: all 0.3s;
  }
  #sv-chat-send:hover {
      background:#00f3ff; color:#000; box-shadow: 0 0 20px rgba(0, 243, 255, 0.6);
  }
  
  .sv-chat-msg { margin:12px 0; padding:12px 16px; border-radius:8px; }
  .sv-chat-msg.user { background:rgba(0, 243, 255, 0.08); text-align:right; border-right: 3px solid #00f3ff; border-top-right-radius: 2px; }
  .sv-chat-msg.bot { background:rgba(255,255,255,0.04); border-left: 3px solid rgba(255, 255, 255, 0.3); border-top-left-radius: 2px; }
  .sv-chat-system { font-size:12px; opacity:0.8; margin:8px 0; color: #a0aec0; font-family: 'Orbitron', sans-serif; text-transform: uppercase; letter-spacing: 1px; }
  
  /* Scrollbar override for bot */
  #sv-chat-body::-webkit-scrollbar { width: 6px; }
  #sv-chat-body::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 10px; }
  #sv-chat-body::-webkit-scrollbar-thumb { background: rgba(0,243,255,0.3); border-radius: 10px; }
  #sv-chat-body::-webkit-scrollbar-thumb:hover { background: rgba(0,243,255,0.6); }
  `;

  const style = document.createElement('style');
  style.innerHTML = css;
  document.head.appendChild(style);

  // Create elements
  const btn = document.createElement('div');
  btn.id = 'sv-chat-btn';
  btn.title = 'Ask SpaceVerse Chatbot';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M12 2v2"></path>
      <circle cx="12" cy="6" r="2"></circle>
      <rect x="5" y="8" width="14" height="10" rx="3"></rect>
      <path d="M7 13h2"></path>
      <path d="M15 13h2"></path>
      <path d="M10 16h4"></path>
      <ellipse cx="12" cy="14" rx="13" ry="4" stroke="#00f3ff" stroke-width="1.5" transform="rotate(-15 12 14)"></ellipse>
    </svg>
  `;

  const modal = document.createElement('div');
  modal.id = 'sv-chat-modal';
  modal.innerHTML = `
    <div id="sv-chat-header">SPACE TERMINAL <span style="font-size:10px; opacity:.8; font-family:'Inter', sans-serif; letter-spacing:0; text-shadow:none; color:#a0aec0; margin-left: 10px;">[GEMINI_AI_CORE]</span><div style="flex:1"></div><button id="sv-chat-close">✕</button></div>
    <div id="sv-chat-body"><div class="sv-chat-system">Hello Pilot! I am your Gemini AI Assistant. Ask me for data regarding planetary mechanics, celestial phenomena, rockets, or black holes!</div></div>
    <div id="sv-chat-input-row"><input id="sv-chat-input" placeholder="Query terminal..." autocomplete="off" aria-label="Ask Space"/><button id="sv-chat-send">Send</button></div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(modal);

  const openModal = () => modal.style.display = 'block';
  const closeModal = () => modal.style.display = 'none';

  btn.addEventListener('click', () => {
    openModal();
    document.getElementById('sv-chat-input').focus();
  });
  modal.querySelector('#sv-chat-close').addEventListener('click', closeModal);

  const body = modal.querySelector('#sv-chat-body');
  const input = modal.querySelector('#sv-chat-input');
  const send = modal.querySelector('#sv-chat-send');

  function appendMessage(text, who='bot'){
    const div = document.createElement('div');
    div.className = 'sv-chat-msg ' + (who === 'user' ? 'user' : 'bot');
    div.innerHTML = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  async function sendQuestion() {
    const q = input.value.trim();
    if (!q) return;
    appendMessage(`<strong>Q:</strong> ${escapeHtml(q)}`, 'user');
    input.value = '';

    // show temporary system message
    const sys = document.createElement('div'); sys.className = 'sv-chat-system'; sys.textContent = 'Thinking...'; body.appendChild(sys); body.scrollTop = body.scrollHeight;

    try {
      // Try authenticated endpoint first
      let res = await fetch('/api/simulator/chatbot', {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ question: q })
      });

      // If not authenticated, fall back to public endpoint
      if (res.status === 401) {
        res = await fetch('/api/simulator/chatbot-public', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ question: q })
        });
      }

      const data = await res.json();
      if (data && data.success) {
        sys.remove();
        appendMessage(`<strong>A:</strong> ${escapeHtml(data.answer || data.message || 'No response')}`,'bot');
      } else {
        sys.textContent = 'Error: ' + (data.message || 'Unknown error.');
      }
    } catch (e) {
      sys.textContent = 'Network error. Please try again.';
      console.error('Chat widget error:', e);
    }
  }

  send.addEventListener('click', sendQuestion);
  input.addEventListener('keydown', function(e){ if (e.key === 'Enter') sendQuestion(); });

  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

})();