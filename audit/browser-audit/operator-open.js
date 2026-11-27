globalThis.operatorEvidence={responses:[],errors:[],steps:[]};
page.on('response',r=>{if(r.url().includes('/api/v1/'))operatorEvidence.responses.push({url:r.url(),status:r.status(),method:r.request().method()});});
page.on('pageerror',e=>operatorEvidence.errors.push(String(e)));
await page.goto('http://localhost:5174/register',{waitUntil:'domcontentloaded'});
return await tabbit.observe({frames:'none',maxChars:5000});
