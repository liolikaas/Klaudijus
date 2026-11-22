#!/usr/bin/env node
/*
  Klaudijaus tiltas į Claude Code.
  Mažas serveris tavo kompiuteryje: Klaudijus (naršyklėje) perduoda jam užduotį,
  jis paleidžia Claude Code ne interaktyviai tavo pasirinktame aplanke ir grąžina eigą bei rezultatą.

  Paleidimas:  node tiltas.mjs
  Nustatymai:  tiltas-config.json (sukuriamas pirmą kartą, šalia šio failo)

  Saugumas:
  - klausosi tik 127.0.0.1 (pasiekiamas tik iš šio kompiuterio);
  - kiekviena užklausa turi turėti slaptą raktą (token);
  - priimamos užklausos tik iš leidžiamų puslapių (allowedOrigins);
  - Claude Code dirba tik nurodytame aplanke (workdir), leidimų režimas nustatomas konfigūracijoje.
*/
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG_PATH = join(HERE, "tiltas-config.json");

const DEFAULTS = {
  port: 8787,
  token: "",
  workdir: "",
  /* plan = tik skaito ir planuoja; acceptEdits = skaito ir keičia failus aplanke; bypassPermissions = viskas be klausimų (pavojinga) */
  permissionMode: "acceptEdits",
  allowedTools: [
    "Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "WebSearch", "WebFetch", "TodoWrite",
    "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(ls:*)", "Bash(dir:*)",
    "Bash(npm test:*)", "Bash(npm run:*)", "Bash(node --version)"
  ],
  model: "",
  maxTurns: 40,
  claudeCommand: "claude",
  allowedOrigins: ["https://liolikaas.github.io"],
  lastSession: ""
};

function loadCfg() {
  let cfg = { ...DEFAULTS };
  if (existsSync(CFG_PATH)) {
    try { cfg = { ...cfg, ...JSON.parse(readFileSync(CFG_PATH, "utf8")) }; }
    catch (e) { console.error("Nepavyko perskaityti tiltas-config.json:", e.message); process.exit(1); }
  }
  let changed = !existsSync(CFG_PATH);
  if (!cfg.token) { cfg.token = randomBytes(24).toString("base64url"); changed = true; }
  if (changed) writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}
const cfg = loadCfg();
function saveCfg() { try { writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2)); } catch (e) {} }

if (!cfg.workdir || !existsSync(cfg.workdir) || !statSync(cfg.workdir).isDirectory()) {
  console.error("\nNenurodytas arba neegzistuoja darbo aplankas (workdir).");
  console.error("Atidaryk " + CFG_PATH + " ir įrašyk, pvz.:  \"workdir\": \"C:\\\\Projektai\\\\StatykProtingai\"\n");
  process.exit(1);
}
const WORKDIR = resolve(cfg.workdir);

const SPOKEN = "Tavo galutinį atsakymą balsu perskaitys asistentas Klaudijus lietuviškai. " +
  "Galutinį atsakymą parašyk lietuviškai, trumpai (iki 5 sakinių): ką padarei, kas pavyko, kas ne, ką reikia nuspręsti žmogui. " +
  "Be lentelių, be kodo blokų ir be ilgų failų kelių, nebent jų tiesiog reikia. Detalės lieka failuose.";

/* ---------- jobs ---------- */
const jobs = new Map();
let running = null;
let seq = 0;

