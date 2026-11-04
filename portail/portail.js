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
// Journal des mises à jour (mandat du 3 nov.) : charge changelog.json et affiche les entrées
// dans la langue de la page. Repli silencieux si le fichier est absent ou invalide.
(function () {
  var list = document.getElementById('changelog-list');
  if (!list) return;
  function render(entries) {
    var en = document.documentElement.lang === 'en';
    list.innerHTML = '';
    entries.slice(0, 8).forEach(function (e) {
      var t = (en ? e.en : e.fr) || e.fr || e.en;
      if (!t) return;
      var li = document.createElement('li');
      var date = document.createElement('span');
      date.className = 'date';
      date.textContent = e.date || '';
      var b = document.createElement('b');
      b.textContent = t.title || '';
      var p = document.createElement('p');
      p.textContent = t.text || '';
      li.appendChild(date);
      li.appendChild(b);
      li.appendChild(p);
      list.appendChild(li);
    });
  }
  function load() {
    fetch('/changelog.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no changelog');
      return r.json();
    }).then(render).catch(function () { /* repli silencieux */ });
  }
  load();
  new MutationObserver(function () {
    load();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
})();
