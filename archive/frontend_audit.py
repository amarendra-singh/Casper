"""
Comprehensive frontend audit script.
Navigates every page like a real user, takes screenshots, and reports design issues.
"""
import sys, os, json, traceback
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from datetime import datetime
from playwright.sync_api import sync_playwright

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "frontend_audit")
os.makedirs(OUTPUT_DIR, exist_ok=True)

BASE = "http://localhost:5173"
CREDS = {"email": os.environ["CASPER_AUDIT_EMAIL"], "password": os.environ["CASPER_AUDIT_PASSWORD"]}

results = []
def report(category, severity, page_url, description, detail=""):
    entry = {
        "category": category,
        "severity": severity,
        "page": page_url,
        "description": description,
        "detail": detail,
    }
    results.append(entry)
    icon = {"high": "!!!", "medium": "***", "low": "-->", "info": "   "}.get(severity, "   ")
    print(f"  {icon} [{severity.upper()}] {category}: {description}")
    if detail:
        for line in detail.split("\n"):
            print(f"      {line}")

def screenshot(page, name):
    path = os.path.join(OUTPUT_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    return path

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        
        # ── Test at desktop ──
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        console_errors = []
        page.on("console", lambda msg: console_errors.append(f"[{msg.type}] {msg.text[:300]}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda err: report("JS Error", "high", page.url, str(err)[:300], ""))
        
        try:
            test_full_desktop(page, console_errors)
        except Exception as e:
            traceback.print_exc()
            report("CRASH", "high", page.url, f"Desktop test crashed: {e}", traceback.format_exc()[:500])
        
        # ── Test at mobile ──
        page_m = context.new_page()
        page_m.set_viewport_size({"width": 375, "height": 812})
        mobile_errors = []
        page_m.on("console", lambda msg: mobile_errors.append(f"[{msg.type}] {msg.text[:300]}") if msg.type in ("error", "warning") else None)
        try:
            test_login(page_m, "mobile", mobile_errors)
        except Exception as e:
            traceback.print_exc()
            report("CRASH", "high", "mobile", f"Mobile test crashed: {e}", traceback.format_exc()[:500])
        
        browser.close()
    
    # Write report
    report_path = os.path.join(OUTPUT_DIR, "audit_report.json")
    with open(report_path, "w") as f:
        json.dump({"timestamp": datetime.now().isoformat(), "issues": results}, f, indent=2)
    
    print(f"\n{'='*60}")
    print(f"Audit complete. {len(results)} issues found.")
    print(f"Screenshots: {OUTPUT_DIR}")
    print(f"Report: {report_path}")
    
    high = sum(1 for r in results if r["severity"] == "high")
    med = sum(1 for r in results if r["severity"] == "medium")
    low = sum(1 for r in results if r["severity"] == "low")
    print(f"Severity: {high} high, {med} medium, {low} low")

def test_full_desktop(page, console_errors):
    if not test_login(page, "", console_errors):
        return
    
    # Already on dashboard after login
    test_dashboard_interactions(page, "")
    
    # Navigate all major pages
    pages_to_test = [
        ("PnL", "/pnl"),
        ("Fraud - Overview", "/fraud"),
        ("Fraud - Flipkart", "/fraud/flipkart"),
        ("SKUs", "/skus"),
        ("Vendors", "/vendors"),
        ("Pricing", "/pricing"),
        ("Settings - Platforms", "/settings"),
        ("Settings - Intro", "/settings/intro"),
        ("Users", "/users"),
    ]
    
    for label, path in pages_to_test:
        try:
            print(f"\n{'─'*50}")
            print(f"NAVIGATING: {label} → {path}")
            page.goto(f"{BASE}{path}", wait_until="networkidle")
            page.wait_for_timeout(3000)
            
            sp = screenshot(page, label.lower().replace(" ", "_").replace("-", "_"))
            report("Navigation", "info", page.url, f"{label} page loaded", f"Screenshot: {sp}")
            
            # Check page content
            body = page.inner_text("body")
            
            # Error states
            for err_text in ["internal server error", "something went wrong", "500 error"]:
                if err_text in body[:800].lower():
                    report("Backend", "high", page.url, f"Error on {label} page", f"Contains '{err_text}'")
            
            # Empty states
            for empty_text in ["no data", "no results", "no items found", "nothing here"]:
                if empty_text in body[:1000].lower():
                    report("Data", "medium", page.url, f"Empty state on {label}: '{empty_text}'")
            
            check_broken_images(page)
            check_overlaps(page, label.lower())
            
        except Exception as e:
            report("Navigation", "high", page.url, f"Failed navigating to {label} ({path}): {e}", 
                   traceback.format_exc()[:300])
    
    # Console error summary
    if console_errors:
        report("Console", "medium", "global", 
               f"Console errors/warnings: {len(console_errors)}", 
               "\n".join(console_errors[:10]))

def test_login(page, suffix, console_errors):
    print(f"\n{'='*60}")
    print(f"TESTING: Login (viewport: 1280x800)" if not suffix else "TESTING: Mobile Login (375x812)")
    
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(2000)
    
    sp = screenshot(page, f"login_{suffix}" if suffix else "login")
    report("Layout", "info", page.url, f"Login page loaded", f"Screenshot: {sp}")
    
    check_overlaps(page, "login")
    check_scroll_issues(page)
    
    # Check if the page rendered correctly
    body = page.inner_text("body")
    if "sign in" not in body.lower() and "login" not in body.lower():
        report("Auth", "high", page.url, "Login page may not be rendering correctly", 
               f"Page text starts with: {body[:200]}")
    
    # Find form fields
    email_input = page.query_selector('input[type="email"], input[name="email"], input[placeholder*="email"], input[placeholder*="Email"]')
    pass_input = page.query_selector('input[type="password"]')
    
    if not email_input or not pass_input:
        # Try any text input for email
        inputs = page.query_selector_all('input:not([type="hidden"])')
        if len(inputs) >= 2:
            email_input, pass_input = inputs[0], inputs[1]
            report("Auth", "low", page.url, "Login form fields detected by position (no type=email)", "")
        else:
            report("Auth", "high", page.url, "Cannot find login form fields", 
                   f"Inputs found: {len(inputs)}")
            return False
    
    email_input.fill(CREDS["email"])
    pass_input.fill(CREDS["password"])
    
    # Find and click submit
    submit = page.query_selector('button[type="submit"], button:has-text("Sign In"), button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")')
    if submit:
        submit.click()
    else:
        page.keyboard.press("Enter")
    
    page.wait_for_timeout(3000)
    sp = screenshot(page, f"post_login_{suffix}" if suffix else "post_login")
    
    current_url = page.url
    report("Auth", "info", current_url, f"Post-login URL: {current_url}", f"Screenshot: {sp}")
    
    if "login" in current_url.lower():
        report("Auth", "high", current_url, "Login failed — still on login page", 
               "Check credentials or form submission mechanism")
        return False
    
    # Check if we landed on dashboard
    body = page.inner_text("body").lower()
    if "dashboard" not in body and "pulse" not in body and "overview" not in body:
        report("Auth", "medium", current_url, "Post-login page doesn't look like dashboard", 
               f"Body starts: {body[:200]}")
    
    return True

def test_dashboard_interactions(page, suffix):
    """Test interactive elements on dashboard."""
    print(f"\n{'─'*50}")
    print("TESTING: Dashboard interactions")
    
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(2000)
    
    sp = screenshot(page, f"dashboard_full{suffix}")
    report("Layout", "info", page.url, "Dashboard full page", f"Screenshot: {sp}")
    
    # Check for loading spinners
    loaders = page.query_selector_all(".loader, [class*=loading], [class*=spinner]")
    visible_loaders = [l for l in loaders if l.is_visible()]
    if visible_loaders:
        report("UX", "high", page.url, 
               f"Loading spinners still visible ({len(visible_loaders)})", "")
    
    # Check KPI strip clicks
    kpis = page.query_selector_all(".kpi")
    if len(kpis) >= 3:
        kpis[2].click()
        page.wait_for_timeout(500)
        report("Interaction", "info", page.url, "Clicked KPI #3 — checking response", "")
    
    # Check channel filter clicks
    channels = page.query_selector_all(".ch-chip")
    if len(channels) >= 2:
        channels[1].click()
        page.wait_for_timeout(500)
        report("Interaction", "info", page.url, 
               f"Clicked channel filter '{channels[1].inner_text()[:20]}'", "")
    
    # Check metric toggle clicks
    perf_btns = page.query_selector_all(".pt-btn")
    if len(perf_btns) >= 2:
        perf_btns[1].click()
        page.wait_for_timeout(500)
        report("Interaction", "info", page.url, 
               f"Clicked perf metric '{perf_btns[1].inner_text()}'", "")
    
    # Check view toggle
    vt_btns = page.query_selector_all(".vt-btn")
    if len(vt_btns) >= 2:
        vt_btns[1].click()
        page.wait_for_timeout(500)
        report("Interaction", "info", page.url, "Clicked 'Per company' view toggle", "")
    
    # Check reports section buttons
    p_pills = page.query_selector_all(".p-pill")
    csv_btn = [b for b in p_pills if "CSV" in (b.inner_text() or "")]
    if csv_btn:
        csv_btn[0].click()
        page.wait_for_timeout(500)
        # Check if alert was shown
        try:
            alert = page.once("dialog", lambda d: d.accept())
            if alert:
                report("Interaction", "info", page.url, "CSV button shows alert dialog", "")
        except:
            report("Interaction", "info", page.url, "CSV button clicked (no dialog detected)", "")
    
    check_scroll_issues(page)

def check_broken_images(page):
    broken = page.evaluate("""() => {
        const imgs = document.querySelectorAll('img');
        return Array.from(imgs).filter(img => !img.complete || img.naturalWidth === 0).map(i => i.src);
    }""")
    if broken:
        report("Assets", "medium", page.url, f"Broken images: {len(broken)}", "\n".join(broken[:5]))

def check_overlaps(page, label):
    overlap_count = page.evaluate("""() => {
        const all = document.querySelectorAll('*');
        const rects = [];
        let count = 0;
        for (const el of all) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.width > 2000 || r.height > 2000) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            for (const prev of rects) {
                const o = prev.rect;
                const ox = Math.max(0, Math.min(r.right, o.right) - Math.max(r.left, o.left));
                const oy = Math.max(0, Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top));
                const overlap = ox * oy;
                if (overlap > 200 && overlap < r.width * r.height * 0.9 && overlap < o.width * o.height * 0.9) {
                    count++;
                }
            }
            rects.push({el, rect: r});
        }
        return count;
    }""")
    if overlap_count > 3:
        report("Layout", "medium", page.url, 
               f"Potential element overlaps on {label} (~{overlap_count} pairs)", "")
    elif overlap_count > 0:
        report("Layout", "low", page.url, 
               f"Minor element overlaps on {label} ({overlap_count})", "")

def check_scroll_issues(page):
    has_x = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 5")
    if has_x:
        report("Layout", "high", page.url, 
               "Horizontal scrollbar detected (content overflows viewport)", "")
    has_y = page.evaluate("document.documentElement.scrollHeight > document.documentElement.clientHeight + 50")
    if not has_y:
        report("Layout", "low", page.url, 
               "Page doesn't scroll — content may be cut off below viewport", "")

    # Check for overflow:hidden traps
    trapped = page.evaluate("""() => {
        const els = document.querySelectorAll('body, #root, .app, .canvas');
        for (const el of els) {
            const s = getComputedStyle(el);
            if (s.overflowX === 'hidden' || s.overflow === 'hidden') return el.tagName + '.' + (el.className || '');
        }
        return null;
    }""")
    if trapped:
        report("Layout", "medium", page.url, 
               f"Overflow hidden detected on {trapped} — may hide overflow content", "")

if __name__ == "__main__":
    run()
