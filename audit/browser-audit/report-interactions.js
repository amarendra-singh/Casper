const result=[];
for(const platform of ['flipkart','meesho','snapdeal','shopdeck']){
  await page.goto('http://localhost:5173/pnl/'+platform,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Real P&L',exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Real P&L',exact:true}).first().click();
  await expect(page.locator('main .loader')).toHaveCount(0);
  await page.waitForFunction(()=>{const t=document.querySelector('main')?.innerText||'';return t.length>150 && !t.includes('Loading');});
  result.push({platform,url:page.url(),text:(await page.locator('main').innerText()).slice(0,3000),buttons:await page.locator('main button').allTextContents()});
}
return {reports:result,errors:audit.errors};
