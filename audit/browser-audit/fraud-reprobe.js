globalThis.audit.console=[];
page.on('console',msg=>{if(['error','warning'].includes(msg.type())) audit.console.push({type:msg.type(),text:msg.text().slice(0,1000)});});
return {html:await page.locator('main').innerHTML(),activeTabs:await page.locator('main button').evaluateAll(es=>es.map(e=>({text:e.innerText,cls:e.className}))),console:audit.console};
