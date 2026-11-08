import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../portail/i18n.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const requests = [];
  const label = { textContent: 'Français', getAttribute: () => 'label' };
  const document = {
    readyState: 'loading', documentElement: { lang: 'fr' }, addEventListener() {},
    querySelectorAll: selector => selector === '[data-i18n]' ? [label] : [],
    querySelector: () => null,
  };
  const window = {};
  vm.runInNewContext(source, {
    document, window, navigator: { language: 'fr' }, localStorage: { getItem: () => null, setItem() {} },
    fetch: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
  });
  return { document, label, requests, setLang: window.emupersoSetLang };
}
test('langue : une ancienne réponse lente ne remplace pas le dernier choix', async () => {
  const s = setup(); s.setLang('en'); s.setLang('fr');
  s.requests[1].resolve({ ok: true, json: async () => ({ label: 'Français' }) }); await flush();
  s.requests[0].resolve({ ok: true, json: async () => ({ label: 'English' }) }); await flush();
  assert.equal(s.document.documentElement.lang, 'fr');
  assert.equal(s.label.textContent, 'Français');
});
test('langue : une ancienne erreur ne rétablit pas le français après un choix anglais réussi', async () => {
  const s = setup(); s.setLang('en'); s.setLang('en');
  s.requests[1].resolve({ ok: true, json: async () => ({ label: 'English' }) }); await flush();
  s.requests[0].reject(Error('ancienne requête hors ligne')); await flush();
  assert.equal(s.document.documentElement.lang, 'en');
  assert.equal(s.label.textContent, 'English');
});
