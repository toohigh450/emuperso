/* EMUPERSO — i18n v1 : français par défaut, anglais en option.
 * - Langue : localStorage 'emuperso_lang' > langue du navigateur > 'fr'.
 * - Les textes français sont déjà dans le HTML : sans JS ou si le JSON
 *   est injoignable, la page reste en français (jamais cassée).
 * - Les noms de jeux, ROMs et codes de triche ne sont jamais traduits.
 */
(function () {
  'use strict';
  var LANGS = ['fr', 'en'];
  var KEY = 'emuperso_lang';
  var languageRequest = 0;

  function pick() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved && LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) {}
    var nav = String(navigator.language || navigator.userLanguage || 'fr').toLowerCase();
    return nav.indexOf('en') === 0 ? 'en' : 'fr';
  }

  function apply(lang, dict) {
    document.documentElement.lang = lang;
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute('data-i18n');
      if (dict[k] != null) els[i].textContent = dict[k];
    }
    var meta = document.querySelector('meta[name="description"]');
    if (meta && dict['meta.description']) meta.setAttribute('content', dict['meta.description']);
    var btns = document.querySelectorAll('[data-lang-btn]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].setAttribute('aria-pressed', btns[j].getAttribute('data-lang-btn') === lang ? 'true' : 'false');
    }
  }

  function setLang(lang) {
    var request = ++languageRequest;
    if (LANGS.indexOf(lang) < 0) lang = 'fr';
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    fetch('/i18n/' + lang + '.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('i18n ' + r.status);
      return r.json();
    }).then(function (dict) {
      if (request !== languageRequest) return;
      apply(lang, dict);
    }).catch(function () {
      if (request !== languageRequest) return;
      /* JSON injoignable : on garde le français du HTML. */
      if (lang !== 'fr') apply('fr', {});
    });
  }

  window.emupersoSetLang = setLang;

  function bind() {
    var btns = document.querySelectorAll('[data-lang-btn]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        setLang(this.getAttribute('data-lang-btn'));
      });
    }
    setLang(pick());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
