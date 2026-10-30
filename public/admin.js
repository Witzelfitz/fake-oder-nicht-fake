const app = document.querySelector('#admin-app');
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let key = '', questions = [], editing = null, asset = '', previewUrl, busy = false, dirty = false;
try { key = sessionStorage.getItem('quiz-admin-key') || ''; } catch { /* Use this tab's memory. */ }
const canLeave = () => !dirty || window.confirm('Ungespeicherte Änderungen verwerfen?');
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
async function request(url, options = {}) {
  const headers = { Authorization: `Bearer ${key}`, ...options.headers };
  if (options.body && !(options.body instanceof File)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let message = 'Bitte nochmals versuchen.';
    try { message = (await response.json()).error || message; } catch { /* Keep the generic error. */ }
    throw new Error(message);
  }
  return response;
}
async function refresh() { questions = (await (await request('/api/admin/questions')).json()).questions; }
function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
function login(message = '') {
  releasePreview(); dirty = false;
  app.innerHTML = `<section class="narrow"><h1>Medien verwalten</h1><form id="login"><label for="admin-key">Moderationsschlüssel</label><input id="admin-key" type="password" required autocomplete="off"><button class="button primary" type="submit">Anmelden</button><p id="login-error" class="form-error" role="alert">${esc(message)}</p></form></section>`;
  $('#login').addEventListener('submit', async event => {
    event.preventDefault(); $('#login button').disabled = true; key = $('#admin-key').value;
    try { await refresh(); sessionStorage.setItem('quiz-admin-key', key); render(); }
    catch (error) { $('#login-error').textContent = error.message; $('#login button').disabled = false; }
  });
}
function preview(blob, type) {
  releasePreview(); previewUrl = URL.createObjectURL(blob);
  $('#preview').innerHTML = type === 'video' ? '<video class="admin-preview" controls muted playsinline></video>' : '<img class="admin-preview" alt="Medienvorschau">';
  $('#preview').firstChild.src = previewUrl;
}
function render() {
  releasePreview(); dirty = false; asset = editing?.asset || '';
  const q = editing || { type: 'photo', answer: 'human', enabled: true };
  app.innerHTML = `<section class="admin-header"><div><h1>Medien</h1><p>${questions.filter(q => q.enabled).length} aktive Runden.</p></div><div class="toolbar-buttons"><a href="/host">Zur Moderation</a><button class="button" id="logout">Abmelden</button></div></section>
    <div class="admin-layout"><aside class="question-list"><button class="button primary" id="new-question">Neues Medium</button><ol>${questions.map((q, i) => `<li class="q-item ${q.id === editing?.id ? 'editing' : ''}"><button class="question-select" data-edit="${q.id}"><span>${esc(q.title)}</span><small>${q.type === 'video' ? 'Video' : 'Bild'} · ${q.enabled ? 'aktiv' : 'inaktiv'}</small></button><div class="order-controls"><button data-move="${q.id}" data-direction="-1" aria-label="Nach oben: ${esc(q.title)}" ${!i ? 'disabled' : ''}>↑</button><button data-move="${q.id}" data-direction="1" aria-label="Nach unten: ${esc(q.title)}" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button></div></li>`).join('')}</ol></aside>
    <section class="question-editor"><form id="question-form"><h2>${editing ? 'Medium bearbeiten' : 'Neues Medium'}</h2>
      <label for="q-title">Name für die Verwaltung</label><input id="q-title" maxlength="160" value="${esc(q.title)}" required placeholder="Zum Beispiel: Porträt im Park">
      <div class="form-row"><div><label for="q-type">Format</label><select id="q-type"><option value="photo" ${q.type !== 'video' ? 'selected' : ''}>Bild</option><option value="video" ${q.type === 'video' ? 'selected' : ''}>Video</option></select></div><div><label for="q-answer">Richtige Antwort</label><select id="q-answer"><option value="human" ${q.answer === 'human' ? 'selected' : ''}>Echt aufgenommen</option><option value="ai" ${q.answer === 'ai' ? 'selected' : ''}>KI-generiert</option></select></div></div>
      <label for="q-file">Bild oder Video hochladen</label><input id="q-file" type="file" accept="image/jpeg,image/png,image/webp,video/mp4"><p class="field-help">Bilder: JPG, PNG, WebP. Kurze Videos: MP4. Maximal 20 MB.</p><div id="preview"></div>
      <details><summary>Mediennachweis (optional)</summary><label for="q-source">Originaladresse</label><input id="q-source" type="url" value="${q.source?.startsWith('https:') ? esc(q.source) : ''}"><label for="q-credit">Urheber oder Generator</label><input id="q-credit" maxlength="1000" value="${esc(q.credit)}"><label for="q-license">Nutzungsangabe</label><input id="q-license" maxlength="1000" value="${esc(q.license)}"></details>
      <label class="checkbox-label"><input id="q-enabled" type="checkbox" ${q.enabled ? 'checked' : ''}> In neuen Runden verwenden</label>
      <div class="editor-actions"><button class="button primary" type="submit">Medium speichern</button>${editing ? '<button class="button danger" type="button" id="delete-question">Entfernen</button>' : ''}</div><p id="editor-error" class="form-error" role="alert"></p>
      <div id="delete-confirm" hidden><p>Dieses Medium aus dem Quiz entfernen?</p><button class="button danger" type="button" id="confirm-delete">Medium entfernen</button><button class="button" type="button" id="cancel-delete">Abbrechen</button></div></form></section></div>`;
  $('#logout').addEventListener('click', () => { if (!canLeave()) return; key = ''; sessionStorage.removeItem('quiz-admin-key'); login(); });
  $('#new-question').addEventListener('click', () => { if (busy || !canLeave()) return; editing = null; render(); });
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => { if (busy || !canLeave()) return; editing = questions.find(q => q.id === button.dataset.edit); render(); }));
  document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', async () => {
    if (busy || !canLeave()) return; busy = true;
    try {
      const ids = questions.map(q => q.id), index = ids.indexOf(button.dataset.move), target = index + Number(button.dataset.direction);
      [ids[index], ids[target]] = [ids[target], ids[index]];
      await request('/api/admin/order', { method: 'POST', body: JSON.stringify({ ids }) }); await refresh(); render();
    } catch (error) { $('#editor-error').textContent = error.message; } finally { busy = false; }
  }));
  $('#q-file').addEventListener('change', () => {
    const file = $('#q-file').files[0]; if (!file) return;
    const type = file.type === 'video/mp4' || /\.mp4$/i.test(file.name) ? 'video' : 'photo';
    $('#q-type').value = type; preview(file, type);
  });
  if (editing && asset) {
    const id = editing.id;
    request(`/api/admin/questions/${id}/media`).then(r => r.blob()).then(blob => {
      if (editing?.id === id && !$('#q-file')?.files.length) preview(blob, editing.type);
    }).catch(error => { if ($('#editor-error')) $('#editor-error').textContent = error.message; });
  }
  $('#question-form').addEventListener('input', () => { dirty = true; });
  $('#question-form').addEventListener('change', () => { dirty = true; });
  $('#question-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; busy = true; const button = $('#question-form button[type=submit]'); button.disabled = true;
    try {
      const file = $('#q-file').files[0];
      if (file) {
        if (file.size > 20 * 1024 * 1024) throw new Error('Die Datei ist grösser als 20 MB.');
        asset = (await (await request('/api/admin/media', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })).json()).asset;
      }
      if (!asset) throw new Error('Bitte ein Bild oder Video wählen.');
      const body = { type: $('#q-type').value, title: $('#q-title').value, answer: $('#q-answer').value, asset, enabled: $('#q-enabled').checked, source: $('#q-source').value, credit: $('#q-credit').value, license: $('#q-license').value, ...(editing ? { version: editing.version } : {}) };
      editing = await (await request('/api/admin/questions' + (editing ? `/${editing.id}` : ''), { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) })).json();
      dirty = false; await refresh(); render();
    } catch (error) { $('#editor-error').textContent = error.message; button.disabled = false; }
    finally { busy = false; }
  });
  $('#delete-question')?.addEventListener('click', () => { $('#delete-confirm').hidden = false; });
  $('#cancel-delete')?.addEventListener('click', () => { $('#delete-confirm').hidden = true; });
  $('#confirm-delete')?.addEventListener('click', async () => {
    if (busy) return; busy = true;
    try { await request(`/api/admin/questions/${editing.id}`, { method: 'DELETE', body: JSON.stringify({ version: editing.version }) }); editing = null; dirty = false; await refresh(); render(); }
    catch (error) { $('#editor-error').textContent = error.message; } finally { busy = false; }
  });
}
if (key) refresh().then(render).catch(error => login(error.message)); else login();
