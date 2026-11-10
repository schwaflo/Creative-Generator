'use strict';
/* Haptisches Feedback – bewusst sparsam: nur an Rastpunkten
   (Winkel 0/90/180/270°, Stufen-Regler, Standardwert, Funktionswechsel).
   - Android/Chrome: navigator.vibrate
   - iOS Safari 18+: Umschalten eines versteckten <input switch> löst Haptik aus
   - Desktop: kein Web-API für Trackpad-Haptik -> visueller "Klick" am Regler */
CG.haptics = (() => {
  const { store } = CG.util;
  let enabled = store.get('haptics', true);
  let last = 0;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let iosSwitch = null;

  if (isIOS && !navigator.vibrate) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }

  function tick(strong) {
    if (!enabled) return;
    const now = performance.now();
    if (now - last < 45) return;
    last = now;
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (navigator.vibrate) { if (active) navigator.vibrate(strong ? 16 : 7); }
    else if (iosSwitch) iosSwitch.click();
  }

  function flash(node) {
    if (!node) return;
    node.classList.remove('detent'); void node.offsetWidth; node.classList.add('detent');
  }

  return {
    tick, flash,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; store.set('haptics', enabled); },
  };
})();
