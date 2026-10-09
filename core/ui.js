// Componenti di interfaccia condivisi tra le pagine.

import { $, esc, opts, shortDT, toLocalInput } from './util.js';
import { RANGES, isAbs } from './time.js';
import { t, L } from './i18n.js';

export const ICON = {
  x: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  clock: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.4 1.6"/></svg>',
  back: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3.5L2.5 7 6 10.5"/><path d="M3 7h6.5a4 4 0 0 1 0 8H8"/></svg>',
  cfg: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4h7M12 4h2M2 12h2M7 12h7"/><circle cx="10.5" cy="4" r="1.6"/><circle cx="5.5" cy="12" r="1.6"/></svg>',
  dup: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>',
  del: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.7 9.5h5.6L11.5 4"/></svg>',
  widget: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="5" width="22" height="20" rx="3"/><path d="M9 19l4-5 3 3 5-6"/></svg>'
};

/* ---------- toast ---------- */
let toastT;
export function toast(msg, action, fn) {
  const t = $('#toast'); clearTimeout(toastT);
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; fn(); };
  toastT = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2800);
}

/* ---------- modale ---------- */
let onModalClose = null;
export const modal = {
  /** `onClose` viene chiamata una volta alla chiusura, comunque avvenga (pulsante, Esc, click fuori). */
  open(html, { onClose } = {}) {
    const m = $('#modal'), box = $('#mbox');
    onModalClose = onClose || null;
    box.innerHTML = html; m.hidden = false;
    box.querySelector('input,textarea,select,button')?.focus();
    return box;
  },
  close() {
    $('#modal').hidden = true; $('#mbox').innerHTML = '';
    const fn = onModalClose; onModalClose = null; fn?.();
  },
  get isOpen() { return !$('#modal').hidden; }
};

/**
 * Chiede conferma in una modale. Ritorna una Promise<boolean>: true solo con il pulsante di conferma;
 * Annulla, Esc e click fuori danno false. `html` può contenere HTML fidato (i valori vanno passati da esc()).
 */
export function confirm({ title, html = '', ok, danger = false }) {
  return new Promise(resolve => {
    let answer = false;
    const box = modal.open(`<h2>${esc(title)}</h2>${html ? `<p>${html}</p>` : ''}
      <div class="mrow"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button></div>`,
    { onClose: () => resolve(answer) });
    const okBtn = box.querySelector('[data-ok]');
    okBtn.onclick = () => { answer = true; modal.close(); };
    if (!danger) okBtn.focus();   // azione distruttiva: il focus resta su Annulla (Invio non cancella)
  });
}

