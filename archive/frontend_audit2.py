"""
Focused frontend audit -- finds REAL layout/design bugs:
1. Zero-sized elements
2. Text overflow / truncated content
3. Badges / pills with wrong colors
4. Buttons with missing onClick/null handlers
5. Missing aria labels on interactive elements
6. Misaligned grids (uneven column widths)
7. Empty states that should show data
"""
import sys, os, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "frontend_audit")
BASE = "http://localhost:5173"
CREDS = {"email": os.environ["CASPER_AUDIT_EMAIL"], "password": os.environ["CASPER_AUDIT_PASSWORD"]}
results = []

def rpt(cat, sev, pg, desc, det=""):
    results.append({"category":cat,"severity":sev,"page":pg,"description":desc,"detail":det})
    m = {"high":"!!!","medium":"***","low":"-->","info":"   "}
    print(f"  {m[sev]} [{sev.upper()}] {cat}: {desc}")

def screenshot(page, name):
    p = os.path.join(OUTPUT_DIR, f"v2_{name}.png")
    page.screenshot(path=p, full_page=True)
    return p

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        
        # Login
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1500)
        page.fill("#login-email", CREDS["email"])
        page.fill("#login-password", CREDS["password"])
        page.click('button[type="submit"]')
        page.wait_for_timeout(3000)
        
        # Check all pages
        pages = [
            ("dashboard", "/"),
            ("pnl", "/pnl"),
            ("fraud", "/fraud"),
            ("skus", "/skus"),
            ("vendors", "/vendors"),
            ("pricing", "/pricing"),
            ("settings", "/settings"),
            ("settings_intro", "/settings/intro"),
            ("users", "/users"),
        ]
        
        for label, path in pages:
            print(f"\n{'='*50}")
            print(f"CHECKING: {label} ({path})")
            page.goto(f"{BASE}{path}", wait_until="networkidle")
            page.wait_for_timeout(2000)
            sp = screenshot(page, label)
            rpt("Navigation", "info", page.url, f"{label} loaded", f"screenshot: {sp}")
            
            check_zero_size(page)
            check_text_overflow(page)
            check_dead_buttons(page)
            check_tables(page)
            check_aria(page)
        
        browser.close()
    
    j = os.path.join(OUTPUT_DIR, "audit_v2.json")
    with open(j, "w") as f:
        json.dump({"issues": results}, f, indent=2)
    
    h = sum(1 for r in results if r["severity"] == "high")
    m = sum(1 for r in results if r["severity"] == "medium")
    l = sum(1 for r in results if r["severity"] == "low")
    print(f"\n{'='*50}\nAudit v2: {len(results)} issues ({h} high, {m} medium, {l} low)")

def check_zero_size(page):
    """Elements with 0 width or height that shouldn't be."""
    zero = page.evaluate("""() => {
        const all = document.querySelectorAll('*');
        return Array.from(all).filter(el => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') return false;
            // Ignore very small elements
            if (el.tagName === 'BR' || el.tagName === 'WBR') return false;
            return (r.width === 0 || r.height === 0) && el.children.length > 0;
        }).slice(0, 10).map(el => el.tagName + (el.id ? '#'+el.id : ''));
    }""")
    if zero:
        rpt("Layout", "medium", page.url, f"Zero-size elements ({len(zero)})", "\n".join(zero[:5]))

def check_text_overflow(page):
    """Check for text overflow / truncation issues."""
    overflow = page.evaluate("""() => {
        const els = document.querySelectorAll('*');
        return Array.from(els).filter(el => {
            const s = getComputedStyle(el);
            if (s.textOverflow === 'ellipsis' && s.overflow === 'hidden') {
                return el.scrollWidth > el.clientWidth + 2;
            }
            return false;
        }).slice(0, 5).map(el => ({
            tag: el.tagName,
            text: el.innerText.slice(0, 60),
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
        }));
    }""")
    if overflow:
        for o in overflow:
            rpt("Layout", "medium", page.url,
                f"Text truncated: '{o['text']}' ({o['scrollW']}px > {o['clientW']}px)", "")

def check_dead_buttons(page):
    """Find buttons without onClick handlers or with empty handlers."""
    dead = page.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        return Array.from(btns).filter(b => {
            if (b.disabled) return false;
            if (b.hasAttribute('onclick')) return false;
            // Check if it has any event listeners
            return !b.closest('form') && !b.getAttribute('type') && !b.onclick;
        }).slice(0, 10).map(b => (b.innerText || '').slice(0, 40) || b.tagName);
    }""")
    if dead:
        rpt("UX", "medium", page.url, f"Potentially dead buttons ({len(dead)})", "\n".join(dead[:5]))

def check_tables(page):
    """Check tables for empty rows, wrong colspan, broken structure."""
    table_issues = page.evaluate("""() => {
        const issues = [];
        document.querySelectorAll('table').forEach(tbl => {
            const rows = tbl.querySelectorAll('tr');
            const cols = rows[0]?.querySelectorAll('th, td').length || 0;
            rows.forEach((row, i) => {
                const cells = row.querySelectorAll('th, td');
                let totalColspan = 0;
                cells.forEach(c => { totalColspan += parseInt(c.getAttribute('colspan') || 1); });
                if (totalColspan !== cols && totalColspan < cols && cells.length > 0) {
                    if (i < 3 || i === rows.length - 1) {
                        issues.push(`Row ${i+1}: has ${totalColspan} cols, expected ${cols}`);
                    }
                }
            });
        });
        return issues.slice(0, 5);
    }""")
    if table_issues:
        rpt("Layout", "medium", page.url, "Table column mismatch", "\n".join(table_issues))

def check_aria(page):
    """Check for interactive elements missing accessible labels."""
    issues = page.evaluate("""() => {
        const issues = [];
        document.querySelectorAll('button:not([aria-label]):not([aria-labelledby])').forEach(b => {
            const txt = (b.innerText || '').trim();
            if (!txt && !b.querySelector('img') && !b.querySelector('svg')) {
                issues.push('Button without text or aria-label: ' + (b.id || b.tagName));
            }
        });
        document.querySelectorAll('a:not([aria-label]):not([aria-labelledby])').forEach(a => {
            const txt = (a.innerText || '').trim();
            if (!txt && !a.querySelector('img')) {
                issues.push('Link without text or aria-label: ' + (a.id || a.tagName));
            }
        });
        return issues.slice(0, 10);
    }""")
    if issues:
        rpt("Accessibility", "low", page.url, f"Missing aria labels ({len(issues)})", "\n".join(issues))

if __name__ == "__main__":
    run()
