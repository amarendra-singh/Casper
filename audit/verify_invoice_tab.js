await page.getByRole('button',{name:'Invoices',exact:true}).click();
return await page.locator('main').innerText();
