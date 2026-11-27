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

const DAY_MS = 86400000;

async function addAccess(sql, userId, days, credits, now) {
  const key = "user:" + userId;
  const previous = await read(sql,key);
  const account = {
    ...previous,
    until:Math.max(previous?.until || 0, now) + days * DAY_MS,
    credits:(previous?.credits ?? 15) + credits,
    trial:previous?.trial ?? true
  };
  await write(sql,key,account);
  return account;
}

export async function grantAccess(sql, userId, days, credits, requestId) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 365 ||
      !Number.isSafeInteger(credits) || credits < 1 || credits > 10000 ||
      typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw Error("INVALID_GRANT");
  }
  return sql.begin(async tx => {
    const key = "grant:" + requestId;
    const existing = await read(tx,key);
    if (existing) {
      if (existing.userId !== userId || existing.days !== days || existing.credits !== credits) throw Error("INVALID_GRANT");
      return {telegramId:userId, ...await balance(tx,userId)};
    }
    const now = Date.now();
    const account = await addAccess(tx,userId,days,credits,now);
    await write(tx,key,{userId,days,credits,createdAt:now});
    return {telegramId:userId,...account};
  });
}

export async function deductCredits(sql, userId, credits, requestId) {
  if (!Number.isSafeInteger(credits) || credits < 1 || credits > 10000 ||
      typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw Error("INVALID_DEDUCTION");
  }
  return sql.begin(async tx => {
    const operationKey = "deduction:" + requestId;
    const previous = await read(tx, operationKey);
    if (previous) {
      if (previous.userId !== userId || previous.credits !== credits) throw Error("INVALID_DEDUCTION");
      return balance(tx, userId);
    }

    const key = "user:" + userId;
    const account = await read(tx, key);
    if (!account || !Number.isSafeInteger(account.credits) || account.credits < credits) {
      throw Error("INSUFFICIENT_CREDITS");
    }
    const updated = { ...account, credits: account.credits - credits };
    await write(tx, key, updated);
    await write(tx, operationKey, { userId, credits, createdAt: Date.now() });
    return updated;
  });
}

export async function registerReferral(sql, userId, inviterId) {
  await sql.begin(async tx => {
    const key = "referral:" + userId;
    if (await read(tx,key)) return;
    const safeInviter = typeof inviterId === "string" && /^[1-9][0-9]{4,15}$/.test(inviterId) &&
      Number.isSafeInteger(Number(inviterId)) && inviterId !== userId ? inviterId : null;
    await write(tx,key,{inviterId:safeInviter,rewarded:false});
  });
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
    const term = confirmedTerm(o.planId,previous?.until || 0,now);
    const credits = (previous?.credits ?? 15) + plan.credits;
    await write(tx,key,{...previous,until:term.until,credits,trial:false,paidBefore:true});
    const referralKey = "referral:" + o.userId;
    const referral = await read(tx,referralKey);
    const firstPayment = !previous?.paidBefore && (!previous || previous.trial === true);
    if (firstPayment && referral?.inviterId && !referral.rewarded) {
      await addAccess(tx,referral.inviterId,14,30,now);
      await write(tx,referralKey,{...referral,rewarded:true,orderId:id});
    }
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
