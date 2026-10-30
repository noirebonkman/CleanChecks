var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/security.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var buffer = /* @__PURE__ */ __name((value) => value, "buffer");
function base64(value) {
  let text2 = "";
  for (const byte of value)
    text2 += String.fromCharCode(byte);
  return btoa(text2);
}
__name(base64, "base64");
function fromBase64(text2) {
  return Uint8Array.from(atob(text2), (character) => character.charCodeAt(0));
}
__name(fromBase64, "fromBase64");
async function digest(text2) {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text2))));
}
__name(digest, "digest");
function same(left, right) {
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++)
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return mismatch === 0;
}
__name(same, "same");
async function passwordHash(password2, salt = base64(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password2), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: buffer(fromBase64(salt)), iterations: 1e5, hash: "SHA-256" }, key, 256);
  return salt + "." + base64(new Uint8Array(bits));
}
__name(passwordHash, "passwordHash");
async function verifyPassword(password2, hash) {
  const salt = hash.split(".")[0];
  return same(await passwordHash(password2, salt), hash);
}
__name(verifyPassword, "verifyPassword");
async function dataKey(environment) {
  const bytes = fromBase64(environment.APP_DATA_KEY || "");
  if (bytes.length !== 32)
    throw new Error("Server encryption key is not configured");
  return crypto.subtle.importKey("raw", buffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(dataKey, "dataKey");
async function sealBytes(bytes, environment) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await dataKey(environment), buffer(bytes)));
  const result = new Uint8Array(12 + encrypted.length);
  result.set(iv);
  result.set(encrypted, 12);
  return result;
}
__name(sealBytes, "sealBytes");
async function openBytes(bytes, environment) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(bytes.slice(0, 12)) }, await dataKey(environment), buffer(bytes.slice(12))));
}
__name(openBytes, "openBytes");
async function seal(value, environment) {
  return base64(await sealBytes(encoder.encode(JSON.stringify(value)), environment));
}
__name(seal, "seal");
async function open(value, environment) {
  return JSON.parse(decoder.decode(await openBytes(fromBase64(value), environment)));
}
__name(open, "open");
function sessionToken(request) {
  const name = new URL(request.url).protocol === "https:" ? "__Host-cleanchecks_session" : "cleanchecks_session";
  return request.headers.get("Cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(name + "="))?.slice(name.length + 1);
}
__name(sessionToken, "sessionToken");
function cookie(token, request, maxAge = 43200) {
  const secure = new URL(request.url).protocol === "https:";
  const name = secure ? "__Host-cleanchecks_session" : "cleanchecks_session";
  return name + "=" + token + "; Path=" + (secure ? "/" : "/api") + "; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (secure ? "; Secure" : "");
}
__name(cookie, "cookie");

// src/validation.ts
var ApiError = class extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
  status;
  details;
  static {
    __name(this, "ApiError");
  }
};
function text(value, label, max = 4e3, required = false) {
  if (typeof value !== "string" || value.length > max || required && !value.trim())
    throw new ApiError(400, label + " \uAC12\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  return value;
}
__name(text, "text");
function id(value) {
  const result = text(value, "\uC2DD\uBCC4\uBC88\uD638", 100, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(result))
    throw new ApiError(400, "\uC2DD\uBCC4\uBC88\uD638 \uD615\uC2DD\uC774 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
  return result;
}
__name(id, "id");
function revision(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new ApiError(400, "\uC218\uC815 \uBC84\uC804\uC774 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
  return Number(value);
}
__name(revision, "revision");
function site(value) {
  if (!value || typeof value !== "object")
    throw new ApiError(400, "\uD604\uC7A5 \uC815\uBCF4\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const input = value;
  return { id: id(input.id), name: text(input.name, "\uD604\uC7A5\uBA85", 200, true), zone: text(input.zone, "\uAD6C\uC5ED", 200), address: text(input.address, "\uC8FC\uC18C", 500, true), priority: text(input.priority, "\uC6B0\uC120\uB3C4", 100), cycle: text(input.cycle, "\uC791\uC5C5\uC8FC\uAE30", 200) };
}
__name(site, "site");
function record(value) {
  if (!value || typeof value !== "object")
    throw new ApiError(400, "\uC810\uAC80\uD45C\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const input = value, result = { id: id(input.id), site: site(input.site) };
  for (const key of ["date", "type", "cycle", "technician", "rating", "issues", "action", "assignee", "due", "actionState", "notes", "updated"])
    result[key] = text(input[key], key);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(result.date)) || !Number.isFinite(Date.parse(String(result.date))))
    throw new ApiError(400, "\uC810\uAC80 \uC77C\uC2DC\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  if (input.status !== "draft" && input.status !== "complete")
    throw new ApiError(400, "\uC810\uAC80 \uC0C1\uD0DC\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  result.status = input.status;
  result.modified = Boolean(input.modified);
  if (input.completed !== void 0)
    result.completed = text(input.completed, "\uC644\uB8CC\uC77C", 100);
  const answers = input.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    throw new ApiError(400, "\uD3C9\uAC00 \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  const counts = [5, 6, 6, 5, 5, 6, 5];
  const cleanAnswers = {};
  for (const [key, grade] of Object.entries(answers)) {
    const match = /^(\d)-(\d)$/.exec(key);
    if (!match || Number(match[1]) > 6 || Number(match[2]) >= counts[Number(match[1])] || !["A", "B", "C", "N/A"].includes(String(grade)))
      throw new ApiError(400, "\uD3C9\uAC00 \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
    cleanAnswers[key] = String(grade);
  }
  if (input.status === "complete" && (Object.keys(cleanAnswers).length !== 38 || !["\uC591\uD638", "\uBCF4\uD1B5", "\uAC1C\uC120 \uD544\uC694", "\uC9D1\uC911 \uAD00\uB9AC"].includes(String(result.rating))))
    throw new ApiError(400, "\uC810\uAC80 \uD56D\uBAA9\uACFC \uC885\uD569\uD3C9\uAC00\uB97C \uBAA8\uB450 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  result.answers = cleanAnswers;
  if (!Array.isArray(input.photos) || input.photos.length !== 0)
    throw new ApiError(400, "\uC0AC\uC9C4 \uD30C\uC77C\uC740 \uC11C\uBC84\uB85C \uC804\uC1A1\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC571\uC744 \uCD5C\uC2E0 \uBC84\uC804\uC73C\uB85C \uC5C5\uB370\uC774\uD2B8\uD574 \uC8FC\uC138\uC694.");
  if (input.photoCount !== void 0 && (!Number.isSafeInteger(input.photoCount) || Number(input.photoCount) < 0 || Number(input.photoCount) > 20))
    throw new ApiError(400, "\uC0AC\uC9C4 \uC218\uB7C9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  result.photos = [];
  result.photoCount = Number(input.photoCount || 0);
  result.history = Array.isArray(input.history) ? input.history.slice(-200).map((entry) => ({ at: text(entry.at, "\uC218\uC815\uC77C", 100) })) : [];
  return result;
}
__name(record, "record");
async function readBody(request, max = 512e3) {
  const reader = request.body?.getReader();
  if (!reader)
    return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done)
      break;
    size += next.value.length;
    if (size > max) {
      while (!(await reader.read()).done) {
      }
      throw new ApiError(413, "\uD30C\uC77C \uB610\uB294 \uC785\uB825 \uB0B4\uC6A9\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4.");
    }
    chunks.push(next.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
__name(readBody, "readBody");
async function jsonBody(request) {
  try {
    const value = JSON.parse(new TextDecoder().decode(await readBody(request)));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch (error) {
    if (error instanceof ApiError)
      throw error;
    throw new ApiError(400, "\uC785\uB825 \uB0B4\uC6A9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  }
}
__name(jsonBody, "jsonBody");

// src/worker.ts
var sessionSeconds = 12 * 60 * 60;
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var send = /* @__PURE__ */ __name((value, status = 200, headers = {}) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } }), "send");
async function publicAccount(account, env) {
  return { id: account.id, username: account.username, name: await open(account.display_name, env), role: account.role, active: !!account.active };
}
__name(publicAccount, "publicAccount");
function loginName(value) {
  const name = text(value, "\uB85C\uADF8\uC778 \uC544\uC774\uB514", 80, true).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(name))
    throw new ApiError(400, "\uC544\uC774\uB514\uB294 \uC601\uBB38 \uC18C\uBB38\uC790\xB7\uC22B\uC790 \uB4F1 3~80\uC790\uB85C \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
  return name;
}
__name(loginName, "loginName");
function password(value) {
  const result = text(value, "\uBE44\uBC00\uBC88\uD638", 128, true);
  if (result.length < 12)
    throw new ApiError(400, "\uC11C\uBC84 \uBE44\uBC00\uBC88\uD638\uB294 12\uC790 \uC774\uC0C1\uC73C\uB85C \uC124\uC815\uD574 \uC8FC\uC138\uC694.");
  return result;
}
__name(password, "password");
async function authenticate(request, env) {
  const token = sessionToken(request);
  if (!token || token.length > 200)
    throw new ApiError(401, "\uC11C\uBC84\uC5D0 \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.");
  const user = await env.DB.prepare("SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 AND a.deleted_at IS NULL").bind(await digest(token), Date.now()).first();
  if (!user)
    throw new ApiError(401, "\uB85C\uADF8\uC778\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.");
  await open(user.display_name, env);
  return user;
}
__name(authenticate, "authenticate");
function requireAdmin(account) {
  if (account.role !== "admin" && account.role !== "owner")
    throw new ApiError(403, "\uC11C\uBC84 \uAD00\uB9AC\uC790\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
}
__name(requireAdmin, "requireAdmin");
function audit(env, actor, action, target) {
  return env.DB.prepare("INSERT INTO audit(id,actor_id,action,target_id,at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), actor, action, target, now());
}
__name(audit, "audit");
async function listRecords(request, env, account, all = false) {
  const url = new URL(request.url), cursor = url.searchParams.get("cursor") || "";
  if (cursor)
    id(cursor);
  const rows = await env.DB.prepare(all ? "SELECT * FROM inspections WHERE id>? ORDER BY id LIMIT 101" : "SELECT * FROM inspections WHERE account_id=? AND id>? ORDER BY id LIMIT 101").bind(...all ? [cursor] : [account.id, cursor]).all();
  const page = rows.results.slice(0, 100);
  return send({ records: await Promise.all(page.map(async (row) => ({ id: row.id, ownerId: row.account_id, revision: row.revision, deleted: !!row.deleted, updated: row.updated_at, record: row.deleted ? null : await open(row.payload, env) }))), nextCursor: rows.results.length > 100 ? page[page.length - 1].id : null });
}
__name(listRecords, "listRecords");
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!path.startsWith("/api/"))
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("CleanChecks API", { status: 200 });
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!loopback && url.protocol !== "https:")
    throw new ApiError(400, "HTTPS \uC811\uC18D\uB9CC \uD5C8\uC6A9\uD569\uB2C8\uB2E4.");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site")
    throw new ApiError(403, "\uC678\uBD80 \uC0AC\uC774\uD2B8 \uC694\uCCAD\uC740 \uD5C8\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    const localOrigin = loopback && ["http://127.0.0.1:5179", "http://localhost:5179"].includes(origin || "");
    if (!origin || origin !== url.origin && !localOrigin)
      throw new ApiError(403, "\uD5C8\uC6A9\uD558\uC9C0 \uC54A\uC740 \uC811\uC18D \uC8FC\uC18C\uC785\uB2C8\uB2E4.");
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
      throw new ApiError(415, "JSON \uD615\uC2DD\uB9CC \uD5C8\uC6A9\uD569\uB2C8\uB2E4.");
  }
  if (path === "/api/health" && method === "GET") {
    try {
      if (fromBase64(env.APP_DATA_KEY || "").length !== 32)
        throw Error();
    } catch {
      throw new ApiError(503, "\uC11C\uBC84 \uC554\uD638\uD654 \uC124\uC815\uC774 \uC900\uBE44\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
    }
    await env.DB.prepare("SELECT id FROM installation WHERE id=1").first();
    const owner = await env.DB.prepare("SELECT display_name FROM accounts WHERE username=?").bind("ludmin").first();
    if (owner) {
      try {
        await open(owner.display_name, env);
      } catch {
        throw new ApiError(503, "\uAE30\uC874 \uC790\uB8CC\uC758 \uC554\uD638\uD654 \uD0A4\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694. \uC0C8 \uD0A4\uB85C \uB36E\uC5B4\uC4F0\uC9C0 \uB9C8\uC138\uC694.");
      }
    }
    return send({ ok: true, service: "cleanchecks", version: "0.94", photoStorage: "local-only" });
  }
  if (path === "/api/setup" && method === "POST") {
    const body = await jsonBody(request);
    if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 32 || !same(String(body.setupToken || ""), env.SETUP_TOKEN))
      throw new ApiError(403, "\uC11C\uBC84 \uCD08\uAE30 \uC124\uC815 \uCF54\uB4DC\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
    const username = loginName(body.username), name = text(body.name, "\uC774\uB984", 100, true);
    if (username !== "ludmin")
      throw new ApiError(400, "\uCD5C\uCD08 \uC6B4\uC601\uC790 \uC544\uC774\uB514\uB294 ludmin\uC785\uB2C8\uB2E4.");
    const hash = await passwordHash(password(body.password)), userId = crypto.randomUUID();
    if (await env.DB.prepare("SELECT id FROM installation WHERE id=1").first())
      throw new ApiError(409, "\uCD08\uAE30 \uC124\uC815\uC774 \uC774\uBBF8 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO installation(id) VALUES(1)"),
        env.DB.prepare("INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").bind(userId, username, await seal(name, env), hash, "owner", now()),
        audit(env, userId, "server-initialized", userId)
      ]);
    } catch {
      throw new ApiError(409, "\uCD08\uAE30 \uC124\uC815\uC774 \uC774\uBBF8 \uC644\uB8CC\uB418\uC5C8\uAC70\uB098 \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    }
    return send({ ok: true }, 201);
  }
  if (path === "/api/login" && method === "POST") {
    const body = await jsonBody(request), username = loginName(body.username), provided = text(body.password, "\uBE44\uBC00\uBC88\uD638", 128, true), clock = Date.now();
    await env.DB.prepare("DELETE FROM login_attempts WHERE expires_at<?").bind(clock).run();
    const attempts = await env.DB.prepare("INSERT INTO login_attempts(username,failures,expires_at) VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN expires_at<? THEN 1 ELSE failures+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING failures,expires_at").bind(username, clock + 15 * 6e4, clock, clock).first();
    if (!attempts || attempts.failures > 8)
      throw new ApiError(429, "\uB85C\uADF8\uC778 \uC2DC\uB3C4\uAC00 \uB9CE\uC2B5\uB2C8\uB2E4. 15\uBD84 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
    const account2 = await env.DB.prepare("SELECT * FROM accounts WHERE username=?").bind(username).first();
    const dummy = "AAAAAAAAAAAAAAAAAAAAAA==.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const valid = await verifyPassword(provided, account2?.password_hash || dummy);
    if (!account2 || !account2.active || account2.deleted_at || !valid)
      throw new ApiError(401, "\uC544\uC774\uB514 \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
    const token = base64(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_attempts WHERE username=?").bind(username),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(clock),
      env.DB.prepare("DELETE FROM sessions WHERE account_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id=? ORDER BY expires_at DESC LIMIT 4)").bind(account2.id, account2.id),
      env.DB.prepare("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)").bind(await digest(token), account2.id, clock + sessionSeconds * 1e3),
      audit(env, account2.id, "login", account2.id)
    ]);
    return send({ user: await publicAccount(account2, env) }, 200, { "Set-Cookie": cookie(token, request) });
  }
  const account = await authenticate(request, env);
  if (path === "/api/session" && method === "GET")
    return send({ user: await publicAccount(account, env) });
  if (path === "/api/logout" && method === "POST") {
    const token = sessionToken(request) || "";
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return send({ ok: true }, 200, { "Set-Cookie": cookie("", request, 0) });
  }
  if (path === "/api/password" && method === "POST") {
    const body = await jsonBody(request);
    if (!await verifyPassword(text(body.current, "\uD604\uC7AC \uBE44\uBC00\uBC88\uD638", 128, true), account.password_hash))
      throw new ApiError(401, "\uD604\uC7AC \uBE44\uBC00\uBC88\uD638\uAC00 \uB2E4\uB985\uB2C8\uB2E4.");
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET password_hash=? WHERE id=?").bind(await passwordHash(password(body.password)), account.id),
      env.DB.prepare("DELETE FROM sessions WHERE account_id=?").bind(account.id),
      audit(env, account.id, "password-changed", account.id)
    ]);
    return send({ ok: true }, 200, { "Set-Cookie": cookie("", request, 0) });
  }
  if (path === "/api/accounts") {
    requireAdmin(account);
    if (method === "GET") {
      const result = await env.DB.prepare(account.role === "owner" ? "SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at LIMIT 500" : "SELECT * FROM accounts WHERE role<>'owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 500").all();
      return send({ users: await Promise.all(result.results.map((row) => publicAccount(row, env))) });
    }
    if (method === "POST") {
      const body = await jsonBody(request), username = loginName(body.username), name = text(body.name, "\uC774\uB984", 100, true);
      const hash = await passwordHash(password(body.password)), userId = crypto.randomUUID();
      const duplicate = await env.DB.prepare("SELECT id FROM accounts WHERE username=?").bind(username).first();
      if (duplicate)
        throw new ApiError(409, "\uAC19\uC740 \uC544\uC774\uB514\uAC00 \uC788\uC2B5\uB2C8\uB2E4.");
      if (body.role && body.role !== "inspector" && (body.role !== "admin" || account.role !== "owner"))
        throw new ApiError(403, "\uAD00\uB9AC\uC790 \uACC4\uC815\uC740 \uCD5C\uC0C1\uC704 \uC6B4\uC601\uC790\uB9CC \uB9CC\uB4E4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
      const role = body.role === "admin" ? "admin" : "inspector";
      await env.DB.batch([env.DB.prepare("INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").bind(userId, username, await seal(name, env), hash, role, now()), audit(env, account.id, "account-created", userId)]);
      return send({ ok: true }, 201);
    }
  }
  const accountMatch = /^\/api\/accounts\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (accountMatch && method === "PATCH") {
    requireAdmin(account);
    const target = id(accountMatch[1]), body = await jsonBody(request);
    if (target === account.id)
      throw new ApiError(400, "\uBCF8\uC778 \uACC4\uC815\uC740 \uC774 \uBA54\uB274\uC5D0\uC11C \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    const targetAccount = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(target).first();
    if (!targetAccount || targetAccount.role === "owner" || targetAccount.role === "admin" && account.role !== "owner")
      throw new ApiError(404, "\uC810\uAC80\uC790 \uACC4\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
    if (typeof body.active === "boolean")
      await env.DB.batch([env.DB.prepare("UPDATE accounts SET active=? WHERE id=?").bind(body.active ? 1 : 0, target), env.DB.prepare("DELETE FROM sessions WHERE account_id=?").bind(target), audit(env, account.id, body.active ? "account-enabled" : "account-disabled", target)]);
    else if (body.password)
      await env.DB.batch([env.DB.prepare("UPDATE accounts SET password_hash=? WHERE id=?").bind(await passwordHash(password(body.password)), target), env.DB.prepare("DELETE FROM sessions WHERE account_id=?").bind(target), audit(env, account.id, "password-reset", target)]);
    else
      throw new ApiError(400, "\uBCC0\uACBD\uD560 \uAC12\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
    return send({ ok: true });
  }
  if (path === "/api/sites" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM sites ORDER BY id LIMIT 2000").all();
    return send({ sites: await Promise.all(rows.results.map(async (row) => ({ site: await open(row.payload, env), revision: row.revision }))) });
  }
  const siteMatch = /^\/api\/sites\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (siteMatch && method === "PUT") {
    requireAdmin(account);
    const body = await jsonBody(request), value = site(body.site), expected = revision(body.revision), operation = crypto.randomUUID(), at = now();
    if (value.id !== siteMatch[1])
      throw new ApiError(400, "\uD604\uC7A5 \uC2DD\uBCC4\uBC88\uD638\uAC00 \uB2E4\uB985\uB2C8\uB2E4.");
    const result = await env.DB.batch([
      expected === 0 ? env.DB.prepare("INSERT INTO sites(id,payload,revision,operation_id,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(id) DO NOTHING").bind(value.id, await seal(value, env), operation, at) : env.DB.prepare("UPDATE sites SET payload=?,revision=revision+1,operation_id=?,updated_at=? WHERE id=? AND revision=?").bind(await seal(value, env), operation, at, value.id, expected),
      env.DB.prepare("INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sites WHERE id=? AND operation_id=?)").bind(crypto.randomUUID(), account.id, "site-saved", value.id, at, value.id, operation)
    ]);
    if (result[0].meta.changes !== 1)
      throw new ApiError(409, "\uD604\uC7A5\uC774 \uB2E4\uB978 \uAE30\uAE30\uC5D0\uC11C \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    return send({ revision: expected + 1 });
  }
  if (path === "/api/records" && method === "GET") {
    if (account.role !== "inspector")
      throw new ApiError(403, "\uAD00\uB9AC \uACC4\uC815\uC740 \uC77C\uBC18 \uC810\uAC80\uC790\uB85C \uC5F0\uACB0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    return listRecords(request, env, account);
  }
  if (path === "/api/admin/records" && method === "GET") {
    requireAdmin(account);
    return listRecords(request, env, account, true);
  }
  const recordMatch = /^\/api\/records\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (recordMatch && (method === "PUT" || method === "DELETE")) {
    if (account.role !== "inspector")
      throw new ApiError(403, "\uAD00\uB9AC \uACC4\uC815\uC740 \uC77C\uBC18 \uC810\uAC80\uC790\uB85C \uC5F0\uACB0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    const recordId = id(recordMatch[1]), body = await jsonBody(request), expected = revision(body.revision), at = now(), operation = crypto.randomUUID();
    const value = method === "PUT" ? record(body.record) : null;
    if (value && value.id !== recordId)
      throw new ApiError(400, "\uC810\uAC80\uD45C \uC2DD\uBCC4\uBC88\uD638\uAC00 \uB2E4\uB985\uB2C8\uB2E4.");
    const payload = await seal(value, env), deleted = method === "DELETE" ? 1 : 0;
    const result = await env.DB.batch([
      expected === 0 ? env.DB.prepare("INSERT INTO inspections(id,account_id,payload,revision,deleted,operation_id,updated_at) SELECT ?,?,?,1,?,?,? WHERE ?=0 ON CONFLICT(id) DO NOTHING").bind(recordId, account.id, payload, deleted, operation, at, deleted) : env.DB.prepare("UPDATE inspections SET payload=?,revision=revision+1,deleted=?,operation_id=?,updated_at=? WHERE id=? AND account_id=? AND revision=?").bind(payload, deleted, operation, at, recordId, account.id, expected),
      env.DB.prepare("INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)").bind(crypto.randomUUID(), account.id, deleted ? "inspection-deleted" : "inspection-saved", recordId, at, recordId, operation)
    ]);
    if (result[0].meta.changes !== 1)
      throw new ApiError(409, "\uB2E4\uB978 \uAE30\uAE30\uC5D0\uC11C \uBCC0\uACBD\uB418\uC5C8\uAC70\uB098 \uC811\uADFC\uD560 \uC218 \uC5C6\uB294 \uC810\uAC80\uD45C\uC785\uB2C8\uB2E4.");
    return send({ revision: expected + 1, updated: at });
  }
  if (path === "/api/photos" || path.startsWith("/api/photos/"))
    throw new ApiError(410, "\uC11C\uBC84 \uC0AC\uC9C4 \uC800\uC7A5\uC740 \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4\uC740 \uCD2C\uC601\uD55C \uAE30\uAE30\uC5D0 \uBCF4\uAD00\uB429\uB2C8\uB2E4.");
  const ownerRecord = /^\/api\/owner\/records\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (ownerRecord && method === "DELETE") {
    if (account.role !== "owner")
      throw new ApiError(403, "\uCD5C\uC0C1\uC704 \uC6B4\uC601\uC790\uB9CC \uB2E4\uB978 \uC0AC\uB78C\uC758 \uAE30\uB85D\uC744 \uC0AD\uC81C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    const recordId = id(ownerRecord[1]), body = await jsonBody(request), expected = revision(body.revision);
    const reason = text(body.reason, "\uC0AD\uC81C \uC0AC\uC720", 1e3, true);
    const existing = await env.DB.prepare("SELECT * FROM inspections WHERE id=?").bind(recordId).first();
    if (!existing)
      throw new ApiError(404, "\uC810\uAC80 \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    const operation = crypto.randomUUID(), at = now(), payload = await seal(null, env);
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE inspections SET payload=?,revision=revision+1,deleted=1,operation_id=?,updated_at=? WHERE id=? AND revision=? AND deleted=0").bind(payload, operation, at, recordId, expected),
      env.DB.prepare("INSERT INTO owner_actions(id,actor_id,target_id,action,detail,at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)").bind(crypto.randomUUID(), account.id, recordId, "record-deleted", await seal({ reason, accountId: existing.account_id, name: (await open(existing.payload, env))?.site?.name || recordId }, env), at, recordId, operation),
      env.DB.prepare("INSERT INTO audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inspections WHERE id=? AND operation_id=?)").bind(crypto.randomUUID(), account.id, "owner-deleted-record", recordId, at, recordId, operation)
    ]);
    if (results[0].meta.changes !== 1)
      throw new ApiError(409, "\uAE30\uB85D\uC774 \uBCC0\uACBD\uB418\uC5C8\uAC70\uB098 \uC774\uBBF8 \uC0AD\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uBD88\uB7EC\uC640 \uC8FC\uC138\uC694.");
    return send({ revision: expected + 1 });
  }
  const ownerAccount = /^\/api\/owner\/accounts\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (ownerAccount && method === "DELETE") {
    if (account.role !== "owner")
      throw new ApiError(403, "\uCD5C\uC0C1\uC704 \uC6B4\uC601\uC790\uB9CC \uC810\uAC80\uC790\uB97C \uC0AD\uC81C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    const target = id(ownerAccount[1]), body = await jsonBody(request), reason = text(body.reason, "\uC0AD\uC81C \uC0AC\uC720", 1e3, true);
    const person = await env.DB.prepare("SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL").bind(target).first();
    if (!person || person.role === "owner" || person.id === account.id)
      throw new ApiError(400, "\uC0AD\uC81C\uD560 \uC218 \uC5C6\uB294 \uACC4\uC815\uC785\uB2C8\uB2E4.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM inspections WHERE account_id=? AND deleted=0").bind(target).first();
    const at = now(), operation = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET active=0,deleted_at=? WHERE id=?").bind(at, target),
      env.DB.prepare("DELETE FROM sessions WHERE account_id=?").bind(target),
      env.DB.prepare("UPDATE inspections SET payload=?,deleted=1,revision=revision+1,operation_id=?,updated_at=? WHERE account_id=? AND deleted=0").bind(await seal(null, env), operation, at, target),
      env.DB.prepare("INSERT INTO owner_actions(id,actor_id,target_id,action,detail,at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), account.id, target, "account-deleted", await seal({ reason, name: await open(person.display_name, env), recordCount: count?.total || 0 }, env), at),
      audit(env, account.id, "owner-deleted-account", target)
    ]);
    return send({ ok: true, deletedRecords: count?.total || 0 });
  }
  if (path === "/api/owner/history" && method === "GET") {
    if (account.role !== "owner")
      throw new ApiError(403, "\uCD5C\uC0C1\uC704 \uC6B4\uC601\uC790\uB9CC \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    const rows = await env.DB.prepare("SELECT * FROM owner_actions ORDER BY at DESC LIMIT 200").all();
    return send({ events: await Promise.all(rows.results.map(async (row) => ({ id: row.id, actorId: row.actor_id, targetId: row.target_id, action: row.action, detail: await open(row.detail, env), at: row.at }))) });
  }
  if (path === "/api/audit" && method === "GET") {
    requireAdmin(account);
    const rows = await env.DB.prepare("SELECT actor_id,action,target_id,at FROM audit ORDER BY at DESC LIMIT 200").all();
    return send({ events: rows.results });
  }
  throw new ApiError(404, "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC694\uCCAD\uC785\uB2C8\uB2E4.");
}
__name(route, "route");
function secureResponse(response, request) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  if (new URL(request.url).protocol === "https:")
    headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
__name(secureResponse, "secureResponse");
var worker_default = {
  async fetch(request, env) {
    let response;
    try {
      response = await route(request, env);
    } catch (error) {
      response = error instanceof ApiError ? send({ error: error.message, details: error.details }, error.status) : send({ error: "\uC11C\uBC84 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uC5F0\uACB0\uACFC \uC11C\uBC84 \uC124\uC815\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, 500);
    }
    return secureResponse(response, request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-1tVIuZ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-1tVIuZ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
