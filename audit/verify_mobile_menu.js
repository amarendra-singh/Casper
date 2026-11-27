await page.getByRole('button',{name:'Open navigation and company menu'}).click();
await expect(page.getByRole('combobox',{name:'Company'})).toBeVisible();
await expect(page.getByRole('link',{name:'Business P&L',exact:true})).toBeVisible();
return {observation:await tabbit.observe({frames:'none',maxChars:3000}),screenshot:await page.screenshot({fullPage:false})};
