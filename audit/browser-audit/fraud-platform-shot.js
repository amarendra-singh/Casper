return {text:await page.locator('main').innerText(),screenshot:await page.screenshot({fullPage:false})};
