/* Aurora Keys — Partituras: busca unificada em acervos livres (Mutopia, IMSLP, CPDL, Internet Archive).
   Nada é copiado desses sites: a busca consulta cada acervo na hora e os downloads saem da fonte original.
   Exceção: os MIDIs de piano do Mutopia (licenças livres) vêm junto com o app em assets/mutopia/,
   para poderem abrir direto no modo de prática. */
(function (global) {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');

  const SOURCES = {
    mutopia: { name: 'Mutopia', site: 'https://www.mutopiaproject.org/', color: '#2ee6d6', blurb: 'PDF, MIDI e LilyPond' },
    imslp: { name: 'IMSLP', site: 'https://imslp.org/', color: '#8b7bff', blurb: 'Biblioteca Petrucci' },
    cpdl: { name: 'CPDL', site: 'https://www.cpdl.org/', color: '#ff5fb1', blurb: 'Música coral' },
    archive: { name: 'Internet Archive', site: 'https://archive.org/', color: '#ffd166', blurb: 'Partituras digitalizadas' }
  };
  const MUTOPIA_FTP = 'https://www.mutopiaproject.org/ftp/';
  const PER_SOURCE = 20;

  /* ---------------- utilidades de rede ---------------- */
  let jsonpSeq = 0;
  function jsonp(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const cb = '__akJsonp' + (++jsonpSeq) + Date.now().toString(36);
      const s = document.createElement('script');
      const done = (fn, v) => { clearTimeout(t); delete global[cb]; s.remove(); fn(v); };
      const t = setTimeout(() => done(reject, new Error('tempo esgotado')), timeout);
      global[cb] = (data) => done(resolve, data);
      s.onerror = () => done(reject, new Error('falha de rede'));
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(s);
    });
  }
  async function getJson(url, timeout = 15000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  // "Nocturne in E minor, Op.72 No.1 (Chopin, Frédéric)" → { title, composer }
  function splitWikiTitle(t) {
    const m = /^(.*)\s\(([^()]+)\)\s*$/.exec(t);
    if (!m) return { title: t, composer: '' };
    let composer = m[2].trim();
    const c = /^([^,]+),\s*([^,]+)$/.exec(composer); // "Sobrenome, Nome" → "Nome Sobrenome"
    if (c) composer = c[2] + ' ' + c[1];
    return { title: m[1], composer };
  }

  /* ---------------- Mutopia (índice local) ---------------- */
  let mutopiaIndex = null;
  function loadMutopia() {
    if (!mutopiaIndex) {
      mutopiaIndex = fetch('data/mutopia.json').then(r => r.json()).then(d => d.items.map(a => ({
        id: a[0], title: a[1], composer: a[2], opus: a[3], instrument: a[4], style: a[5], license: a[6],
        pdf: a[7], mid: a[8], local: a[9] === 1, preview: a[10],
        hay: norm([a[1], a[2], a[3], a[4], a[5]].join(' '))
      }))).catch(e => { mutopiaIndex = null; throw e; });
    }
    return mutopiaIndex;
  }
  function mutopiaResult(p) {
    const files = [];
    if (p.pdf) files.push({ kind: 'PDF', url: MUTOPIA_FTP + p.pdf });
    if (p.mid) files.push({ kind: 'MIDI', url: MUTOPIA_FTP + p.mid });
    if (p.pdf) files.push({ kind: 'Pasta', url: MUTOPIA_FTP + p.pdf.replace(/[^/]+$/, ''), label: 'Todos os formatos' });
    return {
      source: 'mutopia', key: 'm' + p.id, title: p.title, composer: p.composer,
      meta: [p.opus, p.instrument, p.style].filter(Boolean).join(' · '),
      license: p.license, page: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=' + p.id,
      files, practice: p.local ? { url: 'assets/mutopia/' + p.id + '.mid', title: p.title, artist: p.composer } : null,
      piano: /piano|harpsichord|clavichord|keyboard/i.test(p.instrument)
    };
  }
  async function searchMutopia(q, opts) {
    const idx = await loadMutopia();
    const terms = norm(q).split(/\s+/).filter(Boolean);
    let list = idx.filter(p => terms.every(t => p.hay.includes(t)));
    if (opts.pianoOnly) list = list.filter(p => /piano|harpsichord|clavichord|keyboard/i.test(p.instrument));
    list.sort((a, b) => (b.local - a.local) || a.title.localeCompare(b.title));
    return { total: list.length, items: list.slice(0, opts.limit || PER_SOURCE).map(mutopiaResult) };
  }

  /* ---------------- IMSLP (MediaWiki via JSONP) ---------------- */
  async function searchImslp(q, opts) {
    const term = opts.pianoOnly ? q + ' piano' : q;
    const d = await jsonp('https://imslp.org/api.php?action=query&list=search&format=json&srnamespace=0&srprop=snippet&srlimit=' +
      PER_SOURCE + '&srsearch=' + encodeURIComponent(term));
    const hits = (d.query && d.query.search) || [];
    const total = (d.query && d.query.searchinfo && d.query.searchinfo.totalhits) || hits.length;
    return {
      total,
      items: hits.filter(h => /\(.+\)\s*$/.test(h.title)).map(h => {
        const { title, composer } = splitWikiTitle(h.title);
        return {
          source: 'imslp', key: 'i' + h.title, title, composer, meta: '', license: 'Domínio público (verifique seu país)',
          page: 'https://imslp.org/wiki/' + encodeURIComponent(h.title.replace(/ /g, '_')), wikiTitle: h.title, files: null
        };
      })
    };
  }
  // "{{LinkEd|Herrmann|Scholtz|1845|1918}}<br>{{FE}}" → "Herrmann Scholtz"
  function cleanEditor(s) {
    return s.replace(/<br\s*\/?>/gi, ', ')
      .replace(/\{\{(?:LinkEd|LinkName)\|([^|}]*)\|([^|}]*)[^}]*\}\}/gi, '$1 $2')
      .replace(/\{\{FE\}\}/gi, 'Primeira edição').replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/[[\]]/g, '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').slice(0, 70);
  }
  async function filesImslp(r) {
    const d = await jsonp('https://imslp.org/api.php?action=parse&prop=wikitext&format=json&page=' + encodeURIComponent(r.wikiTitle));
    const text = (d.parse && d.parse.wikitext && d.parse.wikitext['*']) || '';
    const out = [];
    const blocks = text.split('{{#fte:imslpfile').slice(1);
    for (const b of blocks) {
      const body = b.split(/\n\}\}/)[0];
      const field = (k) => { const m = new RegExp('\\|' + k + '=([^\\n]*)').exec(body); return m ? m[1].trim() : ''; };
      const copyright = field('Copyright');
      const editor = cleanEditor(field('Editor'));
      for (let i = 1; i <= 40; i++) {
        const name = field('File Name ' + i);
        if (!name) { if (i > 1) break; continue; }
        const desc = field('File Description ' + i).replace(/\{\{[^}]*\}\}/g, '').replace(/[[\]']/g, '');
        out.push({
          kind: (name.split('.').pop() || 'arquivo').toUpperCase(),
          url: 'https://imslp.org/wiki/File:' + encodeURIComponent(name.replace(/ /g, '_')),
          label: [desc || 'Partitura', editor].filter(Boolean).join(' — '),
          note: copyright
        });
        if (out.length >= 30) return out;
      }
    }
    return out;
  }

  /* ---------------- CPDL (MediaWiki com CORS) ---------------- */
  const CPDL_API = 'https://www.cpdl.org/wiki/api.php?format=json&origin=*&';
  async function searchCpdl(q) {
    const d = await getJson(CPDL_API + 'action=query&list=search&srnamespace=0&srprop=snippet&srlimit=' + (PER_SOURCE + 10) + '&srsearch=' + encodeURIComponent(q));
    const hits = ((d.query && d.query.search) || []).filter(h => !/^#redirect/i.test(stripTags(h.snippet)) && /\(.+\)\s*$/.test(h.title));
    return {
      total: (d.query && d.query.searchinfo && d.query.searchinfo.totalhits) || hits.length,
      items: hits.slice(0, PER_SOURCE).map(h => {
        const { title, composer } = splitWikiTitle(h.title);
        return {
          source: 'cpdl', key: 'c' + h.title, title, composer, meta: 'Coral', license: 'Licença CPDL (uso livre, ver página)',
          page: 'https://www.cpdl.org/wiki/index.php/' + encodeURIComponent(h.title.replace(/ /g, '_')), wikiTitle: h.title, files: null
        };
      })
    };
  }
  async function filesCpdl(r) {
    const d = await getJson(CPDL_API + 'action=query&redirects=1&generator=images&gimlimit=60&prop=imageinfo&iiprop=url&titles=' + encodeURIComponent(r.wikiTitle));
    const pages = Object.values((d.query && d.query.pages) || {});
    const rank = { PDF: 0, MID: 1, MIDI: 1, MXL: 2, XML: 2, MUSICXML: 2, MSCZ: 3, LY: 4 };
    return pages.map(p => {
      const info = p.imageinfo && p.imageinfo[0];
      if (!info) return null;
      const name = p.title.replace(/^File:/, '');
      const kind = (name.split('.').pop() || '').toUpperCase();
      if (/^(PNG|JPG|JPEG|GIF|SVG)$/.test(kind)) return null;
      return { kind, url: info.url, label: name };
    }).filter(Boolean).sort((a, b) => ((rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)) || a.label.localeCompare(b.label));
  }

  /* ---------------- Internet Archive (CORS) ---------------- */
  async function searchArchive(q, opts) {
    const scope = '(subject:"sheet music" OR subject:scores OR subject:"piano music" OR collection:sheetmusic)';
    const query = '(' + q + (opts.pianoOnly ? ' AND piano' : '') + ') AND mediatype:texts AND ' + scope;
    const url = 'https://archive.org/advancedsearch.php?output=json&rows=' + PER_SOURCE +
      '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=licenseurl&q=' + encodeURIComponent(query);
    const d = await getJson(url);
    const docs = (d.response && d.response.docs) || [];
    const one = (v) => Array.isArray(v) ? v[0] : v;
    return {
      total: (d.response && d.response.numFound) || docs.length,
      items: docs.map(x => ({
        source: 'archive', key: 'a' + x.identifier, title: one(x.title) || x.identifier,
        composer: (one(x.creator) || '').replace(/,\s*\d{4}.*$/, ''), meta: x.date ? String(x.date).slice(0, 4) : '',
        license: x.licenseurl ? 'Licença: ' + x.licenseurl.replace(/^https?:\/\//, '') : 'Verifique os direitos na página do item',
        page: 'https://archive.org/details/' + encodeURIComponent(x.identifier), identifier: x.identifier, files: null
      }))
    };
  }
  async function filesArchive(r) {
    const d = await getJson('https://archive.org/metadata/' + encodeURIComponent(r.identifier));
    const files = (d.files || []).filter(f => /\.(pdf|mid|midi|mxl|musicxml|xml|mscz|ly)$/i.test(f.name) && !/_(meta|files|djvu|metasource|marc|scandata|reviews)\.xml$/i.test(f.name) && !/\.xml$/i.test(f.name) || /musicxml|\.mxl$/i.test(f.name) && !/_(text|abbyy)\.pdf$/i.test(f.name));
    return files.slice(0, 30).map(f => ({
      kind: (f.name.split('.').pop() || '').toUpperCase(),
      url: 'https://archive.org/download/' + encodeURIComponent(r.identifier) + '/' + f.name.split('/').map(encodeURIComponent).join('/'),
      label: f.name + (f.size ? ' · ' + Math.max(1, Math.round(f.size / 1024)) + ' KB' : '')
    }));
  }

  const SEARCH = { mutopia: searchMutopia, imslp: searchImslp, cpdl: searchCpdl, archive: searchArchive };
  const FILES = { imslp: filesImslp, cpdl: filesCpdl, archive: filesArchive };

  /* ---------------- interface ---------------- */
  const state = {
    q: '', filter: 'all', pianoOnly: false, seq: 0,
    bySource: {}, // fonte → { status: 'loading'|'ok'|'error', total, items }
    enabled: { mutopia: true, imslp: true, cpdl: true, archive: true }
  };
  let ui = null;
  let importer = null;

  const ICON = {
    dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
  };

  function badge(src) {
    const s = SOURCES[src];
    return '<span class="src-badge" style="--c:' + s.color + '">' + esc(s.name) + '</span>';
  }

  function fileLinks(files) {
    if (!files.length) return '<p class="sheet-empty-files">Nenhum arquivo para download encontrado. Abra a página na fonte.</p>';
    return '<ul class="file-list">' + files.map(f =>
      '<li><a href="' + esc(f.url) + '" target="_blank" rel="noopener" download>' +
      '<span class="kind">' + esc(f.kind) + '</span><span class="flabel">' + esc(f.label || f.kind) + '</span>' +
      (f.note ? '<small>' + esc(f.note) + '</small>' : '') + ICON.dl + '</a></li>').join('') + '</ul>';
  }

  function resultHtml(r) {
    const quick = r.source === 'mutopia'
      ? r.files.filter(f => f.kind !== 'Pasta').map(f =>
        '<a class="btn ghost sm" href="' + esc(f.url) + '" target="_blank" rel="noopener" download>' + ICON.dl + esc(f.kind) + '</a>').join('')
      : '<button class="btn ghost sm" type="button" data-files="' + esc(r.key) + '">' + ICON.list + 'Arquivos</button>';
    return '<article class="sheet-item" data-key="' + esc(r.key) + '">' +
      '<div class="sheet-main">' +
        '<div class="sheet-head">' + badge(r.source) + (r.practice ? '<span class="src-badge practice">MIDI pronto</span>' : '') + '</div>' +
        '<h3 class="sheet-title">' + esc(r.title) + '</h3>' +
        '<div class="sheet-composer">' + esc(r.composer || 'Compositor desconhecido') + (r.meta ? ' <span>· ' + esc(r.meta) + '</span>' : '') + '</div>' +
        '<div class="sheet-license">' + esc(r.license || '') + '</div>' +
      '</div>' +
      '<div class="sheet-actions">' +
        (r.practice ? '<button class="btn primary sm" type="button" data-practice="' + esc(r.key) + '">' + ICON.play + 'Praticar</button>' : '') +
        quick +
        '<a class="btn ghost sm icon-only" href="' + esc(r.page) + '" target="_blank" rel="noopener" title="Abrir em ' + esc(SOURCES[r.source].name) + '" aria-label="Abrir na fonte">' + ICON.ext + '</a>' +
      '</div>' +
      '<div class="sheet-files" hidden></div>' +
    '</article>';
  }

  const resultsByKey = new Map();

  function render() {
    const order = ['mutopia', 'imslp', 'cpdl', 'archive'];
    // contadores nos filtros
    ui.filters.querySelectorAll('button').forEach(b => {
      const src = b.dataset.src;
      const c = b.querySelector('.count');
      if (!c) return;
      if (src === 'all') {
        const n = order.reduce((a, s) => a + ((state.bySource[s] && state.bySource[s].total) || 0), 0);
        c.textContent = state.q ? fmtCount(n) : '';
      } else {
        const st = state.bySource[src];
        c.textContent = !state.q || !st ? '' : st.status === 'loading' ? '…' : st.status === 'error' ? '!' : fmtCount(st.total);
      }
      b.classList.toggle('on', state.filter === src);
    });

    const sources = state.filter === 'all' ? order : [state.filter];
    let html = '';
    resultsByKey.clear();
    for (const src of sources) {
      const st = state.bySource[src];
      if (!st) continue;
      const s = SOURCES[src];
      html += '<section class="sheet-group"><header><h2>' + badge(src) + '<span>' + esc(s.blurb) + '</span></h2>';
      if (st.status === 'ok' && state.q && (st.total > st.items.length || st.items.length >= PER_SOURCE)) {
        html += '<a href="' + esc(sourceSearchUrl(src, state.q)) + '" target="_blank" rel="noopener" class="more">' +
          (st.total > st.items.length ? 'Ver todos os ' + fmtCount(st.total) : 'Ver mais') + ' em ' + esc(s.name) + ' →</a>';
      }
      html += '</header>';
      if (st.status === 'loading') html += '<div class="sheet-loading"><i></i><i></i><i></i></div>';
      else if (st.status === 'error') html += '<p class="sheet-error">Não foi possível consultar ' + esc(s.name) + ' agora. <a href="' + esc(sourceSearchUrl(src, state.q)) + '" target="_blank" rel="noopener">Buscar direto no site</a>.</p>';
      else if (!st.items.length) html += '<p class="sheet-none">Nada encontrado aqui.</p>';
      else {
        html += '<div class="sheet-list">' + st.items.map(r => { resultsByKey.set(r.key, r); return resultHtml(r); }).join('') + '</div>';
      }
      html += '</section>';
    }
    ui.results.innerHTML = html;
  }

  function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + ' mil' : String(n); }

  function sourceSearchUrl(src, q) {
    const e = encodeURIComponent(q || '');
    return {
      mutopia: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor=' + e,
      imslp: 'https://imslp.org/index.php?title=Special:Search&search=' + e,
      cpdl: 'https://www.cpdl.org/wiki/index.php?search=' + e,
      archive: 'https://archive.org/search?query=' + e + '&and[]=mediatype%3A%22texts%22'
    }[src];
  }

  async function runSearch() {
    const q = state.q;
    const seq = ++state.seq;
    state.bySource = {};
    if (!q) return showFeatured();
    ui.intro.hidden = true;
    for (const src of Object.keys(SEARCH)) {
      state.bySource[src] = { status: 'loading', total: 0, items: [] };
      SEARCH[src](q, { pianoOnly: state.pianoOnly }).then(res => {
        if (seq !== state.seq) return;
        state.bySource[src] = { status: 'ok', total: res.total, items: res.items };
        render();
      }).catch(err => {
        if (seq !== state.seq) return;
        console.warn('Partituras:', src, err);
        state.bySource[src] = { status: 'error', total: 0, items: [] };
        render();
      });
    }
    render();
  }

  async function showFeatured() {
    ui.intro.hidden = false;
    const seq = state.seq;
    state.bySource = { mutopia: { status: 'loading', total: 0, items: [] } };
    render();
    try {
      const idx = await loadMutopia();
      if (seq !== state.seq) return;
      const picks = ['Für Elise', 'Gymnopédie', 'Prelude in C', 'Nocturne', 'Minuet in G', 'Clair de lune', 'Turkish', 'Arabesque', 'Träumerei', 'Invention'];
      const seen = new Set();
      const items = [];
      for (const pk of picks) {
        const n = norm(pk);
        const p = idx.find(x => x.local && norm(x.title).includes(n) && !seen.has(x.id));
        if (p) { seen.add(p.id); items.push(p); }
      }
      for (const p of idx) { if (items.length >= 16) break; if (p.local && !seen.has(p.id) && /Romantic|Classical|Baroque/.test(p.style)) { seen.add(p.id); items.push(p); } }
      const localCount = idx.filter(p => p.local).length;
      state.bySource = { mutopia: { status: 'ok', total: localCount, items: items.map(mutopiaResult) } };
      ui.stats.textContent = idx.length.toLocaleString('pt-BR') + ' peças do Mutopia no índice · ' + localCount.toLocaleString('pt-BR') + ' prontas para praticar';
    } catch (e) {
      state.bySource = { mutopia: { status: 'error', total: 0, items: [] } };
    }
    render();
  }

  async function toggleFiles(btn) {
    const item = btn.closest('.sheet-item');
    const r = resultsByKey.get(item.dataset.key);
    const box = item.querySelector('.sheet-files');
    if (!box.hidden) { box.hidden = true; btn.classList.remove('on'); return; }
    box.hidden = false; btn.classList.add('on');
    if (r.files) { box.innerHTML = fileLinks(r.files); return; }
    box.innerHTML = '<div class="sheet-loading small"><i></i><i></i><i></i></div>';
    try {
      r.files = await FILES[r.source](r);
      box.innerHTML = fileLinks(r.files) + (r.source === 'imslp' && r.files.length
        ? '<p class="sheet-note">O IMSLP abre a página do arquivo; clique em “Download” lá (pode pedir para aceitar o aviso de domínio público).</p>' : '');
    } catch (e) {
      console.warn(e);
      box.innerHTML = '<p class="sheet-error">Não consegui listar os arquivos. <a href="' + esc(r.page) + '" target="_blank" rel="noopener">Abrir a página na fonte</a>.</p>';
    }
  }

  async function practice(btn) {
    const r = resultsByKey.get(btn.closest('.sheet-item').dataset.key);
    if (!r || !r.practice || !importer) return;
    btn.disabled = true;
    try {
      const res = await fetch(r.practice.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      await importer(buf, { title: r.practice.title, artist: r.practice.artist, sourceId: r.key, license: r.license, page: r.page });
    } catch (e) {
      console.warn(e);
      global.AuroraKeys && global.AuroraKeys.toast && global.AuroraKeys.toast('Não consegui abrir este MIDI', true);
    } finally { btn.disabled = false; }
  }

  function init(opts) {
    importer = opts.importBuffer;
    ui = {
      root: $('#sheets'), form: $('#sheetForm'), input: $('#sheetQuery'), filters: $('#sheetFilters'),
      results: $('#sheetResults'), intro: $('#sheetIntro'), stats: $('#sheetStats'), piano: $('#sheetPiano')
    };
    let timer = 0;
    ui.form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); state.q = ui.input.value.trim(); runSearch(); ui.input.blur(); });
    ui.input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { const q = ui.input.value.trim(); if (q !== state.q && (q.length >= 3 || !q)) { state.q = q; runSearch(); } }, 650);
    });
    ui.piano.addEventListener('change', () => { state.pianoOnly = ui.piano.checked; if (state.q) runSearch(); });
    ui.filters.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.filter = b.dataset.src; render();
    });
    ui.root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-files]'); if (f) return toggleFiles(f);
      const p = e.target.closest('[data-practice]'); if (p) return practice(p);
      const s = e.target.closest('[data-suggest]'); if (s) { ui.input.value = s.dataset.suggest; state.q = s.dataset.suggest; runSearch(); }
    });
  }

  let started = false;
  function open() {
    if (!started) { started = true; showFeatured(); }
    setTimeout(() => ui.input.focus({ preventScroll: true }), 50);
  }

  global.Sheets = { init, open, _splitWikiTitle: splitWikiTitle };
})(window);
