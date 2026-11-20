/* =========================================================
   Deutsch A1 Master — Core Application Logic (v2)
   - Native German (de-DE) Multi-Provider Audio Engine (NEVER falls back to English!)
   - Complete Netzwerk neu A1 (Kapitel 1 – 12) + 750+ Individual Words + A1 Exam Hub
   ========================================================= */

(function () {
  const CHAPTERS = [
    ...(window.CHAPTERS_1_4 || []),
    ...(window.CHAPTERS_5_8 || []),
    ...(window.CHAPTERS_9_12 || [])
  ];
  const APPENDIX = window.A1_APPENDIX || {};

  // ---- Persistent Progress State ----
  const STORAGE_KEY = 'deutsch_a1_master_v2';
  let state = {
    view: 'dashboard',       // 'dashboard' | 'chapter' | 'appendix'
    chapterId: 1,
    activeTab: 'grammar',    // 'grammar' | 'vocab' | 'qa' | 'dialogues' | 'mindmap' | 'practice'
    vocabFilter: 'all',
    vocabQuery: '',
    hideArabic: false,
    theme: localStorage.getItem('deutsch_a1_theme') || 'light',
    fcIndex: 0,
    fcFlipped: false,
    sprechenIdx: 0,
    sprechenRevealed: false,
    progress: loadProgress()
  };

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('deutsch_a1_master_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { completedChapters: [], masteredCards: {}, quizScores: {} };
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch (e) {}
  }

  // ---- Toast Notification ----
  let toastTimer = null;
  function showToast(msg, duration = 4500) {
    const el = document.getElementById('toastBanner');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // =========================================================
  // BULLETPROOF NATIVE GERMAN (de-DE) PRONUNCIATION ENGINE
  // Default: Online Native German TTS (works on every device!)
  // Local fallback: STRICTLY verified de-* voices ONLY (never English!)
  // =========================================================
  const sharedAudio = new Audio();
  sharedAudio.preload = 'auto';

  let deVoices = [];
  // 'online' = native German online TTS (default), or 'local:<voiceURI>'
  let selectedVoiceMode = localStorage.getItem('deutsch_a1_voice_mode') || 'online';
  let speakSessionId = 0;
  let dialoguePlaying = false;
  let dialogueTimer = null;

  function isGenuineGermanVoice(v) {
    if (!v) return false;
    const lang = (v.lang || '').toLowerCase().replace('_', '-');
    // Strictly require German language code: de, de-de, de-at, de-ch
    return lang === 'de' || lang.startsWith('de-');
  }

  function loadVoices() {
    if ('speechSynthesis' in window) {
      const all = window.speechSynthesis.getVoices() || [];
      deVoices = all.filter(isGenuineGermanVoice);
      deVoices.sort((a, b) => {
        const score = v => {
          let s = 0;
          if ((v.lang || '').toLowerCase() === 'de-de') s += 10;
          if (/google|microsoft|katja|conrad|hedda|stefan|anna|natural|online/i.test(v.name)) s += 5;
          return s;
        };
        return score(b) - score(a);
      });
    }

    const sel = document.getElementById('voiceSelect');
    if (!sel) return;
    sel.innerHTML = '';

    // Option 1 (Always Default): Online Native German (de-DE)
    const optOnline = document.createElement('option');
    optOnline.value = 'online';
    optOnline.textContent = '🌐 ألماني أصلي (أونلاين de-DE)';
    sel.appendChild(optOnline);

    // Genuine local German voices if installed on device
    deVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = 'local:' + v.voiceURI;
      const shortName = v.name.replace(/Microsoft |Google |Desktop |Mobile /gi, '').trim();
      opt.textContent = `💻 ${shortName} (${v.lang})`;
      sel.appendChild(opt);
    });

    // Validate stored preference
    const validValues = Array.from(sel.options).map(o => o.value);
    if (!validValues.includes(selectedVoiceMode)) {
      selectedVoiceMode = 'online';
    }
    sel.value = selectedVoiceMode;
  }

  function cleanGermanForSpeech(text) {
    if (!text) return '';
    let cleaned = String(text)
      // Remove Arabic characters & Arabic punctuation
      .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, ' ')
      // Remove grammatical hint parentheses like (Pl.), (EG), (Nom), (Akk), (Dat), (0-5)
      .replace(/\(\s*(?:Pl\.?|Sg\.?|EG|UG|OG|KM|WM|NK|Nom|Akk|Dat|M|F|N|\d+\s*[–-]\s*\d+|[^a-zA-ZäöüÄÖÜß]*)\s*\)/gi, ' ')
      // Remove blanks
      .replace(/_{2,}/g, ', ')
      // Replace slashes & arrows with gentle pause
      .replace(/[\/←→—|•]/g, ', ')
      // Clean leftover empty parentheses & punctuation clutter
      .replace(/\(\s*\)/g, ' ')
      .replace(/\s*,\s*,+/g, ', ')
      .replace(/^\s*[,.\-:;]+\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned;
  }

  function splitIntoChunks(text, maxLen = 155) {
    if (text.length <= maxLen) return [text];
    const parts = text.split(/(?<=[.!?،,;:])\s+/);
    const chunks = [];
    let current = '';
    for (const part of parts) {
      if ((current + ' ' + part).trim().length <= maxLen) {
        current = (current + ' ' + part).trim();
      } else {
        if (current) chunks.push(current);
        if (part.length <= maxLen) {
          current = part;
        } else {
          // Split long clause by spaces
          const words = part.split(/\s+/);
          let buf = '';
          for (const word of words) {
            if ((buf + ' ' + word).trim().length <= maxLen) {
              buf = (buf + ' ' + word).trim();
            } else {
              if (buf) chunks.push(buf);
              buf = word;
            }
          }
          current = buf;
        }
      }
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  function getOnlineGermanUrls(chunk) {
    const q = encodeURIComponent(chunk);
    return [
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=de&q=${q}`,
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=de&q=${q}`,
      `https://dict.youdao.com/dictvoice?le=de&audio=${q}`
    ];
  }

  function stopSpeaking() {
    speakSessionId++;
    dialoguePlaying = false;
    if (dialogueTimer) {
      clearTimeout(dialogueTimer);
      dialogueTimer = null;
    }
    try {
      sharedAudio.pause();
      sharedAudio.onended = null;
      sharedAudio.onerror = null;
      sharedAudio.currentTime = 0;
    } catch (e) {}
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
    document.querySelectorAll('.active-speaking').forEach(el => el.classList.remove('active-speaking'));
  }

  function playLocalGermanVoice(text, rate, voiceURI, mySession, onDone, onFail) {
    if (!('speechSynthesis' in window)) {
      onFail();
      return;
    }
    if (deVoices.length === 0) loadVoices();
    const chosen = voiceURI
      ? deVoices.find(v => v.voiceURI === voiceURI)
      : deVoices[0];

    // CRITICAL: NEVER fall back to English if no genuine German voice exists!
    if (!chosen) {
      onFail();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.voice = chosen;
      utter.lang = chosen.lang || 'de-DE';
      utter.rate = rate;
      utter.pitch = 1.0;
      utter.onend = () => {
        if (mySession === speakSessionId) onDone();
      };
      utter.onerror = () => {
        if (mySession === speakSessionId) onFail();
      };
      window.speechSynthesis.speak(utter);
    } catch (e) {
      onFail();
    }
  }

  function playOnlineChunk(chunk, rate, mySession, onChunkDone, onChunkFail) {
    const urls = getOnlineGermanUrls(chunk);
    let urlIdx = 0;

    function tryNextUrl() {
      if (mySession !== speakSessionId) return;
      if (urlIdx >= urls.length) {
        onChunkFail();
        return;
      }
      const url = urls[urlIdx++];
      sharedAudio.onended = null;
      sharedAudio.onerror = null;
      sharedAudio.src = url;
      sharedAudio.playbackRate = rate;
      if ('preservesPitch' in sharedAudio) sharedAudio.preservesPitch = true;

      let settled = false;
      const failTimer = setTimeout(() => {
        if (!settled && mySession === speakSessionId) {
          settled = true;
          tryNextUrl();
        }
      }, 6500);

      sharedAudio.onplaying = () => {
        clearTimeout(failTimer);
        sharedAudio.playbackRate = rate;
      };

      sharedAudio.onended = () => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        if (mySession === speakSessionId) onChunkDone();
      };

      sharedAudio.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        if (mySession === speakSessionId) tryNextUrl();
      };

      const p = sharedAudio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(failTimer);
          if (mySession === speakSessionId) tryNextUrl();
        });
      }
    }

    tryNextUrl();
  }

  function speakGerman(rawText, rate = 1.0, btnEl = null, onEndCb = null, keepDialogueFlag = false) {
    const text = cleanGermanForSpeech(rawText);
    if (!text) {
      if (onEndCb) onEndCb();
      return;
    }

    if (!keepDialogueFlag) {
      stopSpeaking();
    } else {
      speakSessionId++;
    }
    const mySession = speakSessionId;

    if (btnEl) btnEl.classList.add('speaking');
    const finish = () => {
      if (btnEl) btnEl.classList.remove('speaking');
      if (onEndCb) onEndCb();
    };

    const handleCompleteFailure = () => {
      if (btnEl) btnEl.classList.remove('speaking');
      showToast('⚠️ تعذّر تشغيل الصوت الألماني أونلاين ولا توجد حزمة صوت ألماني (Deutsch) مثبتة على جهازك. تأكد من الاتصال بالإنترنت لسماع النطق الألماني الأصلي.');
      if (onEndCb) onEndCb();
    };

    // Case A: User explicitly picked a verified local German voice
    if (selectedVoiceMode.startsWith('local:')) {
      const uri = selectedVoiceMode.slice(6);
      playLocalGermanVoice(text, rate, uri, mySession, finish, () => {
        // Fallback to online native German
        const chunks = splitIntoChunks(text);
        let cIdx = 0;
        function nextOnline() {
          if (mySession !== speakSessionId) return;
          if (cIdx >= chunks.length) { finish(); return; }
          playOnlineChunk(chunks[cIdx++], rate, mySession, nextOnline, handleCompleteFailure);
        }
        nextOnline();
      });
      return;
    }

    // Case B (DEFAULT): Online Native German (de-DE)
    const chunks = splitIntoChunks(text);
    let cIdx = 0;
    function runNextChunk() {
      if (mySession !== speakSessionId) return;
      if (cIdx >= chunks.length) {
        finish();
        return;
      }
      playOnlineChunk(chunks[cIdx++], rate, mySession, runNextChunk, () => {
        // Only fallback to local SpeechSynthesis IF a genuine German voice is installed!
        playLocalGermanVoice(text, rate, null, mySession, finish, handleCompleteFailure);
      });
    }
    runNextChunk();
  }

  function playFullDialogue(chId, dIdx, rate = 0.95) {
    const ch = CHAPTERS.find(c => c.id === chId);
    if (!ch || !ch.dialogues[dIdx]) return;
    stopSpeaking();
    dialoguePlaying = true;
    const lines = ch.dialogues[dIdx].lines;

    function nextLine(i) {
      if (!dialoguePlaying || i >= lines.length) {
        stopSpeaking();
        return;
      }
      document.querySelectorAll('.active-speaking').forEach(el => el.classList.remove('active-speaking'));
      const rowEl = document.getElementById(`dlg-${dIdx}-line-${i}`);
      if (rowEl) {
        rowEl.classList.add('active-speaking');
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      speakGerman(lines[i].de, rate, null, () => {
        if (!dialoguePlaying) return;
        dialogueTimer = setTimeout(() => nextLine(i + 1), 420);
      }, true);
    }
    nextLine(0);
  }

  // ---- Utilities ----
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(str) {
    return escHtml(str).replace(/'/g, '&#39;');
  }

  function formatInline(str) {
    return escHtml(str)
      .replace(/==(.+?)==/g, '<strong style="color:var(--accent)">$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  function speakButtonsHtml(deText) {
    const safe = escAttr(deText);
    return `<span class="speak-group">
      <button class="speak-btn" title="نطق ألماني طبيعي (de-DE)" onclick="window.APP.speak('${safe}', 1.0, this)">🔊 نطق</button>
      <button class="speak-btn slow" title="نطق ألماني بطيء للتعلم" onclick="window.APP.speak('${safe}', 0.72, this)">🐢 بطيء</button>
    </span>`;
  }

  function getArticleBadge(art) {
    const map = {
      der: ['der (مذكر)', 'art-der'],
      das: ['das (محايد)', 'art-das'],
      die: ['die (مؤنث/جمع)', 'art-die'],
      verb: ['Verb (فعل)', 'art-verb'],
      other: ['تعبير / صفة', 'art-other']
    };
    const [label, cls] = map[art] || map.other;
    return `<span class="art-badge ${cls}">${label}</span>`;
  }

  function getChapterCompletionPct(ch) {
    let score = 0;
    if (state.progress.completedChapters.includes(ch.id)) score += 40;
    const totalCards = ch.vocab.length || 1;
    let mastered = 0;
    ch.vocab.forEach((_, idx) => {
      if (state.progress.masteredCards[`${ch.id}-${idx}`]) mastered++;
    });
    score += Math.round((mastered / totalCards) * 30);
    const q = state.progress.quizScores[ch.id];
    if (q && q.total > 0) score += Math.round((q.score / q.total) * 30);
    return Math.min(100, score);
  }

  // ---- Render Sidebar ----
  function renderSidebar() {
    const sb = document.getElementById('sidebarNav');
    if (!sb) return;
    let html = `
      <div class="sidebar-section-label">الرئيسية والمراجعة</div>
      <button class="nav-item ${state.view === 'dashboard' ? 'active' : ''}" onclick="window.APP.goDashboard()">
        <span class="nav-badge" style="background:var(--primary)">🏠</span>
        <span class="nav-info">
          <span class="nav-title-de" style="direction:rtl">لوحة التحكم والفهرس</span>
          <span class="nav-title-ar">جميع الدروس (1 – 12)</span>
        </span>
      </button>
      <button class="nav-item ${state.view === 'appendix' ? 'active' : ''}" onclick="window.APP.goAppendix()">
        <span class="nav-badge" style="background:var(--accent)">A1</span>
        <span class="nav-info">
          <span class="nav-title-de" style="direction:rtl">الملحق الذهبي للامتحان</span>
          <span class="nav-title-ar">إعراب + أفعال + كتابة + شفوي</span>
        </span>
      </button>
      <div class="sidebar-section-label">دروس المنهج (Kapitel 1 – 12)</div>
    `;

    CHAPTERS.forEach(ch => {
      const isActive = state.view === 'chapter' && state.chapterId === ch.id;
      const done = state.progress.completedChapters.includes(ch.id);
      html += `
        <button class="nav-item ${isActive ? 'active' : ''}" onclick="window.APP.goChapter(${ch.id})">
          <span class="nav-badge" style="background:${ch.color}">${ch.id}</span>
          <span class="nav-info">
            <span class="nav-title-de">Kapitel ${ch.id}: ${escHtml(ch.deTitle)}</span>
            <span class="nav-title-ar">${escHtml(ch.arTitle)}</span>
          </span>
          <span class="nav-check">${done ? '✅' : ''}</span>
        </button>
      `;
    });

    sb.innerHTML = html;
  }

  // ---- Render Dashboard ----
  function renderDashboard() {
    const main = document.getElementById('mainContent');
    const totalVocab = CHAPTERS.reduce((s, c) => s + c.vocab.length, 0);
    const totalDialogues = CHAPTERS.reduce((s, c) => s + c.dialogues.length, 0);
    const masteredCount = Object.values(state.progress.masteredCards).filter(Boolean).length;
    const completedCount = state.progress.completedChapters.length;
    const quizEntries = Object.values(state.progress.quizScores);
    const quizAvg = quizEntries.length
      ? Math.round(quizEntries.reduce((s, q) => s + (q.score / q.total) * 100, 0) / quizEntries.length)
      : 0;

    let cardsHtml = CHAPTERS.map(ch => {
      const pct = getChapterCompletionPct(ch);
      const done = state.progress.completedChapters.includes(ch.id);
      return `
        <div class="chapter-card" style="border-top-color:${ch.color}" onclick="window.APP.goChapter(${ch.id})">
          <div class="chapter-card-top">
            <span class="chapter-pill" style="background:${ch.color}">الدرس ${ch.id}</span>
            <span style="font-size:12px;font-weight:700;color:var(--text-muted)">${done ? '✅ مكتمل' : `${ch.vocab.length} كلمة • ${pct}%`}</span>
          </div>
          <div>
            <h3>${escHtml(ch.arTitle)}</h3>
            <span class="de-sub ltr">Kapitel ${ch.id}: ${escHtml(ch.deTitle)}</span>
          </div>
          <p>${escHtml(ch.objectives)}</p>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width:${pct}%;background:${ch.color}"></div>
          </div>
        </div>
      `;
    }).join('');

    main.innerHTML = `
      <div class="hero-banner">
        <h2>منصة مذاكرة الألمانية الشاملة — Netzwerk neu A1</h2>
        <p>كل دروس مستوى A1 من الدرس الأول حتى الثاني عشر مقسّمة درساً بدرس: قواعد مفصّلة، <strong>أكثر من ${totalVocab} كلمة فردية</strong> بالأداة والجمع مع <strong>نطق ألماني أصلي (de-DE)</strong> بالسرعة الطبيعية والبطيئة، محادثات مترجمة تفاعلية، خرائط ذهنية، بطاقات حفظ، واختبارات محاكاة.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn-primary" style="background:#fff;color:#1B365D" onclick="window.APP.goChapter(1)">ابدأ من الدرس الأول ←</button>
          <button class="btn-primary" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.35)" onclick="window.APP.goAppendix()">🏆 الملحق الذهبي لامتحان A1</button>
          <button class="btn-primary" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.35)" onclick="window.APP.openLab()">🎙️ مختبر النطق الحر</button>
        </div>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-num">${completedCount} / 12</span><span class="stat-lbl">دروس مكتملة</span></div>
          <div class="stat-card"><span class="stat-num">${totalVocab}</span><span class="stat-lbl">كلمة ألمانية بالنطق الأصلي</span></div>
          <div class="stat-card"><span class="stat-num">${totalDialogues}</span><span class="stat-lbl">مناقشة ومحادثة مترجمة</span></div>
          <div class="stat-card"><span class="stat-num">${quizAvg}%</span><span class="stat-lbl">متوسط الاختبارات</span></div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <h3 style="font-size:18px;font-weight:800">اختر الدرس الذي تريد مذاكرته (Kapitel 1 – 12):</h3>
        <button class="btn-outline" onclick="window.APP.resetProgress()" style="font-size:12px">🔄 إعادة ضبط التقدم</button>
      </div>
      <div class="chapters-grid">${cardsHtml}</div>
    `;
  }

  // ---- Render Single Chapter ----
  function renderChapter() {
    const ch = CHAPTERS.find(c => c.id === state.chapterId) || CHAPTERS[0];
    const main = document.getElementById('mainContent');
    const isDone = state.progress.completedChapters.includes(ch.id);

    const tabs = [
      { id: 'grammar', label: '📘 القواعد بالتفصيل' },
      { id: 'vocab', label: `🔤 الكلمات والنطق (${ch.vocab.length})` },
      { id: 'qa', label: `❓ الأسئلة والأجوبة (${ch.qa.length})` },
      { id: 'dialogues', label: `💬 المناقشات (${ch.dialogues.length})` },
      { id: 'mindmap', label: '🧠 الخريطة الذهنية' },
      { id: 'practice', label: '🎯 بطاقات الحفظ والاختبار' }
    ];

    const tabsHtml = tabs.map(t => `
      <button class="tab-btn ${state.activeTab === t.id ? 'active' : ''}" onclick="window.APP.setTab('${t.id}')">${t.label}</button>
    `).join('');

    let bodyHtml = '';
    if (state.activeTab === 'grammar') bodyHtml = renderGrammarTab(ch);
    else if (state.activeTab === 'vocab') bodyHtml = renderVocabTab(ch);
    else if (state.activeTab === 'qa') bodyHtml = renderQaTab(ch);
    else if (state.activeTab === 'dialogues') bodyHtml = renderDialoguesTab(ch);
    else if (state.activeTab === 'mindmap') bodyHtml = renderMindmapTab(ch);
    else if (state.activeTab === 'practice') bodyHtml = renderPracticeTab(ch);

    main.innerHTML = `
      <div class="chapter-header" style="background:linear-gradient(135deg, #1B365D 0%, ${ch.color} 100%)">
        <div>
          <div style="font-size:12.5px;opacity:0.9;margin-bottom:4px" class="ltr">Kapitel ${ch.id} — ${escHtml(ch.deTitle)}</div>
          <h2>الدرس ${ch.id}: ${escHtml(ch.arTitle)}</h2>
          <div class="ch-objectives">${escHtml(ch.objectives)}</div>
        </div>
        <div class="chapter-nav-arrows">
          <button onclick="window.APP.toggleDone(${ch.id})">${isDone ? '✅ تمت المذاكرة' : '⬜ علّم كمكتمل'}</button>
          ${ch.id > 1 ? `<button onclick="window.APP.goChapter(${ch.id - 1})">→ السابق</button>` : ''}
          ${ch.id < 12 ? `<button onclick="window.APP.goChapter(${ch.id + 1})">التالي ←</button>` : ''}
        </div>
      </div>

      <div class="tabs-bar">${tabsHtml}</div>
      <div class="${state.hideArabic ? 'hide-ar' : ''}">${bodyHtml}</div>
    `;
  }

  function renderGrammarTab(ch) {
    let html = ch.grammar.map(g => {
      const tableHtml = g.table ? `
        <div class="table-wrap">
          <table>
            <thead><tr>${g.table.headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>
              ${g.table.rows.map(row => `<tr>${row.map(cell => `<td>${formatInline(cell)}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>` : '';

      const exHtml = (g.examples || []).map(ex => `
        <div class="example-item">
          <div>
            <div class="example-de ltr">${escHtml(ex.de)}</div>
            <div class="example-ar">${escHtml(ex.ar)}</div>
          </div>
          ${speakButtonsHtml(ex.de)}
        </div>
      `).join('');

      return `
        <div class="card">
          <div class="card-title"><span>${escHtml(g.title)}</span></div>
          <p style="font-size:14.2px;margin-bottom:8px">${formatInline(g.explanation)}</p>
          ${tableHtml}
          ${exHtml}
        </div>
      `;
    }).join('');

    if (ch.traps && ch.traps.length) {
      html += `
        <div class="traps-box">
          <h4>⚠️ تكات الامتحان وأخطاء شائعة في الدرس ${ch.id} (انتبه!)</h4>
          <ul>${ch.traps.map(t => `<li>${formatInline(t)}</li>`).join('')}</ul>
        </div>
      `;
    }
    return html;
  }

  function getFilteredVocab(ch) {
    let list = state.vocabFilter === 'all'
      ? ch.vocab
      : ch.vocab.filter(v => v.art === state.vocabFilter);
    const q = (state.vocabQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(v =>
        v.de.toLowerCase().includes(q) ||
        v.ar.toLowerCase().includes(q) ||
        v.cat.toLowerCase().includes(q) ||
        v.plural.toLowerCase().includes(q)
      );
    }
    return list;
  }

  function buildVocabRowsHtml(list) {
    if (!list.length) {
      return '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">لا توجد كلمات مطابقة للفلتر أو البحث الحالي.</td></tr>';
    }
    return list.map(v => `
      <tr>
        <td>${getArticleBadge(v.art)}<strong class="ltr" style="font-size:14.5px">${escHtml(v.de)}</strong></td>
        <td data-label="الجمع / التصريف" class="ltr" style="color:var(--text-muted);font-size:13px">${escHtml(v.plural)}</td>
        <td data-label="المعنى"><strong>${escHtml(v.ar)}</strong> <span style="font-size:11.5px;color:var(--text-muted)">(${escHtml(v.cat)})</span></td>
        <td>${speakButtonsHtml(v.de)}</td>
      </tr>
    `).join('');
  }

  function renderVocabTab(ch) {
    const filters = [
      { id: 'all', label: `الكل (${ch.vocab.length})` },
      { id: 'der', label: `🔵 der (${ch.vocab.filter(v=>v.art==='der').length})` },
      { id: 'das', label: `🟢 das (${ch.vocab.filter(v=>v.art==='das').length})` },
      { id: 'die', label: `🔴 die (${ch.vocab.filter(v=>v.art==='die').length})` },
      { id: 'verb', label: `🟣 أفعال (${ch.vocab.filter(v=>v.art==='verb').length})` },
      { id: 'other', label: `⚪ صفات وتعبيرات (${ch.vocab.filter(v=>v.art==='other').length})` }
    ];

    const list = getFilteredVocab(ch);

    return `
      <div class="card">
        <div class="card-title">
          <span>قاموس كلمات الدرس ${ch.id} الكامل (${ch.vocab.length} كلمة بالنطق الألماني الأصلي 🇩🇪)</span>
          <span style="font-size:12px;color:var(--text-muted)">der أزرق | das أخضر | die أحمر</span>
        </div>
        <div class="filter-bar">
          ${filters.map(f => `<button class="filter-chip ${state.vocabFilter === f.id ? 'active' : ''}" onclick="window.APP.setVocabFilter('${f.id}')">${f.label}</button>`).join('')}
          <input type="text" class="vocab-search-input" value="${escAttr(state.vocabQuery)}" placeholder="🔎 تصفية سريعة داخل الدرس..." oninput="window.APP.setVocabQuery(this.value)" />
        </div>
        <div class="table-wrap mobile-cards-wrap">
          <table class="mobile-card-table">
            <thead>
              <tr>
                <th>الكلمة بالألماني</th>
                <th>الجمع / التصريف</th>
                <th>المعنى بالعربي</th>
                <th>الاستماع (de-DE)</th>
              </tr>
            </thead>
            <tbody id="vocabTableBody">${buildVocabRowsHtml(list)}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderQaTab(ch) {
    const rowsHtml = ch.qa.map(item => `
      <tr>
        <td data-label="السؤال">
          <div class="ltr" style="font-weight:700;font-size:14px;margin-bottom:5px">${escHtml(item.q)}</div>
          ${speakButtonsHtml(item.q)}
        </td>
        <td data-label="الإجابة">
          <div class="ltr" style="font-weight:700;font-size:14px;color:var(--success);margin-bottom:5px">${escHtml(item.a)}</div>
          ${speakButtonsHtml(item.a)}
        </td>
        <td data-label="الترجمة" class="qa-ar-text" style="font-size:13.3px">${escHtml(item.ar)}</td>
      </tr>
    `).join('');

    return `
      <div class="card">
        <div class="card-title">
          <span>أهم الأسئلة والأجوبة والتعبيرات اليومية (Redemittel)</span>
          <button class="btn-outline" onclick="window.APP.toggleHideArabic()">${state.hideArabic ? '👁️ إظهار الترجمة' : '🙈 إخفاء الترجمة للاختبار'}</button>
        </div>
        <div class="table-wrap mobile-cards-wrap">
          <table class="mobile-card-table">
            <thead>
              <tr>
                <th>السؤال / العبارة بالألماني</th>
                <th>الإجابة / الرد بالألماني</th>
                <th>الترجمة بالعربي</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderDialoguesTab(ch) {
    const controls = `
      <div class="dialogue-controls">
        <button class="btn-outline" onclick="window.APP.toggleHideArabic()">${state.hideArabic ? '👁️ إظهار الترجمة العربية' : '🙈 إخفاء الترجمة العربية (مرّر الماوس للكشف)'}</button>
        <button class="btn-outline" onclick="window.APP.stopSpeak()">⏹️ إيقاف الصوت</button>
      </div>
    `;

    const dlgsHtml = ch.dialogues.map((d, dIdx) => `
      <div class="card">
        <div class="card-title">
          <span>💬 ${escHtml(d.title)}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-primary" onclick="window.APP.playDialogue(${ch.id}, ${dIdx}, 0.95)">▶️ تشغيل المحادثة كاملة</button>
            <button class="btn-outline" onclick="window.APP.playDialogue(${ch.id}, ${dIdx}, 0.72)">🐢 تشغيل بطيء</button>
          </div>
        </div>
        <div>
          ${d.lines.map((ln, lIdx) => `
            <div class="dialogue-line" id="dlg-${dIdx}-line-${lIdx}">
              <span class="speaker-tag">${escHtml(ln.speaker)}</span>
              <div class="dialogue-body">
                <div class="dialogue-de ltr">${escHtml(ln.de)}</div>
                <div class="dialogue-ar">${escHtml(ln.ar)}</div>
              </div>
              ${speakButtonsHtml(ln.de)}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    return controls + dlgsHtml;
  }

  function renderMindmapTab(ch) {
    const mm = ch.mindmap;
    const branchesHtml = mm.branches.map((br, bIdx) => `
      <div class="mm-branch" style="border-color:${br.color}">
        <div class="mm-branch-hdr" style="background:${br.color}" onclick="window.APP.toggleBranch('mm-list-${bIdx}')">
          <span>${escHtml(br.title)}</span>
          <span>▾</span>
        </div>
        <ul class="mm-branch-list" id="mm-list-${bIdx}">
          ${br.items.map(item => `
            <li style="border-right-color:${br.color}">
              <span>${formatInline(item)}</span>
              <button class="speak-btn" style="padding:3px 7px;font-size:11.5px" onclick="window.APP.speak('${escAttr(item)}', 0.92, this)">🔊</button>
            </li>
          `).join('')}
        </ul>
      </div>
    `).join('');

    return `
      <div class="mindmap-container">
        <div style="text-align:center;font-size:13px;color:var(--text-muted);margin-bottom:14px">
          اضغط على أي أيقونة 🔊 داخل الخريطة الذهنية لسماع النطق الألماني الأصلي (de-DE)، أو اضغط على عنوان أي فرع لطيّه أو فتحه.
        </div>
        <div class="mindmap-center-wrap">
          <div class="mindmap-center ltr" onclick="window.APP.speak('${escAttr(mm.center)}', 0.95, this)">
            🧠 ${escHtml(mm.center)}
          </div>
        </div>
        <div class="mindmap-branches">${branchesHtml}</div>
      </div>
    `;
  }

  function renderPracticeTab(ch) {
    const cards = ch.vocab;
    const idx = Math.min(state.fcIndex, cards.length - 1);
    const card = cards[idx];
    const cardKey = `${ch.id}-${idx}`;
    const isMastered = !!state.progress.masteredCards[cardKey];
    const masteredInCh = cards.filter((_, i) => state.progress.masteredCards[`${ch.id}-${i}`]).length;

    const flashcardHtml = `
      <div class="card">
        <div class="card-title">
          <span>🃏 بطاقات الحفظ النشط (Flashcards) — اضغط على البطاقة لقلبها</span>
          <span style="font-size:12.5px;color:var(--success)">متقن: ${masteredInCh} / ${cards.length}</span>
        </div>
        <div class="flashcard-stage">
          <div class="flashcard ${state.fcFlipped ? 'flipped' : ''}" onclick="window.APP.flipCard()">
            <div class="fc-face fc-front">
              <div style="margin-bottom:8px">${getArticleBadge(card.art)}</div>
              <div class="fc-word ltr">${escHtml(card.de)}</div>
              <div class="fc-sub ltr">${escHtml(card.plural)}</div>
              <div style="margin-top:14px;font-size:12px;color:var(--text-muted)">بطاقة ${idx + 1} من ${cards.length} • اضغط للقلب</div>
            </div>
            <div class="fc-face fc-back">
              <div class="fc-word">${escHtml(card.ar)}</div>
              <div class="fc-sub">${escHtml(card.cat)}</div>
              <div class="fc-sub ltr" style="margin-top:8px;opacity:0.9">${escHtml(card.de)}</div>
            </div>
          </div>
          <div class="fc-actions">
            <button class="btn-outline" onclick="window.APP.prevCard(${cards.length})">→ السابقة</button>
            ${speakButtonsHtml(card.de)}
            <button class="btn-primary" style="background:${isMastered ? 'var(--success)' : 'var(--primary)'}" onclick="window.APP.toggleMasterCard('${cardKey}')">
              ${isMastered ? '✅ أعرفها جيداً' : '⭐ علّم كمتقنة'}
            </button>
            <button class="btn-outline" onclick="window.APP.nextCard(${cards.length})">التالية ←</button>
          </div>
        </div>
      </div>
    `;

    const savedQuiz = state.progress.quizScores[ch.id];
    const quizHtml = `
      <div class="card">
        <div class="card-title">
          <span>📝 اختبار الدرس ${ch.id} التفاعلي (${ch.quiz.length} أسئلة على نمط امتحان A1)</span>
          <span id="quizScoreBadge" style="font-size:13px;color:var(--primary-light)">
            ${savedQuiz ? `أفضل درجة مسجلة: ${savedQuiz.score} / ${savedQuiz.total}` : 'اختر الإجابة الصحيحة لكل سؤال'}
          </span>
        </div>
        <div id="quizContainer">
          ${ch.quiz.map((q, qIdx) => `
            <div class="quiz-item" id="qitem-${qIdx}">
              <div class="quiz-q">${qIdx + 1}. <span class="ltr">${escHtml(q.q)}</span></div>
              <div class="quiz-opts">
                ${q.opts.map((opt, oIdx) => `
                  <button class="quiz-opt ltr" onclick="window.APP.answerQuiz(${ch.id}, ${qIdx}, ${oIdx}, this)">${escHtml(opt)}</button>
                `).join('')}
              </div>
              <div class="quiz-exp" id="qexp-${qIdx}" style="display:none"></div>
            </div>
          `).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <div id="quizLiveScore" style="font-weight:800;font-size:15px"></div>
          <button class="btn-outline" onclick="window.APP.setTab('practice')">🔄 إعادة الاختبار</button>
        </div>
      </div>
    `;

    return flashcardHtml + quizHtml;
  }

  // ---- Quiz Session State ----
  let currentQuizAnswers = {};

  function answerQuiz(chId, qIdx, oIdx, btn) {
    const ch = CHAPTERS.find(c => c.id === chId);
    if (!ch || currentQuizAnswers[qIdx] !== undefined) return;
    const q = ch.quiz[qIdx];
    const isCorrect = oIdx === q.ans;
    currentQuizAnswers[qIdx] = isCorrect;

    const parent = document.getElementById(`qitem-${qIdx}`);
    const buttons = parent.querySelectorAll('.quiz-opt');
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === q.ans) b.classList.add('correct');
      else if (i === oIdx && !isCorrect) b.classList.add('wrong');
    });

    const expEl = document.getElementById(`qexp-${qIdx}`);
    expEl.style.display = 'block';
    expEl.innerHTML = `${isCorrect ? '✅ <strong>إجابة صحيحة!</strong>' : '❌ <strong>إجابة خاطئة.</strong>'} ${escHtml(q.exp)}`;

    const answeredCount = Object.keys(currentQuizAnswers).length;
    const correctCount = Object.values(currentQuizAnswers).filter(Boolean).length;
    const live = document.getElementById('quizLiveScore');
    if (live) live.textContent = `النتيجة الحالية: ${correctCount} من ${ch.quiz.length}`;

    if (answeredCount === ch.quiz.length) {
      const prev = state.progress.quizScores[chId];
      if (!prev || correctCount >= prev.score) {
        state.progress.quizScores[chId] = { score: correctCount, total: ch.quiz.length };
        saveProgress();
      }
      renderSidebar();
    }
  }

  // ---- Render A1 Golden Exam Hub (Appendix) ----
  function renderAppendix() {
    const main = document.getElementById('mainContent');
    const card = APPENDIX.sprechenCards[state.sprechenIdx % APPENDIX.sprechenCards.length];

    main.innerHTML = `
      <div class="chapter-header" style="background:linear-gradient(135deg, #1B365D 0%, #A62639 100%)">
        <div>
          <div style="font-size:12.5px;opacity:0.9" class="ltr">A1 Prüfungstraining — Golden Reference Hub</div>
          <h2>🏆 الملحق الذهبي للاستعداد لامتحان مستوى A1</h2>
          <div class="ch-objectives">الجدول الجامع للإعراب (Nominativ / Akkusativ / Dativ)، الضمائر، أهم 24 فعلاً في Perfekt بالنطق الألماني الأصلي، قوالب الإيميل الجاهزة، ومحاكي بطاقات امتحان الشفوي (Sprechen).</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>1. الجدول الجامع لحالات الإعراب الثلاث (Nominativ / Akkusativ / Dativ)</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr>${APPENDIX.casesTable.headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${APPENDIX.casesTable.rows.map(r => `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>2. جدول مقارنة الضمائر الشخصية والملكية في الحالات الثلاث</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr>${APPENDIX.pronounsTable.headers.map(h => `<th class="ltr">${escHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${APPENDIX.pronounsTable.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i > 0 ? 'ltr' : ''}" style="${i === 0 ? 'font-weight:800' : ''}">${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>3. أهم 24 فعلاً في الماضي التام (Perfekt) مع النطق الصوتي الألماني</span></div>
        <div class="table-wrap mobile-cards-wrap">
          <table class="mobile-card-table">
            <thead>
              <tr>
                <th>المصدر (Infinitiv)</th>
                <th>الماضي التام (Perfekt)</th>
                <th>الفعل المساعد</th>
                <th>المعنى</th>
                <th>استماع (de-DE)</th>
              </tr>
            </thead>
            <tbody>
              ${APPENDIX.perfektVerbs.map(v => `
                <tr>
                  <td data-label="المصدر" class="ltr"><strong>${escHtml(v.inf)}</strong></td>
                  <td data-label="الماضي التام" class="ltr" style="font-weight:700;color:var(--primary-light)">${escHtml(v.perf)}</td>
                  <td data-label="المساعد"><span class="art-badge ${v.aux === 'sein' ? 'art-die' : 'art-der'}">${v.aux}</span></td>
                  <td data-label="المعنى">${escHtml(v.ar)}</td>
                  <td>${speakButtonsHtml(`${v.inf}, ${v.perf}`)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>4. قوالب جاهزة لامتحان الكتابة (Schreiben A1 — الإيميل الرسمي وغير الرسمي)</span></div>
        ${APPENDIX.emailTemplates.map((t, i) => `
          <div style="background:var(--surface-alt);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
              <strong style="color:var(--primary)">${escHtml(t.title)}</strong>
              <div style="display:flex;gap:6px">
                ${speakButtonsHtml(t.de)}
                <button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="window.APP.copyText(${i})">📋 نسخ النص</button>
              </div>
            </div>
            <pre class="ltr" style="white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:14px;background:var(--surface);padding:12px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px">${escHtml(t.de)}</pre>
            <div style="font-size:12.8px;color:var(--text-muted)">${escHtml(t.ar)}</div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="card-title">
          <span>5. 🎤 محاكي بطاقات امتحان الشفوي (Sprechen A1 Simulator)</span>
          <button class="btn-primary" onclick="window.APP.nextSprechen()">🎲 اسحب بطاقة جديدة</button>
        </div>
        <div style="background:var(--surface-alt);border:2px dashed var(--primary-light);border-radius:14px;padding:20px;text-align:center">
          <div class="art-badge art-verb" style="margin-bottom:8px">${escHtml(card.part)}</div>
          <h3 style="font-size:17px;margin-bottom:12px">${escHtml(card.prompt)}</h3>
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">حاول تكوين الإجابة بصوت عالٍ أولاً، ثم اضغط لإظهار الإجابة النموذجية وسماع نطقها بالألمانية.</p>
          <button class="btn-outline" onclick="window.APP.toggleSprechenReveal()">${state.sprechenRevealed ? '🙈 إخفاء النموذج' : '💡 إظهار الإجابة النموذجية والنطق'}</button>
          ${state.sprechenRevealed ? `
            <div style="margin-top:14px;text-align:right;background:var(--surface);padding:14px;border-radius:10px;border:1px solid var(--border)">
              <div class="ltr" style="font-weight:700;font-size:15px;margin-bottom:6px">${escHtml(card.sampleDe)}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">${escHtml(card.sampleAr)}</div>
              ${speakButtonsHtml(card.sampleDe)}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ---- Global Search ----
  function performSearch(query) {
    const resEl = document.getElementById('searchResults');
    if (!resEl) return;
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      resEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center">اكتب أي كلمة ألمانية أو عربية أو اسم قاعدة (مثل: Dativ أو Perfekt أو الساعة أو Arzt)...</p>';
      return;
    }

    const hits = [];
    CHAPTERS.forEach(ch => {
      ch.grammar.forEach(g => {
        if ((g.title + ' ' + g.explanation).toLowerCase().includes(q)) {
          hits.push({ chId: ch.id, tab: 'grammar', type: '📘 قاعدة', main: g.title, sub: `الدرس ${ch.id}: ${ch.deTitle}`, speak: '' });
        }
      });
      ch.vocab.forEach(v => {
        if ((v.de + ' ' + v.ar + ' ' + v.cat).toLowerCase().includes(q)) {
          hits.push({ chId: ch.id, tab: 'vocab', type: '🔤 كلمة', main: v.de, sub: `${v.ar} (الدرس ${ch.id})`, speak: v.de });
        }
      });
      ch.qa.forEach(item => {
        if ((item.q + ' ' + item.a + ' ' + item.ar).toLowerCase().includes(q)) {
          hits.push({ chId: ch.id, tab: 'qa', type: '❓ سؤال/جواب', main: item.q, sub: `${item.ar} (الدرس ${ch.id})`, speak: item.q });
        }
      });
    });

    if (hits.length === 0) {
      resEl.innerHTML = '<p style="color:var(--text-muted);text-align:center">لم يتم العثور على نتائج مطابقة.</p>';
      return;
    }

    resEl.innerHTML = hits.slice(0, 30).map(h => `
      <div class="search-res-item" onclick="window.APP.jumpTo(${h.chId}, '${h.tab}')">
        <div>
          <span style="font-size:11.5px;color:var(--primary-light);font-weight:700">${h.type}</span>
          <div style="font-weight:700;font-size:14px">${escHtml(h.main)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${escHtml(h.sub)}</div>
        </div>
        ${h.speak ? `<button class="speak-btn" onclick="event.stopPropagation(); window.APP.speak('${escAttr(h.speak)}', 0.95, this)">🔊</button>` : ''}
      </div>
    `).join('');
  }

  // ---- Theme & Drawer ----
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = state.theme === 'dark' ? '☀️ نهاري' : '🌙 ليلي';
  }

  function closeDrawer() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
  }

  function render() {
    stopSpeaking();
    renderSidebar();
    if (state.view === 'dashboard') renderDashboard();
    else if (state.view === 'chapter') renderChapter();
    else if (state.view === 'appendix') renderAppendix();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ---- Public API ----
  window.APP = {
    goDashboard() { state.view = 'dashboard'; closeDrawer(); render(); },
    goAppendix() { state.view = 'appendix'; closeDrawer(); render(); },
    goChapter(id) {
      state.view = 'chapter';
      state.chapterId = id;
      state.activeTab = 'grammar';
      state.vocabFilter = 'all';
      state.vocabQuery = '';
      state.fcIndex = 0;
      state.fcFlipped = false;
      currentQuizAnswers = {};
      closeDrawer();
      render();
    },
    jumpTo(chId, tab) {
      document.getElementById('searchModal')?.classList.remove('open');
      state.view = 'chapter';
      state.chapterId = chId;
      state.activeTab = tab;
      state.vocabFilter = 'all';
      state.vocabQuery = '';
      currentQuizAnswers = {};
      render();
    },
    setTab(tab) {
      state.activeTab = tab;
      if (tab === 'practice') currentQuizAnswers = {};
      renderChapter();
    },
    setVocabFilter(f) { state.vocabFilter = f; renderChapter(); },
    setVocabQuery(val) {
      state.vocabQuery = val;
      const ch = CHAPTERS.find(c => c.id === state.chapterId);
      const tbody = document.getElementById('vocabTableBody');
      if (ch && tbody) {
        tbody.innerHTML = buildVocabRowsHtml(getFilteredVocab(ch));
      }
    },
    toggleHideArabic() { state.hideArabic = !state.hideArabic; renderChapter(); },
    toggleDone(chId) {
      const idx = state.progress.completedChapters.indexOf(chId);
      if (idx >= 0) state.progress.completedChapters.splice(idx, 1);
      else state.progress.completedChapters.push(chId);
      saveProgress();
      renderSidebar();
      renderChapter();
    },
    speak: speakGerman,
    stopSpeak: stopSpeaking,
    playDialogue: playFullDialogue,
    toggleBranch(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    },
    flipCard() { state.fcFlipped = !state.fcFlipped; renderChapter(); },
    nextCard(len) { state.fcIndex = (state.fcIndex + 1) % len; state.fcFlipped = false; renderChapter(); },
    prevCard(len) { state.fcIndex = (state.fcIndex - 1 + len) % len; state.fcFlipped = false; renderChapter(); },
    toggleMasterCard(key) {
      state.progress.masteredCards[key] = !state.progress.masteredCards[key];
      saveProgress();
      renderChapter();
    },
    answerQuiz,
    nextSprechen() {
      state.sprechenIdx = (state.sprechenIdx + 1) % APPENDIX.sprechenCards.length;
      state.sprechenRevealed = false;
      renderAppendix();
    },
    toggleSprechenReveal() { state.sprechenRevealed = !state.sprechenRevealed; renderAppendix(); },
    copyText(idx) {
      const txt = APPENDIX.emailTemplates[idx]?.de || '';
      navigator.clipboard?.writeText(txt).then(() => showToast('✅ تم نسخ نص الإيميل بنجاح!'));
    },
    toggleTheme() {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('deutsch_a1_theme', state.theme);
      applyTheme();
    },
    toggleDrawer() {
      document.getElementById('sidebar')?.classList.toggle('open');
      document.getElementById('sidebarOverlay')?.classList.toggle('open');
    },
    openSearch() {
      const m = document.getElementById('searchModal');
      if (m) {
        m.classList.add('open');
        const inp = document.getElementById('globalSearchInput');
        if (inp) { inp.value = ''; inp.focus(); performSearch(''); }
      }
    },
    closeSearch() { document.getElementById('searchModal')?.classList.remove('open'); },
    openLab() { document.getElementById('labModal')?.classList.add('open'); },
    closeLab() { document.getElementById('labModal')?.classList.remove('open'); },
    speakLab(rate) {
      const txt = document.getElementById('labInput')?.value || '';
      if (txt.trim()) speakGerman(txt, rate);
    },
    resetProgress() {
      if (confirm('هل تريد مسح التقدم المحفوظ والبدء من جديد؟')) {
        state.progress = { completedChapters: [], masteredCards: {}, quizScores: {} };
        saveProgress();
        render();
      }
    }
  };

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    const vSel = document.getElementById('voiceSelect');
    if (vSel) {
      vSel.addEventListener('change', e => {
        selectedVoiceMode = e.target.value;
        localStorage.setItem('deutsch_a1_voice_mode', selectedVoiceMode);
        showToast(selectedVoiceMode === 'online'
          ? '🌐 تم تفعيل الصوت الألماني الأصلي أونلاين (de-DE)'
          : '💻 تم تفعيل صوت الجهاز الألماني المحلي');
      });
    }

    const sInp = document.getElementById('globalSearchInput');
    if (sInp) sInp.addEventListener('input', e => performSearch(e.target.value));

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.APP.openSearch();
      }
      if (e.key === 'Escape') {
        window.APP.closeSearch();
        window.APP.closeLab();
      }
    });

    render();
  });
})();
