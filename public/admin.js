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
    <label class="checkbox-label"><input id="q-learning" type="checkbox" ${!editing||q.schemaVersion===3?'checked':''}> Als Lernfall mit Quellenprüfung verwalten</label>
    <div class="form-row"><div><label for="q-type">Format</label><select id="q-type">${['photo', 'text', 'poster'].map(type => `<option value="${type}" ${q.type === type ? 'selected' : ''}>${typeName(type)}</option>`).join('')}</select></div><div><label id="answer-label" for="q-answer">Richtige Herkunft</label><select id="q-answer" required></select></div></div>
    <div class="learning-fields"><label for="q-axis">Was wird geprüft?</label><select id="q-axis"><option value="origin" ${q.axis==='origin'?'selected':''}>Entstehung</option><option value="claim" ${q.axis==='claim'?'selected':''}>Konkrete Behauptung</option><option value="context" ${q.axis==='context'?'selected':''}>Kontext</option></select><label for="q-prompt">Leitfrage</label><input id="q-prompt" maxlength="1500" value="${esc(q.prompt)}"><label class="checkbox-label"><input id="q-simulation" type="checkbox" ${q.simulation?'checked':''}> Fiktive Unterrichtssimulation</label></div>
    <label for="q-title">Fragetitel</label><input id="q-title" maxlength="160" value="${esc(q.title)}" required placeholder="Zum Beispiel: Echt aufgenommen?">
    <div id="image-field"><label for="q-file">Bild hochladen</label><input id="q-file" type="file" accept="image/jpeg,image/png,image/webp"><p class="field-help">PNG, JPEG oder WebP · maximal 12 MB. Ein bestehendes Bild bleibt erhalten, solange du kein neues wählst.</p><img class="admin-preview" id="image-preview" alt="Bildvorschau der Frage" hidden></div>
    <div id="text-field"><label for="q-text">Quiztext</label><textarea id="q-text" rows="7" maxlength="10000">${esc(q.text)}</textarea></div>
    <label for="q-explanation">Auflösung / Erklärung</label><textarea id="q-explanation" rows="3" maxlength="4000" required placeholder="Was ist die Herkunft? Was soll die Gruppe daraus lernen?">${esc(q.explanation)}</textarea>
    <label for="q-takeaway">Merksatz (optional)</label><input id="q-takeaway" maxlength="1500" value="${esc(q.takeaway)}">
    <div class="learning-fields"><label for="q-limitation">Was bleibt offen?</label><textarea id="q-limitation" maxlength="2000" rows="2">${esc(q.limitation)}</textarea><label for="q-transfer">Transferfrage für den Alltag</label><input id="q-transfer" maxlength="1500" value="${esc(q.transfer)}"><label for="q-private">Private Moderationsnotizen</label><textarea id="q-private" maxlength="4000" rows="2">${esc(q.privateNotes)}</textarea><h3>Quellenkarten</h3><div id="source-cards">${(q.sources||[]).map(sourceEditor).join('')}</div><button id="add-source" class="button" type="button">Quelle hinzufügen</button><label for="q-status">Redaktioneller Status</label><select id="q-status"><option value="draft">Entwurf</option><option value="published" ${q.status==='published'?'selected':''}>Freigegeben</option></select><div class="release-checks"><label class="checkbox-label"><input id="review-sources" type="checkbox" ${q.review?.sources?'checked':''}> Quellen und konkrete Fundstellen geprüft</label><label class="checkbox-label"><input id="review-rights" type="checkbox" ${q.review?.rights?'checked':''}> Nutzungsrechte geprüft</label><label class="checkbox-label"><input id="review-didactics" type="checkbox" ${q.review?.didactics?'checked':''}> Frage, Grenze und Transfer geprüft</label><label for="review-date">Datum der Freigabeprüfung</label><input id="review-date" type="date" value="${esc(q.review?.reviewedAt)}"><label for="review-by">Geprüft durch</label><input id="review-by" maxlength="200" value="${esc(q.review?.reviewedBy)}"></div></div>
    <details class="source-fields"><summary>Quelle und Nutzungsangaben</summary><label for="q-source">Quellenlink (HTTPS, optional)</label><input id="q-source" maxlength="1500" value="${esc(q.source)}" placeholder="https://…"><label for="q-credit">Urheber / Herkunft</label><input id="q-credit" maxlength="1000" value="${esc(q.credit)}"><label for="q-license">Lizenz / Nutzungsangabe</label><input id="q-license" maxlength="1000" value="${esc(q.license)}"></details>
    <label class="checkbox-label"><input id="q-enabled" type="checkbox" ${q.enabled ? 'checked' : ''}> In neuen Runden verwenden</label>
    <div class="editor-actions"><button class="button primary" type="submit">Frage speichern</button>${editing ? '<button class="button danger" id="delete-question" type="button">Löschen</button>' : ''}</div><p id="editor-error" class="form-error" role="alert"></p><div id="delete-confirm" class="delete-confirm" hidden><p>Diese Frage aus der Bibliothek löschen? Laufende Runden und ihre Bilder bleiben erhalten.</p><button id="confirm-delete" class="button danger" type="button">Frage endgültig löschen</button><button id="cancel-delete" class="button" type="button">Abbrechen</button></div>
  </form>`;
}
function sourceEditor(s={},i=0){return `<fieldset class="source-editor"><legend>Quellenkarte</legend>${[['title','Titel'],['publisher','Herausgeber'],['url','Originaladresse (HTTPS, optional)'],['publishedAt','Veröffentlichungsdatum (soweit bekannt)'],['reviewedAt','Prüfdatum (JJJJ-MM-TT)'],['locator','Konkrete Fundstelle'],['supports','Was dokumentiert dieser Beleg?'],['limitation','Grenze des Belegs'],['rights','Rechte / Nutzungsangaben']].map(([key,label])=>`<label>${label}<input data-source-field="${key}" maxlength="4000" value="${esc(s[key])}"></label>`).join('')}<input type="hidden" data-source-field="id" value="${esc(s.id||`source-${i+1}`)}"><button type="button" class="button" data-remove-source>Quelle entfernen</button></fieldset>`;}
function render() {
  releasePreview(); currentAsset = editing?.asset || ''; dirty = false;
  app.innerHTML = `<section class="admin-header"><div><h1>Fragen</h1><p>${questions.filter(q => q.enabled).length} aktiv · ${questions.length} insgesamt. Änderungen gelten für neue Runden.</p></div><div class="toolbar-buttons"><a href="/host">Zur Moderation</a><a href="/materials">Unterlagen</a><button id="import-pack" class="button" type="button">Lernpaket importieren</button><button id="logout" class="button" type="button">Abmelden</button></div></section><section id="import-preview" hidden></section><div class="admin-layout"><aside class="question-list"><button class="button primary" id="new-question">Neue Frage</button><ol>${listHtml()}</ol></aside><section class="question-editor">${editorHtml()}</section></div>`;
  $('#import-pack').addEventListener('click',async()=>{try{const preview=await(await request('/api/admin/import/preview')).json();$('#import-preview').hidden=false;$('#import-preview').innerHTML=`<h2>Importvorschau</h2><p>Nur neue IDs werden ergänzt. Lokale Fassungen bleiben erhalten.</p><ul>${preview.cases.map(q=>`<li>${esc(q.id)} · ${esc(q.title)} · ${esc(q.status)}</li>`).join('')}</ul><button class="button primary" id="apply-import">Neue Lernfälle ergänzen</button>`;$('#apply-import').addEventListener('click',async()=>{if(!canLeave())return;await request('/api/admin/import/apply',{method:'POST',body:JSON.stringify({confirm:true})});editing=null;await refresh();render();notify('Neue Fälle ergänzt; vorhandene Fassungen beibehalten.');});}catch(error){notify(error.message);}});
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
  function toggleLearning(){
    const active=$('#q-learning').checked;document.querySelectorAll('.learning-fields').forEach(el=>{el.hidden=!active;});$('#q-prompt').required=active;
    const answer=$('#q-answer').value||editing?.answer;
    const opts=!active?[['human','Ohne generative KI'],['ai','Mit KI erzeugt']]:$('#q-axis').value==='origin'?[['ai','Mit generativer KI'],['human','Ohne generative KI'],['insufficient','Mit diesen Infos nicht sicher']]:$('#q-axis').value==='claim'?[['supported','Belegt'],['refuted','Widerlegt'],['open','Noch offen']]:[['fits','Kontext passt'],['misleading','Irreführender Kontext'],['open','Noch offen']];
    $('#answer-label').textContent=active?'Urteil nach Quellenprüfung':'Richtige Herkunft';$('#q-answer').innerHTML='<option value="">Bitte wählen</option>'+opts.map(([id,label])=>`<option value="${id}" ${id===answer?'selected':''}>${label}</option>`).join('');
  }
  $('#q-learning').addEventListener('change',toggleLearning);$('#q-axis').addEventListener('change',toggleLearning);toggleLearning();
  $('#add-source').addEventListener('click',()=>{const n=$('#source-cards').children.length;if(n>=5)return;$('#source-cards').insertAdjacentHTML('beforeend',sourceEditor({},Date.now()));dirty=true;invalidateRelease();});
  $('#source-cards').addEventListener('click',event=>{if(event.target.matches('[data-remove-source]')){event.target.closest('fieldset').remove();dirty=true;invalidateRelease();}});
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
  function invalidateRelease(event){
    if(editing?.schemaVersion===3&&$('#q-status').value==='published'&&!event?.target?.closest('.release-checks')&&event?.target?.id!=='q-status'){
      $('#q-status').value='draft';for(const id of ['review-sources','review-rights','review-didactics'])$('#'+id).checked=false;
      $('#review-date').value='';$('#review-by').value='';
    }
  }
  $('#question-form').addEventListener('input',invalidateRelease);
  $('#question-form').addEventListener('change',invalidateRelease);
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
    if($('#q-learning').checked)Object.assign(body,{schemaVersion:3,axis:$('#q-axis').value,prompt:$('#q-prompt').value,simulation:$('#q-simulation').checked,status:$('#q-status').value,limitation:$('#q-limitation').value,transfer:$('#q-transfer').value,privateNotes:$('#q-private').value,sources:Array.from(document.querySelectorAll('.source-editor')).map(card=>Object.fromEntries(Array.from(card.querySelectorAll('[data-source-field]')).map(input=>[input.dataset.sourceField,input.value]))),review:{sources:$('#review-sources').checked,rights:$('#review-rights').checked,didactics:$('#review-didactics').checked,reviewedAt:$('#review-date').value,reviewedBy:$('#review-by').value}});
    const result = await (await request(`/api/admin/questions${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) })).json();
    editing = result; dirty = false; await refresh(); render(); notify('Frage gespeichert. Neue Runden verwenden den aktuellen Stand.');
  } catch (error) { $('#editor-error').textContent = error.message; button.disabled = false; }
  finally { busy = false; }
}
if (key) refresh().then(render).catch(error => login(error.message)); else login();
