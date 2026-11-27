await page.locator('input[accept=".csv,text/csv"]').setInputFiles('C:/WorkStation/Projects/Python/Casper/audit/browser-audit/operator/orders-synthetic.csv');
await page.locator('input[accept=".pdf,application/pdf"]').setInputFiles('C:/WorkStation/Projects/Python/Casper/audit/browser-audit/operator/supplier-synthetic.pdf');
await page.getByRole('button',{name:'Upload & match',exact:true}).click();
await page.waitForFunction(()=>/bills added|No transactions|Could not read|Failed|Choose an/.test(document.querySelector('main')?.innerText||''));
return {text:await page.locator('main').innerText(),inputs:await page.locator('main input').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),role:e.getAttribute('role'),placeholder:e.placeholder,value:e.type==='file'?'file-selected':e.value}))),buttons:await page.locator('main button').allTextContents(),responses:operatorEvidence.responses.slice(-4)};
