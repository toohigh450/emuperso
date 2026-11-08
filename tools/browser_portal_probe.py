"""Verification navigateur reel : /contact/ FR/EN + changelog details + carte GameCube.
Usage: python tools/browser_portal_probe.py [base_url]
"""
import json, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'https://emuperso-git-feature-unified-controller-55789a-toohigh450-1311.vercel.app'
out = {'errors': [], 'checks': {}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on('pageerror', lambda e: out['errors'].append('PAGEERR ' + str(e)))
    page.on('console', lambda m: out['errors'].append('CONSOLE-' + m.type + ' ' + m.text) if m.type == 'error' else None)

    # 1. Portail : changelog details + carte GameCube
    page.goto(BASE + '/', wait_until='networkidle', timeout=45000)
    page.wait_for_timeout(1500)
    out['checks']['portal_title'] = page.title()
    out['checks']['gamecube_card'] = page.locator('a.card[href="gamecube/"]').count()
    out['checks']['gamecube_badge'] = page.locator('a.card[href="gamecube/"] .badge').inner_text() if page.locator('a.card[href="gamecube/"]').count() else None
    out['checks']['contact_link'] = page.locator('a[href="/contact/"], a[href="contact/"]').count()
    cl = page.locator('.changelog li, .changelog article, [data-changelog]')
    out['checks']['changelog_items'] = cl.count()
    if cl.count():
        out['checks']['changelog_first_text'] = cl.first.inner_text()[:300]

    # 2. Contact FR
    page.goto(BASE + '/contact/', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(800)
    out['checks']['contact_title'] = page.title()
    out['checks']['contact_h1'] = page.locator('h1').first.inner_text()
    out['checks']['mailto'] = page.locator('a[href^="mailto:"]').first.get_attribute('href') if page.locator('a[href^="mailto:"]').count() else None
    tpl = page.locator('#template, pre, textarea, [data-template]')
    out['checks']['template_present'] = tpl.count() > 0
    out['checks']['fr_body_sample'] = page.locator('body').inner_text()[:200]

    # 3. Contact EN toggle
    btn = page.locator('[data-lang-btn="en"], button:has-text("EN"), button:has-text("English")').first
    if btn.count():
        btn.click()
        page.wait_for_timeout(800)
        out['checks']['en_h1'] = page.locator('h1').first.inner_text()
        out['checks']['en_sample'] = page.locator('body').inner_text()[:200]
    else:
        out['checks']['en_toggle'] = 'NOT FOUND'

    browser.close()

print(json.dumps(out, indent=1, ensure_ascii=False))
