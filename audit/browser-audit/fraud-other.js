const results=[];
for(const name of ['🗺️ State Risk Map','📋 Return Reasons','📦 SKU Vulnerability']){
  await page.getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('main').innerText.includes('Loading'));
  results.push({tab:name,text:(await page.locator('main').innerText()).slice(0,1800)});
}
return {tabs:results,console:audit.console,errors:audit.errors};
