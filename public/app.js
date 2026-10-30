/* global io */
const app = document.querySelector('#app');
const socket = io({ autoConnect: false });
const params = new URLSearchParams(location.search);
const role = location.pathname === '/host' ? 'host' : location.pathname === '/screen' ? 'screen' : 'player';
let code = params.get('code') || '';
let state, config, toastTimer, memoryCredentials;
let serverOffset = 0;
let requestPending = false;
let boardDuration = 25;
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => Number(value).toLocaleString('de-CH');
const seconds = value => value === null || value === undefined ? '–' : `${(value / 1000).toFixed(1)} s`;
const typeLabel = type => ({ photo: 'Foto', text: 'Text', poster: 'Plakat' }[type]);
const classic = () => state?.scoringVersion === 'classic-v1';
const rules = () => classic() ? '1’000 Punkte pro Treffer (frühere Wertung).' : 'Richtig: 1’000 Punkte + bis zu 500 Tempo- und 400 Serienbonus.';
const getSaved = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const credentials = () => memoryCredentials || getSaved(`quiz-player-${code}`);
const hostToken = () => { try { return sessionStorage.getItem(`quiz-host-${code}`); } catch { return null; } };

function showToast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
function connectionLabel(connected) {
  $('#connection').textContent = connected ? 'Live verbunden' : 'Verbindung unterbrochen';
  $('#connection').classList.toggle('connected', connected);
  document.body.classList.toggle('offline', !connected);
}
function emit(event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Keine Verbindung. Bitte kurz warten.'));
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
    if (role === 'host' && hostToken()) receive((await emit('watch', { room: code, hostToken: hostToken() })).state);
    else if (role === 'screen') receive((await emit('watch', { room: code })).state);
    else if (role === 'player' && credentials()) receive((await emit('join', { room: code, ...credentials() })).state);
  } catch (error) { showToast(error.message); }
});

