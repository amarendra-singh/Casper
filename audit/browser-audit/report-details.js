const result=[];
for(const route of ['/pnl/flipkart/5?view=pnl','/pnl/meesho/1?view=pnl','/pnl/snapdeal/2?view=pnl','/pnl/shopdeck/4?view=pnl']){
  await page.goto('http://localhost:5173'+route,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'← Reports',exact:true})).toBeVisible();
  await page.waitForFunction(()=>!document.querySelector('main').innerText.includes('Loading'));
  result.push({route,text:(await page.locator('main').innerText()).slice(0,3000),buttons:await page.locator('main button').allTextContents()});
}
return {reports:result,errors:audit.errors};
