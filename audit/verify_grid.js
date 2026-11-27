await page.getByRole('button',{name:'Close',exact:true}).click();
await page.goto('http://127.0.0.1:5173/product/unit-economics',{waitUntil:'domcontentloaded'});
return await tabbit.observe({frames:'none',maxChars:3500});
