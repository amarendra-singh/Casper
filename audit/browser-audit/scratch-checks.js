const original=page;
const scratch=await context.newPage();
const result={scope:'Synthetic GET responses on a scratch tab; all real writes blocked'};
try {
  usePage(scratch);
  await page.route('**/api/v1/auth/me',r=>r.fulfill({status:200,json:{id:1,name:'Synthetic viewer',email:'viewer@audit.invalid',role:'viewer',is_active:true}}));
  await page.route('**/api/v1/companies/1/context',r=>r.fulfill({status:200,json:{company:{id:1,name:'Shringar House',role:'viewer'},modules:{}}}));
  await page.goto('http://localhost:5173/settings',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.st-card-head').first()).toBeVisible();
  await page.locator('.st-card-head').first().click();
  result.viewerSettings={text:(await page.locator('main').innerText()).slice(0,2400),buttons:await page.locator('main button').evaluateAll(es=>es.map(e=>({text:e.innerText,name:e.getAttribute('aria-label'),disabled:e.disabled,role:e.getAttribute('role'),pressed:e.getAttribute('aria-pressed'),checked:e.getAttribute('aria-checked')})))};
  await page.goto('http://localhost:5173/billing',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'+ New invoice',exact:true})).toBeVisible();
  result.viewerBillingNewEnabled=await page.getByRole('button',{name:'+ New invoice',exact:true}).isEnabled();
  await page.route('**/api/v1/platforms/',r=>r.fulfill({status:503,json:{detail:'Synthetic audit outage'}}));
  await page.goto('http://localhost:5173/settings',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  result.settingsOutage=(await page.locator('main').innerText()).slice(-1600);
  await page.route('**/api/v1/pnl/reports/5',r=>r.fulfill({status:503,json:{detail:'Synthetic audit outage'}}));
  await page.goto('http://localhost:5173/pnl/flipkart/5',{waitUntil:'domcontentloaded'});
  await expect(page.getByText('Could not load report. Please retry.',{exact:false})).toBeVisible();
  result.reportOutage=await page.locator('main').innerText();
} finally {
  await scratch.close();usePage(original);
}
return result;
