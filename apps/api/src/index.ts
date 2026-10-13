import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

type Env = { DB: D1Database; RESEND_API_KEY: string; APP_BASE_URL: string; COOKIE_SECURE: string };
const app = new Hono<{ Bindings: Env }>();
const cookieName = "sft_session";
const id = () => crypto.randomUUID();
const hex = (v: Uint8Array) => [...v].map(x => x.toString(16).padStart(2, "0")).join("");
function randomToken() { const b = new Uint8Array(32); crypto.getRandomValues(b); return hex(b); }
async function digest(v: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))); }
async function hashPassword(password: string, salt = randomToken().slice(0,32)) {
 const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
 const bits = await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:310000,hash:"SHA-256"},key,256);
 return `${salt}:${hex(new Uint8Array(bits))}`;
}
async function checkPassword(password:string, stored:string) {
 const [salt,expected] = stored.split(":"); const candidate=(await hashPassword(password,salt)).split(":")[1] || "";
 if(candidate.length!==expected?.length) return false;
 let diff=0; for(let i=0;i<candidate.length;i++) diff|=candidate.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
const plusMinutes = (n:number) => new Date(Date.now()+n*60000).toISOString();
const plusDays = (n:number) => new Date(Date.now()+n*86400000).toISOString();
async function sendEmail(env:Env,to:string,subject:string,html:string) {
 if(!env.RESEND_API_KEY || env.RESEND_API_KEY==="re_your_key_here") throw new Error("Email is not configured");
 const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:"Smart Finance <onboarding@resend.dev>",to:[to],subject,html})});
 if(!res.ok) throw new Error(`Email provider returned ${res.status}`);
}
async function makeToken(db:D1Database,userId:string,purpose:"verify_email"|"reset_password") {
 const token=randomToken(); await db.prepare("INSERT INTO auth_tokens(id,user_id,token_hash,purpose,expires_at) VALUES(?,?,?,?,?)").bind(id(),userId,await digest(token),purpose,plusMinutes(purpose==="verify_email"?1440:30)).run(); return token;
}
async function currentUser(c:any) {
 const token=getCookie(c,cookieName); if(!token) return null;
 return await c.env.DB.prepare("SELECT u.id,u.name,u.email,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.session_hash=? AND s.expires_at>? LIMIT 1").bind(await digest(token),new Date().toISOString()).first();
}
async function member(db:D1Database,workspaceId:string,userId:string) {
 return db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId,userId).first();
}
app.use("*",async(c,next)=>{c.header("X-Content-Type-Options","nosniff");c.header("X-Frame-Options","DENY");c.header("Referrer-Policy","strict-origin-when-cross-origin");await next();});
app.get("/api/health",c=>c.json({status:"ok"}));

