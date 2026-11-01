"""Prove the real periodic writer independently of an empty-state load.

Uses a fresh profile and only the repository MIT demo with a changed header byte.
No timer is disabled, advanced or mocked, and no product function is replaced.
"""
from pathlib import Path
import json
import os
import threading
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
import browser_restore_rc as bench


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 18885), bench.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    records = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            page = browser.new_page()
            page.goto('http://127.0.0.1:18885/')
            page.wait_for_function('()=>!!window.RealN64')
            bench.launch(page, bench.VARIANT, bench.VARIANT_SHA)
            before = bench.vault(page)
            assert before['record_count'] == 0, before
            page.wait_for_function("()=>RealN64.diagnostic().records.some(r=>r.type==='battery.saved')", timeout=20000)
            bench.idle(page)
            after_tick = bench.vault(page)
            assert after_tick['record_count'] == 1 and after_tick['sha256'] != before['sha256']
            assert after_tick['records'][0]['kind'] == 'battery'
            records.append({'test':'Real 15-second timer adds native row outside a load operation', 'status':'RÉUSSI',
                'before':before, 'after':after_tick, 'events':bench.events(page, 'battery.saved')})
            bench.action(page, '#battery-save', 'battery.saved')
            primed = bench.vault(page)
            # Observe another genuine interval tick, without controlling the clock.
            page.wait_for_timeout(15500)
            bench.idle(page)
            next_tick = bench.vault(page)
            assert next_tick == primed, {'before':primed, 'after':next_tick}
            records.append({'test':'Unchanged native autosave preserves full row, revision and previous after priming',
                'status':'RÉUSSI', 'before':primed, 'after':next_tick})
            failures = len(bench.events(page, 'operation.failed'))
            page.locator('#state-load').click()
            page.wait_for_function("n=>RealN64.diagnostic().records.filter(r=>r.type==='operation.failed').length>n", arg=failures)
            bench.idle(page)
            after_load = bench.vault(page)
            assert after_load == primed, {'before':primed, 'after':after_load}
            records.append({'test':'Missing state load leaves entire primed vault unchanged', 'status':'RÉUSSI',
                'before':primed, 'after':after_load, 'error':bench.events(page, 'operation.failed')[-1]['data']})
            browser.close()
    finally:
        server.shutdown(); server.server_close()
        out = bench.EVIDENCE / 'probe-autosave-readonly-rc.json'
        out.write_text(json.dumps({'schema':'emuperso/autosave-readonly-probe/v1','results':records,
            'scope':'Actual periodic timer and core, fresh browser profile, owned MIT variant only; no mocks or personal data.',
            'failed_ci_cause':'Timer interference demonstrated as a mechanism; failed CI did not log the differing rows, so its exact interleaving remains unobserved.'},
            ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    assert len(records) == 3
    print('RÉUSSI — 3 contrôles autosave réel / lecture seule', flush=True)


if __name__ == '__main__':
    main()
