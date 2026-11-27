await page.getByRole('button', {name:'Edit', exact:true}).click();
await expect(page.getByRole('dialog',{name:'Edit Pricing'})).toBeVisible();
await expect(page.getByLabel('CR Cost override (₹)')).toHaveValue('');
await expect(page.getByLabel('Damage Cost override (₹)')).toHaveValue('');
await page.keyboard.press('Escape');
await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeFocused();
await page.setViewportSize({width:390,height:844});
return await tabbit.observe({frames:'none',maxChars:4500});
