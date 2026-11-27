await page.route('**/api/v1/ledger/summary',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({income:0,expense:0,balance:0,entry_count:0,by_category:[],monthly:[]})}));
await page.reload({waitUntil:'domcontentloaded'});
await expect(page.getByRole('button',{name:'Bill Discrepancies',exact:true})).toBeVisible();
await page.getByRole('button',{name:'Bill Discrepancies',exact:true}).click();
await expect(page.getByPlaceholder('search SKU…',{exact:true})).toBeVisible();
await page.getByPlaceholder('search SKU…',{exact:true}).fill('NO-MATCH-AUDIT');
await page.keyboard.press('Tab');
uxEvidence.autocompleteTabTrap=await page.getByPlaceholder('search SKU…',{exact:true}).evaluate(e=>document.activeElement===e);
return {evidence:uxEvidence,errors:auditErrors};
