const original=page;
const scratch=await context.newPage();
const inv={id:999999,company_id:1,company_name:'Disposable Seller',number:'AUDIT-ONLY-1',invoice_date:'2026-10-04',due_date:'2026-10-10',customer_name:'Synthetic customer',customer_gstin:'',gst_pct:3,status:'sent',subtotal:100,tax_amount:3,total:103,amount_paid:0,balance:103,bank_name:'',notes:'Synthetic fixture; never saved',lines:[{id:999999,description:'Audit-only item',quantity:1,unit_price:100,amount:100}]};
try {
  usePage(scratch);
  await page.route('**/api/v1/billing/',r=>r.fulfill({status:200,json:[inv]}));
  await page.goto('http://localhost:5173/billing',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Invoices',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Invoices',exact:true}).click();
  await page.getByRole('button',{name:'View invoice PDF',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Invoice AUDIT-ONLY-1',exact:true});
  await expect(dialog).toBeVisible();
  const result={scope:'Synthetic invoice GET fixture, no invoice saved and no print submitted',document:await dialog.innerText(),screenshot:await page.screenshot({fullPage:false})};
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  result.focusRestored=await page.getByRole('button',{name:'View invoice PDF',exact:true}).evaluate(e=>e===document.activeElement);
  return result;
} finally {await scratch.close();usePage(original);}
