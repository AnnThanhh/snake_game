import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.TEST_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage(),errors=[],commands=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const payload='<img src=x onerror="window.__injected=true">',actionId='00000000-0000-4000-8000-000000000123';
let loggedIn=true,failAppeal=true;
const profile={id:'00000000-0000-4000-8000-000000000456',display_name:payload,username:'security_fixture',lives:0,gold:'0',dna:'0',evolution_points:'0',progression_level:1,catalog:[],snakes:[],mastery:[],meta:[],achievements:[]};
const restriction={id:actionId,scope:'ACCOUNT',scopeName:'Account',reason:payload,expiresAt:'2099-01-01T00:00:00Z',appealNotice:'Request review here.'};
await page.route('**/api/configuration',async route=>{const r=await route.fetch(),data=await r.json();data.copy.text_6995eb574e6742=payload;data.moderation.reportCategories[0].name=payload;await route.fulfill({json:data});});
await page.route('**/api/account/**',async route=>{
 const path=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().method()==='POST'?route.request().postDataJSON():null;
 if(path==='catalog'){const r=await route.fetch(),data=await r.json();data.catalog.species[0].name=payload;data.catalog.species[0].title=payload;data.catalog.species[0].color='" onload="window.__injected=true';await route.fulfill({json:data});return;}
 if(body)commands.push({path,body});
 if(path==='me'){await route.fulfill({json:{profile:loggedIn?profile:null}});return;}
 if(path==='logout'){loggedIn=false;await route.fulfill({json:{ok:true}});return;}
 if(path==='login'){await route.fulfill({status:403,json:{error:'Restricted',code:'ACCOUNT_BANNED',restriction}});return;}
 if(path==='appeals'&&failAppeal){failAppeal=false;await route.fulfill({status:503,json:{error:'Retry fixture'}});return;}
 if(path==='security'){await route.fulfill({json:{version:1,restrictions:loggedIn?[]:[restriction],notifications:[{id:actionId,kind:'REPORT_UPDATED',payload:{resolution:payload,status:'resolved'},created_at:'2026-10-05T00:00:00Z',read_at:null}],reports:[],appeals:[]}});return;}
 await route.fulfill({json:{ok:true,id:body?.requestId}});
});
async function noInjection(){assert.equal(await page.evaluate(()=>Boolean(window.__injected)),false);assert.equal(await page.locator('#modal-content img,#species-grid img').count(),0);}
try{
 const response=await page.goto(base);assert.equal(response.status(),200);assert.match(response.headers()['content-security-policy'],/script-src 'self'/);
 await page.waitForFunction(()=>document.querySelectorAll('.species-card').length>0);
 assert.match(await page.locator('.species-card').first().innerText(),/<img/);await noInjection();checks.push('Catalog name/title/color injection remains text; CSP active');
 await page.locator('[data-account=profile]').first().click();await page.locator('[data-account=report]').waitFor();await noInjection();
 await page.locator('[data-account=report]').click();assert.match(await page.locator('#player-report-form select').innerText(),/<img/);await page.locator('#player-report-form [name=username]').fill('target_fixture');await page.locator('#player-report-form [name=reason]').fill('Suspicious conduct with match evidence');await page.locator('#player-report-form [name=evidenceUrl]').fill('https://example.invalid/evidence');await page.locator('#player-report-form button').click();await page.locator('[data-notification-read]').waitFor();await noInjection();assert.ok(commands.some(c=>c.path==='reports'&&c.body.category==='cheating'&&c.body.requestId));checks.push('Report uses API categories, evidence and idempotency key; notification HTML escaped');
 await page.locator('[data-notification-read]').click();await page.waitForFunction(()=>!document.querySelector('[data-notification-read]:disabled'));
 await page.locator('#modal-close').click();await page.locator('[data-account=profile]').first().click();await page.locator('[data-account=logout]').click();await page.locator('#account-form').waitFor();assert.equal(await page.locator('#modal-content h2').innerText(),payload);await noInjection();
 await page.locator('#account-form [name=username]').fill('security_fixture');await page.locator('#account-form [name=password]').fill('fixture-password-only');await page.locator('#account-form button').click();await page.locator('.appeal-form').waitFor();await noInjection();assert.match(await page.locator('#modal-content').innerText(),/2099/);checks.push('Ban notice displays public scope/reason/expiry safely and exposes review form');
 await page.locator('.appeal-form [name=reason]').fill('Please review this restriction using match evidence');await page.locator('.appeal-form button').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Retry fixture');await page.locator('.appeal-form button').click();await page.locator('[data-notification-read]').waitFor();const appeals=commands.filter(c=>c.path==='appeals');assert.equal(appeals.length,2);assert.equal(appeals[0].body.requestId,appeals[1].body.requestId);assert.equal(appeals[0].body.actionId,actionId);await noInjection();checks.push('Appeal retry preserves idempotency and action identity');
 assert.deepEqual(errors,[]);await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/security-center.png',fullPage:true});await writeFile('artifacts/security-browser-results.json',JSON.stringify({date:new Date().toISOString(),checks,errors,scope:'Chrome UI with mocked account/security responses; backend permissions tested separately'},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await browser.close();}
