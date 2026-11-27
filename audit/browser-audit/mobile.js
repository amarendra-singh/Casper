await page.setViewportSize({width:390,height:844});
await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await expect(page.getByText('Net revenue',{exact:true})).toBeVisible();
await page.getByRole('button',{name:'Open navigation and company menu',exact:true}).click();
const dialog=page.getByRole('dialog',{name:'Navigation and company',exact:true});
await expect(dialog).toBeVisible();
const result={dialog:await dialog.innerText(),companyOptions:await dialog.getByRole('combobox',{name:'Current company',exact:true}).locator('option').allTextContents(),screenshot:await page.screenshot({fullPage:false})};
await page.keyboard.press('Escape');
await expect(dialog).toHaveCount(0);
result.focusAfterEscape=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'));
for(const route of ['/product/inventory','/billing','/settings']){
  await page.goto('http://localhost:5173'+route,{waitUntil:'domcontentloaded'});
  await expect(page.locator('main')).toBeVisible();
  await page.waitForFunction(()=>{const m=document.querySelector('main');return m.innerText.length>70&&!m.querySelector('.loader')&&!m.innerText.includes('Loading');});
  result[route]=await page.evaluate(()=>({pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,mainWidth:document.querySelector('main').getBoundingClientRect().width,body:document.querySelector('main').innerText.slice(0,500)}));
}
await page.setViewportSize({width:1280,height:900});
return result;
