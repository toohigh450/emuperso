// Réserve de la place aux commandes centrales : elles ne recouvrent plus les dialogues.
const installed = new WeakMap();
export function installPlayerLayout(emulator) {
  const parent = emulator?.elements?.parent;
  // Moteur 4.2.3 : propriété virtualGamepad ; moteur nightly (PSP) : seulement la classe CSS.
  const pad = emulator?.virtualGamepad || parent?.querySelector('.ejs_virtualGamepad_parent');
  if (!parent || !pad) return;
  if (installed.has(parent)) { installed.get(parent)(); return; }
  const update = () => {
    const style = getComputedStyle(pad);
    // handleResize affiche brièvement la manette cachée avec opacity:0 pour la mesurer.
    const visible = emulator.started && style.display !== 'none' && style.opacity !== '0';
    if (parent.hasAttribute('data-portable-touch-controls') === !!visible) return;
    parent.toggleAttribute('data-portable-touch-controls', !!visible);
  };
  installed.set(parent, update);
  new MutationObserver(update).observe(pad, { attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('resize', update);
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  update();
}
