return {text:await page.locator('main').innerText(),buttons:await page.locator('main button').allTextContents(),errors:auditErrors};
