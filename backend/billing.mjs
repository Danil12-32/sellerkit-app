import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { Text } from "@ydbjs/value/primitive";
import { plans, createPayment, confirmedTerm } from "./platega.mjs";

async function read(sql, key) {
  const [rows] = await sql`DECLARE $id AS Utf8;
    SELECT record FROM sellerkit_billing WHERE id=$id;`.parameter("id", new Text(key));
  return rows.length ? JSON.parse(String(rows[0].record)) : null;
}

async function write(sql, key, value) {
  await sql`DECLARE $id AS Utf8; DECLARE $value AS Utf8;
    UPSERT INTO sellerkit_billing (id, record) VALUES ($id,$value);`
    .parameter("id", new Text(key)).parameter("value", new Text(JSON.stringify(value)));
}

export async function checkout(sql, userId, planId, method) {
  if (!Object.hasOwn(plans, planId) || !["card","sbp","manager"].includes(method)) throw Error("INVALID_ORDER");
  const id = randomUUID();
  const order = {userId, planId, method, paid:false};
  if (method === "manager") {
    await write(sql,id,order);
    return {url:"https://t.me/CardLab100?text="+encodeURIComponent("Хочу оплатить SellerKit, заказ "+id+" · "+plans[planId].rubles+" ₽")};
  }
  const payment = await createPayment({orderId:id,planId,method});
  await write(sql,id,{...order, transactionId:payment.transactionId});
  return {url:payment.url};
}

export function authentic(headers) {
  const map = Object.fromEntries(Object.entries(headers || {}).map(([k,v])=>[k.toLowerCase(),v]));
  const matches = (a,b) => typeof a==="string" && !!b && timingSafeEqual(
    createHash("sha256").update(a).digest(),createHash("sha256").update(b).digest());
  return matches(map["x-merchantid"],process.env.PLATEGA_MERCHANT_ID) && matches(map["x-secret"],process.env.PLATEGA_SECRET);
}

export async function settle(sql,id,receipt) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw Error("INVALID_ORDER");
  const order = await sql.begin(async tx => {
    const o = await read(tx,id);
    if (!o) throw Error("UNKNOWN_ORDER");
    const plan = plans[o.planId];
    if (receipt ? (o.method==="manager" || receipt.id!==o.transactionId || receipt.currency!=="RUB" ||
      Number(receipt.amount)!==plan.rubles) : o.method!=="manager") throw Error("PAYMENT_MISMATCH");
    if (o.paid) return o;
    const key = "user:"+o.userId;
    const previous = await read(tx,key);
    const now = Date.now();
    const term = confirmedTerm(o.planId,previous?.trial ? 0 : previous?.until || 0,now);
    const remaining = previous ? (previous.until > now ? previous.credits : 0) : 15;
    const credits = remaining + plan.credits;
    await write(tx,key,{until:term.until,credits});
    const paid = {...o,paid:true,message:term.message,notified:false};
    await write(tx,id,paid);
    return paid;
  });
  if (!order.notified) {
    const result = await fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:order.userId,text:order.message}),signal:AbortSignal.timeout(8000)
    });
    if (!result.ok) throw Error("NOTIFICATION_PENDING");
    await write(sql,id,{...order,notified:true});
  }
  return {message:order.message};
}

export async function balance(sql,id) {
  return await read(sql,"user:"+id) || {until:0,credits:0};
}

export async function reserve(sql,id) {
  return sql.begin(async tx => {
    const key = "user:"+id;
    const account = await read(tx,key) || {until:Date.now()+5*86400000,credits:15,trial:true};
    if ( account.until<=Date.now() || account.credits<=0) return false;
    await write(tx,key,{...account,credits:account.credits-1});
    return true;
  });
}

export async function refund(sql,id) {
  await sql.begin(async tx => {
    const account = await balance(tx,id);
    if (account.until>Date.now()) await write(tx,"user:"+id,{...account,credits:account.credits+1});
  });
}
