import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {connect} from "./cdp.mjs";

const c = await connect();
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) {
  for (let n=0; n<60; n++) { if (await fn()) return; await delay(200); }
  throw new Error("State did not settle");
}
try {
  const info = await c.invoke("app_info");
  assert.match(info.dataDir, /ai-cockpit-integration-/);
  for (const old of await c.invoke("sessions_open")) await c.invoke("session_close", {id:old.id});
  const project = await c.invoke("project_add", {path: process.cwd(), name:"Cockpit test"});
  const same = await c.invoke("project_add", {path: process.cwd().replaceAll("\\", "/")+"/.", name:"Duplicate"});
  assert.equal(same.id, project.id);
  const accounts = await c.invoke("accounts_list");
  const account = accounts.find(a=>a.name==='Test A') ?? await c.invoke("account_add", {input:{provider:"claude", name:"Test A", mode:"managed"}});
  const other = accounts.find(a=>a.name==='Test B') ?? await c.invoke("account_add", {input:{provider:"claude", name:"Test B", mode:"managed"}});
  assert.notEqual(account.configDir, other.configDir);
  assert.equal((await c.invoke("account_check_auth", {id:account.id, force:true})).authStatus,"logged-out");
  assert.equal((await c.invoke("account_check_auth", {id:other.id, force:true})).authStatus,"logged-out");
  const s = await c.invoke("session_create", {input:{accountId:account.id, projectId:project.id, name:"Resume integration"}});
  await c.call("Page.reload");
  await until(() => c.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Start')`));
  await c.click("Start");
  await until(async () => (await c.invoke("sessions_open")).find(x=>x.id===s.id)?.runtime?.running);
  await c.invoke("session_stop", {id:s.id});
  await until(async () => !(await c.invoke("sessions_open")).find(x=>x.id===s.id)?.runtime?.running);
  await until(() => c.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Resume')`));
  await c.click("Resume");
  await until(async () => (await c.invoke("sessions_open")).find(x=>x.id===s.id)?.runtime?.running);
  const resumed = (await c.invoke("sessions_open")).find(x=>x.id===s.id);
  assert.equal(resumed.providerSessionId,s.providerSessionId);
  assert.equal(resumed.requestedModel,null);
  await assert.rejects(() => c.invoke("session_start", {id:s.id,cols:80,rows:24}), /already running/);
  assert.equal((await c.invoke("sessions_open")).find(x=>x.id===s.id).runtime.running,true);
  await c.invoke("session_close", {id:s.id});
  await c.call("Page.reload");
  await until(() => c.evaluate(`document.body.innerText.includes('PROJECTS')`));
  await c.click("History");
  await until(() => c.evaluate(`document.body.innerText.includes('Resume integration')`));
  await c.click("Reopen");
  await until(() => c.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Resume')`));
  await c.click("Accounts");
  await fs.mkdir("artifacts",{recursive:true});
  await c.screenshot(path.resolve("artifacts/accounts-test.png"));
  await c.click("Sign in with another Claude account");
  await until(async () => (await c.invoke("sessions_open")).some(x=>x.kind==='login' && x.runtime?.running));
  console.log(JSON.stringify({result:"passed",projectDedup:true,accountIsolation:true,realStartStopResume:true,duplicateStartRejected:true,historyReopen:true,loginStarted:true,testData:info.dataDir},null,2));
} finally { c.close(); }
