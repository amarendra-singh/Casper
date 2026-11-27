await expect(page.getByText('Net revenue', {exact:true})).toBeVisible();
return {text:await page.locator('main').innerText(), responses:audit.responses,errors:audit.errors,screenshot:await page.screenshot({fullPage:false})};
