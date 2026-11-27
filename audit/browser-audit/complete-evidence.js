await page.goto('http://localhost:5173/', {waitUntil:'domcontentloaded'});
await expect(page.getByText('Net revenue',{exact:true})).toBeVisible();
const evidence = {
  scope:'Live read-only inspection through Tabbit; synthetic page fixtures and disposable in-memory backend probes separately identified',
  finalUrl:page.url(),
  company:await page.getByRole('button',{name:'Current company: Shringar House. Switch company',exact:true}).innerText(),
  visited:audit.visits,
  failedResponses:audit.responses.filter(r=>r.url.includes('/api/v1/')&&r.status>=400),
  blockedWrites:audit.blockedWrites,
  pageErrors:audit.errors,
  consoleErrors:(audit.console||[]).slice(-15),
  ownedPageCount:pages().length
};
await context.unroute('**/api/**');
return evidence;
