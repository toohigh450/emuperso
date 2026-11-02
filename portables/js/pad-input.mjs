// Lecture de la manette dans le moteur (iframe player.html) selon le profil EMUPERSO choisi.
// Les liaisons manette du moteur (value2) sont vidées pour qu'un bouton ne compte pas deux fois ;
// le clavier (value) n'est pas touché. Profil « natif » : rien n'est modifié, le moteur garde la main.
import { computePadInputs, pickPad, normalizePad } from './input-profiles.mjs';

export function installPadInput(emulator, system, initial, onPad) {
  let settings = normalizePad(initial);
  let raf = 0, padId = null, saved = null;
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
  function poll() {
    raf = requestAnimationFrame(poll);
    try {
      const pad = pickPad(navigator.getGamepads ? navigator.getGamepads() : []);
      if ((pad ? pad.id : null) !== padId) { padId = pad ? pad.id : null; if (onPad) onPad(padId); }
      touch(pad);
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
    },
    settings: () => settings,
    stop() { cancelAnimationFrame(raf); try { release(); } catch { /* moteur déjà arrêté */ } },
  };
}
