// Lecture de la manette dans le moteur (iframe player.html) selon le profil EMUPERSO choisi.
// Les liaisons manette du moteur (value2) sont vidées pour qu'un bouton ne compte pas deux fois ;
// le clavier (value) n'est pas touché. Profil « natif » : rien n'est modifié, le moteur garde la main.
import { computePadInputs, pickPad, normalizePad } from './input-profiles.mjs';

export function installPadInput(emulator, system, initial, onPad) {
  let settings = normalizePad(initial);
  let raf = 0, padId = null, saved = null, offsetsApplied = false;
  const sent = new Map();
  const gm = () => emulator.gameManager;

  function release() {
    for (const [id, value] of sent) if (value) gm().simulateInput(0, Number(id), 0);
    sent.clear();
  }
  // Retire (ou remet) les liaisons manette du moteur, sans toucher au clavier.
  function nativeBindings(enable) {
    const controls = emulator.controls || {};
    if (!enable) {
      if (!saved) saved = Object.fromEntries(Object.entries(controls).map(([p, row]) => [p, Object.fromEntries(Object.entries(row || {}).map(([i, c]) => [i, c && c.value2]))]));
      for (const row of Object.values(controls)) for (const c of Object.values(row || {})) if (c && c.value2 !== undefined) c.value2 = '';
    } else if (saved) {
      for (const [p, row] of Object.entries(saved)) for (const [i, v] of Object.entries(row)) if (controls[p] && controls[p][i]) controls[p][i].value2 = v;
      saved = null;
    }
  }
  // Élément des commandes tactiles : propriété du moteur 4.2.3, ou recherche par classe (moteur nightly).
  const touchElement = () => emulator.virtualGamepad || document.querySelector('.ejs_virtualGamepad_parent');
  function touch(pad) {
    const vg = touchElement();
    if (!vg) return;
    vg.style.opacity = String(settings.touchOpacity);
    vg.style.setProperty('--emuperso-touch-size', String(settings.touchSize));
    // Manette branchée : les commandes tactiles s'effacent ; débranchée : elles reviennent.
    const hide = !!pad && settings.hideTouch;
    if (vg.dataset.emupersoHidden !== String(hide)) {
      vg.dataset.emupersoHidden = String(hide);
      if (emulator.touch || emulator.hasTouchScreen) {
        if (typeof emulator.toggleVirtualGamepad === 'function') emulator.toggleVirtualGamepad(!hide);
        else vg.style.display = hide ? 'none' : '';
      }
    }
  }
  // Déplacement des commandes tactiles : décalage (propriété CSS translate) par bouton ou par bloc.
  const movable = (key) => (/^b_/.test(key) ? document.querySelector(`.ejs_virtualGamepad_button.${key}`) : document.querySelector(`.ejs_virtualGamepad_${key === 'center' ? 'bottom' : key}`));
  function applyOffsets() {
    for (const key of ['left', 'right', 'top', 'center']) { const el = movable(key); if (el) el.style.translate = ''; }
    for (const b of document.querySelectorAll('.ejs_virtualGamepad_button')) b.style.translate = '';
    for (const [key, [x, y]] of Object.entries(settings.touchOffsets)) { const el = movable(key); if (el) el.style.translate = `${x}px ${y}px`; }
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
  function editTouch() {
    return new Promise((resolve) => {
      const offsets = { ...settings.touchOffsets };
      const layer = document.createElement('div');
      layer.className = 'emuperso-touch-editor';
      layer.innerHTML = '<p>Glisse un bouton ou le bloc croix / stick à l’endroit voulu.</p><div><button type="button" data-a="reset">Rétablir</button><button type="button" data-a="done">Terminé</button></div>';
      document.body.append(layer);
      let drag = null;
      layer.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        layer.style.pointerEvents = 'none';
        const under = document.elementFromPoint(e.clientX, e.clientY);
        layer.style.pointerEvents = '';
        const key = under && keyOf(under);
        if (!key) return;
        const [x, y] = offsets[key] || [0, 0];
        drag = { key, x0: e.clientX - x, y0: e.clientY - y };
        layer.setPointerCapture(e.pointerId);
        movable(key)?.classList.add('emuperso-moving');
      });
      layer.addEventListener('pointermove', (e) => {
        if (!drag) return;
        offsets[drag.key] = [Math.round(e.clientX - drag.x0), Math.round(e.clientY - drag.y0)];
        const el = movable(drag.key); if (el) el.style.translate = `${offsets[drag.key][0]}px ${offsets[drag.key][1]}px`;
      });
      const end = () => { if (drag) movable(drag.key)?.classList.remove('emuperso-moving'); drag = null; };
      layer.addEventListener('pointerup', end); layer.addEventListener('pointercancel', end);
      layer.addEventListener('click', (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (a === 'reset') { for (const k of Object.keys(offsets)) delete offsets[k]; settings = normalizePad({ ...settings, touchOffsets: {} }); applyOffsets(); }
        if (a === 'done') { layer.remove(); settings = normalizePad({ ...settings, touchOffsets: offsets }); applyOffsets(); resolve(settings.touchOffsets); }
      });
    });
  }
  function poll() {
    raf = requestAnimationFrame(poll);
    try {
      const pad = pickPad(navigator.getGamepads ? navigator.getGamepads() : []);
      if ((pad ? pad.id : null) !== padId) { padId = pad ? pad.id : null; if (onPad) onPad(padId); }
      touch(pad);
      if (!offsetsApplied && document.querySelector('.ejs_virtualGamepad_button')) { offsetsApplied = true; applyOffsets(); }
      if (settings.profile === 'natif' || !emulator.started) return;
      const inputs = computePadInputs(system, pad, settings);
      for (const [id, value] of Object.entries(inputs)) {
        if ((sent.get(id) || 0) !== value) { sent.set(id, value); gm().simulateInput(0, Number(id), value); }
      }
    } catch (err) { console.error('Manette EMUPERSO', err); }
  }
  nativeBindings(settings.profile === 'natif');
  raf = requestAnimationFrame(poll);
  return {
    update(next) {
      const before = settings.profile;
      settings = normalizePad(next);
      if (before !== settings.profile) { release(); nativeBindings(settings.profile === 'natif'); }
      applyOffsets();
    },
    editTouch,
    settings: () => settings,
    stop() { cancelAnimationFrame(raf); try { release(); } catch { /* moteur déjà arrêté */ } },
  };
}
