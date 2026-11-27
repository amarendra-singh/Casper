await page.getByRole('button',{name:'↑ Export ▾',exact:true}).click();
await page.getByRole('button',{name:'📤 Export as .xlsx',exact:true}).click();
uxEvidence.excelExportErrors=auditErrors.slice();
await page.route('**/api/v1/billing/purchase-bills',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:101,bill_date:'2026-10-01',ref_no:'AUDIT-BILL',lines:[{id:101,item_name:'Synthetic audit item',price_unit:100,pack_multiple:1,unit_cost:100,sku_id:null,sku_code:null,recorded_cost:null,cost_diff:null}]}])}));
await page.goto('http://127.0.0.1:5173/ledger',{waitUntil:'domcontentloaded'});
return {evidence:uxEvidence,buttons:await page.locator('main button').allTextContents()};
