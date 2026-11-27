globalThis.uxEvidence = {};
uxEvidence.pricing = await page.locator('.pricing-page').innerText();
await page.getByRole('button', {name: 'Remove', exact: true}).click();
await expect(page.getByRole('alertdialog')).toBeVisible();
uxEvidence.initialDialogFocus = await page.evaluate(() => document.activeElement.textContent);
await page.getByRole('button', {name:'Cancel', exact:true}).focus();
await page.keyboard.press('Enter');
await expect(page.getByRole('alertdialog')).not.toBeVisible();
uxEvidence.cancelEnterIssuedDelete = auditRequests.filter(r => r.method === 'DELETE');
await page.setViewportSize({width:390,height:844});
uxEvidence.mobile = await page.evaluate(() => ({
  viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
  railDisplay: getComputedStyle(document.querySelector('.rail')).display,
  treeDisplay: getComputedStyle(document.querySelector('.tree')).display,
  visibleCompanySwitchers: [...document.querySelectorAll('[aria-label*="Current company"]')].filter(e=>e.getClientRects().length).length,
  visibleLinks: [...document.querySelectorAll('a[href]')].filter(e=>e.getClientRects().length).map(e=>({text:e.innerText,path:e.getAttribute('href')}))
}));
return {evidence:uxEvidence, observation:await tabbit.observe({frames:'none',maxChars:4500}), screenshot:await page.screenshot({fullPage:false})};
