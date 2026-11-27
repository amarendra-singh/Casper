return {text:(await page.locator('main').innerText()).slice(0,4500),snapshot:await tabbit.observe({frames:'none',maxChars:1500}),responses:audit.responses.slice(-16),errors:audit.errors};
