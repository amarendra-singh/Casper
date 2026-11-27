await page.setViewportSize({width:1280,height:900});
await page.goto('http://127.0.0.1:5173/pnl/flipkart/101',{waitUntil:'domcontentloaded'});
await expect(page.getByText('Report not found',{exact:true})).toBeVisible();
uxEvidence.reportOutage={text:await page.locator('main').innerText(),request:auditRequests.filter(r=>r.path.startsWith('/pnl/reports')).slice(-1)};
await page.goto('http://127.0.0.1:5173/product/unit-economics',{waitUntil:'domcontentloaded'});
return {evidence:uxEvidence,observation:await tabbit.observe({frames:'none',maxChars:4500})};
