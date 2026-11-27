await expect(page.getByRole('button',{name:'Export',exact:true})).toBeVisible();
await page.getByRole('button',{name:'Export',exact:true}).click();
return await tabbit.observe({frames:'none',maxChars:3500});