function renderLanding() {
  app.innerHTML = `<section class="narrow"><h1>Fake oder nicht fake?</h1><p>Mit KI erzeugt oder ohne generative KI entstanden? Schau hin und stimme ab.</p>
    <form id="join-form"><label for="code">Spielcode</label><input id="code" name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" minlength="6" placeholder="6-stelliger Code" value="${escape(code)}" required>
    <label for="nickname">Dein Spitzname</label><input id="nickname" name="nickname" autocomplete="off" maxlength="20" minlength="2" placeholder="Zum Beispiel: Bergfuchs" required>
    <p class="field-help">Der Spitzname erscheint auf der Rangliste. Bitte keinen echten Namen verwenden.</p><button class="button primary" type="submit">Ich rate mit</button><p id="form-error" class="form-error" role="alert"></p></form></section>`;
  $('#join-form').addEventListener('submit', async event => {
    event.preventDefault(); if (requestPending) return;
    requestPending = true; const button = $('#join-form button'); button.disabled = true;
    code = $('#code').value.trim();
    try {
      const result = await emit('join', { room: code, nickname: $('#nickname').value.trim() });
      memoryCredentials = { playerId: result.playerId, playerToken: result.playerToken };
      try { localStorage.setItem(`quiz-player-${code}`, JSON.stringify(memoryCredentials)); } catch { showToast('Bitte diese Seite geöffnet lassen; der Browser speichert deinen Zugang nicht.'); }
      history.replaceState(null, '', `/?code=${code}`); receive(result.state);
    } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; }
    finally { requestPending = false; }
  });
}
function renderHostSetup() {
  app.innerHTML = `<section class="narrow"><h1>Moderation</h1><p>${config.questionCount} aktive Fragen. <a href="/admin">Fragen verwalten</a></p><form id="host-form">
    <label for="host-key">Moderationsschlüssel</label><input id="host-key" type="password" autocomplete="off" required placeholder="Aus dem Server-Terminal">
    <label for="duration">Antwortzeit pro Frage</label><select id="duration">${[15, 20, 25, 30, 45, 60].map(n => `<option value="${n}" ${n === 25 ? 'selected' : ''}>${n} Sekunden</option>`).join('')}</select>
    <label for="join-base">Adresse für die Handys</label><input id="join-base" type="url" list="local-addresses" required value="${escape(config.publicUrl || config.suggestedUrls[0] || location.origin)}"><datalist id="local-addresses">${config.suggestedUrls.map(url => `<option value="${escape(url)}">`).join('')}</datalist>
    <p class="field-help">WLAN-Adresse des Laptops wählen. Handys und Laptop brauchen dasselbe erreichbare Netz.</p><button class="button primary" type="submit">Spielraum erstellen</button><p id="form-error" class="form-error" role="alert"></p></form><p class="field-help">${rules()}<br>Fehlende oder falsche Antworten unterbrechen die Serie.</p></section>`;
  $('#host-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#host-form button'); button.disabled = true;
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostKey: $('#host-key').value, duration: Number($('#duration').value), joinBase: $('#join-base').value }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      code = result.room; sessionStorage.setItem(`quiz-host-${code}`, result.hostToken);
      history.replaceState(null, '', `/host?code=${code}`);
      receive((await emit('watch', { room: code, hostToken: result.hostToken })).state);
    } catch (error) { if ($('#form-error')) $('#form-error').textContent = error.message; button.disabled = false; }
  });
}
function hostToolbar() {
  if (role !== 'host') return '';
  const action = state.phase === 'lobby' ? 'start' : state.phase === 'question' ? 'reveal' : state.phase === 'reveal' ? 'next' : null;
  const label = state.phase === 'lobby' ? 'Quiz starten' : state.phase === 'question' ? 'Jetzt auflösen' : state.index + 1 === state.total ? 'Ergebnis zeigen' : 'Nächste Frage';
  return `<div class="host-toolbar"><span>${state.playerCount} Personen · ${state.answeredCount} Antworten</span><div class="toolbar-buttons"><a href="/screen?code=${code}" target="_blank" rel="noopener">Beamer öffnen</a><a href="/stand.html?join=${encodeURIComponent(state.joinUrl)}" target="_blank" rel="noopener">Standplakat</a>${action ? `<button class="button primary" id="host-action" data-action="${action}" ${state.phase === 'lobby' && !state.playerCount ? 'disabled' : ''}>${label}</button>` : '<a class="button primary" href="/host">Neue Gruppe</a>'}</div></div>`;
}
function renderLobby() {
  const isPlayer = role === 'player';
  return `<section class="lobby"><h1>${isPlayer ? `Hallo, ${escape(state.me?.nickname)}.` : 'Mitmachen'}</h1>${isPlayer ? '<h2>Dein Platz ist reserviert.</h2><p>Die Moderation startet gleich.</p>' : `<div class="qr-block"><img class="qr" src="/api/qr?url=${encodeURIComponent(state.joinUrl)}" alt="QR-Code zum Beitreten"><div><p>Spielcode</p><span class="game-code">${code}</span><p class="join-url">${escape(state.joinUrl)}</p></div></div>`}
    <p>${state.total} Fragen · ${state.duration} Sekunden pro Frage</p><p class="field-help">${rules()}</p><h2>Schon dabei (${state.playerCount})</h2><div class="player-chips">${state.players.map(p => `<span>${escape(p.nickname)}</span>`).join('') || '<p>Noch niemand beigetreten.</p>'}</div></section>`;
}
function questionMedia() {
  const q = state.question;
  if (q.type === 'text') return `<div class="text-example"><p>${escape(q.text)}</p></div>`;
  return `<div class="image-example ${q.type === 'poster' ? 'poster-example' : ''}"><img src="${q.image}" alt="${escape(q.alt)}"><p class="image-error" hidden>Bild nicht geladen. Bitte Verbindung prüfen.</p></div>`;
}
function choices() {
  if (state.phase !== 'question') return '';
  if (role !== 'player') return `<p class="audience-prompt">Auf dem Handy abstimmen · ${state.answeredCount} / ${state.playerCount} Antworten</p>`;
  const answer = state.me?.answer;
  return `<div class="answer-area"><div class="answer-buttons"><button class="answer-button ${answer?.choice === 'human' ? 'selected' : ''}" data-choice="human" ${answer ? 'disabled' : ''}>Ohne generative KI ${answer?.choice === 'human' ? '✓' : ''}</button><button class="answer-button ${answer?.choice === 'ai' ? 'selected' : ''}" data-choice="ai" ${answer ? 'disabled' : ''}>Mit KI erzeugt ${answer?.choice === 'ai' ? '✓' : ''}</button></div><p class="field-help">${answer ? 'Deine Antwort ist gespeichert' : 'Eine Antwort pro Frage. Schnell und richtig gibt mehr Punkte.'}</p></div>`;
}
function revealBlock() {
  const r = state.reveal, a = state.me?.answer;
  if (!r || state.phase !== 'reveal') return '';
  return `<section class="reveal-block"><h2>${r.answer === 'ai' ? 'Mit KI erzeugt.' : 'Ohne generative KI.'}</h2>${role === 'player' ? `<p class="result-pill">${a ? a.points ? `+ ${number(a.points)} Punkte` : 'Diesmal kein Treffer' : 'Nicht abgestimmt'}</p>${a ? `<p class="score-breakdown">${number(a.base)} Basis + ${a.speed} Tempo + ${a.series} Serie · Antwort nach ${seconds(a.elapsedMs)}${a.streak ? ` · ${a.streak} richtig in Folge` : ''}</p>` : ''}` : ''}<p>${escape(r.explanation)}</p><p class="takeaway">${escape(r.takeaway)}</p><p class="vote-summary">Gruppe: ${r.votes.find(v => v.choice === 'human')?.n || 0} ohne KI · ${r.votes.find(v => v.choice === 'ai')?.n || 0} mit KI</p><p class="source-credit">${escape(r.credit)} · ${escape(r.license)}<br><a href="${escape(r.source)}" target="_blank" rel="noopener noreferrer">Herkunft nachprüfen</a></p></section>`;
}
function leaderboardTable(entries, meId) {
  if (!entries.length) return '<p class="empty-state">Noch keine vollständigen Ergebnisse.</p>';
  return `<table class="leaderboard-table"><caption class="sr-only">Rangliste nach Punkten</caption><thead><tr><th>Rang</th><th>Spitzname</th><th>Punkte</th></tr></thead><tbody>${entries.map(p => `<tr class="${p.id === meId ? 'my-row' : ''}"><td>${p.rank}${p.movement ? `<small class="movement">${p.movement > 0 ? '↑' : '↓'}${Math.abs(p.movement)}</small>` : ''}</td><th scope="row">${escape(p.nickname)}${p.id === meId ? ' (du)' : ''}<small>${p.correct}/${state?.total || p.answered} richtig · Ø ${seconds(p.avgMs)} · Serie ${p.bestStreak}</small></th><td>${number(p.score)}</td></tr>`).join('')}</tbody></table>`;
}
function renderQuestion() {
  return `<section class="quiz-section"><div class="question-top"><div><p class="eyebrow">Frage ${state.index + 1} / ${state.total} · ${typeLabel(state.question.type)}</p><h1>${escape(state.question.title)}</h1></div>${state.phase === 'question' ? '<div class="timer" role="timer" aria-label="Verbleibende Antwortzeit"><span id="seconds">–</span><small>Sek.</small></div>' : '<span class="phase-pill">Auflösung</span>'}</div><div class="progress-track"><div id="progress-fill"></div></div>${questionMedia()}${choices()}${revealBlock()}${state.phase === 'reveal' ? `<section class="round-ranking"><h2>Zwischenstand</h2>${leaderboardTable(state.leaderboard, state.me?.id)}</section>` : ''}</section>`;
}
function renderFinished() {
  const me = state.leaderboard.find(p => p.id === state.me?.id);
  return `<section class="results"><h1>Ergebnis</h1>${me ? `<p class="personal-result">${me.correct} von ${state.total} erkannt. ${number(me.score)} Punkte. Rang ${me.rank}.</p>` : ''}<h2>Diese Gruppe</h2>${leaderboardTable(state.leaderboard, state.me?.id)}<section class="overall"><h2>Stand-Rangliste</h2><p class="field-help">Dasselbe Fragenset und ${state.duration} Sekunden Antwortzeit pro Frage.</p>${leaderboardTable(state.globalLeaderboard, state.me?.id)}</section><p class="field-help">Reihenfolge: Punkte, Treffer, dann durchschnittliche Zeit richtiger Antworten. «Serie» zeigt die längste Trefferfolge. Gleiche Werte teilen sich den Rang.</p></section>`;
}
function renderState() {
  document.body.classList.toggle('screen-mode', role === 'screen');
  app.innerHTML = hostToolbar() + (state.phase === 'lobby' ? renderLobby() : state.phase === 'finished' ? renderFinished() : renderQuestion());
  document.querySelectorAll('.image-example img').forEach(img => img.addEventListener('error', () => { img.hidden = true; img.nextElementSibling.hidden = false; }));
  $('#host-action')?.addEventListener('click', async event => {
    if (requestPending) return;
    requestPending = true; const button = event.currentTarget; button.disabled = true;
    try { await emit('host:action', { action: button.dataset.action }); }
    catch (error) { showToast(error.message); button.disabled = false; }
    finally { requestPending = false; }
  });
  document.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', async () => {
    if (requestPending) return;
    requestPending = true;
    document.querySelectorAll('[data-choice]').forEach(b => { b.disabled = true; });
    try { await emit('answer', { questionId: state.question.id, choice: button.dataset.choice }); }
    catch (error) { showToast(error.message); renderState(); }
    finally { requestPending = false; }
  }));
}
function updateClock() {
  if (state?.phase !== 'question') return;
  const left = Math.max(0, state.deadline - (Date.now() + serverOffset));
  if ($('#seconds')) $('#seconds').textContent = Math.ceil(left / 1000);
  if ($('#progress-fill')) $('#progress-fill').style.width = `${left / (state.duration * 1000) * 100}%`;
  $('.timer')?.classList.toggle('urgent', left < 6000);
  if (!left) document.querySelectorAll('[data-choice]').forEach(b => { b.disabled = true; });
}
async function renderGlobalLeaderboard() {
  try {
    const response = await fetch(`/api/leaderboard?duration=${boardDuration}`), result = await response.json();
    if (!response.ok) throw new Error(result.error);
    app.innerHTML = `<section class="results"><h1>Stand-Rangliste</h1><label for="board-duration">Antwortzeit pro Frage</label><select id="board-duration">${[15, 20, 25, 30, 45, 60].map(n => `<option value="${n}" ${n === boardDuration ? 'selected' : ''}>${n} Sekunden</option>`).join('')}</select><p class="field-help">${result.totalQuestions} aktive Fragen. Nur vollständige Runden mit demselben Fragenset, derselben Antwortzeit und Wertung.</p>${leaderboardTable(result.entries)}<p class="field-help">Ø = Zeit richtiger Antworten · Serie = längste Trefferfolge</p><a href="/">Zum Quiz</a></section>`;
    $('#board-duration').addEventListener('change', event => { boardDuration = Number(event.target.value); renderGlobalLeaderboard(); });
  } catch (error) { showToast(error.message); }
}
async function init() {
  try {
    config = await (await fetch('/api/config')).json();
    if (location.pathname === '/leaderboard') { await renderGlobalLeaderboard(); setInterval(renderGlobalLeaderboard, 10000); }
    else if (role === 'host') renderHostSetup();
    else if (role === 'screen') app.innerHTML = '<section class="narrow"><h1>Beamer</h1><p>Diese Ansicht über «Beamer öffnen» in der Moderation starten.</p></section>';
    else renderLanding();
    socket.connect();
  } catch { app.innerHTML = '<section class="narrow"><h1>Keine Verbindung</h1><p>Bitte prüfen, ob der Quiz-Server läuft, und die Seite neu laden.</p></section>'; }
}
setInterval(updateClock, 200);
init();
