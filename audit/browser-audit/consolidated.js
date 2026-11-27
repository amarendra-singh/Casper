await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await expect(page.getByRole('button',{name:'Current company: Shringar House. Switch company',exact:true})).toBeVisible();
await page.getByRole('button',{name:'Current company: Shringar House. Switch company',exact:true}).click();
await page.getByRole('menuitem',{name:/^All Companies, consolidated/}).click();
await expect(page.getByRole('button',{name:'Current company: All Companies. Switch company',exact:true})).toBeVisible();
await expect(page.getByText('Net revenue',{exact:true})).toBeVisible();
globalThis.consolidatedEvidence={scope:'Live read-only company scope switching; restored Shringar House at end'};
const result=globalThis.consolidatedEvidence;
try {
  result.dashboard=(await page.locator('main').innerText()).slice(0,1400);
  await page.goto('http://localhost:5173/settings',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.st-card-head').first()).toBeVisible();
  await page.locator('.st-card-head').first().click();
  result.settings=(await page.locator('main').innerText()).slice(0,2000);
  result.enabledEdit=await page.getByRole('button',{name:'Edit Platform',exact:true}).first().isEnabled();
  await page.goto('http://localhost:5173/product/unit-economics',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{const t=document.querySelector('main')?.innerText||'';return /All Companies is a read-only|Reload|All saved|Could not load/.test(t);});
  result.catalogText=(await page.locator('main').innerText()).slice(0,1800);
  result.responses=audit.responses.slice(-18);
} finally {
  await page.getByRole('button',{name:'Current company: All Companies. Switch company',exact:true}).click();
  await page.getByRole('menuitem',{name:/^Shringar House, owner/}).click();
  await expect(page.getByRole('button',{name:'Current company: Shringar House. Switch company',exact:true})).toBeVisible();
}
return result;
