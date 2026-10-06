"""End-to-end smoke test in real Chromium (phone viewport). Usage: python3 tests/e2e/run.py [shots_dir]"""
import sys, re, subprocess, time, os
from playwright.sync_api import sync_playwright

SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
os.makedirs(SHOTS, exist_ok=True)
srv = subprocess.Popen(['node', 'tools/serve.mjs', '8123'], stdout=subprocess.DEVNULL)
time.sleep(0.8)
errors = []

def pick(page, label, startswith):
    sel = page.get_by_label(label, exact=False).first
    val = sel.evaluate("(el, s) => [...el.options].find(o => o.textContent.startsWith(s))?.value", startswith)
    assert val is not None, f'option {startswith} not in {label}'
    sel.select_option(val)

OVERFLOW_JS = '''() => { const w = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1) && !e.closest('.chips,.scroll,.tabs,.toasts'); }).slice(0,4).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().left) + '..' + Math.round(e.getBoundingClientRect().right)); return [document.documentElement.scrollWidth, w, bad]; }'''

def shot(page, name):
    page.screenshot(path=f'{SHOTS}/{name}.png', full_page=False)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome') if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='ar-EG', device_scale_factor=2)
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:8123/')
        page.get_by_text('أهلًا بك في MoneyFlow').wait_for()
        shot(page, '01-setup')
        pw = page.locator('input[type=password]')
        pw.nth(0).fill('secret123'); pw.nth(1).fill('secret123'); pw.nth(2).fill('1234')
        page.get_by_role('button', name='ابدأ').click()
        page.get_by_text('إجمالي أموالي الآن').wait_for()
        shot(page, '02-dashboard-empty')

        for name, opening in [('Vodafone Cash', '20000'), ('Cash', '5000'), ('Bank', '30000')]:
            page.goto('http://localhost:8123/#/accounts')
            page.get_by_role('button', name='+ حساب').first.click()
            page.get_by_label('اسم الحساب').fill(name)
            page.get_by_label('الرصيد الافتتاحي').fill(opening)
            page.get_by_role('button', name='إضافة', exact=True).click()
            page.get_by_text(name, exact=True).first.wait_for()
        shot(page, '03-accounts')

        page.goto('http://localhost:8123/#/dashboard-x'); page.goto('http://localhost:8123/#/')
        page.get_by_text('55,000.00').first.wait_for()
        shot(page, '04-dashboard-55000')

        page.goto('http://localhost:8123/#/new'); shot(page, '05-new-picker')
        page.goto('http://localhost:8123/#/new/transfer')
        page.get_by_role('heading', name='تحويل').wait_for()
        page.get_by_label('قيمة العملية', exact=True).fill('1000')
        page.get_by_label('المبلغ الذي دفعه العميل لي').fill('1030')
        page.get_by_label('المبلغ الذي خصمته الشركة مني').fill('1010')
        pick(page, 'دخلت إلى (استلام)', 'Cash'); pick(page, 'خرجت من (دفع)', 'Vodafone')
        page.get_by_text('الربح الصافي').first.wait_for()
        shot(page, '06-trade-form')
        page.get_by_role('button', name='حفظ', exact=True).click()
        page.get_by_text('سجل العملية').wait_for()
        assert '+20.00' in page.inner_text('main'), page.inner_text('main')
        shot(page, '07-tx-detail')

        prev = page.evaluate('location.hash')
        page.goto('http://localhost:8123/#/new/expense_personal')
        page.get_by_role('heading', name='مصروف شخصي').wait_for()
        page.get_by_label('المبلغ', exact=True).fill('150')
        pick(page, 'يخرج من حساب', 'Cash')
        cat = page.get_by_label('التصنيف').first
        cat.select_option(cat.evaluate("el => [...el.options].find(o => o.textContent === 'أكل').value"))
        page.get_by_role('button', name='حفظ', exact=True).click()
        page.wait_for_function('p => location.hash !== p && location.hash.startsWith("#/tx/")', arg=prev)
        page.get_by_text('سجل العملية').wait_for()

        page.goto('http://localhost:8123/#/')
        try:
            page.get_by_text('54,870.00').first.wait_for(timeout=5000)
        except Exception:
            print('DASHBOARD TEXT:', page.inner_text('main')[:600]); shot(page, '08-dashboard-final'); raise
        shot(page, '08-dashboard-final')

        for route in ['', 'tx', 'accounts', 'reports', 'settings', 'debts', 'more', 'new/transfer', 'networth']:
            page.goto('http://localhost:8123/#/' + route); page.wait_for_timeout(350)
            sw, w, bad = page.evaluate(OVERFLOW_JS)
            print('overflow', route or '/', sw, w, bad)
            if sw > w or bad: errors.append(f'horizontal overflow on /{route}: {sw}>{w} {bad}')
        for route, name in [('tx', '09-tx-list'), ('reports', '10-reports'), ('settings', '11-settings'), ('networth', '12-networth'), ('debts', '13-debts'), ('more', '14-more')]:
            page.goto(f'http://localhost:8123/#/{route}'); page.wait_for_timeout(350); shot(page, name)
        page.goto('http://localhost:8123/#/reports'); page.get_by_role('tab', name='رسوم بيانية').click(); page.wait_for_timeout(300); page.screenshot(path=f'{SHOTS}/15-charts.png', full_page=True)
        page.get_by_role('tab', name='تقرير شامل').click(); page.wait_for_timeout(300); shot(page, '16-summary')
        txt = page.inner_text('main'); assert 'متطابق مع الدفتر' in txt, txt

        # settings: integrity check
        page.goto('http://localhost:8123/#/settings'); page.get_by_role('button', name='تشغيل الفحص').click()
        page.get_by_text('كل شيء متطابق').wait_for()

        # persistence: reload → lock screen → unlock → data still there
        page.reload(); page.get_by_text('أدخل كلمة السر للمتابعة').wait_for(); shot(page, '17-lock')
        page.get_by_label('كلمة السر').fill('wrongpass'); page.get_by_role('button', name='فتح').click(); page.get_by_text('كلمة السر غير صحيحة').wait_for()
        page.get_by_label('كلمة السر').fill('secret123'); page.get_by_role('button', name='فتح').click()
        page.get_by_role('heading', name='الإعدادات').wait_for()
        page.goto('http://localhost:8123/#/')
        page.get_by_text('54,870.00').first.wait_for()

        # desktop layout
        page.set_viewport_size({'width': 1280, 'height': 800}); page.wait_for_timeout(300); shot(page, '18-desktop')
        b.close()
finally:
    srv.terminate()
bad = [e for e in errors if 'favicon' not in e]
print('CONSOLE_ERRORS:', bad)
sys.exit(1 if bad else 0)
