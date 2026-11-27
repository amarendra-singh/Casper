await page.goto('http://localhost:5173/calculator',{waitUntil:'domcontentloaded'});
await expect(page.getByRole('spinbutton',{name:'RTO rate',exact:true})).toBeVisible();
const before=(await page.locator('main').innerText()).slice(-700);
await page.getByRole('spinbutton',{name:'RTO rate',exact:true}).fill('100');
return {rateInputs:await page.locator('input[aria-label]').evaluateAll(es=>es.map(e=>({name:e.getAttribute('aria-label'),value:e.value,valid:e.checkValidity()}))),text:await page.locator('main').innerText(),before};
