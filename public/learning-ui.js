(() => {
  const e = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = { first_vote:'Erster Eindruck', evidence:'Quellen prüfen', final_vote:'Zweiter Blick', reveal:'Gemeinsam auflösen', finished:'Das nehmen wir mit' };
  const modeName = mode => mode === 'workshop-v1' ? 'Recherche-Werkstatt' : 'Stand-Challenge';
  function sources(cards) {
    return cards.map(s=>`<article class="source-card"><p class="eyebrow">QUELLENKARTE · ${e(s.id)}</p><h3>${e(s.title)}</h3><p class="source-meta">${e(s.publisher)}${s.publishedAt ? ` · ${e(s.publishedAt)}` : ''} · geprüft ${e(s.reviewedAt)}</p><p><strong>Fundstelle:</strong> ${e(s.locator)}</p><p>${e(s.supports)}</p><p class="source-limit"><strong>Grenze:</strong> ${e(s.limitation)}</p>${s.url ? `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">Originalquelle öffnen ↗</a>` : '<p class="field-help">Lokale redaktionelle Quellenkarte · kein Live-Rechercheergebnis</p>'}<p class="source-rights">${e(s.rights)}</p></article>`).join('');
  }
  function material(q) {
    return `<div class="case-material">${q.simulation ? `<p class="simulation-label">${e(q.simulationLabel)}</p>` : ''}${q.type==='text' ? `<div class="text-example"><p>${e(q.text)}</p></div>` : `<div class="image-example"><button class="media-zoom" data-zoom aria-label="Bild vergrössern"><img src="${e(q.image)}" alt="${e(q.alt)}"></button><p class="image-error" hidden>Bild konnte nicht geladen werden. Bitte Moderation informieren.</p></div>`}${q.caption ? `<p class="material-caption">${e(q.caption)}</p>` : ''}</div>`;
  }
  function voteBars(state) {
    const votes=state.distribution || [],total=votes.reduce((sum,v)=>sum+v.n,0);
    return `<section class="group-votes"><h2>Unser erster Eindruck</h2>${state.question.options.map(o=>{const n=votes.find(v=>v.choice===o.id)?.n || 0;return `<div class="distribution-row"><span>${e(o.label)}</span><progress max="${Math.max(total,1)}" value="${n}" aria-label="${e(o.label)}: ${n} Stimmen"></progress><strong>${n}</strong></div>`;}).join('')}<p class="field-help">Anonymisierte Gruppe · ${total} Antworten</p></section>`;
  }
  function toolbar(s) {
    const stepLabels=['Beleg zeigen','Urteil zeigen','Transfer zeigen'];
    let action,label;
    if(s.phase==='lobby'){action='start';label='Challenge starten';}
    else if(s.phase==='first_vote'){action=s.mode==='workshop-v1'?'evidence':'reveal';label=s.mode==='workshop-v1'?'Quellen öffnen':'Gemeinsam auflösen';}
    else if(s.phase==='evidence'){action='final_vote';label='Zweiturteil starten';}
    else if(s.phase==='final_vote'){action='reveal';label='Gemeinsam auflösen';}
    else if(s.phase==='reveal'&&s.revealStep<3){action='reveal_step';label=stepLabels[s.revealStep];}
    else if(s.phase==='reveal'){action='next';label=s.index+1===s.total?'Abschluss zeigen':'Nächster Fall';}
    return `<div class="host-toolbar"><span data-live-count>${s.playerCount} Personen · ${s.answeredCount} Antworten</span><div class="toolbar-buttons"><a href="/screen?code=${s.room}" target="_blank" rel="noopener">Beamer öffnen</a><a href="/materials?room=${s.room}">Unterlagen</a>${action ? `<button id="host-action" class="button primary" data-action="${action}" ${s.phase==='lobby'&&!s.playerCount?'disabled':''}>${label}</button>`:'<a class="button primary" href="/host">Neue Gruppe</a>'}${!['lobby','finished'].includes(s.phase)?'<button class="button" id="skip-case" data-action="skip">Fall überspringen</button>':''}</div></div>`;
  }
  function lobby(s,role) {
    return `<section class="lobby learning-lobby"><p class="eyebrow">${modeName(s.mode)} · DER ZWEITE BLICK</p><h1>${role==='player'?`Hallo, ${e(s.me?.nickname)}.`:'Traust du deinem ersten Blick?'}</h1>${role==='player'?'<h2>Dein Platz ist reserviert.</h2><p>Erst ein eigener Eindruck, dann ein überprüfbarer Beleg. «Nicht sicher» ist eine sinnvolle Antwort.</p>':`<div class="qr-block"><img class="qr" src="/api/qr?url=${encodeURIComponent(s.joinUrl)}" alt="QR-Code zum Beitreten"><div><p>Scannen. Spitzname. Mitmachen.</p><span class="game-code">${s.room}</span><p class="join-url">${e(s.joinUrl)}</p></div></div>`}<div class="flow-steps"><span>01 Eindruck</span><span>02 Beleg</span><span>03 Urteil</span></div><p>${s.total} Fälle · ${s.mode==='workshop-v1'?'Quellenarbeit und zwei Urteile':'etwa 8–12 Minuten'} · keine Tempopunkte</p><h2 data-player-heading>Schon dabei (${s.playerCount})</h2><div class="player-chips">${s.players.map(p=>`<span>${e(p.nickname)}</span>`).join('')}</div></section>`;
  }
  function choices(s,role) {
    if(!['first_vote','final_vote'].includes(s.phase))return '';
    if(role!=='player')return `<p class="audience-prompt" data-vote-count>Auf dem Handy abstimmen · ${s.answeredCount} / ${s.playerCount} Antworten</p>`;
    return `<section class="answer-area"><label for="confidence">Wie sicher bist du? (optional)</label><select id="confidence" ${s.me?.answer?'disabled':''}><option value="">Überspringen</option><option value="1">Unsicher</option><option value="2">Eher sicher</option><option value="3">Sehr sicher</option></select><div class="answer-buttons learning-choices">${s.question.options.map(o=>`<button class="answer-button ${s.me?.answer?.choice===o.id?'selected':''}" data-choice="${o.id}" ${s.me?.answer||s.votingClosed?'disabled':''}>${e(o.label)}${s.me?.answer?.choice===o.id?' ✓':''}</button>`).join('')}</div><p class="field-help" id="answer-status" role="status">${s.me?.answer?'Deine Antwort ist gespeichert':s.votingClosed?'Eingabe geschlossen. Die Moderation führt weiter.':'Dein eigener Eindruck zählt. Noch keine Mehrheitsanzeige.'}</p></section>`;
  }
  function reveal(s) {
    const r=s.reveal, step=s.revealStep;
    return `<section class="learning-reveal">${voteBars(s)}${step>=1?`<section class="reveal-stage"><p class="eyebrow">02 / DER ENTSCHEIDENDE BELEG</p><div class="source-grid">${sources(r.sources)}</div></section>`:''}${step>=2?`<section class="reveal-stage verdict-card"><p class="eyebrow">03 / UNSER URTEIL</p><h2>${e(r.label)}</h2><p>${e(r.explanation)}</p><p><strong>Was offen bleibt:</strong> ${e(r.limitation)}</p></section>`:''}${step>=3?`<section class="reveal-stage transfer-card"><p class="eyebrow">04 / DAS NEHME ICH MIT</p><h2>${e(r.takeaway)}</h2><p>${e(r.transfer)}</p></section>`:''}</section>`;
  }
  function finished(s) {
    return `<section class="learning-finished"><p class="eyebrow">DER ZWEITE BLICK / ABSCHLUSS</p><h1>Welchen Prüfschritt nutzt du morgen?</h1><p>Welche Fälle haben überrascht? Welcher Beleg hat dein Urteil getragen? Was bleibt offen?</p>${s.reflection?`<p><strong>${s.reflection.completed} von ${s.total} Fällen bearbeitet.</strong> Das ist kein Kompetenztest.</p><div class="reflection-list">${s.reflection.cases.map(c=>`<article><h2>${e(c.title)}</h2><p>${c.skipped?'Von der Moderation übersprungen':c.first?`Erster Eindruck: ${e(c.first)}`:'Kein Ersturteil'}${c.final?` → Zweiter Blick: ${e(c.final)}`:''}</p>${!c.skipped&&c.first&&c.final?`<p>${c.changed?'Urteil geändert':'Urteil beibehalten'} · nur tatsächlich abgegebene Antworten</p>`:''}<p>${e(c.takeaway)}</p></article>`).join('')}</div>`:''}<div class="transfer-card"><h2>Kurz stoppen. Zum Original gehen. Kontext vergleichen. Bewusst entscheiden.</h2><p>KI-generiert bedeutet nicht automatisch falsch. Ein echtes Foto kann im falschen Kontext stehen.</p></div><a href="/merkkarte.html">Prüfschritte mitnehmen</a> · <a href="/sources.html">Quellen</a></section>`;
  }
  function render(s,role) {
    let html=role==='host'?toolbar(s):'';
    if(s.phase==='lobby')return html+lobby(s,role);
    if(s.phase==='finished')return html+finished(s);
    const q=s.question;
    return html+`<section class="quiz-section learning-case phase-${s.phase} reveal-step-${s.revealStep}"><div class="question-top"><div><p class="eyebrow">FALL ${String(s.index+1).padStart(2,'0')} / ${s.total} · ${labels[s.phase]}</p><h1>${e(q.title)}</h1></div>${['first_vote','final_vote'].includes(s.phase)?'<div class="timer" role="timer" aria-label="Verbleibende Antwortzeit"><span id="seconds">–</span><small>Sek.</small></div>':''}</div><div class="progress-track"><div id="progress-fill"></div></div>${material(q)}<h2 class="case-prompt">${e(q.prompt)}</h2>${choices(s,role)}${s.phase==='evidence'?`${voteBars(s)}<h2>Prüfe die Quelle</h2><p>Wer veröffentlicht das? Welche Fundstelle stützt die konkrete Aussage? Welche Frage bleibt offen?</p><div class="source-grid">${sources(s.evidence)}</div><p class="field-help">Die Karten sind lokal vorbereitete Belege. Externe Recherche benötigt Internet. Ein zweiter Chatbot ist kein unabhängiger Beleg.</p><p class="team-roles">Im Team: Bedienung · Gegenprüfung · Protokoll. Nach jedem Fall wechseln.</p>`:''}${s.phase==='reveal'?reveal(s):''}${role==='host'&&s.hostNotes?`<details class="host-notes"><summary>Nur Moderation: Hinweise & Transfer</summary><p>${e(s.hostNotes.privateNotes)}</p><p>${e(s.hostNotes.transfer)}</p></details>`:''}</section>`;
  }
  window.LearningUI={render};
})();