function shortDetail(name, input) {
  if (!input || typeof input !== "object") return "";
  const v = input.file_path || input.path || input.command || input.pattern || input.url || input.query || input.description || "";
  let s = String(v);
  if (input.file_path || input.path) s = s.replace(WORKDIR, "").replace(/^[\\/]+/, "");
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

function startJob(text, fresh) {
  const id = String(++seq) + "-" + randomBytes(4).toString("hex");
  const job = { id, text, events: [], done: false, result: "", error: "", cost: 0, session: "", started: Date.now(), proc: null };
  jobs.set(id, job);
  if (jobs.size > 30) jobs.delete(jobs.keys().next().value);

  const args = ["-p", "--output-format", "stream-json", "--verbose",
    "--permission-mode", cfg.permissionMode, "--max-turns", String(cfg.maxTurns),
    "--append-system-prompt", SPOKEN];
  if (cfg.allowedTools && cfg.allowedTools.length && cfg.permissionMode !== "bypassPermissions")
    args.push("--allowedTools", cfg.allowedTools.join(","));
  if (cfg.model) args.push("--model", cfg.model);
  if (!fresh && cfg.lastSession) args.push("--resume", cfg.lastSession);

  /* the prompt goes in through stdin, so no quoting problems on Windows */
  const isWin = process.platform === "win32";
  const proc = spawn(cfg.claudeCommand, args.map(a => isWin && /[\s"&|<>^()]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a),
    { cwd: WORKDIR, shell: isWin, env: process.env, windowsHide: true });
  job.proc = proc; running = job;
  proc.stdin.end(text);

  let buf = "";
  proc.stdout.on("data", chunk => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (line) onLine(job, line);
    }
  });
  let err = "";
  proc.stderr.on("data", c => { err += c.toString("utf8"); if (err.length > 4000) err = err.slice(-4000); });
  proc.on("error", e => { job.error = "Nepavyko paleisti Claude Code: " + e.message; finish(job); });
  proc.on("close", code => {
    if (buf.trim()) onLine(job, buf.trim());
    if (!job.result && !job.error && code !== 0) job.error = (err.trim().split("\n").slice(-3).join(" ") || ("Claude Code baigė su kodu " + code));
    finish(job);
  });
  console.log(`[${new Date().toLocaleTimeString()}] Užduotis ${id}: ${text.slice(0, 100)}`);
  return job;
}

function onLine(job, line) {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.session_id) job.session = m.session_id;
  if (m.type === "assistant" && m.message && Array.isArray(m.message.content)) {
    for (const b of m.message.content) {
      if (b.type === "text" && b.text && b.text.trim()) job.events.push({ kind: "text", text: b.text.trim().slice(0, 600), t: Date.now() });
      if (b.type === "tool_use") job.events.push({ kind: "tool", name: b.name, detail: shortDetail(b.name, b.input), t: Date.now() });
    }
  }
  if (m.type === "result") {
    job.result = String(m.result || "").trim();
    job.cost = Number(m.total_cost_usd || 0);
    if (m.is_error && !job.result) job.error = "Claude Code klaida: " + (m.subtype || "nežinoma");
  }
}

function finish(job) {
  if (job.done) return;
  job.done = true; job.proc = null;
  if (running === job) running = null;
  if (job.session) { cfg.lastSession = job.session; saveCfg(); }
  console.log(`[${new Date().toLocaleTimeString()}] Užduotis ${job.id} baigta${job.error ? " su klaida: " + job.error : ""}`);
}

/* ---------- http ---------- */
function okToken(req) {
  const got = Buffer.from(String(req.headers["x-klaudijus-token"] || ""));
  const want = Buffer.from(cfg.token);
  return got.length === want.length && timingSafeEqual(got, want);
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && cfg.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-klaudijus-token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    /* Chrome asks this before a public site may talk to this computer */
    if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
    return true;
  }
  return !origin;
}
function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((ok, bad) => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 20000) { bad(new Error("per didelė užklausa")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(allowed ? 204 : 403); res.end(); return; }
  if (!allowed) return send(res, 403, { error: "Šis puslapis neleidžiamas" });
  if (!okToken(req)) return send(res, 401, { error: "Neteisingas raktas" });

  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, workdir: WORKDIR, mode: cfg.permissionMode, busy: !!running, running: running && { id: running.id, text: running.text, started: running.started } });
    }
    if (req.method === "POST" && url.pathname === "/task") {
      const b = await body(req);
      const text = String(b.text || "").trim();
      if (!text) return send(res, 400, { error: "Tuščia užduotis" });
      if (running) return send(res, 409, { error: "Claude Code dar dirba prie kitos užduoties", running: { id: running.id, text: running.text } });
      const job = startJob(text, !!b.fresh);
      return send(res, 200, { id: job.id });
    }
    const m = /^\/task\/([\w-]+)(\/stop)?$/.exec(url.pathname);
    if (m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: "Tokios užduoties nėra" });
      if (req.method === "POST" && m[2]) {
        if (job.proc) { try { job.proc.kill(); } catch {} job.error = "Sustabdyta"; }
        return send(res, 200, { ok: true });
      }
      const after = Math.max(0, Number(url.searchParams.get("after") || 0));
      return send(res, 200, { id: job.id, events: job.events.slice(after), next: job.events.length, done: job.done,
        result: job.done ? job.result : "", error: job.done ? job.error : "", cost: job.cost, started: job.started });
    }
    if (req.method === "POST" && url.pathname === "/new") { cfg.lastSession = ""; saveCfg(); return send(res, 200, { ok: true }); }
    send(res, 404, { error: "Nėra tokio adreso" });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
});

server.listen(cfg.port, "127.0.0.1", () => {
  console.log("\nKlaudijaus tiltas veikia:  http://127.0.0.1:" + cfg.port);
  console.log("Darbo aplankas:            " + WORKDIR);
  console.log("Leidimų režimas:           " + cfg.permissionMode);
  console.log("Raktas (įvesk Klaudijaus nustatymuose):\n\n    " + cfg.token + "\n");
  console.log("Langą palik atidarytą. Sustabdyti: Ctrl+C.\n");
});
