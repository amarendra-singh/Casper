await page.getByRole('button',{name:'↑ Export ▾',exact:true}).click();
const downloaded = page.waitForEvent('download');
await page.getByRole('button',{name:'📤 Export as .xlsx',exact:true}).click();
const file = await downloaded;
await page.goto('http://127.0.0.1:5173/pnl/reports/999',{waitUntil:'domcontentloaded'});
return {export:file.suggestedFilename(),errors:auditErrors,observation:await tabbit.observe({frames:'none',maxChars:1200})};
