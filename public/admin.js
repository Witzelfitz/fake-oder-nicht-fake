const app = document.querySelector('#admin-app');
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeName = type => ({ photo: 'Foto', text: 'Text', poster: 'Plakat' }[type]);
let key = '', questions = [], editing = null, currentAsset = '', previewUrl = null, busy = false, toastTimer;
let dirty = false;
const canLeave = () => !dirty || window.confirm('Ungespeicherte Änderungen verwerfen?');
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try { key = sessionStorage.getItem('quiz-admin-key') || ''; } catch { /* login remains available */ }

function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
async function request(url, options = {}) {
  const headers = { Authorization: `Bearer ${key}`, ...options.headers };
  if (options.body && !(options.body instanceof File)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let message = 'Die Anfrage konnte nicht ausgeführt werden.';
    try { message = (await response.json()).error || message; } catch { /* generic error */ }
    if (response.status === 401) { key = ''; try { sessionStorage.removeItem('quiz-admin-key'); } catch { /* no storage */ } }
    throw new Error(message);
  }
  return response;
}
async function refresh() {
  const result = await (await request('/api/admin/questions')).json();
  questions = result.questions;
}
function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
function login(message = '') {
  releasePreview(); dirty = false; editing = null; currentAsset = '';
  app.innerHTML = `<section class="narrow"><h1>Fragen verwalten</h1><p>Mit demselben Schlüssel wie die Moderation anmelden.</p><form id="login"><label for="admin-key">Moderationsschlüssel</label><input id="admin-key" type="password" autocomplete="off" required><button class="button primary" type="submit">Anmelden</button><p class="form-error" id="login-error" role="alert">${esc(message)}</p></form></section>`;
  $('#login').addEventListener('submit', async event => {
    event.preventDefault(); $('#login button').disabled = true; key = $('#admin-key').value;
    try {
      await refresh();
      try { sessionStorage.setItem('quiz-admin-key', key); } catch { /* in-memory authentication still works */ }
      render();
    } catch (error) { $('#login-error').textContent = error.message; $('#login button').disabled = false; }
  });
}
function listHtml() {
  return questions.map((q, index) => `<li class="q-item ${editing?.id === q.id ? 'editing' : ''}"><button class="question-select" data-edit="${q.id}"><span>${esc(q.title)}</span><small>${typeName(q.type)} · ${q.enabled ? 'aktiv' : 'inaktiv'}</small></button><div class="order-controls"><button type="button" data-move="${q.id}" data-direction="-1" aria-label="Nach oben: ${esc(q.title)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move="${q.id}" data-direction="1" aria-label="Nach unten: ${esc(q.title)}" ${index === questions.length - 1 ? 'disabled' : ''}>↓</button></div></li>`).join('') || '<li class="empty-state">Noch keine Fragen. Rechts die erste erstellen.</li>';
}
function editorHtml() {
  const q = editing || { type: 'photo', enabled: true };
  return `<form id="question-form"><h2>${editing ? 'Frage bearbeiten' : 'Neue Frage'}</h2>
    <div class="form-row"><div><label for="q-type">Format</label><select id="q-type">${['photo', 'text', 'poster'].map(type => `<option value="${type}" ${q.type === type ? 'selected' : ''}>${typeName(type)}</option>`).join('')}</select></div><div><label for="q-answer">Richtige Herkunft</label><select id="q-answer" required><option value="">Bitte wählen</option><option value="human" ${q.answer === 'human' ? 'selected' : ''}>Ohne generative KI</option><option value="ai" ${q.answer === 'ai' ? 'selected' : ''}>Mit KI erzeugt</option></select></div></div>
    <label for="q-title">Fragetitel</label><input id="q-title" maxlength="160" value="${esc(q.title)}" required placeholder="Zum Beispiel: Echt aufgenommen?">
    <div id="image-field"><label for="q-file">Bild hochladen</label><input id="q-file" type="file" accept="image/jpeg,image/png,image/webp"><p class="field-help">PNG, JPEG oder WebP · maximal 12 MB. Ein bestehendes Bild bleibt erhalten, solange du kein neues wählst.</p><img class="admin-preview" id="image-preview" alt="Bildvorschau der Frage" hidden></div>
    <div id="text-field"><label for="q-text">Quiztext</label><textarea id="q-text" rows="7" maxlength="10000">${esc(q.text)}</textarea></div>
    <label for="q-explanation">Auflösung / Erklärung</label><textarea id="q-explanation" rows="3" maxlength="4000" required placeholder="Was ist die Herkunft? Was soll die Gruppe daraus lernen?">${esc(q.explanation)}</textarea>
    <label for="q-takeaway">Merksatz (optional)</label><input id="q-takeaway" maxlength="1500" value="${esc(q.takeaway)}">
    <details class="source-fields"><summary>Quelle und Nutzungsangaben</summary><label for="q-source">Quellenlink (HTTPS, optional)</label><input id="q-source" maxlength="1500" value="${esc(q.source)}" placeholder="https://…"><label for="q-credit">Urheber / Herkunft</label><input id="q-credit" maxlength="1000" value="${esc(q.credit)}"><label for="q-license">Lizenz / Nutzungsangabe</label><input id="q-license" maxlength="1000" value="${esc(q.license)}"></details>
    <label class="checkbox-label"><input id="q-enabled" type="checkbox" ${q.enabled ? 'checked' : ''}> In neuen Runden verwenden</label>
    <div class="editor-actions"><button class="button primary" type="submit">Frage speichern</button>${editing ? '<button class="button danger" id="delete-question" type="button">Löschen</button>' : ''}</div><p id="editor-error" class="form-error" role="alert"></p><div id="delete-confirm" class="delete-confirm" hidden><p>Diese Frage aus der Bibliothek löschen? Laufende Runden und ihre Bilder bleiben erhalten.</p><button id="confirm-delete" class="button danger" type="button">Frage endgültig löschen</button><button id="cancel-delete" class="button" type="button">Abbrechen</button></div>
  </form>`;
}
function render() {
  releasePreview(); currentAsset = editing?.asset || ''; dirty = false;
  app.innerHTML = `<section class="admin-header"><div><h1>Fragen</h1><p>${questions.filter(q => q.enabled).length} aktiv · ${questions.length} insgesamt. Änderungen gelten für neue Runden.</p></div><div class="toolbar-buttons"><a href="/host">Zur Moderation</a><button id="logout" class="button" type="button">Abmelden</button></div></section><div class="admin-layout"><aside class="question-list"><button class="button primary" id="new-question">Neue Frage</button><ol>${listHtml()}</ol></aside><section class="question-editor">${editorHtml()}</section></div>`;
  $('#logout').addEventListener('click', () => { if (busy || !canLeave()) return; key = ''; try { sessionStorage.removeItem('quiz-admin-key'); } catch { /* no storage */ } login(); });
  $('#new-question').addEventListener('click', () => { if (busy || !canLeave()) return; editing = null; render(); $('#q-title').focus(); });
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => { if (busy || !canLeave()) return; editing = questions.find(q => q.id === button.dataset.edit); render(); }));
  document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', async () => {
    if (busy || !canLeave()) return;
    busy = true;
    try {
      const ids = questions.map(q => q.id), index = ids.indexOf(button.dataset.move), target = index + Number(button.dataset.direction);
      [ids[index], ids[target]] = [ids[target], ids[index]];
      await request('/api/admin/order', { method: 'POST', body: JSON.stringify({ ids }) });
      await refresh(); render();
    } catch (error) { notify(error.message); }
    finally { busy = false; }
  }));
  function toggleType() {
    const isText = $('#q-type').value === 'text';
    $('#text-field').hidden = !isText; $('#image-field').hidden = isText; $('#q-text').required = isText;
  }
  $('#q-type').addEventListener('change', toggleType); toggleType();
  $('#q-file').addEventListener('change', () => {
    releasePreview(); const file = $('#q-file').files[0];
    if (file) { previewUrl = URL.createObjectURL(file); $('#image-preview').src = previewUrl; $('#image-preview').hidden = false; }
  });
  if (editing && currentAsset) {
    const id = editing.id;
    request(`/api/admin/questions/${id}/media`).then(r => r.blob()).then(blob => {
      if (editing?.id !== id || !$('#image-preview') || $('#q-file')?.files.length) return;
      previewUrl = URL.createObjectURL(blob); $('#image-preview').src = previewUrl; $('#image-preview').hidden = false;
    }).catch(error => notify(error.message));
  }
  $('#question-form').addEventListener('submit', saveQuestion);
  $('#question-form').addEventListener('input', () => { dirty = true; });
  $('#question-form').addEventListener('change', () => { dirty = true; });
  $('#delete-question')?.addEventListener('click', () => { $('#delete-confirm').hidden = false; });
  $('#cancel-delete')?.addEventListener('click', () => { $('#delete-confirm').hidden = true; });
  $('#confirm-delete')?.addEventListener('click', async () => {
    if (busy) return; busy = true; $('#confirm-delete').disabled = true;
    try {
      await request(`/api/admin/questions/${editing.id}`, { method: 'DELETE', body: JSON.stringify({ version: editing.version }) });
      editing = null; await refresh(); render(); notify('Frage gelöscht.');
    } catch (error) { $('#editor-error').textContent = error.message; $('#confirm-delete').disabled = false; }
    finally { busy = false; }
  });
}
async function saveQuestion(event) {
  event.preventDefault(); if (busy) return; busy = true;
  const button = $('#question-form button[type="submit"]'); button.disabled = true; $('#editor-error').textContent = '';
  try {
    const type = $('#q-type').value, file = $('#q-file').files[0];
    if (type !== 'text' && file) {
      if (file.size > 12 * 1024 * 1024) throw new Error('Das Bild ist grösser als 12 MB.');
      const uploaded = await (await request('/api/admin/media', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })).json();
      currentAsset = uploaded.asset;
    }
    if (type !== 'text' && !currentAsset) throw new Error('Bitte ein Bild hochladen.');
    const body = { type, title: $('#q-title').value, answer: $('#q-answer').value, text: $('#q-text').value,
      asset: currentAsset, explanation: $('#q-explanation').value, takeaway: $('#q-takeaway').value,
      source: $('#q-source').value, credit: $('#q-credit').value, license: $('#q-license').value,
      enabled: $('#q-enabled').checked, ...(editing ? { version: editing.version } : {}) };
    const result = await (await request(`/api/admin/questions${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) })).json();
    editing = result; dirty = false; await refresh(); render(); notify('Frage gespeichert. Neue Runden verwenden den aktuellen Stand.');
  } catch (error) { $('#editor-error').textContent = error.message; button.disabled = false; }
  finally { busy = false; }
}
if (key) refresh().then(render).catch(error => login(error.message)); else login();
