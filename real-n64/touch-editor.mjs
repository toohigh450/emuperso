// Commandes tactiles du moteur (mandat Controller V2) : masquées quand une manette est branchée, et
// déplaçables bouton par bouton ou par bloc (croix, stick…), position retenue sur cet appareil.
// Même principe que le lanceur (portables/js/pad-input.mjs). Fichier identique dans real-n64 et ps1-web.
export const MOVABLE_KEY = /^(?:b_[a-z0-9_-]{1,20}|left|right|top|center)$/i;

export function normalizeTouch(v = {}) {
  const offsets = v && typeof v.offsets === 'object' && v.offsets ? v.offsets : {};
  return {
    hideTouch: v.hideTouch !== false,
    offsets: Object.fromEntries(Object.entries(offsets)
      .filter(([k, o]) => MOVABLE_KEY.test(k) && Array.isArray(o) && o.length === 2 && o.every(Number.isFinite))
      .map(([k, [x, y]]) => [k, [Math.max(-2000, Math.min(2000, Math.round(x))), Math.max(-2000, Math.min(2000, Math.round(y)))]])),
  };
}
export function readTouch(key) {
  try { return normalizeTouch(JSON.parse(localStorage.getItem(key) || '{}')); } catch { return normalizeTouch({}); }
}
export function writeTouch(key, value) {
  const clean = normalizeTouch(value);
  localStorage.setItem(key, JSON.stringify(clean));
  return clean;
}

const movable = (doc, key) => (/^b_/.test(key) ? doc.querySelector(`.ejs_virtualGamepad_button.${key}`) : doc.querySelector(`.ejs_virtualGamepad_${key === 'center' ? 'bottom' : key}`));
export function applyOffsets(doc, offsets) {
  for (const key of ['left', 'right', 'top', 'center']) { const el = movable(doc, key); if (el) el.style.translate = ''; }
  for (const b of doc.querySelectorAll('.ejs_virtualGamepad_button')) b.style.translate = '';
  for (const [key, [x, y]] of Object.entries(offsets)) { const el = movable(doc, key); if (el) el.style.translate = `${x}px ${y}px`; }
}
function keyOf(el) {
  const button = el.closest('.ejs_virtualGamepad_button');
  const id = button && [...button.classList].find((c) => /^b_/.test(c));
  if (id) return id;
  const group = el.closest('.ejs_virtualGamepad_left, .ejs_virtualGamepad_right, .ejs_virtualGamepad_top, .ejs_virtualGamepad_bottom');
  if (!group) return null;
  return ['left', 'right', 'top', 'center'].find((k) => group.classList.contains(`ejs_virtualGamepad_${k === 'center' ? 'bottom' : k}`)) || null;
}

// Mode édition : un calque capte les doigts ; on glisse un bouton ou un bloc, puis « Terminé ».
export function editTouch(doc, initial) {
  if (!doc.querySelector('.ejs_virtualGamepad_button')) return Promise.reject(new Error('Commandes tactiles absentes : ouvre le jeu sur un écran tactile.'));
  return new Promise((resolve) => {
    const offsets = { ...initial };
    const layer = doc.createElement('div');
    layer.className = 'emuperso-touch-editor';
    layer.innerHTML = '<p>Glisse un bouton ou le bloc croix / stick à l’endroit voulu.</p><div><button type="button" data-a="reset">Rétablir</button><button type="button" data-a="done">Terminé</button></div>';
    doc.body.append(layer);
    let drag = null;
    layer.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      layer.style.pointerEvents = 'none';
      const under = doc.elementFromPoint(e.clientX, e.clientY);
      layer.style.pointerEvents = '';
      const key = under && keyOf(under);
      if (!key) return;
      const [x, y] = offsets[key] || [0, 0];
      drag = { key, x0: e.clientX - x, y0: e.clientY - y };
      layer.setPointerCapture(e.pointerId);
      movable(doc, key)?.classList.add('emuperso-moving');
    });
    layer.addEventListener('pointermove', (e) => {
      if (!drag) return;
      offsets[drag.key] = [Math.round(e.clientX - drag.x0), Math.round(e.clientY - drag.y0)];
      const el = movable(doc, drag.key); if (el) el.style.translate = `${offsets[drag.key][0]}px ${offsets[drag.key][1]}px`;
    });
    const end = () => { if (drag) movable(doc, drag.key)?.classList.remove('emuperso-moving'); drag = null; };
    layer.addEventListener('pointerup', end); layer.addEventListener('pointercancel', end);
    layer.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'reset') { for (const k of Object.keys(offsets)) delete offsets[k]; applyOffsets(doc, offsets); }
      if (a === 'done') { layer.remove(); applyOffsets(doc, offsets); resolve(normalizeTouch({ offsets }).offsets); }
    });
  });
}

// Dans la page du moteur : masque le tactile quand une manette est branchée (si hideTouch) et applique
// les positions enregistrées, puis les suit (évènement « storage » quand la page les change).
// hideTouch() permet à la N64 de garder son propre réglage ; sinon celui de la clé est utilisé.
export function watchTouch({ doc = document, key, emulator, hideTouch, onPad }) {
  let touch = readTouch(key), applied = false, padId, raf = 0;
  addEventListener('storage', (e) => { if (e.key === key) { touch = readTouch(key); applied = false; } });
  const tick = () => {
    raf = requestAnimationFrame(tick);
    try {
      const emu = emulator();
      if (!emu) return;
      const pads = [...(navigator.getGamepads?.() ?? [])].filter((p) => p?.connected);
      const pad = pads.find((p) => p.mapping === 'standard') ?? pads[0] ?? null;
      if ((pad?.id ?? null) !== padId) { padId = pad?.id ?? null; onPad?.(padId); }
      const vg = emu.virtualGamepad || doc.querySelector('.ejs_virtualGamepad_parent');
      if (!vg) return;
      const hide = !!pad && (hideTouch ? hideTouch() : touch.hideTouch);
      if ((emu.touch || emu.hasTouchScreen) && vg.dataset.emupersoHidden !== String(hide)) { vg.dataset.emupersoHidden = String(hide); vg.style.display = hide ? 'none' : ''; }
      if (!applied && doc.querySelector('.ejs_virtualGamepad_button')) { applied = true; applyOffsets(doc, touch.offsets); }
    } catch { /* moteur en cours d'arrêt */ }
  };
  raf = requestAnimationFrame(tick);
  return {
    stop: () => cancelAnimationFrame(raf),
    edit: async () => { const offsets = await editTouch(doc, touch.offsets); touch = writeTouch(key, { ...touch, offsets }); return touch.offsets; },
  };
}