/* ---------- selettore del tempo (stato globale in app.time) ---------- */
export function timePicker(el, app, suffix) {
  const id = s => s + '-' + suffix;
  el.classList.add('tp');
  el.innerHTML = `
    <button class="btn" type="button" id="${id('tbtn')}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id('tpop')}">${ICON.clock}<span class="tl"></span><span class="rf" hidden></span></button>
    <button class="btn ghost tback" type="button" hidden title="${t('time.backTitle')}" aria-label="${t('time.backTitle')}">${ICON.back}</button>
    <div class="tpop" id="${id('tpop')}" role="dialog" aria-label="${t('time.range')}" hidden>
      <span class="eyebrow">${t('time.relative')}</span>
      <div class="presets">${Object.keys(RANGES).map(k => `<button type="button" data-r="${k}" aria-pressed="false">${t('time.short.' + k)}</button>`).join('')}</div>
      <span class="eyebrow">${t('time.absolute')}</span>
      <div class="two">
        <div class="f"><label for="${id('tf')}">${t('time.from')}</label><input type="datetime-local" id="${id('tf')}"></div>
        <div class="f"><label for="${id('tt')}">${t('time.to')}</label><input type="datetime-local" id="${id('tt')}"></div>
      </div>
      <p class="jerr" hidden></p>
      <div class="f"><label for="${id('rf')}">${t('time.refresh')}</label>
        <select id="${id('rf')}"><option value="0">${t('time.refresh.off')}</option><option value="15">${t('time.refresh.15')}</option><option value="60">${t('time.refresh.60')}</option><option value="300">${t('time.refresh.300')}</option></select></div>
      <div class="mrow"><button type="button" class="btn primary tapply">${t('time.applyAbs')}</button></div>
      <p class="help">${t('time.brushHint')}</p>
    </div>`;
  const pop = el.querySelector('.tpop'), btn = el.querySelector('#' + id('tbtn')), err = el.querySelector('.jerr');
  const update = () => {
    const tv = app.time.value, tr = app.time.range();
    el.querySelector('.tl').textContent = isAbs(tv) ? shortDT(tv.from) + ' → ' + shortDT(tv.to) : t('time.last.' + tv);
    el.querySelector('.tback').hidden = !app.time.canBack;
    el.querySelectorAll('[data-r]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.r === tv)));
    el.querySelector('#' + id('tf')).value = toLocalInput(tr.from); el.querySelector('#' + id('tt')).value = toLocalInput(tr.to);
    const rfSel = el.querySelector('#' + id('rf')), rf = isAbs(tv) ? 0 : app.time.refresh;
    rfSel.value = String(app.time.refresh); rfSel.disabled = isAbs(tv);
    const chip = el.querySelector('.rf'); chip.hidden = !rf; chip.textContent = rf >= 60 ? rf / 60 + ' min' : rf + ' s';
  };
  const toggle = open => { pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); err.hidden = true; if (open) update(); };
  btn.addEventListener('click', () => toggle(pop.hidden));
  document.addEventListener('click', e => { if (!pop.hidden && !el.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { toggle(false); btn.focus(); } });
  el.querySelector('.presets').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; app.time.set(b.dataset.r); toggle(false); });
  el.querySelector('.tapply').addEventListener('click', () => {
    const a = new Date(el.querySelector('#' + id('tf')).value).getTime(), b = new Date(el.querySelector('#' + id('tt')).value).getTime();
    if (!a || !b) { err.hidden = false; err.textContent = t('time.errBoth'); return; }
    if (a >= b) { err.hidden = false; err.textContent = t('time.errOrder'); return; }
    app.time.set({ from: a, to: b }); toggle(false);
  });
  el.querySelector('#' + id('rf')).addEventListener('change', e => app.time.setRefresh(+e.target.value));
  el.querySelector('.tback').addEventListener('click', () => app.time.back());
  app.on('time', update);
  update();
  return { update, isOpen: () => !pop.hidden };
}

/* ---------- barra della query ---------- */
export function queryBar(el, { placeholder, value, onSubmit }) {
  el.classList.add('qwrap');
  el.innerHTML = `<label class="vh" for="${el.id}-in">${t('query.label')}</label><input id="${el.id}-in" type="text" placeholder="${esc(placeholder || t('query.label'))}" autocomplete="off"><button class="btn" type="submit">${t('query.submit')}</button>`;
  const input = el.querySelector('input'); input.value = value || '';
  el.addEventListener('submit', e => { e.preventDefault(); onSubmit(input.value); });
  return { set: v => { input.value = v || ''; }, get: () => input.value };
}

/* ---------- chip dei filtri ---------- */
export function filterChips(el, getFilters, onRemove) {
  el.classList.add('filters');
  const render = () => {
    el.innerHTML = (getFilters() || []).map((f, i) => `<span class="chip${f.neg ? ' neg' : ''}"><b>${esc(f.field)}</b>${esc(f.value)}<button type="button" data-i="${i}" aria-label="${esc(t('filters.remove', { field: f.field }))}">${ICON.x}</button></span>`).join('');
  };
  el.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) onRemove(+b.dataset.i); });
  render();
  return { render };
}

