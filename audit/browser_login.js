await page.goto('http://127.0.0.1:5173/login', {waitUntil: 'domcontentloaded'});
await expect(page.getByRole('button', {name: 'Sign in', exact: true})).toBeVisible();
return {observation: await tabbit.observe({frames: 'none', maxChars: 5000}), screenshot: await page.screenshot({fullPage: false})};
