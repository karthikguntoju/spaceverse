// Chat widget — injects a floating chat popup available across pages
(function(){
  // Avoid duplicate initialization
  if (window.__SpaceverseChatWidget) return;
  window.__SpaceverseChatWidget = true;

  /* Liquid glass, matching /public/css/liquid-glass.css. Kept inline here
     because the widget injects itself onto pages that may not load the
     design system, and it has to look right on all of them. */
  const css = `
  #sv-chat-btn {
      position:fixed; right:22px; bottom:22px; z-index:99999;
      width:60px; height:60px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      color:#fff; border:none;
      background:
        linear-gradient(140deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.06) 44%, transparent 62%),
        linear-gradient(120deg, rgba(34,211,238,0.9), rgba(167,139,250,0.9));
      backdrop-filter: blur(18px) saturate(185%); -webkit-backdrop-filter: blur(18px) saturate(185%);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.6),
        inset 0 -2px 6px rgba(0,40,60,0.28),
        0 12px 34px -8px rgba(34,211,238,0.6),
        0 24px 60px -20px rgba(0,0,0,0.75);
      cursor:pointer;
      transition: transform 0.24s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.34s ease;
  }
  #sv-chat-btn:hover {
      transform: translateY(-3px) scale(1.05);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.75),
        0 18px 46px -8px rgba(34,211,238,0.75),
        0 30px 70px -20px rgba(0,0,0,0.8);
  }
  #sv-chat-btn span { font-size: 28px; line-height: 1; }

  #sv-chat-modal {
      position:fixed; right:22px; bottom:96px;
      width:420px; max-width:calc(100% - 44px); z-index:99999;
      color:#f2f6ff; border:none; border-radius:24px;
      background: rgba(255,255,255,0.075);
      backdrop-filter: blur(40px) saturate(210%); -webkit-backdrop-filter: blur(40px) saturate(210%);
      box-shadow:
        inset 0 1px 0 0 rgba(255,255,255,0.3),
        inset 0 -1px 0 0 rgba(255,255,255,0.07),
        inset 0 0 0 1px rgba(255,255,255,0.1),
        0 48px 110px -28px rgba(0,0,0,0.8);
      display:none; overflow:hidden;
      font-family: 'Inter', system-ui, sans-serif;
  }
  #sv-chat-header {
      padding:15px 20px; font-weight:600; font-size:0.95rem;
      display:flex; justify-content:space-between; align-items:center;
      font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
      letter-spacing:-0.01em; color:#fff;
      background: rgba(255,255,255,0.04);
      border-bottom: 1px solid rgba(255,255,255,0.09);
  }
  #sv-chat-close {
      background:rgba(255,255,255,0.06); border:none; color:rgba(226,234,255,0.72);
      width:30px; height:30px; border-radius:50%; font-size:18px; line-height:1; cursor:pointer;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
      transition: color 0.18s ease, background-color 0.18s ease, transform 0.24s ease;
  }
  #sv-chat-close:hover { color:#fff; background:rgba(255,255,255,0.14); transform: rotate(90deg); }

  #sv-chat-body { padding:16px 20px; max-height:350px; overflow:auto; font-size:14.5px; line-height:1.65; }
  #sv-chat-input-row {
      display:flex; padding:14px 18px; gap:10px;
      background: rgba(0,0,0,0.16);
      border-top: 1px solid rgba(255,255,255,0.07);
  }
  #sv-chat-input {
      flex:1; padding:12px 14px; border-radius:14px; border:none;
      color:#fff; font-family:'Inter', system-ui, sans-serif;
      background: rgba(255,255,255,0.045);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.11), inset 0 2px 5px rgba(0,0,0,0.3);
      transition: box-shadow 0.28s ease, background-color 0.28s ease;
  }
  #sv-chat-input::placeholder { color: rgba(180,194,230,0.34); }
  #sv-chat-input:focus {
      outline:none; background: rgba(255,255,255,0.08);
      box-shadow: inset 0 0 0 1px rgba(34,211,238,0.65), 0 0 0 4px rgba(34,211,238,0.14);
  }
  #sv-chat-send {
      padding:0 18px; min-height:44px; border:none; border-radius:999px;
      color:#02121a; font-weight:600; cursor:pointer;
      font-family:'Inter', system-ui, sans-serif;
      background:
        linear-gradient(120deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.05) 42%, transparent 60%),
        linear-gradient(100deg, #22d3ee 0%, #2dd4bf 34%, #a78bfa 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.65), 0 10px 30px -8px rgba(34,211,238,0.55);
      transition: transform 0.18s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s ease;
  }
  #sv-chat-send:hover { transform: translateY(-2px); box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 16px 44px -10px rgba(34,211,238,0.7); }
  #sv-chat-send:active { transform: translateY(0) scale(0.97); }

  .sv-chat-msg { margin:12px 0; padding:11px 15px; border-radius:16px; }
  .sv-chat-msg.user {
      text-align:right; border-top-right-radius:5px;
      background: linear-gradient(150deg, rgba(34,211,238,0.16), rgba(255,255,255,0.05));
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.22);
  }
  .sv-chat-msg.bot {
      border-top-left-radius:5px;
      background: rgba(255,255,255,0.055);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.18);
  }
  .sv-chat-system {
      font-size:11px; margin:8px 0; color: rgba(198,210,240,0.52);
      font-family:'JetBrains Mono', ui-monospace, monospace;
      text-transform:uppercase; letter-spacing:0.16em;
  }

  #sv-chat-body::-webkit-scrollbar { width: 6px; }
  #sv-chat-body::-webkit-scrollbar-track { background: transparent; }
  #sv-chat-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 10px; }
  #sv-chat-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.26); }

  @media (prefers-reduced-motion: reduce) {
      #sv-chat-btn, #sv-chat-send, #sv-chat-close { transition: none; }
  }
  `;

  const style = document.createElement('style');
  style.innerHTML = css;
  document.head.appendChild(style);

  // Create elements
  const btn = document.createElement('div');
  btn.id = 'sv-chat-btn';
  btn.title = 'Ask SpaceVerse Chatbot';
  btn.innerHTML = `<span>👽</span>`;

  const modal = document.createElement('div');
  modal.id = 'sv-chat-modal';
  modal.innerHTML = `
    <div id="sv-chat-header">SPACE TERMINAL <span style="font-size:10px; opacity:.8; font-family:'Inter', sans-serif; letter-spacing:0; text-shadow:none; color:#a0aec0; margin-left: 10px;">[GEMINI_AI_CORE]</span><div style="flex:1"></div><button id="sv-chat-close">✕</button></div>
    <div id="sv-chat-body"><div class="sv-chat-system">Hello Pilot! I am your co pilot alien Assistant. Ask me for data regarding planetary mechanics, celestial phenomena, rockets, or black holes!</div></div>
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