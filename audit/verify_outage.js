await page.goto('http://127.0.0.1:5173/pnl/reports/999',{waitUntil:'domcontentloaded'});
await expect(page.getByText('Could not load report. Please retry.')).toBeVisible();
return {errors:auditErrors, reportMessage:await page.locator('main').innerText()};
