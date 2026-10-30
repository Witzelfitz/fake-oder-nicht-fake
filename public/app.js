/* global io */
const app = document.querySelector('#app');
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const socket = io({ autoConnect: false });
const role = location.pathname === '/host' ? 'host' : location.pathname === '/screen' ? 'screen' : 'player';
let code = new URLSearchParams(location.search).get('code') || '';
let state, config, renderedKey, memoryCredentials, toastTimer;
let pending = false, serverOffset = 0;
const saved = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const credentials = () => memoryCredentials || saved(`quiz-player-${code}`);
const hostToken = () => { try { return sessionStorage.getItem(`quiz-host-${code}`); } catch { return null; } };
const originLabel = answer => answer === 'ai' ? 'KI-generiert' : 'Echt aufgenommen';

function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
function emit(event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Keine Verbindung. Bitte kurz warten.'));
    socket.timeout(10000).emit(event, payload, (error, response) => {
      if (error) reject(new Error('Bitte nochmals versuchen.'));
      else if (!response?.ok) reject(new Error(response?.error || 'Das hat nicht geklappt.'));
      else resolve(response);
    });
  });
}
function connection(connected) {
  $('#connection').textContent = connected ? 'Live verbunden' : 'Verbindung unterbrochen';
  $('#connection').classList.toggle('connected', connected);
}
function receive(next) {
  if (next.mode !== 'simple-v1') {
    code = ''; state = null; renderedKey = null;
    history.replaceState(null, '', role === 'host' ? '/host' : role === 'screen' ? '/screen' : '/');
    if (role === 'host') setup();
    else if (role === 'player') landing();
    else app.innerHTML = '<section class="narrow"><h1>Neue Runde, neuer Code.</h1><p>Den Beamer aus der neuen Moderation öffnen.</p></section>';
    notify('Das neue Medienquiz ist bereit. Bitte eine neue Gruppe starten.');
    return;
  }
  state = next; code = next.room; serverOffset = next.serverTime - Date.now(); render(); updateClock();
}
socket.on('state', receive);
socket.on('disconnect', () => connection(false));
socket.on('connect_error', () => connection(false));
socket.on('connect', async () => {
  connection(true);
  if (!code) return;
  try {
    if (role === 'host' && hostToken()) receive((await emit('watch', { room: code, hostToken: hostToken() })).state);
    else if (role === 'screen') receive((await emit('watch', { room: code })).state);
    else if (role === 'player' && credentials()) receive((await emit('join', { room: code, ...credentials() })).state);
  } catch (error) { notify(error.message); }
});

