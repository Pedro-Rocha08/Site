/* Aurora Keys — interface, biblioteca, MIDI e entradas */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ================= Preferências ================= */
  const DEFAULTS = {
    noteNames: 'solfege', noteLabels: true, keyLabels: 'c', keyRange: 'fit', userSound: true,
    volume: 0.8, fallSpeed: 1, particles: true, midiIn: 'all', midiOut: '', autoSoundWithOut: false,
    lastMode: 'practice', lastHands: 'both', view: 'staff'
  };
  const settings = Object.assign({}, DEFAULTS, Store.get('settings', {}));
  const saveSettings = () => Store.set('settings', settings);

  const synth = new PianoSynth();
  synth.volume = settings.volume;

  /* ================= Avisos ================= */
  function toast(msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3200);
  }

  const MIDI_UNBLOCK_HELP =
    '<b>O acesso ao MIDI foi bloqueado.</b> Para liberar:' +
    '<br>• <b>App instalado no Android:</b> segure o ícone do Aurora Keys → <i>Informações do app</i> → <i>Permissões</i> (ou <i>Configurações do site</i>) → permita <i>Dispositivos MIDI</i>.' +
    '<br>• <b>No Chrome:</b> toque no ícone à esquerda do endereço (ou ⋮ → <i>Configurações</i> → <i>Configurações do site</i> → <i>Dispositivos MIDI</i>) e escolha <i>Permitir</i>.' +
    '<br>Depois toque em <b>Procurar teclado</b>.';

  /* ================= MIDI ================= */
  const Midi = {
    access: null,
    status: 'init',
    lastError: '',
    known: new Set(),
    // fromUser: veio de um toque. Sem toque, só pedimos se a permissão já foi dada —
    // o Chrome no Android bloqueia pedidos feitos sem interação, e depois não pergunta mais.
    async init(fromUser) {
      if (!navigator.requestMIDIAccess) { this.status = 'unsupported'; this.update(); return; }
      if (this.busy) return this.busy;
      this.busy = this._init(fromUser).finally(() => { this.busy = null; });
      return this.busy;
    },
    async _init(fromUser) {
      if (!fromUser) {
        const perm = await midiPermission();
        if (perm === 'denied') { this.status = 'denied'; this.update(); return; }
        if (perm === 'prompt') { this.status = 'ask'; this.update(); return; }
      }
      let access = null;
      // Pede o acesso; se o sistema falhar (ex.: outro app acabou de soltar o teclado), tenta de novo uma vez
      for (let attempt = 0; attempt < 2 && !access; attempt++) {
        try {
          access = await navigator.requestMIDIAccess({ sysex: false });
        } catch (e) {
          console.warn('MIDI:', e);
          this.lastError = ((e && e.name) || 'Erro') + (e && e.message ? ': ' + e.message : '');
          if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { this.status = 'denied'; this.update(); return; }
          if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
        }
      }
      if (!access) { this.status = 'error'; this.update(); midiRecover(false); return; }
      let reloaded = false;
      try { reloaded = sessionStorage.getItem('aurora-midi-reloaded') === '1'; sessionStorage.removeItem('aurora-midi-reloaded'); } catch (e) { /* sem armazenamento */ }
      if (this.status === 'error' || reloaded) setTimeout(() => toast(this.inputs().length ? 'MIDI voltou: teclado pronto!' : 'MIDI liberado. Conecte o teclado.'), 0);
      // O acesso foi concedido: daqui em diante, um problema do app não pode virar "MIDI indisponível"
      this.access = access;
      this.lastError = '';
      this.access.onstatechange = () => this.bind(true);
      this.bind(false);
    },
    inputs() { return this.access ? Array.from(this.access.inputs.values()) : []; },
    outputs() { return this.access ? Array.from(this.access.outputs.values()) : []; },
    bind(notify) {
      const ins = this.inputs();
      ins.forEach(inp => {
        try {
          inp.onmidimessage = (e) => {
            if (settings.midiIn !== 'all' && settings.midiIn !== inp.id) return;
            onMidiMessage(e.data);
          };
          // alguns aparelhos só entregam as notas depois de abrir a porta explicitamente
          if (inp.connection !== 'open' && typeof inp.open === 'function') inp.open().catch(err => { this.lastError = 'porta: ' + ((err && err.name) || err); });
        } catch (err) { console.warn('MIDI porta', inp && inp.name, err); this.lastError = 'porta: ' + ((err && err.message) || err); }
        if (!this.known.has(inp.id)) {
          this.known.add(inp.id);
          if (notify) toast('Teclado conectado: ' + (inp.name || 'MIDI'));
        }
      });
      this.known.forEach(id => {
        if (!ins.find(i => i.id === id)) { this.known.delete(id); if (notify) toast('Teclado desconectado', true); }
      });
      this.status = ins.length ? 'ok' : 'none';
      this.update();
    },
    out() {
      if (!settings.midiOut || !this.access) return null;
      return this.access.outputs.get(settings.midiOut) || null;
    },
    update() {
      const chip = $('#midiChip');
      const lbl = $('.label', chip);
      chip.classList.remove('ok', 'off');
      const ins = this.inputs();
      if (this.status === 'ok') {
        chip.classList.add('ok');
        const active = settings.midiIn === 'all' ? ins[0] : ins.find(i => i.id === settings.midiIn);
        lbl.textContent = ((active ? active.name : ins[0].name) || 'Teclado MIDI') + (ins.length > 1 && settings.midiIn === 'all' ? ' +' + (ins.length - 1) : '');
      } else if (this.status === 'none') {
        lbl.textContent = 'Conecte seu teclado MIDI';
      } else if (this.status === 'unsupported') {
        chip.classList.add('off');
        lbl.textContent = inAppBrowser() ? 'Abra no Chrome para usar o MIDI' : 'MIDI indisponível neste navegador';
      } else if (this.status === 'error') {
        chip.classList.add('off');
        lbl.textContent = 'MIDI travou: toque para reconectar';
      } else if (this.status === 'ask') {
        lbl.textContent = 'Toque para ativar o MIDI';
      } else if (this.status === 'denied') {
        chip.classList.add('off');
        lbl.textContent = 'MIDI bloqueado: toque para ver como liberar';
      }
      fillMidiSelects();
    }
  };

  /* O Chrome guarda o resultado do MIDI por página: depois de uma falha (ex.: o app ficou aberto
   * em segundo plano enquanto o cabo era trocado), qualquer novo pedido na MESMA página falha igual,
   * mesmo com o teclado funcionando em outros apps. A saída é recarregar a página. */
  const RELOAD_KEY = 'aurora-midi-reload';
  function midiReloadBudget() {
    let r = {};
    try { r = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || '{}') || {}; } catch (e) { r = {}; }
    const now = Date.now();
    if (!r.t || now - r.t > 90000) r = { t: now, n: 0 };
    return r;
  }
  function safeToReload() {
    if (screen === 'player') return false;
    if (screen === 'ar' && arStage && arStage.phase !== 'off') return false;
    return !anyModalOpen() || $('#settingsModal').classList.contains('open');
  }
  // fromUser: o usuário pediu (toque no aviso). Automático: no máximo 2 vezes a cada 90 s.
  function midiRecover(fromUser) {
    const r = midiReloadBudget();
    if (!fromUser && r.n >= 2) return false;
    if (!fromUser && !safeToReload()) { Midi.pendingReload = true; return false; }
    r.n++;
    try { sessionStorage.setItem(RELOAD_KEY, JSON.stringify(r)); } catch (e) { /* sem armazenamento */ }
    try { sessionStorage.setItem('aurora-midi-reloaded', '1'); } catch (e) { /* idem */ }
    toast('Reconectando o MIDI…');
    setTimeout(() => location.reload(), 700);
    return true;
  }

  // Navegador embutido de outro app (GitHub, WhatsApp, Instagram…): não tem Web MIDI
  function inAppBrowser() {
    const ua = navigator.userAgent || '';
    return /; wv\)|FBAN|FBAV|Instagram|WhatsApp|GitHub|Line\/|Twitter|LinkedInApp|Telegram/i.test(ua);
  }

  async function midiPermission() {
    try {
      const st = await navigator.permissions.query({ name: 'midi', sysex: false });
      return st.state; // 'granted' | 'prompt' | 'denied'
    } catch (e) { return 'granted'; } // navegador sem a API de permissões: tenta direto
  }

  function fillMidiSelects() {
    const inSel = $('#setMidiIn'), outSel = $('#setMidiOut');
    const ins = Midi.inputs(), outs = Midi.outputs();
    inSel.innerHTML = '<option value="all">Todos os dispositivos</option>' + ins.map(i => '<option value="' + esc(i.id) + '">' + esc(i.name || 'Teclado MIDI') + '</option>').join('');
    inSel.value = ins.find(i => i.id === settings.midiIn) ? settings.midiIn : 'all';
    outSel.innerHTML = '<option value="">Nenhuma (usar o som do app)</option>' + outs.map(o => '<option value="' + esc(o.id) + '">' + esc(o.name || 'Saída MIDI') + '</option>').join('');
    outSel.value = outs.find(o => o.id === settings.midiOut) ? settings.midiOut : '';
    const note = $('#midiNote');
    if (Midi.status === 'unsupported' && inAppBrowser()) note.innerHTML = 'Você abriu o site <b>dentro de outro app</b> (pelo link do GitHub, WhatsApp etc.), e esse navegador embutido não tem MIDI. Toque em ⋮ e escolha <b>Abrir no Chrome</b>, ou abra o app Aurora Keys instalado.';
    else if (Midi.status === 'unsupported') note.textContent = 'Seu navegador não suporta Web MIDI. Use Google Chrome, Microsoft Edge ou Opera no computador (ou Chrome no Android).';
    else if (Midi.status === 'error') note.innerHTML = 'O MIDI desta página travou (o navegador guarda a falha até a página ser recarregada). Toque em <b>Procurar teclado</b> para recarregar e conectar de novo. Se continuar: tire e recoloque o cabo USB-OTG e feche outros apps que estejam usando o teclado.';
    else if (Midi.status === 'ask') note.textContent = 'Toque em "Procurar teclado" e permita o acesso a dispositivos MIDI quando o navegador perguntar.';
    else if (Midi.status === 'denied') note.innerHTML = MIDI_UNBLOCK_HELP;
    else if (!ins.length) note.textContent = 'Conecte o teclado via USB (ou adaptador MIDI-USB). Ele aparece aqui automaticamente.';
    else note.textContent = ins.length + ' dispositivo(s) de entrada encontrado(s).';
    // Detalhes técnicos (para diagnosticar pelo print da tela)
    const diag = $('#midiDiag');
    if (!diag) return; // página antiga em cache
    if (Midi.status === 'error' || Midi.status === 'denied' || Midi.status === 'unsupported') {
      const ua = navigator.userAgent || '';
      const browser = /SamsungBrowser\/[\d.]+/.exec(ua) || /EdgA?\/[\d.]+/.exec(ua) || /OPR\/[\d.]+/.exec(ua) || /Firefox\/[\d.]+/.exec(ua) || /Chrome\/[\d.]+/.exec(ua) || /Version\/[\d.]+.*Safari/.exec(ua);
      const os = /Android [\d.]+/.exec(ua) || /(iPhone|iPad).*?OS [\d_]+/.exec(ua) || /Windows NT [\d.]+|Mac OS X [\d_]+|Linux/.exec(ua);
      const installed = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
      diag.textContent = 'Detalhes técnicos: ' + [
        inAppBrowser() ? 'navegador embutido' : '',
        'estado=' + Midi.status,
        Midi.lastError ? 'erro=' + Midi.lastError : '',
        'navegador=' + (browser ? browser[0] : '?'),
        'sistema=' + (os ? os[0] : '?'),
        installed ? 'app instalado' : 'no navegador',
        'webmidi=' + (navigator.requestMIDIAccess ? 'sim' : 'não'),
        window.isSecureContext ? 'https' : 'sem https'
      ].filter(Boolean).join(' · ');
      diag.hidden = false;
    } else diag.hidden = true;
  }

  /* ================= Notas do usuário ================= */
  const userVoices = new Map();
  const sustained = [];
  let sustain = false;

  function onMidiMessage(data) {
    const st = data[0] & 0xf0;
    if (st === 0x90 && data[2] > 0) noteOn(data[1], data[2] / 127, 'midi');
    else if (st === 0x80 || (st === 0x90 && data[2] === 0)) noteOff(data[1]);
    else if (st === 0xb0 && data[1] === 64) setSustain(data[2] >= 64);
  }

  function setSustain(on) {
    sustain = on;
    if (!on) { sustained.forEach(v => synth.release(v)); sustained.length = 0; }
  }

  function noteOn(midi, vel, src) {
    if (midi < 0 || midi > 127) return;
    if (settings.userSound || src !== 'midi') {
      const prev = userVoices.get(midi);
      if (prev) synth.release(prev);
      const v = synth.noteOn(midi, vel);
      if (v) userVoices.set(midi, v);
    }
    if (screen === 'player') {
      if (!player.playing && !player.free && !anyModalOpen() && player.t < player.firstStart - 0.2) {
        player.play();
      }
      player.userNoteOn(midi, vel);
    } else if (arLive()) {
      arStage.noteOn(midi, vel);
    } else {
      ambient.noteOn(midi, vel);
    }
  }

  function noteOff(midi) {
    const v = userVoices.get(midi);
    if (v) {
      userVoices.delete(midi);
      if (sustain) sustained.push(v); else synth.release(v);
    }
    if (screen === 'player') player.userNoteOff(midi);
    else if (arLive()) arStage.noteOff(midi);
    else ambient.noteOff(midi);
  }

  /* ================= Teclado do computador ================= */
  const KEYMAP = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
    KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28
  };
  let octave = 0;
  const pcDown = new Map();

  /* ================= Músicas ================= */
  const songs = [];

  function assignHands(parts) {
    const cands = parts.filter(p => !p.isDrum);
    parts.forEach(p => { p.hand = p.isDrum ? 'hidden' : 'background'; });
    if (!cands.length) return parts;
    const R = /(right|direita|\brh\b|treble|melod|soprano|\bm\.?d\b)/i;
    const L = /(left|esquerda|\blh\b|bass|baixo|\bm\.?e\b)/i;
    let r = cands.find(p => R.test(p.name));
    let l = cands.find(p => L.test(p.name) && p !== r);
    if (cands.length === 1 && !r && !l) {
      const p = cands[0];
      const hi = p.notes.filter(n => n.midi >= 60), lo = p.notes.filter(n => n.midi < 60);
      const out = parts.filter(x => x !== p);
      if (hi.length) out.unshift({ name: p.name + ' · agudos', hand: 'right', notes: hi });
      if (lo.length) out.splice(hi.length ? 1 : 0, 0, { name: p.name + ' · graves', hand: 'left', notes: lo });
      return out;
    }
    const avg = p => p.notes.reduce((s, n) => s + n.midi, 0) / p.notes.length;
    const maxN = Math.max(...cands.map(p => p.notes.length));
    const main = cands.filter(p => p.notes.length >= maxN * 0.15).sort((a, b) => avg(b) - avg(a));
    if (!r) r = main.find(p => p !== l);
    if (!l) l = main.slice().reverse().find(p => p !== r);
    if (r) r.hand = 'right';
    if (l) l.hand = 'left';
    return parts;
  }

  function fromRecord(rec, parsed) {
    const parts = assignHands(parsed.parts.map(p => ({ name: p.name, isDrum: p.isDrum, notes: p.notes })));
    return {
      id: rec.id, title: rec.title, artist: rec.artist || 'Importada', builtin: false, sourceId: rec.sourceId,
      parts, duration: parsed.duration, bars: parsed.bars, bpm: parsed.bpm, added: rec.added
    };
  }

  function cleanName(name) {
    return name.replace(/\.(mid|midi|kar)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Sem título';
  }

  function difficulty(song) {
    let n = 0;
    song.parts.forEach(p => { if (p.hand === 'left' || p.hand === 'right') n += p.notes.length; });
    const nps = n / Math.max(1, song.duration);
    return clamp(Math.ceil(nps / 1.6), 1, 5);
  }

  function coverSVG(song) {
    const h = hash(song.title + (song.artist || ''));
    const hue = h % 360;
    const win = 14;
    const notes = [];
    song.parts.forEach(p => {
      if (p.hand === 'hidden') return;
      for (const n of p.notes) { if (n.start > win) break; notes.push([n, p.hand]); }
    });
    let lo = 127, hi = 0;
    notes.forEach(([n]) => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    if (lo > hi) { lo = 48; hi = 72; }
    lo -= 2; hi += 2;
    const span = hi - lo + 1;
    const W = 200, H = 120, kb = 14, area = H - kb;
    const col = { right: '#2ee6d6', left: '#ff5fb1', background: '#9b7bff' };
    const id = 'g' + h.toString(36);
    let rects = '';
    notes.slice(0, 260).forEach(([n, hand]) => {
      const x = (n.midi - lo) / span * W;
      const w = Math.max(2, W / span * 0.78);
      const yb = area - (n.start / win) * area;
      const hh = Math.max(2.5, n.dur / win * area);
      rects += '<rect x="' + x.toFixed(1) + '" y="' + (yb - hh).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.4" fill="' + col[hand] + '" opacity="' + (hand === 'background' ? 0.45 : 0.92) + '"/>';
    });
    let keys = '';
    const whites = [];
    for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
    const ww = W / whites.length;
    whites.forEach((m, i) => { keys += '<rect x="' + (i * ww + 0.3).toFixed(1) + '" y="' + area + '" width="' + (ww - 0.6).toFixed(1) + '" height="' + kb + '" fill="#eef0fa" rx="0.8"/>'; });
    let wi = 0;
    for (let m = lo; m <= hi; m++) {
      if ([1, 3, 6, 8, 10].includes(m % 12)) keys += '<rect x="' + (wi * ww - ww * 0.3).toFixed(1) + '" y="' + area + '" width="' + (ww * 0.6).toFixed(1) + '" height="' + (kb * 0.62).toFixed(1) + '" fill="#141420" rx="0.6"/>';
      else wi++;
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + hue + ',62%,16%)"/><stop offset="1" stop-color="hsl(' + ((hue + 60) % 360) + ',70%,7%)"/></linearGradient>' +
      '<radialGradient id="' + id + 'r" cx=".5" cy="1" r=".8"><stop offset="0" stop-color="hsl(' + ((hue + 200) % 360) + ',90%,60%)" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + ')"/><rect width="' + W + '" height="' + H + '" fill="url(#' + id + 'r)"/>' +
      rects + '<rect y="' + (area - 1.2) + '" width="' + W + '" height="1.2" fill="#fff" opacity=".7"/>' + keys + '</svg>';
  }

  /* ================= Biblioteca ================= */
  let tab = 'all';
  let query = '';
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

  function starsText(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

  function renderLibrary() {
    const grid = $('#songGrid');
    const best = Store.get('best', {});
    const q = query.toLowerCase();
    const list = songs.filter(s =>
      (tab === 'all' || (tab === 'builtin' ? s.builtin : !s.builtin)) &&
      (!q || (s.title + ' ' + s.artist).toLowerCase().includes(q))
    );
    let html = '';
    list.forEach((s, i) => {
      const d = difficulty(s);
      const b = best[s.id];
      html += '<article class="card" style="animation-delay:' + Math.min(i * 35, 400) + 'ms">' +
        (s.builtin ? '' : '<button class="del" data-del="' + esc(s.id) + '" type="button" title="Remover" aria-label="Remover ' + esc(s.title) + '">' + ICON_TRASH + '</button>') +
        '<button class="card-btn" data-song="' + esc(s.id) + '" type="button">' +
        '<div class="cover">' + coverSVG(s) + '<span class="play-badge">' + ICON_PLAY + '</span></div>' +
        '<div class="card-body"><h3 class="card-title">' + esc(s.title) + '</h3>' +
        '<div class="card-artist">' + esc(s.artist) + '</div>' +
        '<div class="card-meta"><span>' + fmt(s.duration) + '</span>' +
        '<span class="diff" title="Dificuldade ' + d + '/5">' + [1, 2, 3, 4, 5].map(k => '<i class="' + (k <= d ? 'on' : '') + '"></i>').join('') + '</span>' +
        (s.builtin ? '' : '<span class="tag">MIDI</span>') +
        (b ? '<span class="best" title="Seu melhor: ' + b.acc + '%">' + starsText(b.stars) + '</span>' : '') +
        '</div></div></button></article>';
    });
    if (tab !== 'builtin' && !q) {
      html += '<button class="card add" id="addCard" type="button"><div class="plus"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>' +
        '<b>Adicionar música</b><span>Importe arquivos .mid do seu computador<br>ou arraste-os para cá</span></button>';
    }
    if (!list.length && q) html = '<div class="empty">Nenhuma música encontrada para “' + esc(query) + '”.</div>';
    grid.innerHTML = html;
  }

  $('#songGrid').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const s = songs.find(x => x.id === del.dataset.del);
      if (s && !del.classList.contains('confirm')) {
        del.classList.add('confirm');
        toast('Clique na lixeira de novo para remover “' + s.title + '”');
        setTimeout(() => del.classList.remove('confirm'), 3000);
        return;
      }
      if (s) {
        await Store.deleteSong(s.id);
        songs.splice(songs.indexOf(s), 1);
        renderLibrary();
        toast('Música removida');
      }
      return;
    }
    if (e.target.closest('#addCard')) { $('#fileInput').click(); return; }
    const c = e.target.closest('[data-song]');
    if (c) openSetup(songs.find(x => x.id === c.dataset.song));
  });

  $('#libTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tab = b.dataset.tab;
    $$('#libTabs button').forEach(x => x.classList.toggle('on', x === b));
    renderLibrary();
  });
  $('#search').addEventListener('input', (e) => { query = e.target.value.trim(); renderLibrary(); });

  /* ================= Importação ================= */
  async function importFiles(files) {
    let ok = 0, last = null;
    for (const f of files) {
      if (!/\.(mid|midi|kar)$/i.test(f.name) && !/midi/.test(f.type)) { toast('"' + f.name + '" não é um arquivo MIDI', true); continue; }
      try {
        const buf = await f.arrayBuffer();
        const parsed = parseMidi(buf);
        if (!parsed.parts.length) throw new Error('sem notas');
        const rec = { id: 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: cleanName(f.name), artist: 'Importada', data: buf, added: Date.now() };
        await Store.putSong(rec).catch(() => toast('Não foi possível salvar no navegador; a música fica só nesta sessão.', true));
        last = fromRecord(rec, parsed);
        songs.push(last);
        ok++;
      } catch (err) {
        console.warn(err);
        toast('Não consegui ler "' + f.name + '"', true);
      }
    }
    if (ok) {
      toast(ok === 1 ? '“' + last.title + '” adicionada à biblioteca' : ok + ' músicas adicionadas');
      renderLibrary();
      if (ok === 1 && screen === 'library') openSetup(last);
    }
  }

  $('#btnImport').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { importFiles(Array.from(e.target.files)); e.target.value = ''; });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { dragDepth++; $('#dropOverlay').classList.add('show'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').classList.remove('show'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropOverlay').classList.remove('show');
    if (e.dataTransfer && e.dataTransfer.files.length) importFiles(Array.from(e.dataTransfer.files));
  });

  /* ================= Modais ================= */
  function openModal(id) { const m = $(id); m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
  function closeModal(id) { const m = $(id); m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
  function anyModalOpen() { return !!$('.modal.open'); }
  $$('.modal').forEach(m => {
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal('#' + m.id); });
    $$('[data-close]', m).forEach(b => b.addEventListener('click', () => closeModal('#' + m.id)));
  });

  /* ================= Preparação da música ================= */
  let setup = null;
  const HAND_LABEL = { right: 'Mão direita', left: 'Mão esquerda', background: 'Acompanhamento', hidden: 'Oculta' };
  const HAND_COLOR = { right: '#2ee6d6', left: '#ff5fb1', background: '#9b7bff', hidden: '#3b3f5c' };

  function openSetup(song) {
    if (!song) return;
    synth.init();
    const saved = Store.get('parts:' + song.id, null);
    setup = {
      song,
      mode: settings.lastMode,
      hands: settings.lastHands,
      partHands: song.parts.map((p, i) => (saved && saved[i]) || p.hand),
      speed: 1
    };
    $('#setupCover').innerHTML = coverSVG(song);
    $('#setupTitle').textContent = song.title;
    $('#setupArtist').textContent = song.artist;
    const best = Store.get('best', {})[song.id];
    const d = difficulty(song);
    $('#setupMeta').innerHTML = '<span class="tag">' + fmt(song.duration) + '</span>' +
      '<span class="tag">' + song.parts.reduce((s, p) => s + p.notes.length, 0) + ' notas</span>' +
      '<span class="tag">Dificuldade ' + d + '/5</span>' +
      (best ? '<span class="tag" style="color:var(--gold)">Recorde ' + best.acc + '% ' + '★'.repeat(best.stars) + '</span>' : '');
    $('#setupSpeed').value = 100;
    $('#setupSpeedVal').textContent = '100%';
    renderParts();
    syncSetup();
    openModal('#setupModal');
  }

  function renderParts() {
    const list = $('#partsList');
    const s = setup.song;
    $('#partsCount').textContent = '(' + s.parts.length + ')';
    $('#partsBox').open = s.parts.length > 2;
    list.innerHTML = s.parts.map((p, i) =>
      '<div class="part-row"><span class="swatch" style="background:' + HAND_COLOR[setup.partHands[i]] + '"></span>' +
      '<span class="pname">' + esc(p.name) + '<small>' + p.notes.length + ' notas</small></span>' +
      '<select data-part="' + i + '">' + Object.keys(HAND_LABEL).map(h => '<option value="' + h + '"' + (setup.partHands[i] === h ? ' selected' : '') + '>' + HAND_LABEL[h] + '</option>').join('') + '</select></div>'
    ).join('');
  }

  $('#partsList').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-part]');
    if (!sel) return;
    setup.partHands[+sel.dataset.part] = sel.value;
    Store.set('parts:' + setup.song.id, setup.partHands);
    renderParts();
    $('#partsBox').open = true;
  });

  function syncSetup() {
    $$('#modeCards .mode-card').forEach(b => b.classList.toggle('on', b.dataset.mode === setup.mode));
    $$('#setupHands button').forEach(b => b.classList.toggle('on', b.dataset.hand === setup.hands));
    $('#setupHands').style.opacity = setup.mode === 'listen' ? 0.45 : 1;
    $$('#setupView button').forEach(b => b.classList.toggle('on', b.dataset.view === settings.view));
  }
  $('#setupView').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.view = b.dataset.view;
    saveSettings();
    syncSetup();
  });
  $('#modeCards').addEventListener('click', (e) => {
    const b = e.target.closest('.mode-card');
    if (!b) return;
    setup.mode = b.dataset.mode;
    syncSetup();
  });
  $('#setupHands').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setup.hands = b.dataset.hand;
    syncSetup();
  });
  $('#setupSpeed').addEventListener('input', (e) => {
    setup.speed = e.target.value / 100;
    $('#setupSpeedVal').textContent = e.target.value + '%';
  });
  $('#btnStart').addEventListener('click', () => {
    settings.lastMode = setup.mode;
    settings.lastHands = setup.hands;
    saveSettings();
    closeModal('#setupModal');
    startSong(setup.song, setup);
  });

  /* ================= Player ================= */
  const player = new Player($('#stage'), {
    synth,
    settings: () => settings,
    midiOut: () => Midi.out(),
    onFinish: showResults,
    onStats: updateScore
  });
  let current = null;
  let screen = 'library';

  const handsObj = (h) => ({ left: h !== 'right', right: h !== 'left' });

  let browseScreen = 'library'; // tela para onde o player volta (Músicas ou Partituras)
  function showScreen(name) {
    screen = name;
    if (name !== 'player') browseScreen = name;
    $('#library').classList.toggle('active', name === 'library');
    $('#sheets').classList.toggle('active', name === 'sheets');
    $('#ar').classList.toggle('active', name === 'ar');
    if (name !== 'ar' && arStage && arStage.phase !== 'off') arStage.close();
    $('#player').classList.toggle('active', name === 'player');
    document.body.classList.toggle('in-player', name === 'player');
    if (name === 'player') ambient.releaseAll();
    ambient.active = name !== 'player';
    ambient.dirty = true;
    if (name === 'player') {
      requestAnimationFrame(() => player.resize());
      const hint = $('#rotateHint');
      hint.classList.add('show');
      clearTimeout(showScreen.hintTimer);
      showScreen.hintTimer = setTimeout(() => hint.classList.remove('show'), 4500);
    }
  }

  function startSong(song, cfg) {
    current = { song, cfg };
    showScreen('player');
    player.resize();
    player.load(song, { mode: cfg.mode, hands: handsObj(cfg.hands), partHands: cfg.partHands });
    player.setSpeed(cfg.speed || 1);
    $('#player').classList.toggle('free', !!song.free);
    $('#hudSong').textContent = song.title;
    // Partitura escrita (peças do Mutopia): botão no player
    const btnScore = $('#btnScore');
    btnScore.hidden = true;
    if (song.sourceId) Sheets.scoreForSource(song.sourceId).then(p => { if (current && current.song === song) btnScore.hidden = !p; }).catch(() => {});
    syncHud();
    drawDensity();
    updateLoopUi();
    $('#timeTot').textContent = fmt(player.duration);
    $('#startTitle').textContent = song.free ? 'Tocar livre' : 'Pronto?';
    $('#startHint').innerHTML = song.free
      ? 'Toque no seu teclado MIDI, no teclado do computador ou na tela.'
      : (cfg.mode === 'listen' ? 'Pressione <kbd>Espaço</kbd> para ouvir a música.' : 'Pressione <kbd>Espaço</kbd> ou toque qualquer tecla do piano para começar.');
    if (song.free) {
      $('#startOverlay').classList.add('show');
      setTimeout(() => { if (current && current.song.free) $('#startOverlay').classList.remove('show'); }, 2600);
    }
  }

  function syncHud() {
    const s = current.cfg;
    $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === player.mode));
    $$('#handSeg button').forEach(b => b.classList.toggle('on', b.dataset.hand === s.hands));
    $('#handSeg').style.opacity = player.mode === 'listen' ? 0.45 : 1;
    $('#speedVal').textContent = Math.round(player.speed * 100) + '%';
    $('#scoreboard').classList.toggle('hidden', player.mode === 'listen' || player.free);
    updateScore(player.stats);
    placeScoreboard();
    syncViewBtn();
  }
  function stripVisible() { return !player.free && settings.view !== 'staff'; }
  function placeScoreboard() {
    const hud = $('#player .hud');
    const strip = $('#staffStrip');
    const hudBottom = hud.offsetTop + hud.offsetHeight;
    strip.style.top = (hudBottom + 8) + 'px';
    strip.hidden = !stripVisible();
    const below = strip.offsetHeight ? hudBottom + 8 + strip.offsetHeight : hudBottom;
    $('#scoreboard').style.top = (below + 10) + 'px';
    placeStaff();
  }
  // No modo pauta, a partitura começa logo abaixo da barra de controles (e do placar)
  function placeStaff() {
    const c = $('#stage').getBoundingClientRect();
    let bottom = $('#player .hud').getBoundingClientRect().bottom;
    const sb = $('#scoreboard');
    if (!sb.classList.contains('hidden') && getComputedStyle(sb).display !== 'none') bottom = Math.max(bottom, sb.getBoundingClientRect().bottom);
    player.topInset = Math.max(0, bottom - c.top + 4);
  }
  function syncViewBtn() {
    const b = $('#btnView');
    const staff = settings.view === 'staff';
    b.classList.toggle('on', staff);
    b.title = staff ? 'Mostrar notas caindo' : 'Mostrar partitura (pauta)';
    b.setAttribute('aria-label', b.title);
    $('#player').classList.toggle('staff-view', staff && !player.free);
    player.layout();
    placeScoreboard();
  }
  $('#btnView').addEventListener('click', () => {
    settings.view = settings.view === 'staff' ? 'falling' : 'staff';
    saveSettings();
    syncViewBtn();
    toast(settings.view === 'staff' ? 'Modo partitura' : 'Modo notas caindo');
  });

  const hudFree = document.createElement('style');
  hudFree.textContent = '#player.free .hud { grid-template-columns: 1fr auto !important; grid-template-areas: "l r" !important } #player.free .hud-center, #player.free #modeSeg, #player.free .hud-right .stepper, #player.free .hud-right .hands { display:none !important }';
  document.head.appendChild(hudFree);

  let lastCombo = 0;
  function accuracy(st) {
    const tot = st.hits + st.missed + st.wrong;
    return tot ? Math.round(st.hits / tot * 100) : 100;
  }
  function updateScore(st) {
    if (!st) return;
    $('#sbAcc').textContent = accuracy(st) + '%';
    const c = $('#sbCombo');
    c.textContent = st.combo;
    if (st.combo > lastCombo && st.combo % 10 === 0) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
    lastCombo = st.combo;
    $('#sbScore').textContent = st.score.toLocaleString('pt-BR');
  }

  function drawDensity() {
    const cv = $('#density');
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, r.width * dpr);
    cv.height = Math.max(1, r.height * dpr);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!player.notes.length || !isFinite(player.duration)) return;
    const bins = Math.max(10, Math.floor(r.width / 3));
    const cnt = new Array(bins).fill(0);
    player.notes.forEach(n => { cnt[Math.min(bins - 1, Math.floor(n.start / player.duration * bins))]++; });
    const mx = Math.max(...cnt, 1);
    const g = ctx.createLinearGradient(0, 0, cv.width, 0);
    g.addColorStop(0, '#2ee6d6'); g.addColorStop(0.5, '#8b7bff'); g.addColorStop(1, '#ff5fb1');
    ctx.fillStyle = g;
    const bw = cv.width / bins;
    cnt.forEach((c, i) => {
      const h = Math.max(1, (c / mx) * cv.height * 0.8);
      ctx.fillRect(i * bw + 1, (cv.height - h) / 2, Math.max(1, bw - 2), h);
    });
  }

  function updateLoopUi() {
    const b = $('#btnLoop');
    b.classList.toggle('a', player.loopA !== null && player.loopB === null);
    b.classList.toggle('ab', player.loopB !== null);
    b.title = player.loopB !== null ? 'Desligar repetição' : player.loopA !== null ? 'Marcar fim do trecho (B)' : 'Marcar início do trecho (A)';
    const lr = $('#loopRange');
    if (player.loopA !== null && isFinite(player.duration)) {
      const a = Math.max(0, player.loopA) / player.duration * 100;
      const bb = (player.loopB !== null ? player.loopB : player.loopA) / player.duration * 100;
      lr.style.display = 'block';
      lr.style.left = a + '%';
      lr.style.width = Math.max(0.3, bb - a) + '%';
    } else lr.style.display = 'none';
  }

  $('#btnLoop').addEventListener('click', () => {
    if (player.loopA === null) { player.loopA = Math.max(0, player.t); toast('Início do trecho marcado (A)'); }
    else if (player.loopB === null) {
      if (player.t <= player.loopA + 0.5) { toast('Avance um pouco antes de marcar o fim (B)', true); return; }
      player.loopB = player.t; toast('Repetindo o trecho A–B');
    } else { player.loopA = player.loopB = null; toast('Repetição desligada'); }
    updateLoopUi();
  });

  $('#btnPlay').addEventListener('click', () => { player.toggle(); });
  $('#btnRestart').addEventListener('click', () => { player.restart(); });
  $('#btnBack').addEventListener('click', goLibrary);
  $('#speedDown').addEventListener('click', () => changeSpeed(-0.1));
  $('#speedUp').addEventListener('click', () => changeSpeed(0.1));
  function changeSpeed(d) {
    player.setSpeed(Math.round((player.speed + d) * 20) / 20);
    $('#speedVal').textContent = Math.round(player.speed * 100) + '%';
  }
  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    player.setMode(b.dataset.mode);
    current.cfg.mode = b.dataset.mode;
    settings.lastMode = b.dataset.mode; saveSettings();
    syncHud();
  });
  $('#handSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    current.cfg.hands = b.dataset.hand;
    player.setHands(handsObj(b.dataset.hand));
    settings.lastHands = b.dataset.hand; saveSettings();
    syncHud();
  });
  $('#btnPlayerSettings').addEventListener('click', () => { player.pause(); openSettings(); });

  // Barra de progresso
  const prog = $('#progress');
  let seeking = false;
  function seekFromEvent(e) {
    const r = prog.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    player.seek(f * player.duration);
  }
  prog.addEventListener('pointerdown', (e) => { seeking = true; prog.setPointerCapture(e.pointerId); seekFromEvent(e); });
  prog.addEventListener('pointermove', (e) => { if (seeking) seekFromEvent(e); });
  prog.addEventListener('pointerup', () => { seeking = false; });

  // Toque/mouse no teclado da tela
  const stage = $('#stage');
  const pointers = new Map();
  stage.addEventListener('pointerdown', (e) => {
    synth.init();
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const m = player.keyAt(x, y);
    if (m !== null) {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, m);
      noteOn(m, 0.75, 'touch');
    } else if (!player.free) {
      player.toggle();
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const r = stage.getBoundingClientRect();
    const m = player.keyAt(e.clientX - r.left, e.clientY - r.top);
    const prev = pointers.get(e.pointerId);
    if (m !== null && m !== prev) { noteOff(prev); pointers.set(e.pointerId, m); noteOn(m, 0.7, 'touch'); }
  });
  const endPointer = (e) => { if (pointers.has(e.pointerId)) { noteOff(pointers.get(e.pointerId)); pointers.delete(e.pointerId); } };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  // HUD some enquanto toca
  let idleTimer = 0;
  function poke() {
    $('.hud').classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (player.playing) $('.hud').classList.add('idle'); }, 3000);
  }
  document.addEventListener('mousemove', poke);
  document.addEventListener('pointerdown', poke);

  $('#btnScore').addEventListener('click', () => {
    if (Sheets.isViewerOpen()) { Sheets.closeViewer(); return; }
    // painel logo abaixo da barra do player, para os controles continuarem acessíveis
    const hud = $('#player .hud').getBoundingClientRect();
    if (current) Sheets.viewSource(current.song.sourceId, { docked: true, top: hud.bottom + 6 });
  });

  function goLibrary() {
    Sheets.closeViewer();
    player.pause();
    player.keyDown.clear();
    closeModal('#resultsModal');
    showScreen(browseScreen);
    if (browseScreen === 'library') renderLibrary();
  }

  /* ================= Navegação Músicas / Partituras ================= */
  const HASHES = { sheets: '#partituras', ar: '#palco3d' };
  const fromHash = () => Object.keys(HASHES).find(k => HASHES[k] === location.hash) || 'library';
  function go(name, push) {
    if (name === screen) return;
    if (screen === 'player') { player.pause(); player.keyDown.clear(); }
    showScreen(name);
    if (name === 'library') renderLibrary();
    if (name === 'sheets') Sheets.open();
    window.scrollTo(0, 0);
    const hash = HASHES[name] || '';
    if (push !== false && location.hash !== hash) history.pushState(null, '', hash || location.pathname + location.search);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    e.preventDefault();
    go(b.dataset.go);
  });
  window.addEventListener('popstate', () => go(fromHash(), false));

  // MIDI vindo da busca de partituras: salva na biblioteca (uma vez só) e abre a preparação
  async function importBuffer(buf, meta) {
    const existing = songs.find(x => x.sourceId && x.sourceId === meta.sourceId);
    if (existing) { openSetup(existing); return existing; }
    const parsed = parseMidi(buf);
    if (!parsed.parts.length) throw new Error('sem notas');
    const rec = { id: 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: meta.title, artist: meta.artist || 'Partitura', data: buf, added: Date.now(), sourceId: meta.sourceId };
    await Store.putSong(rec).catch(() => toast('Não foi possível salvar no navegador; a música fica só nesta sessão.', true));
    const song = fromRecord(rec, parsed);
    songs.push(song);
    toast('“' + song.title + '” adicionada às suas músicas');
    openSetup(song);
    return song;
  }
  Sheets.init({ importBuffer });

  /* ================= Resultados ================= */
  function starsFor(acc) { return acc >= 97 ? 5 : acc >= 90 ? 4 : acc >= 78 ? 3 : acc >= 60 ? 2 : 1; }

  function showResults(st) {
    const song = current.song;
    const listen = player.mode === 'listen';
    const acc = accuracy(st);
    const stars = listen ? 0 : starsFor(acc);
    $('#resSong').textContent = song.title;
    $('#resTitle').textContent = listen ? 'Fim da música' : (stars >= 5 ? 'Impecável!' : stars >= 4 ? 'Excelente!' : stars >= 3 ? 'Muito bem!' : stars >= 2 ? 'Bom trabalho!' : 'Continue praticando!');
    $('#resStars').innerHTML = listen ? '' : [1, 2, 3, 4, 5].map(i => '<svg viewBox="0 0 24 24" class="' + (i <= stars ? 'on' : '') + '" style="animation-delay:' + (i * 120) + 'ms"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>').join('');
    $('.res-acc').style.display = listen ? 'none' : '';
    $('.res-grid').style.display = listen ? 'none' : '';
    $('#resAcc').textContent = acc + '%';
    $('#resHits').textContent = st.hits;
    $('#resPerfect').textContent = st.perfect;
    $('#resWrong').textContent = st.wrong;
    $('#resMissed').textContent = st.missed;
    $('#resCombo').textContent = st.maxCombo;
    $('#resScore').textContent = st.score.toLocaleString('pt-BR');
    let record = false;
    if (!listen && st.hits > 0) {
      const best = Store.get('best', {});
      const prev = best[song.id];
      if (!prev || acc > prev.acc || (acc === prev.acc && st.score > prev.score)) {
        record = true;
        best[song.id] = { acc, stars, score: st.score, date: Date.now() };
        Store.set('best', best);
      }
    }
    $('#resBadge').hidden = !record;
    const conf = $('#confetti');
    conf.innerHTML = '';
    if (stars >= 4) {
      const cols = ['#2ee6d6', '#8b7bff', '#ff5fb1', '#ffd166', '#ffffff'];
      for (let i = 0; i < 70; i++) {
        const c = document.createElement('i');
        c.style.left = Math.random() * 100 + '%';
        c.style.background = cols[i % cols.length];
        c.style.animationDuration = (2 + Math.random() * 2.5) + 's';
        c.style.animationDelay = (Math.random() * 0.8) + 's';
        c.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
        conf.appendChild(c);
      }
    }
    openModal('#resultsModal');
  }
  $('#resAgain').addEventListener('click', () => { closeModal('#resultsModal'); player.restart(); });
  $('#resLibrary').addEventListener('click', goLibrary);

  /* ================= Configurações ================= */
  function openSettings() {
    fillMidiSelects();
    $('#setVolume').value = Math.round(settings.volume * 100);
    $('#setUserSound').checked = settings.userSound;
    $('#setNames').value = settings.noteNames;
    $('#setNoteLabels').checked = settings.noteLabels;
    $('#setKeyLabels').value = settings.keyLabels;
    $('#setRange').value = settings.keyRange;
    $('#setFall').value = Math.round(settings.fallSpeed * 100);
    $('#setParticles').checked = settings.particles;
    openModal('#settingsModal');
  }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#midiChip').addEventListener('click', async () => {
    if (Midi.status === 'error') { midiRecover(true); return; }
    if (Midi.status !== 'ok' && Midi.status !== 'none' && Midi.status !== 'unsupported') await Midi.init(true);
    if (Midi.status !== 'ok') openSettings();
  });
  $('#btnMidiRetry').addEventListener('click', async () => {
    if (Midi.status === 'error') { midiRecover(true); return; }
    await Midi.init(true);
    if (Midi.status === 'ok') toast('Teclado MIDI liberado!');
    else if (Midi.status === 'none') toast('MIDI liberado. Conecte o teclado.');
  });

  const bindSetting = (sel, key, conv, after) => {
    $(sel).addEventListener('input', (e) => {
      const el = e.target;
      settings[key] = conv(el.type === 'checkbox' ? el.checked : el.value);
      saveSettings();
      if (after) after();
    });
  };
  const relayout = () => { player.layout(); hero.layout(); };
  bindSetting('#setMidiIn', 'midiIn', v => v, () => Midi.update());
  bindSetting('#setMidiOut', 'midiOut', v => v);
  bindSetting('#setVolume', 'volume', v => v / 100, () => synth.setVolume(settings.volume));
  bindSetting('#setUserSound', 'userSound', v => v);
  bindSetting('#setNames', 'noteNames', v => v);
  bindSetting('#setNoteLabels', 'noteLabels', v => v);
  bindSetting('#setKeyLabels', 'keyLabels', v => v);
  bindSetting('#setRange', 'keyRange', v => v, relayout);
  bindSetting('#setFall', 'fallSpeed', v => v / 100, relayout);
  bindSetting('#setParticles', 'particles', v => v);

  /* ================= Atalhos ================= */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox' || tag === 'textarea') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') {
      const open = $('.modal.open');
      if (open) { closeModal('#' + open.id); return; }
      if (screen === 'player') goLibrary();
      else if (arLive()) arStage.close();
      return;
    }
    if (anyModalOpen()) return;

    if (screen === 'player') {
      if (e.code === 'Space') {
        e.preventDefault();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        if (!e.repeat) player.toggle();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        player.seek(player.t + (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 5));
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); changeSpeed(e.code === 'ArrowUp' ? 0.05 : -0.05); return; }
      if (e.code === 'Home') { e.preventDefault(); player.restart(); return; }
    }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      octave = clamp(octave + (e.code === 'BracketLeft' ? -1 : 1), -3, 3);
      toast('Teclado do computador: oitava ' + (3 + octave) + '–' + (5 + octave));
      return;
    }
    if (KEYMAP[e.code] !== undefined && !e.repeat) {
      if (tag === 'select') return;
      e.preventDefault();
      synth.init();
      const midi = 48 + octave * 12 + KEYMAP[e.code];
      if (pcDown.has(e.code)) return;
      pcDown.set(e.code, midi);
      noteOn(midi, 0.75, 'pc');
    }
  });
  document.addEventListener('keyup', (e) => {
    if (pcDown.has(e.code)) { noteOff(pcDown.get(e.code)); pcDown.delete(e.code); }
  });
  window.addEventListener('blur', () => { pcDown.forEach(m => noteOff(m)); pcDown.clear(); });

  /* ================= Tocar livre ================= */
  $('#btnFree').addEventListener('click', () => {
    synth.init();
    startSong({ id: 'free', title: 'Tocar livre', free: true, parts: [] }, { mode: 'listen', hands: 'both', partHands: [] });
  });

  /* ================= Vitrine animada ================= */
  const heroSettings = () => Object.assign({}, settings, { noteLabels: false, keyLabels: 'none', keyRange: 'fit', fallSpeed: 0.85, barNumbers: false });
  const silent = { init() {}, play() { return null; }, release() {}, noteOn() { return null; } };
  const hero = new Player($('#heroCanvas'), {
    synth: silent, settings: heroSettings, midiOut: () => null,
    onFinish: () => setTimeout(() => { hero.restart(); hero.play(); }, 600)
  });
  hero.load(BUILTIN_SONGS.find(s => s.id === 'builtin-ode'), { mode: 'listen', hands: { left: true, right: true } });
  hero.play();

  /* ================= Teclado do rodapé ================= */
  const ambient = new AmbientKeys({
    fx: $('#ambientFx'),
    kb: $('#ambientKb'),
    onPress: (m, v) => { synth.init(); noteOn(m, v, 'touch'); },
    onRelease: (m) => noteOff(m),
    labels: () => settings.keyLabels !== 'none'
  });
  function setKbCollapsed(c) {
    settings.kbCollapsed = c;
    saveSettings();
    ambient.collapsed = c;
    ambient.dirty = true;
    $('#kbDock').classList.toggle('collapsed', c);
    document.body.classList.toggle('kb-open', !c);
    $('#kbToggle').setAttribute('aria-expanded', String(!c));
    $('#kbToggle span').textContent = c ? 'Mostrar teclado' : 'Esconder teclado';
  }
  setKbCollapsed(!!settings.kbCollapsed);
  $('#kbToggle').addEventListener('click', () => setKbCollapsed(!settings.kbCollapsed));

  /* ================= Palco 3D (câmera + realidade aumentada) ================= */
  const arName = (m, oct) => Player.noteName(m, settings.noteNames, oct);
  const arStage = new ARStage({
    root: $('#arLive'),
    noteName: arName,
    toast,
    songs: () => songs,
    modelLabel: (cfg) => (ARStage.MODELS[cfg.model] || ARStage.MODELS.custom).name.split(' / ')[0],
    onPress: (m, v) => { synth.init(); noteOn(m, v, 'touch'); },
    onRelease: (m) => noteOff(m)
  });
  function arLive() { return screen === 'ar' && arStage.phase !== 'off'; }
  (function setupAR() {
    new ARStage.Preview($('#arPreview'));
    const sel = $('#arModel'), keysSel = $('#arKeys'), lowSel = $('#arLow');
    sel.innerHTML = ARStage.MODEL_GROUPS.map(([label, , , list]) =>
      '<optgroup label="' + esc(label) + '">' + list.map(([id, name]) => '<option value="' + id + '">' + esc(name) + '</option>').join('') + '</optgroup>'
    ).join('') + '<optgroup label="Outro"><option value="custom">Personalizado (escolho teclas e nota)</option></optgroup>';
    const whites = [];
    for (let m = 21; m <= 72; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
    lowSel.innerHTML = whites.map(m => '<option value="' + m + '">' + esc(arName(m, true)) + '</option>').join('');
    const cfg = arStage.cfg;
    sel.value = ARStage.MODELS[cfg.model] ? cfg.model : 'yamaha-p';
    keysSel.value = String(cfg.keys);
    lowSel.value = String(cfg.low);
    const current = () => {
      const id = sel.value;
      if (id === 'custom') return { id, keys: +keysSel.value, low: +lowSel.value };
      const m = ARStage.MODELS[id];
      return { id, keys: m.keys, low: m.low };
    };
    const info = () => {
      const c = current();
      $('#arCustom').hidden = c.id !== 'custom';
      const g = ARStage.buildGeom(c.keys, c.low);
      $('#arModelInfo').innerHTML = '<b>' + c.keys + ' teclas</b> · ' + esc(arName(g.low, true)) + ' a ' + esc(arName(g.hi, true)) +
        ' · ' + g.whites + ' brancas e ' + g.blacks.length + ' pretas · ' + (g.W / 10).toFixed(1).replace('.', ',') + ' cm de teclas';
    };
    [sel, keysSel, lowSel].forEach(el => el.addEventListener('change', info));
    info();
    $('#arSetup').addEventListener('submit', (e) => {
      e.preventDefault();
      synth.init();
      const c = current();
      arStage.setModel(c.id, c.keys, c.low);
      arStage.open();
      syncARButtons();
    });
    const syncARButtons = () => {
      $('#arGrid').classList.toggle('on', !!arStage.cfg.grid);
      $('#arNames').classList.toggle('on', !!arStage.cfg.names);
      $('#arFov').value = Math.round(arStage.cfg.fovMul * 100);
    };
    $('#arClose').addEventListener('click', () => arStage.close());
    $('#arFlip').addEventListener('click', () => arStage.flip());
    $('#arManual').addEventListener('click', () => arStage.adjust());
    $('#arRescan').addEventListener('click', () => arStage.rescan());
    $('#arDone').addEventListener('click', () => arStage.done());
    $('#arAdjust').addEventListener('click', () => { arStage.stopDemo(); arStage.releaseAll(); arStage.adjust(); });
    $('#arRetry').addEventListener('click', () => arStage.open());
    $('#arOctDown').addEventListener('click', () => arStage.shiftOctave(-1));
    $('#arOctUp').addEventListener('click', () => arStage.shiftOctave(1));
    $('#arLowest').addEventListener('click', () => {
      if (!Midi.access || !Array.from(Midi.access.inputs.values()).length) toast('Conecte um teclado MIDI para usar este ajuste. Sem MIDI, use −8ª e +8ª.');
      arStage.askLowest();
    });
    $('#arFov').addEventListener('input', (e) => arStage.setFov(e.target.value / 100));
    $('#arGrid').addEventListener('click', (e) => e.currentTarget.classList.toggle('on', arStage.toggle('grid')));
    $('#arNames').addEventListener('click', (e) => e.currentTarget.classList.toggle('on', arStage.toggle('names')));
    $('#arDemo').addEventListener('click', (e) => { synth.init(); e.currentTarget.classList.toggle('on', arStage.toggleDemo()); });
  })();

  /* ================= Laço principal ================= */
  const startOverlay = $('#startOverlay');
  const btnPlay = $('#btnPlay');
  // Faixa de partitura no alto do player (no lugar da faixa de densidade)
  const strip = $('#staffStrip');
  const stripCtx = strip.getContext('2d');
  function drawStrip() {
    if (player.free || settings.view === 'staff' || !player.notes.length) return;
    const r = strip.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (strip.width !== w || strip.height !== h) { strip.width = w; strip.height = h; }
    stripCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stripCtx.clearRect(0, 0, r.width, r.height);
    const s = player.settings();
    player.drawStaffArea(stripCtx, s, s.noteNames, r.width, 4, r.height - 4, r.height, true);
  }

  function loop(now) {
    if (screen === 'player') {
      player.frame(now);
      drawStrip();
      if (!player.free) {
        btnPlay.classList.toggle('playing', player.playing);
        const show = !player.playing && !anyModalOpen();
        startOverlay.classList.toggle('show', show);
        if (show && player.t > player.firstStart) $('#startTitle').textContent = 'Pausado';
        else if (show) $('#startTitle').textContent = 'Pronto?';
        $('#timeCur').textContent = fmt(player.t);
        if (isFinite(player.duration) && player.duration > 0) {
          $('#progressFill').style.width = clamp(player.t / player.duration, 0, 1) * 100 + '%';
        }
      }
    } else {
      hero.frame(now);
      ambient.frame(now);
      player.lastFrame = 0;
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => { if (screen === 'player') { drawDensity(); placeScoreboard(); } });
  document.addEventListener('pointerdown', () => synth.init(), { once: true });

  /* ================= Início ================= */
  async function boot() {
    BUILTIN_SONGS.forEach(s => songs.push(s));
    renderLibrary();
    // pede o MIDI com a página visível (o app instalado pode abrir em segundo plano)
    if (document.hidden) document.addEventListener('visibilitychange', function once() { if (!document.hidden) { document.removeEventListener('visibilitychange', once); Midi.init(); } });
    else Midi.init();
    const recs = await Store.allSongs();
    recs.sort((a, b) => a.added - b.added).forEach(rec => {
      try { songs.push(fromRecord(rec, parseMidi(rec.data))); } catch (e) { console.warn('Falha ao carregar', rec.title, e); }
    });
    renderLibrary();
    requestAnimationFrame(loop);
    if (fromHash() !== 'library') go(fromHash(), false);
  }
  boot();

  /* ================= Instalação como aplicativo (PWA) ================= */
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  let deferredPrompt = null;
  const btnInstall = $('#btnInstall');

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btnInstall.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    btnInstall.hidden = true;
    closeModal('#installModal');
    toast('Aurora Keys instalado! Procure o ícone na tela inicial.');
  });

  // No iPhone/iPad não existe o aviso automático: mostramos o botão com instruções.
  if (!standalone && (isIOS || isAndroid)) btnInstall.hidden = false;

  const ICON_SHARE = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg>';
  const ICON_DOTS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>';
  const ICON_ADD = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  btnInstall.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      if (choice && choice.outcome === 'accepted') btnInstall.hidden = true;
      return;
    }
    let steps;
    if (isIOS) {
      steps = '<ol class="install-steps">' +
        '<li><span>Abra esta página no <b>Safari</b>.</span></li>' +
        '<li><span>Toque em <b>Compartilhar</b> ' + ICON_SHARE + ' na barra do navegador.</span></li>' +
        '<li><span>Escolha <b>Adicionar à Tela de Início</b> ' + ICON_ADD + ' e toque em <b>Adicionar</b>.</span></li></ol>' +
        '<p class="install-note">No iPhone e iPad, a Apple não permite teclado MIDI em apps da web. Você pode tocar pela tela ou ouvir as músicas.</p>';
    } else {
      steps = '<ol class="install-steps">' +
        '<li><span>Abra esta página no <b>Chrome</b>.</span></li>' +
        '<li><span>Toque no menu ' + ICON_DOTS + ' no canto superior.</span></li>' +
        '<li><span>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</span></li></ol>' +
        '<p class="install-note">No Android, conecte o teclado MIDI com um cabo USB-OTG. Ele é reconhecido pelo app instalado.</p>';
    }
    $('#installSteps').innerHTML = steps;
    openModal('#installModal');
  });

  // Abrir arquivos .mid direto pelo sistema (app instalado no computador)
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const files = await Promise.all(params.files.map(h => h.getFile()));
      importFiles(files);
    });
  }

  // Pausa quando o app vai para segundo plano
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'player') player.pause();
    // voltou para o app (ex.: depois de reconectar o cabo): tenta o MIDI de novo
    if (!document.hidden && Midi.status === 'error') midiRecover(false);
  });
  // falhou no meio de uma música ou com a câmera aberta: recarrega quando sair dela
  setInterval(() => { if (Midi.status === 'error' && Midi.pendingReload && safeToReload()) { Midi.pendingReload = false; midiRecover(false); } }, 1500);

  // para depuração
  window.AuroraKeys = { player, synth, songs, settings, importFiles, importBuffer, toast, noteOn, noteOff, arStage };
})();
