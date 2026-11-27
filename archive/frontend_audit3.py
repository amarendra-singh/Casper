"""Quick check on zero-size elements and dead buttons."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
CREDS = {"email": os.environ["CASPER_AUDIT_EMAIL"], "password": os.environ["CASPER_AUDIT_PASSWORD"]}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.fill("#login-email", CREDS["email"])
    page.fill("#login-password", CREDS["password"])
    page.click('button[type="submit"]')
    page.wait_for_timeout(3000)
    
    # Check dashboard zero-size elements
    print("=== Zero-size elements on dashboard ===")
    details = page.evaluate("""() => {
        const all = document.querySelectorAll('*');
        return Array.from(all).filter(el => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') return false;
            if (el.tagName === 'BR' || el.tagName === 'WBR') return false;
            return (r.width === 0 || r.height === 0) && el.children.length > 0;
        }).slice(0, 15).map(el => ({
            tag: el.tagName,
            id: el.id || '',
            cls: (el.className || '').toString().slice(0, 40),
            rect: `${el.getBoundingClientRect().width.toFixed(0)}x${el.getBoundingClientRect().height.toFixed(0)}`,
            childCount: el.children.length,
        }));
    }""")
    for d in details:
        print(f"  {d['tag']}#{d['id']}.{d['cls']}: {d['rect']}, children:{d['childCount']}")
    
    # Check dead buttons on dashboard
    print("\n=== Buttons on dashboard ===")
    btns = page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        return Array.from(btns).map(b => ({
            text: (b.innerText || '').slice(0, 30),
            hasOnClick: b.hasAttribute('onclick') || !!b.onclick,
            type: b.getAttribute('type') || '',
            disabled: b.disabled,
            id: b.id || '',
        }));
    }""")
    for b in btns:
        react = "no-onclick" if not b['hasOnClick'] and not b['type'] and not b['disabled'] else ""
        marker = " <<< " if react else ""
        if marker or b['disabled']:
            print(f"  {b['text']:30s} type={b['type']:10s} disabled={str(b['disabled']):5s} {react}{marker}")
    
    browser.close()
