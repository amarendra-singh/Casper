globalThis.audit = {responses: [], errors: [], blockedWrites: [], visits: []};
await context.route('**/api/**', async route => {
  const request = route.request();
  if (!['GET','HEAD','OPTIONS'].includes(request.method()) && !request.url().includes('/auth/refresh')) {
    audit.blockedWrites.push({method:request.method(), url:request.url()});
    await route.abort('blockedbyclient');
  } else await route.continue();
});
page.on('pageerror', error => audit.errors.push(String(error)));
page.on('response', response => {
  if(response.url().includes('/api/')) audit.responses.push({url:response.url(),status:response.status()});
});
await page.reload({waitUntil:'domcontentloaded'});
await expect(page.getByRole('button', {name:'Dashboard', exact:true})).toBeVisible();
return {observation:await tabbit.observe({frames:'none', maxChars:1000}),links:await page.locator('a[href]').evaluateAll(els=>els.map(a=>({text:a.innerText,url:a.getAttribute('href')}))), headings:await page.locator('h1,h2,h3').allTextContents()};
