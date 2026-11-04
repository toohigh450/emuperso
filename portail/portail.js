// Portail : infobulle du badge ALPHA selon la langue, et service worker (PWA). Fichier à part pour que la
// règle de sécurité (CSP) de la page interdise tout script intégré.
// Infobulle du badge ALPHA dans la langue de la page (i18n.js change l'attribut lang de <html>).
new MutationObserver(function () {
  var en = document.documentElement.lang === 'en';
  var badges = document.querySelectorAll('.card .badge.alpha');
  for (var i = 0; i < badges.length; i++) badges[i].title = en ? 'Alpha version — under testing' : 'Version alpha — en phase de tests';
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
