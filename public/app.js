/* global io */
const app = document.querySelector('#app');
const socket = io({ autoConnect: false });
const params = new URLSearchParams(location.search);
const role = location.pathname === '/host' ? 'host' : location.pathname === '/screen' ? 'screen' : 'player';
let code = params.get('code') || '';
let state;
let config;
let serverOffset = 0;
let requestPending = false;
let toastTimer;
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeLabel = type => ({ photo: 'Fotografie', text: 'Text', poster: 'Werbeplakat' }[type]);
const getSaved = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { showToast('Der Browser speichert deinen Zugang nicht. Bitte diese Seite geöffnet lassen.'); } };
let memoryCredentials;
const credentials = () => memoryCredentials || getSaved(`quiz-player-${code}`);
const hostToken = () => { try { return sessionStorage.getItem(`quiz-host-${code}`); } catch { return null; } };

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}
function connectionLabel(connected) {
  $('#connection').textContent = connected ? 'Live verbunden' : 'Verbindung unterbrochen';
  $('#connection').classList.toggle('connected', connected);
  document.body.classList.toggle('offline', !connected);
}
function emit(event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Keine Verbindung. Bitte kurz warten; die Seite verbindet sich wieder.'));
    socket.timeout(8000).emit(event, payload, (error, response) => {
      if (error) reject(new Error('Der Server antwortet nicht. Bitte erneut versuchen.'));
      else if (!response.ok) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
function receive(next) {
  state = next; serverOffset = next.serverTime - Date.now(); code = next.room;
  renderState(); updateClock();
}
socket.on('state', receive);
socket.on('disconnect', () => connectionLabel(false));
socket.on('connect_error', () => connectionLabel(false));
socket.on('connect', async () => {
  connectionLabel(true);
  if (!code || location.pathname === '/leaderboard') return;
  try {
    if (role === 'host' && hostToken()) {
      receive((await emit('watch', { room: code, hostToken: hostToken() })).state);
    } else if (role === 'screen') {
      receive((await emit('watch', { room: code })).state);
    } else if (role === 'player' && credentials()) {
      receive((await emit('join', { room: code, ...credentials() })).state);
    }
  } catch (error) { showToast(error.message); }
});

function joinForm() {
  return `<form id="join-form" class="join-form">
    <div class="form-heading"><span class="step-number">↗</span><h2>Bereit für den zweiten Blick?</h2></div>
    <label for="code">Spielcode</label><input id="code" name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" minlength="6" placeholder="6-stelliger Code" value="${escape(code)}" required>
    <label for="nickname">Dein Spitzname</label><input id="nickname" name="nickname" autocomplete="off" maxlength="20" minlength="2" placeholder="Zum Beispiel: Bergfuchs" required>
    <p class="field-help">Nur ein Spitzname – keine echten Namen nötig. Er erscheint auf der Rangliste.</p>
    <button class="button primary" type="submit">Ich rate mit <span>↗</span></button>
    <p id="form-error" class="form-error" role="alert"></p>
  </form>`;
}
function renderLanding() {
  app.innerHTML = `<section class="landing"><div class="hero-copy"><p class="eyebrow"><span class="mini-dot"></span> DAS LIVE-QUIZ ÜBER KÜNSTLICHE INTELLIGENZ</p>
    <h1>Traust du<br>deinen <span class="underline">Augen?</span></h1><p class="hero-description">Ein Foto. Ein Text. Ein Plakat.<br>Erkennst du, was mit KI entstanden ist?</p>
    <div class="format-tags"><span>01 / Fotos</span><span>02 / Texte</span><span>03 / Plakate</span></div>
    <div class="visual-stack" aria-hidden="true"><div class="photo-sticker"><img src="/sample" alt=""><span>Ein Bild. Zwei Möglichkeiten.</span></div><div class="question-sticker">ECHT<span>ODER</span>KI?</div><span class="spark">✳</span></div>
    </div><aside class="join-panel">${joinForm()}<div class="how"><span>So geht’s</span><ol><li>Code eingeben & mitmachen</li><li>Genau hinsehen & abstimmen</li><li>Auflösung entdecken & Punkte sammeln</li></ol></div></aside></section>
    <section class="learning-strip"><span class="asterisk">✳</span><p><strong>Nicht alles, was echt aussieht, ist eine Aufnahme.</strong><br>Und nicht alles, was KI erzeugt, ist falsch. Wir prüfen die Herkunft.</p><span class="strip-label">NEUGIER STATT BAUCHGEFÜHL</span></section>`;
  $('#join-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (requestPending) return;
    requestPending = true;
    const button = $('#join-form button'); button.disabled = true;
    code = $('#code').value.trim();
    const name = $('#nickname').value.trim();
    try {
      const result = await emit('join', { room: code, nickname: name });
      memoryCredentials = { playerId: result.playerId, playerToken: result.playerToken };
      save(`quiz-player-${code}`, memoryCredentials);
      history.replaceState(null, '', `/?code=${code}`);
      receive(result.state);
    } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; }
    finally { requestPending = false; }
  });
}
function renderHostSetup() {
  app.innerHTML = `<section class="setup-layout"><div><p class="eyebrow">REGIE / STAND 02</p><h1>Du gibst<br>den <span class="underline">Takt an.</span></h1><p class="hero-description">Eine Runde, alle Geräte, ein gemeinsamer Aha-Moment.</p><div class="info-box"><strong>Für den Stand</strong><p>Beamer öffnen, QR-Code zeigen, Gruppe sammeln. Jede richtige Antwort gibt 1’000 Punkte. Die Geschwindigkeit spielt keine Rolle.</p><a href="/stand.html">Ablauf & druckbare Unterlagen ↗</a></div></div>
    <form id="host-form" class="panel"><h2>Neue Gruppe starten</h2><p>${config.questionCount} Beispiele · Fotos, Texte & Plakate</p>
    <label for="host-key">Moderationsschlüssel</label><input id="host-key" type="password" autocomplete="off" required placeholder="Steht im Server-Terminal">
    <label for="duration">Antwortzeit pro Frage</label><select id="duration"><option value="15">15 Sekunden</option><option value="20">20 Sekunden</option><option value="25" selected>25 Sekunden</option><option value="30">30 Sekunden</option><option value="45">45 Sekunden</option><option value="60">60 Sekunden</option></select>
    <label for="join-base">Adresse für die Handys</label><input id="join-base" type="url" list="local-addresses" required value="${escape(config.publicUrl || config.suggestedUrls[0] || location.origin)}"><datalist id="local-addresses">${config.suggestedUrls.map(url => `<option value="${escape(url)}">`).join('')}</datalist>
    <p class="field-help">Die erreichbare WLAN-Adresse des Laptops. Alle Geräte müssen dasselbe Netz nutzen. «localhost» funktioniert nur auf diesem Laptop.</p>
    <button class="button primary" type="submit">Spielraum erstellen <span>↗</span></button><p id="form-error" class="form-error" role="alert"></p></form></section>`;
  $('#host-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#host-form button'); button.disabled = true;
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostKey: $('#host-key').value, duration: Number($('#duration').value), joinBase: $('#join-base').value }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      code = result.room;
      sessionStorage.setItem(`quiz-host-${code}`, result.hostToken);
      history.replaceState(null, '', `/host?code=${code}`);
      receive((await emit('watch', { room: code, hostToken: result.hostToken })).state);
    } catch (error) { if ($('#form-error')) $('#form-error').textContent = error.message; button.disabled = false; }
  });
}
function qrBlock() {
  return `<div class="qr-block"><img class="qr" src="/api/qr?url=${encodeURIComponent(state.joinUrl)}" alt="QR-Code zum Beitreten"><div><p class="eyebrow">KAMERA AUF. MITMACHEN.</p><span class="game-code">${escape(code)}</span><p class="join-url">${escape(state.joinUrl)}</p></div></div>`;
}
function hostToolbar() {
  if (role !== 'host') return '';
  const action = state.phase === 'lobby' ? 'start' : state.phase === 'question' ? 'reveal' : state.phase === 'reveal' ? 'next' : null;
  const label = state.phase === 'lobby' ? 'Quiz starten →' : state.phase === 'question' ? 'Jetzt auflösen →' : state.index + 1 === state.total ? 'Ergebnis zeigen →' : 'Nächste Frage →';
  return `<div class="host-toolbar"><div><span class="eyebrow">MODERATION</span><span>${state.playerCount} Personen · ${state.answeredCount} Antworten</span></div><div class="toolbar-buttons"><a class="button secondary" href="/stand.html?join=${encodeURIComponent(state.joinUrl)}" target="_blank" rel="noopener">Standplakat ↗</a><a class="button secondary" href="/screen?code=${code}" target="_blank" rel="noopener">Beamer öffnen ↗</a>${action ? `<button class="button primary" id="host-action" data-action="${action}" ${state.phase === 'lobby' && !state.playerCount ? 'disabled' : ''}>${label}</button>` : '<a class="button primary" href="/host">Neue Gruppe ↗</a>'}</div></div>`;
}
function renderLobby() {
  const isPlayer = role === 'player';
  return `<section class="lobby"><div class="lobby-title"><p class="eyebrow">SPIELRAUM ${code} / WIR STARTEN GLEICH</p><h1>${isPlayer ? `Hallo,<br><span class="underline">${escape(state.me?.nickname)}.</span>` : 'Der zweite Blick<br><span class="underline">beginnt hier.</span>'}</h1><p class="hero-description">${isPlayer ? 'Du bist dabei. Die Moderation startet das Quiz.<br>Handy bereithalten, neugierig bleiben.' : 'QR-Code scannen. Spitznamen wählen.<br>Gemeinsam herausfinden, was KI möglich macht.'}</p><div class="lobby-facts"><span>${state.total} Beispiele</span><span>${state.duration} Sek. zum Raten</span><span>1’000 Punkte pro Treffer</span></div></div><aside class="panel lobby-panel">${isPlayer ? '<div class="ready-symbol">✓</div><h2>Dein Platz ist reserviert.</h2><p>Du bekommst jedes Beispiel direkt hier angezeigt.</p>' : qrBlock()}<div class="players-heading"><strong>Schon dabei</strong><span class="count-pill">${state.playerCount}</span></div><div class="player-chips">${state.players.map(p => `<span>${escape(p.nickname)}</span>`).join('') || '<p>Die ersten Spürnasen fehlen noch …</p>'}</div></aside></section>`;
}
function questionMedia() {
  const q = state.question;
  if (q.type === 'text') return `<div class="text-example"><span class="quote-mark">“</span><p>${escape(q.text)}</p><span class="text-end">TEXTBEISPIEL / ${String(state.index + 1).padStart(2, '0')}</span></div>`;
  return `<div class="image-example ${q.type === 'poster' ? 'poster-example' : ''}"><img src="${q.image}" alt="${escape(q.alt)}"><span class="image-error" hidden>Bild konnte nicht geladen werden. Bitte Verbindung prüfen.</span></div>`;
}
function choices() {
  const answer = state.me?.answer;
  if (state.phase !== 'question') return '';
  if (role !== 'player') return `<div class="audience-prompt"><span>↙</span><p>Was denkst du?<strong>Jetzt auf dem Handy abstimmen.</strong></p><span class="answer-counter">${state.answeredCount} / ${state.playerCount}</span></div>`;
  return `<div class="answer-area"><p class="eyebrow">${answer ? 'DEINE ANTWORT IST GESPEICHERT' : 'WIE IST DIESES BEISPIEL ENTSTANDEN?'}</p><div class="answer-buttons"><button class="answer-button human ${answer?.choice === 'human' ? 'selected' : ''}" data-choice="human" ${answer ? 'disabled' : ''}><span class="answer-icon">◉</span><span>Ohne generative KI<small>Fotografiert oder von Menschen gestaltet</small></span><span>${answer?.choice === 'human' ? '✓' : 'A'}</span></button><button class="answer-button ai ${answer?.choice === 'ai' ? 'selected' : ''}" data-choice="ai" ${answer ? 'disabled' : ''}><span class="answer-icon">✳</span><span>Mit KI erzeugt<small>Durch generative KI erstellt</small></span><span>${answer?.choice === 'ai' ? '✓' : 'B'}</span></button></div><p class="field-help">${answer ? 'Gute Beobachtung? Gleich kommt die Auflösung.' : 'Eine Antwort pro Beispiel. Einmal gewählt, bleibt sie gespeichert.'}</p></div>`;
}
function revealBlock() {
  const reveal = state.reveal;
  if (!reveal || state.phase !== 'reveal') return '';
  const myAnswer = state.me?.answer;
  const aiVotes = reveal.votes.find(v => v.choice === 'ai')?.n || 0;
  const humanVotes = reveal.votes.find(v => v.choice === 'human')?.n || 0;
  return `<section class="reveal-block"><div class="reveal-heading"><span class="reveal-icon">${reveal.answer === 'ai' ? '✳' : '◉'}</span><div><p class="eyebrow">DIE AUFLÖSUNG</p><h2>${reveal.answer === 'ai' ? 'Mit KI erzeugt.' : 'Ohne generative KI.'}</h2></div>${role === 'player' ? `<span class="result-pill">${myAnswer ? myAnswer.points ? '+ 1’000 Punkte ✓' : 'Diesmal kein Treffer' : 'Nicht abgestimmt'}</span>` : ''}</div><p class="explanation">${escape(reveal.explanation)}</p><div class="takeaway"><span>↗</span><p>${escape(reveal.takeaway)}</p></div><div class="vote-summary"><span>So hat die Gruppe getippt:</span><strong>${humanVotes} ohne KI</strong><strong>${aiVotes} mit KI</strong></div><p class="source-credit">${escape(reveal.credit)} · ${escape(reveal.license)}<br><a href="${escape(reveal.source)}" target="_blank" rel="noopener noreferrer">Herkunft nachprüfen ↗</a></p></section>`;
}
function leaderboardTable(entries, meId, empty = 'Noch keine Ergebnisse. Die erste Gruppe legt gleich los.') {
  if (!entries.length) return `<p class="empty-state">${empty}</p>`;
  return `<table class="leaderboard-table"><caption class="sr-only">Rangliste nach Punkten</caption><thead><tr><th scope="col">Rang</th><th scope="col">Spitzname</th><th scope="col">Treffer</th><th scope="col">Punkte</th></tr></thead><tbody>${entries.map(p => `<tr class="${p.id === meId ? 'my-row' : ''}"><td><span class="rank rank-${p.rank}">${String(p.rank).padStart(2, '0')}</span></td><th scope="row">${escape(p.nickname)}${p.id === meId ? '<small>Du</small>' : ''}</th><td>${p.correct}/${p.answered}</td><td>${Number(p.score).toLocaleString('de-CH')}</td></tr>`).join('')}</tbody></table>`;
}
function renderQuestion() {
  return `<section class="quiz-section"><div class="question-top"><div><p class="eyebrow">BEISPIEL ${String(state.index + 1).padStart(2, '0')} / ${String(state.total).padStart(2, '0')} <span class="category">${typeLabel(state.question.type)}</span></p><h1>${escape(state.question.title)}</h1></div>${state.phase === 'question' ? '<div class="timer" role="timer" aria-label="Verbleibende Antwortzeit"><span id="seconds">–</span><small>Sekunden</small></div>' : '<span class="phase-pill">Aufgelöst ✓</span>'}</div><div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div><div class="question-layout"><div>${questionMedia()}${choices()}</div><aside>${state.phase === 'reveal' ? revealBlock() : `<div class="observation-card"><span class="giant-symbol">?</span><h2>Echt gut gemacht.<br>Oder gut generiert?</h2><p>Schau auf Details. Überlege, woher das Beispiel stammen könnte.</p><div class="rule-line"></div><p>Gefragt ist die <strong>Herkunft</strong> – ob der Inhalt stimmt, ist eine eigene Frage.</p><span class="count-pill">${state.answeredCount} von ${state.playerCount} haben abgestimmt</span></div>`}</aside></div>${state.phase === 'reveal' ? `<details class="round-ranking"><summary>Zwischenstand ansehen ↗</summary>${leaderboardTable(state.leaderboard, state.me?.id)}</details>` : ''}</section>`;
}
function renderFinished() {
  const me = state.leaderboard.find(p => p.id === state.me?.id);
  return `<section class="results"><div class="results-title"><p class="eyebrow">SPIELRAUM ${code} / GUT HINGESCHAUT</p><h1>Ein Bild sagt<br><span class="underline">nicht alles.</span></h1><p class="hero-description">${me ? `${me.correct} von ${state.total} erkannt. ${Number(me.score).toLocaleString('de-CH')} Punkte. Rang ${me.rank}.` : 'Die Punkte stehen fest. Die Neugier bleibt.'}</p><div class="takeaway"><span>✳</span><p>KI kann überzeugend gestalten. Eine zuverlässige Einschätzung braucht Herkunft, Kontext und überprüfbare Quellen.</p></div></div><div class="panel"><p class="eyebrow">DIESE GRUPPE</p><h2>Die besten zweiten Blicke.</h2>${leaderboardTable(state.leaderboard, state.me?.id)}</div></section><section class="overall"><div class="section-heading"><h2>Stand-Rangliste</h2><span>Vollständig gespielte Runden mit demselben Fragenset</span></div>${leaderboardTable(state.globalLeaderboard, state.me?.id)}<p class="field-help">Alle mit gleicher Punktzahl teilen sich den Rang. Es gibt keinen Zeitbonus.</p></section>`;
}
function renderState() {
  document.body.classList.toggle('screen-mode', role === 'screen');
  app.innerHTML = hostToolbar() + (state.phase === 'lobby' ? renderLobby() : state.phase === 'finished' ? renderFinished() : renderQuestion());
  document.querySelectorAll('.image-example img').forEach(img => img.addEventListener('error', () => { img.hidden = true; img.nextElementSibling.hidden = false; }));
  if ($('#host-action')) $('#host-action').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (requestPending) return;
    requestPending = true; button.disabled = true;
    try { await emit('host:action', { action: button.dataset.action }); }
    catch (error) { showToast(error.message); button.disabled = false; }
    finally { requestPending = false; }
  });
  document.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', async () => {
    if (requestPending) return;
    requestPending = true;
    const choice = button.dataset.choice;
    document.querySelectorAll('[data-choice]').forEach(b => { b.disabled = true; });
    try { await emit('answer', { questionId: state.question.id, choice }); }
    catch (error) { showToast(error.message); renderState(); }
    finally { requestPending = false; }
  }));
}
function updateClock() {
  if (!state || state.phase !== 'question') return;
  const left = Math.max(0, state.deadline - (Date.now() + serverOffset));
  if ($('#seconds')) $('#seconds').textContent = Math.ceil(left / 1000);
  if ($('#progress-fill')) $('#progress-fill').style.width = `${left / (state.duration * 1000) * 100}%`;
  $('.timer')?.classList.toggle('urgent', left < 6000);
  if (left === 0) document.querySelectorAll('[data-choice]').forEach(b => { b.disabled = true; });
}
async function renderGlobalLeaderboard() {
  try {
    const result = await (await fetch('/api/leaderboard')).json();
    app.innerHTML = `<section class="overall standalone"><p class="eyebrow">DIGIMÄRT ALPNACH / STAND 02</p><h1>Die besten<br><span class="underline">zweiten Blicke.</span></h1><p class="hero-description">Stand-Rangliste · ${result.totalQuestions} Beispiele · 1’000 Punkte pro Treffer</p>${leaderboardTable(result.entries)}<p class="field-help">Nur abgeschlossene Runden, in denen alle Fragen beantwortet wurden. Gleiche Punkte, gleicher Rang.</p><a class="button primary" href="/">Zum Quiz ↗</a></section>`;
  } catch { showToast('Die Rangliste ist gerade nicht erreichbar.'); }
}
async function init() {
  try {
    config = await (await fetch('/api/config')).json();
    if (location.pathname === '/leaderboard') { await renderGlobalLeaderboard(); setInterval(renderGlobalLeaderboard, 10000); }
    else if (role === 'host') renderHostSetup();
    else if (role === 'screen') {
      app.innerHTML = `<section class="standalone panel"><h1>Beamer-Modus</h1><p>Öffne diese Ansicht über «Beamer öffnen» in der Moderation.</p><a href="/host">Zur Moderation ↗</a></section>`;
    } else renderLanding();
    socket.connect();
  } catch { app.innerHTML = '<section class="panel standalone"><h1>Keine Verbindung.</h1><p>Bitte prüfen, ob der Quiz-Server läuft, und die Seite neu laden.</p></section>'; }
}
setInterval(updateClock, 200);
init();