function landing() {
  app.innerHTML = `<section class="narrow entry"><p class="eyebrow">${config.questionCount} RUNDEN · ETWA 10 MINUTEN</p><h1>Echt oder KI?<br>Was meinst du?</h1><p>Bilder, kurze Clips und dein Bauchgefühl.</p>
    <form id="join-form"><label for="code">Spielcode</label><input id="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" minlength="6" placeholder="6-stelliger Code" value="${esc(code)}" required>
    <label for="nickname">Dein Spitzname</label><input id="nickname" autocomplete="off" maxlength="20" minlength="2" placeholder="Zum Beispiel: Bergfuchs" required>
    <button class="button primary" type="submit">Ich rate mit</button><p id="form-error" class="form-error" role="alert"></p></form></section>`;
  $('#join-form').addEventListener('submit', async event => {
    event.preventDefault(); if (pending) return; pending = true;
    const button = $('#join-form button'); button.disabled = true; code = $('#code').value.trim();
    try {
      const result = await emit('join', { room: code, nickname: $('#nickname').value.trim() });
      memoryCredentials = { playerId: result.playerId, playerToken: result.playerToken };
      try { localStorage.setItem(`quiz-player-${code}`, JSON.stringify(memoryCredentials)); } catch { /* This tab retains the credentials. */ }
      history.replaceState(null, '', `/?code=${code}`); receive(result.state);
    } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; }
    finally { pending = false; }
  });
}
function setup() {
  app.innerHTML = `<section class="narrow entry"><p class="eyebrow">GEMEINSAM RATEN</p><h1>Eine Runde starten.</h1><p>${config.questionCount} Bilder und Clips. Erst tippen, dann auflösen und kurz darüber reden.</p>
    <form id="host-form"><label for="host-key">Moderationsschlüssel</label><input id="host-key" type="password" autocomplete="off" required>
    <button class="button primary" type="submit">Spielraum erstellen</button><p id="form-error" class="form-error" role="alert"></p></form>
    <p class="field-help">25 Sekunden zum Tippen. Fürs Gespräch bestimmst du das Tempo.</p></section>`;
  $('#host-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#host-form button'); button.disabled = true;
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostKey: $('#host-key').value, duration: 25, mode: 'simple-v1', joinBase: config.publicUrl || location.origin }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      code = result.room; sessionStorage.setItem(`quiz-host-${code}`, result.hostToken);
      history.replaceState(null, '', `/host?code=${code}`);
      receive((await emit('watch', { room: code, hostToken: result.hostToken })).state);
    } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; }
  });
}
function toolbar() {
  if (role !== 'host') return '';
  const action = ({ lobby: 'start', question: 'reveal', reveal: 'next' })[state.phase];
  const label = state.phase === 'lobby' ? 'Quiz starten' : state.phase === 'question' ? 'Auflösen' : state.index + 1 === state.total ? 'Ergebnis zeigen' : 'Nächste Runde';
  return `<div class="host-toolbar"><span data-live-count aria-live="polite">${state.playerCount} Personen · ${state.answeredCount} Antworten</span><div class="toolbar-buttons"><a href="/screen?code=${code}" target="_blank" rel="noopener">Beamer öffnen ↗</a>${action ? `<button class="button primary" id="host-action" data-action="${action}" ${state.phase === 'lobby' && !state.playerCount ? 'disabled' : ''}>${label}</button>` : '<a class="button primary" href="/host">Neue Gruppe</a>'}</div></div>`;
}
function lobby() {
  const player = role === 'player';
  return `<section class="lobby"><p class="eyebrow">${state.total} RUNDEN · ETWA 10 MINUTEN</p><h1>${player ? `Hallo, ${esc(state.me?.nickname)}.` : 'Handy raus. Mitraten.'}</h1>${player ? '<h2>Dein Platz ist reserviert.</h2><p>Gleich gehts los.</p>' : `<div class="qr-block"><img class="qr" src="/api/qr?url=${encodeURIComponent(state.joinUrl)}" alt="QR-Code zum Beitreten"><div><p>Spielcode</p><span class="game-code">${code}</span><p class="join-url">${esc(state.joinUrl)}</p></div></div>`}
    <p>Echt aufgenommen oder mit KI gemacht?</p><h2 data-player-heading>Schon dabei (${state.playerCount})</h2><div class="player-chips">${state.players.map(p => `<span>${esc(p.nickname)}</span>`).join('')}</div></section>`;
}
function media() {
  const q = state.question;
  const content = q.type === 'video'
    ? `<video src="${q.video}" autoplay muted loop playsinline controls preload="auto" aria-label="Quizvideo"></video>`
    : `<img src="${q.image}" alt="Quizbild – echt aufgenommen oder KI-generiert?">`;
  return `<div class="quiz-media">${content}<p class="media-error" hidden>Das Medium lädt nicht. Bitte nochmals laden.</p></div>`;
}
function choices() {
  if (state.phase !== 'question') return '';
  if (role !== 'player') return '<p class="audience-prompt" data-vote-count></p>';
  return `<div class="answer-area"><div class="answer-buttons"><button class="answer-button" data-choice="human">Echt</button><button class="answer-button" data-choice="ai">KI</button></div><p class="field-help" id="answer-status" aria-live="polite"></p></div>`;
}
function reveal() {
  if (state.phase !== 'reveal') return '';
  const r = state.reveal, answer = state.me?.answer;
  const votes = choice => r.votes.find(v => v.choice === choice)?.n || 0;
  return `<section class="simple-reveal"><div><p class="eyebrow">DIE AUFLÖSUNG</p><h2 class="reveal-answer">${originLabel(r.answer)}.</h2>${role === 'player' ? `<p class="verdict">${!answer ? 'Diesmal nicht abgestimmt.' : answer.choice === r.answer ? 'Richtig getippt!' : 'Überraschung! Diesmal daneben.'}</p>` : ''}</div>
    <p class="group-votes">${votes('human')} tippten auf Echt · ${votes('ai')} auf KI</p><p class="talk-prompt">Was hat euch überzeugt – und was hat euch getäuscht?</p></section>`;
}
function question() {
  return `<section class="quiz-section ${state.phase === 'reveal' ? 'is-reveal' : ''}"><div class="question-top"><div><p class="eyebrow">RUNDE ${state.index + 1} / ${state.total} · ${state.question.type === 'video' ? 'VIDEO' : 'BILD'}</p><h1>Echt oder KI?</h1></div>${state.phase === 'question' ? '<div class="timer" role="timer" aria-label="Verbleibende Antwortzeit"><span id="seconds">–</span><small>Sek.</small></div>' : ''}</div>${media()}${choices()}${reveal()}</section>`;
}
function finished() {
  const me = state.leaderboard.find(p => p.id === state.me?.id);
  return `<section class="results"><p class="eyebrow">DAS WARS!</p><h1>Und? Überrascht?</h1>${me ? `<p class="personal-result">${me.correct} von ${state.total} richtig.</p>` : ''}<p class="talk-prompt">Bei welchem Bild oder Clip wart ihr euch ganz sicher – und lagt daneben?</p>
    <h2>Eure Treffer</h2><table class="leaderboard-table"><thead><tr><th>Spitzname</th><th>Richtig</th></tr></thead><tbody>${state.leaderboard.map(p => `<tr class="${p.id === me?.id ? 'my-row' : ''}"><th scope="row">${esc(p.nickname)}</th><td>${p.correct} / ${state.total}</td></tr>`).join('')}</tbody></table></section>`;
}
function patch() {
  const count = $('[data-live-count]'); if (count) count.textContent = `${state.playerCount} Personen · ${state.answeredCount} Antworten`;
  const vote = $('[data-vote-count]'); if (vote) vote.textContent = `Auf dem Handy tippen · ${state.answeredCount} / ${state.playerCount} Antworten`;
  if (state.phase === 'lobby') {
    if ($('.player-chips')) $('.player-chips').innerHTML = state.players.map(p => `<span>${esc(p.nickname)}</span>`).join('');
    if ($('[data-player-heading]')) $('[data-player-heading]').textContent = `Schon dabei (${state.playerCount})`;
    if ($('#host-action')) $('#host-action').disabled = !state.playerCount;
  }
  document.querySelectorAll('[data-choice]').forEach(button => {
    button.disabled = !!state.me?.answer;
    button.classList.toggle('selected', button.dataset.choice === state.me?.answer?.choice);
  });
  if ($('#answer-status')) $('#answer-status').textContent = state.me?.answer ? 'Deine Antwort ist gespeichert.' : 'Was sagt dein Bauchgefühl?';
}
function render() {
  document.body.classList.toggle('screen-mode', role === 'screen');
  const key = `${state.room}:${state.phase}:${state.index}:${state.me?.id || role}`;
  if (key === renderedKey) { patch(); return; }
  renderedKey = key;
  app.innerHTML = toolbar() + (state.phase === 'lobby' ? lobby() : state.phase === 'finished' ? finished() : question());
  patch();
  document.querySelectorAll('.quiz-media img,.quiz-media video').forEach(el => el.addEventListener('error', () => { $('.media-error').hidden = false; }));
  const video = $('.quiz-media video'); if (video) video.play().catch(() => { /* Native play controls remain available. */ });
  $('#host-action')?.addEventListener('click', async event => {
    if (pending) return; pending = true; const button = event.currentTarget; button.disabled = true;
    try { await emit('host:action', { action: button.dataset.action }); }
    catch (error) { notify(error.message); button.disabled = false; }
    finally { pending = false; }
  });
  document.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', async () => {
    if (pending) return; pending = true;
    document.querySelectorAll('[data-choice]').forEach(b => { b.disabled = true; });
    try { await emit('answer', { questionId: state.question.id, choice: button.dataset.choice }); }
    catch (error) { notify(error.message); patch(); }
    finally { pending = false; }
  }));
}
function updateClock() {
  if (state?.phase !== 'question') return;
  const left = Math.max(0, state.deadline - Date.now() - serverOffset);
  if ($('#seconds')) $('#seconds').textContent = Math.ceil(left / 1000);
  if (!left) document.querySelectorAll('[data-choice]').forEach(button => { button.disabled = true; });
}
async function init() {
  try {
    config = await (await fetch('/api/config')).json();
    if (role === 'host') setup();
    else if (role === 'screen') app.innerHTML = '<section class="narrow"><h1>Beamer</h1><p>In der Moderation «Beamer öffnen» wählen.</p></section>';
    else landing();
    socket.connect();
  } catch { app.innerHTML = '<section class="narrow"><h1>Keine Verbindung</h1><p>Bitte die Seite nochmals laden.</p></section>'; }
}
setInterval(updateClock, 200);
init();