/* ---------- controlli di form generati dai parametri di un widget ---------- */
/** Nome leggibile di un tipo di campo nella lingua attiva. */
export const typeLabel = ft => t('type.' + ft);
export function paramControl(params, prm, { indices, fields }) {
  // label, help, placeholder e le etichette delle options possono essere stringhe o { en, it }: passano da L().
  const v = params[prm.key], id = 'f-' + prm.key, help = prm.help ? `<p class="help">${L(prm.help)}</p>` : '';
  const lab = `<label for="${id}">${esc(L(prm.label) || prm.key)}</label>`, wrap = s => `<div class="f">${s}${help}</div>`;
  switch (prm.type) {
    case 'index': return wrap(lab + `<select id="${id}" data-key="${prm.key}">${opts(indices.map(i => [i, i]), v)}</select>`);
    case 'field': {
      const ft = typeof prm.ftype === 'function' ? prm.ftype(params) : prm.ftype, fs = fields.filter(f => f.type === ft);
      return wrap(lab + (fs.length ? `<select id="${id}" data-key="${prm.key}">${opts(fs.map(f => [f.name, f.name]), v)}</select>` : `<p class="help warn">${esc(t('param.noField', { type: typeLabel(ft) }))}</p>`));
    }
    case 'fields': {
      const sel = new Set(v || []), kinds = prm.kinds || ['keyword', 'number', 'date'];
      return `<fieldset class="fld f"><legend>${esc(L(prm.label) || prm.key)}</legend>${help}<div class="checks">${fields.filter(f => kinds.includes(f.type)).map((f, i) => `<label class="chk"><input type="checkbox" id="${id}-${i}" data-key="${prm.key}" data-multi value="${esc(f.name)}"${sel.has(f.name) ? ' checked' : ''}><span>${esc(f.name)}</span><em>${typeLabel(f.type)}</em></label>`).join('')}</div></fieldset>`;
    }
    case 'select': return wrap(lab + `<select id="${id}" data-key="${prm.key}">${opts(prm.options.map(([k, lab]) => [k, L(lab)]), v)}</select>`);
    case 'number': return wrap(lab + `<input type="number" id="${id}" data-key="${prm.key}" min="${prm.min}" max="${prm.max}" value="${esc(v)}">`);
    case 'text': return wrap(lab + `<input type="text" id="${id}" data-key="${prm.key}" data-live value="${esc(v)}" placeholder="${esc(L(prm.placeholder) || '')}" autocomplete="off">`);
    case 'json': return wrap(lab + `<textarea id="${id}" data-key="${prm.key}" data-live data-json rows="9" spellcheck="false">${esc(v)}</textarea><p class="jerr" id="${id}-err" hidden></p>`);
  }
  return '';
}

/** Sceglie un campo plausibile di un certo tipo (per riempire i parametri di un widget appena aggiunto). */
export function pickField(fields, ft) {
  const fs = fields.filter(f => f.type === ft); if (!fs.length) return '';
  if (ft === 'date') return (fs.find(f => f.name === '@timestamp') || fs.find(f => /time|date/i.test(f.name)) || fs[0]).name;
  if (ft === 'keyword') return (fs.find(f => !/(^|_)id$/i.test(f.name) && !f.name.endsWith('.keyword')) || fs[0]).name;
  return fs[0].name;
}
/** Completa i parametri field/fields mancanti o non validi rispetto ai campi dell'indice. */
export function autofill(widget, params, fields) {
  for (const prm of widget.params) {
    if (prm.type === 'field') {
      const ft = typeof prm.ftype === 'function' ? prm.ftype(params) : prm.ftype;
      if (!fields.some(f => f.name === params[prm.key] && f.type === ft)) params[prm.key] = pickField(fields, ft);
    } else if (prm.type === 'fields') {
      const ok = (params[prm.key] || []).filter(n => fields.some(f => f.name === n));
      params[prm.key] = ok.length || prm.optional ? ok : fields.filter(f => f.type !== 'text').slice(0, 6).map(f => f.name);
    }
  }
  return params;
}