app.post("/api/auth/signup",async c=>{
 const b=await c.req.json<any>().catch(()=>({}));
 const name=String(b.name||"").trim(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
 const type=b.accountType==="business"?"business":"personal";
 if(!name||name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>128) return c.json({error:"Enter a valid name/email and password (12–128 characters)."},400);
 if(await c.env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first()) return c.json({error:"Unable to create account with those details. Try signing in or resetting your password."},409);
 const uid=id(),wid=id(),workspaceName=String(b.workspaceName||"").trim()||(type==="business"?`${name}'s business`:`${name}'s personal space`),currency=String(b.currency||"USD").toUpperCase();
 await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)").bind(uid,name,email,await hashPassword(password)),
  c.env.DB.prepare("INSERT INTO workspaces(id,owner_user_id,name,type,currency) VALUES(?,?,?,?,?)").bind(wid,uid,workspaceName,type,currency),
  c.env.DB.prepare("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?,?,?)").bind(wid,uid,"owner")
 ]);
 const token=await makeToken(c.env.DB,uid,"verify_email"),link=`${c.env.APP_BASE_URL.replace(/\/$/,"")}/verify-email?token=${encodeURIComponent(token)}`;
 try { await sendEmail(c.env,email,"Verify your Smart Finance account",`<p>Hi ${name.replace(/[<>&"]/g,"")},</p><p><a href="${link}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`); }
 catch { return c.json({message:"Account created, but email delivery is not configured or failed. Configure Resend before testing verification.",emailVerificationRequired:true},202); }
 return c.json({message:"Account created. Check your email to verify your address.",emailVerificationRequired:true},201);
});
app.post("/api/auth/verify-email",async c=>{
 const b=await c.req.json<any>().catch(()=>({})); if(!b.token) return c.json({error:"Token is required."},400);
 const row=await c.env.DB.prepare("SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose='verify_email' AND used_at IS NULL AND expires_at>?").bind(await digest(String(b.token)),new Date().toISOString()).first<any>();
 if(!row) return c.json({error:"Verification link is invalid or expired."},400);
 await c.env.DB.batch([c.env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(new Date().toISOString(),row.user_id),c.env.DB.prepare("UPDATE auth_tokens SET used_at=? WHERE id=?").bind(new Date().toISOString(),row.id)]);
 return c.json({message:"Email verified. You can now sign in."});
});
app.post("/api/auth/resend-verification",async c=>{
 const b=await c.req.json<any>().catch(()=>({})),email=String(b.email||"").trim().toLowerCase();
 const user=email?await c.env.DB.prepare("SELECT id,email_verified_at FROM users WHERE email=?").bind(email).first<any>():null;
 if(user&&!user.email_verified_at){const token=await makeToken(c.env.DB,user.id,"verify_email"),link=`${c.env.APP_BASE_URL.replace(/\/$/,"")}/verify-email?token=${encodeURIComponent(token)}`;try{await sendEmail(c.env,email,"Verify your Smart Finance account",`<p><a href="${link}">Verify email</a></p>`);}catch{}}
 return c.json({message:"If an unverified account exists, a verification email will be sent."});
});
app.post("/api/auth/signin",async c=>{
 const b=await c.req.json<any>().catch(()=>({})),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
 const user=await c.env.DB.prepare("SELECT id,name,email,password_hash,email_verified_at FROM users WHERE email=?").bind(email).first<any>();
 if(!user||!(await checkPassword(password,user.password_hash))) return c.json({error:"Invalid email or password."},401);
 if(!user.email_verified_at) return c.json({error:"Verify your email before signing in.",code:"EMAIL_NOT_VERIFIED"},403);
 const raw=randomToken(); await c.env.DB.prepare("INSERT INTO sessions(id,user_id,session_hash,expires_at) VALUES(?,?,?,?)").bind(id(),user.id,await digest(raw),plusDays(7)).run();
 setCookie(c,cookieName,raw,{httpOnly:true,secure:c.env.COOKIE_SECURE==="true",sameSite:"Lax",path:"/",maxAge:604800});
 return c.json({user:{id:user.id,name:user.name,email:user.email}});
});
app.post("/api/auth/signout",async c=>{const raw=getCookie(c,cookieName);if(raw)await c.env.DB.prepare("DELETE FROM sessions WHERE session_hash=?").bind(await digest(raw)).run();deleteCookie(c,cookieName,{path:"/"});return c.json({message:"Signed out."});});
app.get("/api/auth/me",async c=>{const u=await currentUser(c);return c.json({user:u?{id:u.id,name:u.name,email:u.email,emailVerified:Boolean(u.email_verified_at)}:null});});
app.post("/api/auth/forgot-password",async c=>{
 const b=await c.req.json<any>().catch(()=>({})),email=String(b.email||"").trim().toLowerCase();
 const user=email?await c.env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first<any>():null;
 if(user){const token=await makeToken(c.env.DB,user.id,"reset_password"),link=`${c.env.APP_BASE_URL.replace(/\/$/,"")}/reset-password?token=${encodeURIComponent(token)}`;try{await sendEmail(c.env,email,"Reset your Smart Finance password",`<p><a href="${link}">Reset your password</a></p><p>This link expires in 30 minutes.</p>`);}catch{}}
 return c.json({message:"If an account exists for that email, a password-reset link will be sent."});
});
app.post("/api/auth/reset-password",async c=>{
 const b=await c.req.json<any>().catch(()=>({})),token=String(b.token||""),password=String(b.password||"");
 if(!token||password.length<12||password.length>128)return c.json({error:"A token and password of 12–128 characters are required."},400);
 const row=await c.env.DB.prepare("SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose='reset_password' AND used_at IS NULL AND expires_at>?").bind(await digest(token),new Date().toISOString()).first<any>();
 if(!row)return c.json({error:"Reset link is invalid or expired."},400);
 const now=new Date().toISOString();
 await c.env.DB.batch([c.env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(await hashPassword(password),row.user_id),c.env.DB.prepare("UPDATE auth_tokens SET used_at=? WHERE id=?").bind(now,row.id),c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(row.user_id),c.env.DB.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND purpose='reset_password' AND used_at IS NULL").bind(now,row.user_id)]);
 return c.json({message:"Password reset successfully. Please sign in again."});
});
app.get("/api/workspaces",async c=>{
 const u=await currentUser(c);if(!u)return c.json({error:"Authentication required."},401);
 const rows=await c.env.DB.prepare("SELECT w.id,w.name,w.type,w.currency,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at").bind(u.id).all();
 return c.json({workspaces:rows.results});
});
app.get("/api/transactions",async c=>{
 const u=await currentUser(c);if(!u)return c.json({error:"Authentication required."},401);
 const wid=c.req.query("workspaceId");if(!wid||!(await member(c.env.DB,wid,u.id)))return c.json({error:"Workspace not found."},404);
 const rows=await c.env.DB.prepare("SELECT id,kind,amount_minor,currency,description,occurred_on,created_at FROM transactions WHERE workspace_id=? ORDER BY occurred_on DESC,created_at DESC LIMIT 200").bind(wid).all();
 return c.json({transactions:rows.results});
});
app.post("/api/transactions",async c=>{
 const u=await currentUser(c);if(!u)return c.json({error:"Authentication required."},401);
 const b=await c.req.json<any>().catch(()=>({})),amount=Number(b.amount);
 if(!b.workspaceId||!["income","expense"].includes(b.kind)||!Number.isSafeInteger(amount)||amount<=0||!String(b.description||"").trim()||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(b.occurredOn||"")))return c.json({error:"Provide workspaceId, kind, positive integer amount in minor units, description, and date."},400);
 if(!(await member(c.env.DB,b.workspaceId,u.id)))return c.json({error:"Workspace not found."},404);
 const currency=String(b.currency||"USD").toUpperCase(),tid=id();
 await c.env.DB.prepare("INSERT INTO transactions(id,workspace_id,created_by,kind,amount_minor,currency,description,occurred_on) VALUES(?,?,?,?,?,?,?,?)").bind(tid,b.workspaceId,u.id,b.kind,amount,currency,String(b.description).trim().slice(0,300),b.occurredOn).run();
 return c.json({id:tid},201);
});
app.get("/api/budgets",async c=>{
 const u=await currentUser(c);if(!u)return c.json({error:"Authentication required."},401);
 const wid=c.req.query("workspaceId");if(!wid||!(await member(c.env.DB,wid,u.id)))return c.json({error:"Workspace not found."},404);
 const rows=await c.env.DB.prepare("SELECT id,name,amount_minor,currency,period,starts_on,created_at FROM budgets WHERE workspace_id=? ORDER BY starts_on DESC").bind(wid).all();
 return c.json({budgets:rows.results});
});
app.post("/api/budgets",async c=>{
 const u=await currentUser(c);if(!u)return c.json({error:"Authentication required."},401);
 const b=await c.req.json<any>().catch(()=>({})),amount=Number(b.amount);
 if(!b.workspaceId||!String(b.name||"").trim()||!Number.isSafeInteger(amount)||amount<=0||!["weekly","monthly","yearly"].includes(b.period)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(b.startsOn||"")))return c.json({error:"Provide workspaceId, name, positive integer amount in minor units, period, and start date."},400);
 if(!(await member(c.env.DB,b.workspaceId,u.id)))return c.json({error:"Workspace not found."},404);
 const bid=id(),currency=String(b.currency||"USD").toUpperCase();
 await c.env.DB.prepare("INSERT INTO budgets(id,workspace_id,name,amount_minor,currency,period,starts_on) VALUES(?,?,?,?,?,?,?)").bind(bid,b.workspaceId,String(b.name).trim().slice(0,120),amount,currency,b.period,b.startsOn).run();
 return c.json({id:bid},201);
});
app.notFound(c=>c.json({error:"Not found."},404));
app.onError((err,c)=>{console.error("API error",err.message);return c.json({error:"Internal server error."},500);});
export default app;
