globalThis.nextAuditRoutes=['/product/unit-economics','/product/inventory','/product/categories','/vendors','/pricing','/calculator'];
const routes = globalThis.nextAuditRoutes;
assert(Array.isArray(routes));
const result=[];
for(const route of routes){
  const before=audit.responses.length;
  await page.goto('http://localhost:5173'+route, {waitUntil:'domcontentloaded'});
  await expect(page.locator('main')).toBeVisible();
  await page.waitForFunction(()=>{const m=document.querySelector('main');return m && m.innerText.trim().length>30 && !m.querySelector('.loader');});
  const data=await page.locator('main').evaluate(m=>({text:m.innerText.slice(0,2600),headings:[...m.querySelectorAll('h1,h2,h3')].map(e=>e.innerText),buttons:[...m.querySelectorAll('button')].map(e=>({text:e.innerText,label:e.getAttribute('aria-label'),disabled:e.disabled})).slice(0,18),links:[...m.querySelectorAll('a[href]')].map(a=>({text:a.innerText,href:a.getAttribute('href')})).slice(0,12),width:document.documentElement.scrollWidth,viewport:innerWidth}));
  const record={route,url:page.url(),...data,responses:audit.responses.slice(before)};
  audit.visits.push(record);result.push(record);
}
return {visits:result,errors:audit.errors,blockedWrites:audit.blockedWrites};
