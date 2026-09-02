const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const express = require('express');

const rootDir = path.resolve(__dirname, '..');

function runtimeRootDir() {
  return process.pkg ? path.dirname(process.execPath) : rootDir;
}

function loadLocalEnv() {
  const envFile = path.join(runtimeRootDir(), '.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) return;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadLocalEnv();

let workbookData = require('./workbook-data');
let { catalog, lists, typePresets, enrichModules, calculateModulePrice } = workbookData;

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const adminUser = process.env.SILWOOD_ADMIN_USER || 'admin';
const adminPassword = process.env.SILWOOD_ADMIN_PASSWORD || 'silwood';
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const useSupabaseAuth = Boolean(supabaseUrl && supabaseAnonKey);
const allowBootstrapAdmin = process.env.SILWOOD_BOOTSTRAP_ADMIN === 'true';
const adminSessions = new Map();
const sessionMaxAgeSeconds = 8 * 60 * 60;
const sessionMaxAgeMs = sessionMaxAgeSeconds * 1000;

function localNetworkUrls() {
  const urls = [];
  Object.values(os.networkInterfaces()).flat().forEach((address) => {
    if (!address || address.family !== 'IPv4' || address.internal) return;
    urls.push('http://' + address.address + ':' + port);
  });
  return urls;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(runtimeRootDir(), 'public')));

let workbookFile = workbookData.workbookPath;
function fileStamp(file) {
  return file && fs.existsSync(file) ? file + ':' + fs.statSync(file).mtimeMs : '';
}
function dataStamp() {
  return [fileStamp(workbookData.resolveWorkbookPath()), fileStamp(workbookData.comparisonWorkbookPath?.())].join('|');
}
let workbookStamp = dataStamp();
const priceOverridesFile = path.join(runtimeRootDir(), 'data', 'price-overrides.json');
const saveSupplierPricesScript = path.join(runtimeRootDir(), 'scripts', 'excel-save-supplier-prices.ps1');
const backupDirectory = path.join(runtimeRootDir(), 'data', 'backups');
const workDirectory = path.join(runtimeRootDir(), 'work');
const pendingSupplierPricesFile = path.join(runtimeRootDir(), 'data', 'pending-supplier-prices.json');
const execFileAsync = promisify(execFile);
const platePricingRules = { labor: 2.02, clientMultiplier: 3, resellerMultiplier: 1.4 };
const skirtingLacquerClientPerMeter = 6;
const wardrobeDrawerGroup = 'Gavetas Roupeiro';
const transportExtraGroup = 'Transporte e embalamento';
const wardrobeDrawerItem = 'Gaveta Roupeiro';

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return cookies;
  }, {});
}

function sessionCookie(value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return 'silwood_session=' + encodeURIComponent(value || '') + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge + secure;
}

function readAuthSession(req) {
  const token = parseCookies(req).silwood_session;
  const session = token ? adminSessions.get(token) : null;
  const expiresAt = typeof session === 'number' ? session : session?.expiresAt;
  if (!expiresAt) return null;
  if (expiresAt < Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  if (typeof session === 'number') return { role: 'admin', admin: true, authenticated: true, name: adminUser };
  return session;
}

function isAdminRequest(req) {
  return readAuthSession(req)?.role === 'admin';
}

function requireAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  return res.status(401).json({ error: 'Login de administrador necessario.' });
}

function requireAuth(req, res, next) {
  const session = readAuthSession(req);
  if (!session) return res.status(401).json({ error: 'Login necessario.' });
  req.authSession = session;
  return next();
}

function allowedPricingModeForRequest(req, requestedMode) {
  const role = normalizeUserRole(readAuthSession(req)?.role);
  if (role === 'admin') return requestedMode === 'reseller' ? 'reseller' : 'normal';
  if (role === 'reseller') return 'reseller';
  return 'normal';
}

function publicSession(session) {
  return {
    authenticated: Boolean(session),
    admin: session?.role === 'admin',
    role: normalizeUserRole(session?.role || 'guest'),
    name: session?.name || '',
    supabase: useSupabaseAuth
  };
}

function createAuthSession(profile) {
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, {
    userId: profile.userId || '',
    email: profile.email || '',
    name: profile.name || profile.email || profile.username || '',
    role: normalizeUserRole(profile.role),
    expiresAt: Date.now() + sessionMaxAgeMs
  });
  return token;
}

async function supabaseJson(pathname, options = {}) {
  if (typeof fetch !== 'function') throw new Error('Esta versao do Node nao suporta fetch. Usa Node 18+ para login Supabase.');
  const apiKey = options.serviceRole ? supabaseServiceRoleKey : supabaseAnonKey;
  if (!apiKey) throw new Error('Supabase nao configurado.');
  const headers = {
    apikey: apiKey,
    Authorization: options.accessToken ? 'Bearer ' + options.accessToken : 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(supabaseUrl + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_description || data.msg || data.message || 'Erro de autenticaÃ§Ã£o no Supabase.';
    throw new Error(message);
  }
  return data;
}

async function loginWithSupabase(username, password) {
  const auth = await supabaseJson('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: username, password }
  });
  const user = auth.user || {};
  const accessToken = auth.access_token;
  if (!user.id || !accessToken) throw new Error('Login Supabase sem utilizador valido.');
  const profiles = await supabaseJson('/rest/v1/profiles?select=id,name,role,active&id=eq.' + encodeURIComponent(user.id), {
    accessToken
  });
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (profile && profile.active === false) throw new Error('Utilizador desativado.');
  return {
    userId: user.id,
    email: user.email || username,
    name: profile?.name || user.user_metadata?.name || user.email || username,
    role: profile?.role || user.app_metadata?.role || user.user_metadata?.role || 'user'
  };
}

function requireSupabaseUserAdmin() {
  if (!useSupabaseAuth) throw new Error('Configura SUPABASE_URL e SUPABASE_ANON_KEY para gerir utilizadores.');
  if (!supabaseServiceRoleKey) throw new Error('Configura SUPABASE_SERVICE_ROLE_KEY no servidor para criar utilizadores.');
}

function normalizeUserRole(role) {
  if (role === 'admin') return 'admin';
  if (role === 'reseller' || role === 'revendedor') return 'reseller';
  return 'guest';
}

function normalizeUserProfileInput(body) {
  return {
    email: String(body?.email || '').trim().toLowerCase(),
    password: String(body?.password || ''),
    name: String(body?.name || '').trim(),
    role: normalizeUserRole(body?.role),
    active: body?.active !== false
  };
}

async function upsertSupabaseProfile(profile) {
  const rows = await supabaseJson('/rest/v1/profiles', {
    method: 'POST',
    serviceRole: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      id: profile.id,
      name: profile.name || null,
      role: normalizeUserRole(profile.role),
      active: profile.active !== false,
      updated_at: new Date().toISOString()
    }
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function listSupabaseUsers() {
  requireSupabaseUserAdmin();
  const auth = await supabaseJson('/auth/v1/admin/users', { serviceRole: true });
  const profiles = await supabaseJson('/rest/v1/profiles?select=id,name,role,active,created_at,updated_at', { serviceRole: true });
  const profileById = new Map((Array.isArray(profiles) ? profiles : []).map(profile => [profile.id, profile]));
  return (auth.users || []).map(user => {
    const profile = profileById.get(user.id) || {};
    return {
      id: user.id,
      email: user.email || '',
      name: profile.name || user.user_metadata?.name || '',
      role: normalizeUserRole(profile.role || user.app_metadata?.role || user.user_metadata?.role),
      active: profile.active !== false,
      createdAt: profile.created_at || user.created_at || '',
      lastSignInAt: user.last_sign_in_at || ''
    };
  });
}

async function createSupabaseUser(body) {
  requireSupabaseUserAdmin();
  const input = normalizeUserProfileInput(body);
  if (!input.email || !input.email.includes('@')) throw new Error('Preenche um email valido.');
  if (input.password.length < 6) throw new Error('A palavra-passe deve ter pelo menos 6 caracteres.');
  const created = await supabaseJson('/auth/v1/admin/users', {
    method: 'POST',
    serviceRole: true,
    body: {
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name }
    }
  });
  const user = created.user || created;
  if (!user.id) throw new Error('O Supabase nao devolveu o utilizador criado.');
  await upsertSupabaseProfile({ id: user.id, name: input.name, role: input.role, active: input.active });
  return user.id;
}

async function updateSupabaseUser(id, body) {
  requireSupabaseUserAdmin();
  const userId = String(id || '').trim();
  if (!userId) throw new Error('Utilizador invalido.');
  const password = String(body?.password || '');
  const email = String(body?.email || '').trim().toLowerCase();
  if (password || email) {
    const authUpdate = {};
    if (email) authUpdate.email = email;
    if (password) {
      if (password.length < 6) throw new Error('A palavra-passe deve ter pelo menos 6 caracteres.');
      authUpdate.password = password;
    }
    await supabaseJson('/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      serviceRole: true,
      body: authUpdate
    });
  }
  await upsertSupabaseProfile({
    id: userId,
    name: String(body?.name || '').trim(),
    role: normalizeUserRole(body?.role),
    active: body?.active !== false
  });
}

function requireSupabaseHistory() {
  if (!useSupabaseAuth || !supabaseServiceRoleKey) {
    throw new Error('Historico por utilizador precisa de Supabase configurado no servidor.');
  }
}

function normalizeQuoteHistoryEntry(row, profileById = new Map()) {
  const profile = profileById.get(row.owner_id) || {};
  return {
    id: row.id,
    userId: row.owner_id,
    userName: profile.name || profile.email || '',
    label: row.label || 'Sem nome',
    updatedAt: row.updated_at || row.created_at || '',
    snapshot: row.snapshot || null
  };
}

async function profileMapForUserIds(userIds) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!ids.length) return new Map();
  const query = '/rest/v1/profiles?select=id,name&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
  const rows = await supabaseJson(query, { serviceRole: true });
  return new Map((Array.isArray(rows) ? rows : []).map(row => [row.id, row]));
}

async function quoteHistoryForSession(session, requestedUserId) {
  requireSupabaseHistory();
  const admin = session.role === 'admin';
  const ownerId = admin && requestedUserId ? String(requestedUserId) : session.userId;
  if (!ownerId) throw new Error('Sessao sem utilizador Supabase associado.');
  const rows = await supabaseJson(
    '/rest/v1/quote_history?select=id,owner_id,label,snapshot,created_at,updated_at&owner_id=eq.' + encodeURIComponent(ownerId) + '&order=updated_at.desc&limit=100',
    { serviceRole: true }
  );
  const profileById = await profileMapForUserIds([ownerId]);
  return (Array.isArray(rows) ? rows : []).map(row => normalizeQuoteHistoryEntry(row, profileById));
}

async function saveQuoteHistoryForSession(session, body) {
  requireSupabaseHistory();
  const ownerId = session.role === 'admin' && body?.userId ? String(body.userId) : session.userId;
  if (!ownerId) throw new Error('Sessao sem utilizador Supabase associado.');
  const snapshot = body?.snapshot || {};
  const label = String(body?.label || 'Sem nome').trim() || 'Sem nome';
  const snapshotKey = String(body?.snapshotKey || label).trim() || label;
  await supabaseJson('/rest/v1/quote_history?on_conflict=owner_id,snapshot_key', {
    method: 'POST',
    serviceRole: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      owner_id: ownerId,
      snapshot_key: snapshotKey,
      label,
      snapshot,
      updated_at: new Date().toISOString()
    }
  });
}

async function importQuoteHistoryForSession(session, body) {
  requireSupabaseHistory();
  const ownerId = session.userId;
  if (!ownerId) throw new Error('Sessao sem utilizador Supabase associado.');
  const entries = Array.isArray(body?.entries) ? body.entries.slice(0, 100) : [];
  const rows = entries.map((entry) => {
    const snapshot = entry?.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : {};
    const label = String(entry?.label || 'Sem nome').trim() || 'Sem nome';
    const snapshotKey = String(entry?.snapshotKey || entry?.id || label).trim() || label;
    return {
      owner_id: ownerId,
      snapshot_key: snapshotKey,
      label,
      snapshot,
      updated_at: entry?.updatedAt || new Date().toISOString()
    };
  }).filter(row => row.snapshot && row.snapshot.client);
  if (!rows.length) return;
  await supabaseJson('/rest/v1/quote_history?on_conflict=owner_id,snapshot_key', {
    method: 'POST',
    serviceRole: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: rows
  });
}

async function deleteQuoteHistoryForSession(session, id) {
  requireSupabaseHistory();
  const rows = await supabaseJson('/rest/v1/quote_history?select=id,owner_id&id=eq.' + encodeURIComponent(id), { serviceRole: true });
  const entry = Array.isArray(rows) ? rows[0] : null;
  if (!entry) return;
  if (session.role !== 'admin' && entry.owner_id !== session.userId) throw new Error('Sem permissao para apagar este historico.');
  await supabaseJson('/rest/v1/quote_history?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    serviceRole: true,
    headers: { Prefer: 'return=minimal' }
  });
}

function assertWorkbookWritable(file) {
  let handle;
  try {
    handle = fs.openSync(file, 'r+');
  } catch (error) {
    throw new Error('O ficheiro Excel estÃ¡ bloqueado pelo Windows. Fecha processos Excel em segundo plano e tenta novamente.');
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function cleanComparableSource(value) {
  let text = String(value || '');
  text = text
    .replace(/\u00c3\u20ac/g, 'À')
    .replace(/\u00c3\u00a1/g, 'á')
    .replace(/\u00c3\u00a0/g, 'à')
    .replace(/\u00c3\u00a9/g, 'é')
    .replace(/\u00c3\u00b3/g, 'ó')
    .replace(/\u00c3\u00a7/g, 'ç')
    .replace(/\u00c3\u00a3/g, 'ã');
  for (let index = 0; index < 3 && /Ã|Â|�/.test(text); index += 1) {
    try {
      const decoded = Buffer.from(text, 'latin1').toString('utf8');
      if (!decoded || decoded === text) break;
      text = decoded;
    } catch (error) {
      break;
    }
  }
  return text
    .replace(/LEDÂ´S/g, "LED'S")
    .replace(/LED´S/g, "LED'S")
    .replace(/SÃƒO/g, 'SÃO')
    .replace(/SÃƒÂO/g, 'SÃO')
    .replace(/PeÃƒÂ§as/g, 'Peças')
    .replace(/PeÃ§as/g, 'Peças')
    .replace(/AcessÃ³rios/g, 'Acessórios')
    .replace(/RodapÃ©s/g, 'Rodapés')
    .replace(/DobradiÃ§a/g, 'Dobradiça')
    .replace(/HidrÃ³fuga/g, 'Hidrófuga')
    .replace(/OrÃ§amento/g, 'Orçamento')
    .replace(/AfinaÃ§Ã£o/g, 'Afinação')
    .replace(/NÃ£o/g, 'Não')
    .replace(/SÃ³/g, 'Só');
}

function comparableText(value) {
  return cleanComparableSource(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function badHingeSummary(item) {
  const text = comparableText([item?.name, item?.item, item?.label, item?.reference].join(' '));
  return text.includes('CORRED') || text.includes('GAVETAS ROUPEIRO');
}

function normalizeExtraGroupName(group) {
  const text = comparableText(group);
  if (!text) return '';
  if (text === comparableText('Sistema de abertura de portas') || text === comparableText('Sistema de abertura')) return 'Sistema de abertura';
  if (text === comparableText(wardrobeDrawerGroup)) return wardrobeDrawerGroup;
  if (text === comparableText(transportExtraGroup) || (text.includes('TRANSPORTE') && text.includes('EMBAL'))) return transportExtraGroup;
  if (text.includes('ACESS') && text.includes('COZINHA')) return 'Acessórios Cozinha';
  if (text.includes('ACESS') && text.includes('ROUPEIRO')) return 'Acessórios Roupeiro';
  if (text.includes('RODAP')) return 'Rodapés (metros)';
  if (text.includes('LED')) return "LED'S (metros)";
  if (text === 'CESTOS DO LIXO') return 'Cestos do Lixo';
  if (text === 'PUXADORES') return 'Puxadores';
  if (text === 'TOMADAS') return 'Tomadas';
  if (text === 'GAVETAS') return 'Gavetas';
  if (text.includes('PES') && text.includes('FIXACAO') && text.includes('ORGANIZACAO')) return 'Pés, Fixação e Organização';
  if (text === 'OUTROS') return 'Outros';
  return String(group || '').replace(/\s+/g, ' ').trim();
}

function isManualPricedExtra(extra) {
  const group = normalizeExtraGroupName(extra?.group);
  return group === 'Outros' || group === transportExtraGroup;
}

function comparableItemText(value) {
  return comparableText(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function catalogExtraMatches(item, extra) {
  if (normalizeExtraGroupName(item?.group) !== normalizeExtraGroupName(extra?.group)) return false;
  const left = comparableItemText(item?.item || item?.label || item?.name || item?.reference);
  const right = comparableItemText(extra?.item || extra?.label || extra?.name || extra?.reference);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function isSkirtingExtra(extra) {
  return comparableText(extra?.group).includes('RODAP');
}

function isLacqueredExtra(extra) {
  return extra?.lacquered === true || extra?.lacquered === 'Sim';
}

function isWardrobeDrawerExtra(extra) {
  return comparableText(extra?.group) === comparableText(wardrobeDrawerGroup);
}

function isWardrobeRodExtra(extra, catalogItem) {
  const group = normalizeExtraGroupName(extra?.group || catalogItem?.group);
  if (group !== 'Acessórios Roupeiro') return false;
  const text = comparableText([
    extra?.item,
    extra?.reference,
    catalogItem?.item,
    catalogItem?.label,
    catalogItem?.name,
    catalogItem?.reference
  ].join(' '));
  return text.includes('VARAO') ||
    text.includes('EXTENSIVEL') ||
    /\bASSA\s*75\s*125\b/.test(text) ||
    wardrobeRodLengthCm(extra, catalogItem) > 80;
}

function wardrobeRodLengthCm(extra, catalogItem) {
  const raw = cleanComparableSource([
    extra?.item,
    extra?.reference,
    catalogItem?.item,
    catalogItem?.label,
    catalogItem?.name,
    catalogItem?.reference
  ].join(' ')).toUpperCase();
  const normalized = comparableText(raw);
  let longest = 0;

  for (const match of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:M|MT|METRO|METROS)\b/g)) {
    longest = Math.max(longest, Number(String(match[1]).replace(',', '.')) * 100);
  }
  for (const match of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:CM|CENTIMETROS)\b/g)) {
    longest = Math.max(longest, Number(String(match[1]).replace(',', '.')));
  }
  for (const match of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:MM|MILIMETROS)\b/g)) {
    longest = Math.max(longest, Number(String(match[1]).replace(',', '.')) / 10);
  }
  for (const match of normalized.matchAll(/\b(?:MOD|AAF)\s*\.?\s*(\d{2,3})\b/g)) {
    longest = Math.max(longest, Number(match[1]));
  }
  for (const match of normalized.matchAll(/\b(\d{2,4})\s*[-/]\s*(\d{2,4})\b/g)) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    const max = Math.max(left, right);
    longest = Math.max(longest, max > 300 ? max / 10 : max);
  }

  return longest;
}

function wardrobeRodClientSurcharge(extra, catalogItem) {
  if (!isWardrobeRodExtra(extra, catalogItem)) return 0;
  return wardrobeRodLengthCm(extra, catalogItem) > 80 ? 4 : 0;
}

function wardrobeRodSegments(extra) {
  return String(extra?.rodLengths || extra?.rodLengthCm || '')
    .split(/[+;,|/\n]+/)
    .map(value => Number(String(value).replace(',', '.').trim()))
    .filter(value => Number.isFinite(value) && value > 0);
}

function wardrobeRodLine(extra, catalogItem, baseClient, baseCost) {
  if (!isWardrobeRodExtra(extra, catalogItem)) return null;
  const fullLengthCm = wardrobeRodLengthCm(extra, catalogItem);
  const segments = wardrobeRodSegments(extra);
  if (!segments.length || !fullLengthCm) {
    return {
      unitClient: money(baseClient + wardrobeRodClientSurcharge(extra, catalogItem)),
      unitCost: money(baseCost)
    };
  }
  const usedCm = segments.reduce((sum, value) => sum + value, 0);
  const proportionalClient = baseClient * (usedCm / fullLengthCm);
  const proportionalCost = baseCost * (usedCm / fullLengthCm);
  const middleSupportClient = segments.filter(value => value > 80).length * 4;
  return {
    unitClient: money(proportionalClient + middleSupportClient),
    unitCost: money(proportionalCost)
  };
}

function updatePlatePrices(plate, changes) {
  if (typeof changes.supplier === 'string') plate.supplier = changes.supplier.trim();
  if (typeof changes.reference === 'string') plate.reference = changes.reference.trim();
  if (Number.isFinite(Number(changes.supplierPrice))) plate.supplierPrice = Math.max(0, Number(changes.supplierPrice));
  if (changes.manualClient !== undefined) plate.manualClient = changes.manualClient === true;
  if (changes.manualReseller !== undefined) plate.manualReseller = changes.manualReseller === true;
  plate.cost = plate.supplierPrice + platePricingRules.labor;
  plate.client = plate.manualClient === true && Number.isFinite(Number(changes.client))
    ? Number(changes.client)
    : plate.cost * platePricingRules.clientMultiplier;
  plate.reseller = plate.manualReseller === true && Number.isFinite(Number(changes.reseller))
    ? Number(changes.reseller)
    : plate.cost * platePricingRules.resellerMultiplier;
}

function loadPriceOverrides() {
  if (!fs.existsSync(priceOverridesFile)) return;
  try {
    const overrides = JSON.parse(fs.readFileSync(priceOverridesFile, 'utf8'));
    if (Array.isArray(overrides.plates) || Array.isArray(overrides.extras)) {
      applySupplierPayload(overrides);
      return;
    }
    const legacy = {
      plates: Object.entries(overrides).map(([name, changes]) => ({ name, ...(changes || {}) }))
    };
    applySupplierPayload(legacy);
  } catch (error) {
    console.error('NÃ£o foi possÃ­vel carregar os preÃ§os guardados:', error.message);
  }
}

function readPriceOverridesPayload() {
  if (!fs.existsSync(priceOverridesFile)) return {};
  try {
    const overrides = JSON.parse(fs.readFileSync(priceOverridesFile, 'utf8')) || {};
    if (Array.isArray(overrides.plates) || Array.isArray(overrides.extras)) return overrides;
    return { plates: Object.entries(overrides).map(([name, changes]) => ({ name, ...(changes || {}) })) };
  } catch (error) {
    return {};
  }
}

function persistPriceOverridesPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const next = mergeSupplierPayload(readPriceOverridesPayload(), payload);
  fs.mkdirSync(path.dirname(priceOverridesFile), { recursive: true });
  fs.writeFileSync(priceOverridesFile, JSON.stringify(next, null, 2), 'utf8');
}

function supplierChangeKey(item, nameField) {
  const identityName = item?.[nameField] || item?.name || item?.item || item?.label;
  return [
    item?.priceKey,
    identityName,
    item?.group,
    item?.family,
    item?.supplier,
    item?.reference
  ].map(comparableText).filter(Boolean).join('|');
}

function upsertCatalogItems(list, items, nameField) {
  if (!Array.isArray(list) || !Array.isArray(items)) return;
  items.forEach((item) => {
    const key = supplierChangeKey(item, nameField);
    const target = list.find(existing => supplierChangeKey(existing, nameField) === key);
    if (target) {
      Object.assign(target, item);
    } else {
      list.push({ ...item });
    }
  });
  dedupeCatalogItems(list, nameField);
}

function dedupeCatalogItems(list, nameField) {
  if (!Array.isArray(list)) return;
  const seen = new Map();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const key = supplierChangeKey(list[index], nameField);
    if (!key) continue;
    if (seen.has(key)) {
      list.splice(index, 1);
    } else {
      seen.set(key, list[index]);
    }
  }
}

function upsertCatalogItemsByName(list, items, nameField) {
  if (!Array.isArray(list) || !Array.isArray(items)) return;
  items.forEach((item) => {
    const wanted = comparableText(item?.[nameField] || item?.name || item?.item || item?.label);
    const target = list.find(existing => comparableText(existing?.[nameField] || existing?.name || existing?.item || existing?.label) === wanted);
    if (target) {
      Object.assign(target, item);
    } else {
      list.push({ ...item });
    }
  });
}

function applySupplierPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (Array.isArray(payload.plates)) {
    payload.plates.forEach((change) => {
      const key = supplierChangeKey(change, 'name');
      const plate = catalog.plates.find(item => supplierChangeKey(item, 'name') === key);
      if (plate) {
        Object.assign(plate, change);
        updatePlatePrices(plate, change);
      } else {
        const next = { ...change };
        updatePlatePrices(next, change);
        catalog.plates.push(next);
      }
    });
  }
  (payload.extras || []).forEach(item => { item.group = normalizeExtraGroupName(item.group); });
  upsertCatalogItems(catalog.paintings, payload.paintings, 'name');
  upsertCatalogItems(catalog.paintingComponents, payload.paintingComponents, 'item');
  upsertCatalogItems(catalog.edges, payload.edges, 'name');
  upsertCatalogItems(catalog.extras, payload.extras, 'item');
  upsertCatalogItems(catalog.hinges, (payload.hinges || []).filter(item => !badHingeSummary(item)), 'name');
  upsertCatalogItemsByName(catalog.doorSystems, (payload.extras || [])
    .filter(item => comparableText(item.group) === comparableText('Sistema de abertura de portas') || comparableText(item.group) === comparableText('Sistema de abertura'))
    .map(item => ({
      name: item.name || item.item || item.label,
      item: item.name || item.item || item.label,
      label: item.name || item.item || item.label,
      supplier: item.supplier,
      reference: item.reference,
      supplierPrice: item.supplierPrice,
      cost: item.cost,
      client: item.client,
      reseller: item.reseller,
      manualSupplierPrice: item.manualSupplierPrice,
      manualClient: item.manualClient,
      manualReseller: item.manualReseller,
      userAdded: item.userAdded
    })), 'name');
  upsertCatalogItems(catalog.drawerComponents, payload.drawerComponents, 'item');
  upsertCatalogItems(catalog.hingeComponents, payload.hingeComponents, 'item');
  upsertCatalogItems(catalog.openingSystemComponents, (payload.openingSystemComponents || []).filter(item => !item.userAddedSummary), 'item');
  upsertCatalogItemsByName(catalog.doorSystems, (payload.openingSystemComponents || []).filter(item => item.userAddedSummary || item.name).map(item => ({
    name: item.name || item.item || item.label,
    item: item.name || item.item || item.label,
    label: item.name || item.item || item.label,
    supplier: item.supplier,
    reference: item.reference,
    supplierPrice: item.supplierPrice,
    cost: item.cost,
    client: item.client,
    reseller: item.reseller,
    manualSupplierPrice: item.manualSupplierPrice,
    manualClient: item.manualClient,
    manualReseller: item.manualReseller,
    userAdded: item.userAdded
  })), 'name');
}

function readPendingSupplierPayload() {
  if (!fs.existsSync(pendingSupplierPricesFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(pendingSupplierPricesFile, 'utf8')) || {};
  } catch (error) {
    return {};
  }
}

function mergeSupplierPayload(base, next) {
  const merged = { ...(base || {}) };
  [
    'plates',
    'paintings',
    'paintingComponents',
    'edges',
    'extras',
    'drawerComponents',
    'hinges',
    'hingeComponents',
    'openingSystemComponents'
  ].forEach((key) => {
    const map = new Map();
    [...(merged[key] || []), ...(next?.[key] || [])].forEach((item, index) => {
      map.set(supplierChangeKey(item, key === 'plates' || key === 'edges' || key === 'paintings' || key === 'hinges' ? 'name' : 'item') || String(index), item);
    });
    const values = Array.from(map.values());
    if (values.length) merged[key] = values;
  });
  if (next?.addMissingPlates || merged.addMissingPlates) merged.addMissingPlates = true;
  return merged;
}

function loadPendingSupplierPrices() {
  const pending = readPendingSupplierPayload();
  applySupplierPayload(pending);
}

function supplierPricePayload() {
  return {
    rules: platePricingRules,
    plates: catalog.plates.map(({ name, supplier, reference, supplierPrice, cost, client, reseller, manualClient, manualReseller, comparisonKey, comparisonSource, comparisonRow, comparisonColumn, priceKey }) => ({
      name, supplier, reference, supplierPrice, cost, client, reseller, manualClient, manualReseller, comparisonKey, comparisonSource, comparisonRow, comparisonColumn, priceKey
    }))
  };
}

async function runSupplierPriceScript(payloadPath) {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', saveSupplierPricesScript,
      '-WorkbookPath', workbookFile,
      '-PayloadPath', payloadPath,
      '-BackupDirectory', backupDirectory,
      '-ComparisonWorkbookPath', workbookData.comparisonWorkbookPath?.() || ''
    ], { timeout: 300000, windowsHide: true, maxBuffer: 1024 * 1024 * 4 }));
  } catch (error) {
    stdout = String(error.stdout || '');
    const errorLines = stdout.trim().split(/\r?\n/).filter(Boolean);
    try {
      const result = JSON.parse(errorLines[errorLines.length - 1] || '{}');
      if (result.error) throw new Error(result.error);
    } catch (parsedError) {
      if (parsedError.message && !parsedError.message.startsWith('Unexpected token')) throw parsedError;
    }
    const stderr = String(error.stderr || '').trim();
    if (error.killed || error.signal === 'SIGTERM') {
      throw new Error('O Excel demorou demasiado tempo a guardar. A operaÃ§Ã£o foi interrompida.');
    }
    throw new Error(stderr || error.message || 'O Excel falhou ao guardar os preÃ§os.');
  }
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const result = JSON.parse(lines[lines.length - 1] || '{}');
  if (!result.ok) throw new Error(result.error || 'O Excel nÃ£o confirmou a gravaÃ§Ã£o.');
  return result;
}

async function saveSupplierPricesToExcel(payload) {
  assertWorkbookWritable(workbookFile);
  const payloadPath = path.join(workDirectory, 'supplier-prices-' + Date.now() + '.json');
  fs.mkdirSync(workDirectory, { recursive: true });
  fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');
  try {
    return await runSupplierPriceScript(payloadPath);
  } finally {
    if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
  }
}

let supplierExcelSyncRunning = false;

function queueSupplierPricesToExcel(payload) {
  fs.mkdirSync(path.dirname(pendingSupplierPricesFile), { recursive: true });
  fs.mkdirSync(workDirectory, { recursive: true });
  const pending = mergeSupplierPayload(readPendingSupplierPayload(), payload);
  fs.writeFileSync(pendingSupplierPricesFile, JSON.stringify(pending), 'utf8');
  persistPriceOverridesPayload(payload);
  applySupplierPayload(payload);

  if (supplierExcelSyncRunning) return { queued: true, running: true };
  supplierExcelSyncRunning = true;
  const payloadPath = path.join(workDirectory, 'supplier-prices-' + Date.now() + '.json');
  fs.writeFileSync(payloadPath, JSON.stringify(pending), 'utf8');
  const child = execFile('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', saveSupplierPricesScript,
    '-WorkbookPath', workbookFile,
    '-PayloadPath', payloadPath,
    '-BackupDirectory', backupDirectory,
    '-ComparisonWorkbookPath', workbookData.comparisonWorkbookPath?.() || ''
  ], { timeout: 300000, windowsHide: true, maxBuffer: 1024 * 1024 * 4 }, (error, stdout) => {
    supplierExcelSyncRunning = false;
    if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
    if (error) return;
    const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
    try {
      const result = JSON.parse(lines[lines.length - 1] || '{}');
      if (result.ok) {
        if (fs.existsSync(pendingSupplierPricesFile)) fs.unlinkSync(pendingSupplierPricesFile);
        workbookStamp = '';
        refreshWorkbookData();
      }
    } catch (parseError) {
      // Keep pending file; user can sync again later.
    }
  });
  child.on('error', () => { supplierExcelSyncRunning = false; });
  return { queued: true, running: false };
}

loadPriceOverrides();
loadPendingSupplierPrices();

function refreshWorkbookData() {
  const nextStamp = dataStamp();
  if (!nextStamp || nextStamp === workbookStamp) return false;

  try {
    delete require.cache[require.resolve('./workbook-data')];
    workbookData = require('./workbook-data');
    ({ catalog, lists, typePresets, enrichModules, calculateModulePrice } = workbookData);
    workbookFile = workbookData.workbookPath;
    workbookStamp = dataStamp();
    loadPriceOverrides();
    loadPendingSupplierPrices();
    quoteSeed.source.workbookFile = workbookFile;
    quoteSeed.source.present = true;
    quoteSeed.lists = lists;
    quoteSeed.typePresets = typePresets;
    quoteSeed.catalog = catalog;
    quoteSeed.modules = enrichModules(quoteSeed.modules);
    return true;
  } catch (error) {
    console.error('NÃ£o foi possÃ­vel atualizar os dados do Excel:', error.message);
    return false;
  }
}

const quoteSeed = {
  source: {
    workbookFile: 'Silwood_Calculadora_Orcamentos_Cozinhas.xlsm',
    present: fs.existsSync(workbookFile),
    note: 'Dados e fluxo modelados a partir das folhas OrÃ§amento_Cozinhas e OrÃ§amento_Final.'
  },
  client: {
    name: 'ELISABETE - MANUEL (V2)',
    location: 'SÃƒO JOAO MADEIRA',
    date: '2026-07-02'
  },
  modules: [
    {
      id: 'inferior_75',
      family: 'ARMÃRIO COZINHA - CAIXOTES INFERIORES',
      quantity: 1,
      width: 75,
      height: 78,
      depth: 60,
      doors: 1,
      drawers: 3,
      interior: 'Melamina F067 HidrÃ³fuga - 16mm',
      exterior: 'Melamina Branca HidrÃ³fuga B3768 - 16mm',
      paintDoor: 'Velaturas Claras c/ AfinaÃ§Ã£o',
      doorSystem: 'Normal',
      topBottomEdges: 'Sim',
      sideEdges: 'Sim',
      hinge: 'DobradiÃ§a Standard (com mola)',
      shelves: 0,
      back: 1,
      divider: 0,
      unitClient: 103.0008,
      unitCost: 37.052,
      description: 'ARMÃRIO COZINHA - CAIXOTES INFERIORES / 75(L)x78(A)x60(P) / 1 Portas / 3 Gavetas / INT: Melamina F067 HidrÃ³fuga - 16mm / EXT: Melamina Branca HidrÃ³fuga B3768 - 16mm'
    },
    {
      id: 'superior_90',
      family: 'ARMÃRIO COZINHA - CAIXOTES SUPERIORES',
      quantity: 1,
      width: 90,
      height: 100,
      depth: 40,
      doors: 2,
      drawers: 0,
      interior: 'Melamina F067 HidrÃ³fuga - 16mm',
      exterior: 'Termolaminado Cinza Alto Brilho - 19mm',
      paintDoor: 'Nenhuma',
      doorSystem: 'Tip-on (Pulsador Preto) / Tic-Tac',
      topBottomEdges: 'Sim',
      sideEdges: 'Sim',
      hinge: 'DobradiÃ§a Standard (com mola)',
      shelves: 1,
      back: 1,
      divider: 0,
      unitClient: 465.8826,
      unitCost: 179.2834,
      description: 'ARMÃRIO COZINHA - CAIXOTES SUPERIORES / 90(L)x100(A)x40(P) / 2 Portas / INT: Melamina F067 HidrÃ³fuga - 16mm / EXT: Termolaminado Cinza Alto Brilho - 19mm'
    },
    {
      id: 'superior_60',
      family: 'ARMÃRIO COZINHA - CAIXOTES SUPERIORES',
      quantity: 1,
      width: 60,
      height: 60,
      depth: 60,
      doors: 2,
      drawers: 0,
      interior: 'Melamina F067 HidrÃ³fuga - 16mm',
      exterior: 'Termolaminado Cinza Alto Brilho - 19mm',
      paintDoor: 'Nenhuma',
      doorSystem: 'Normal',
      topBottomEdges: 'Sim',
      sideEdges: 'Sim',
      hinge: 'DobradiÃ§a Standard (com mola)',
      shelves: 1,
      back: 1,
      divider: 0,
      unitClient: 316.4267,
      unitCost: 120.0218,
      description: 'ARMÃRIO COZINHA - CAIXOTES SUPERIORES / 60(L)x60(A)x60(P) / 2 Portas / INT: Melamina F067 HidrÃ³fuga - 16mm / EXT: Termolaminado Cinza Alto Brilho - 19mm'
    },
    {
      id: 'coluna_60',
      family: 'ARMÃRIO COZINHA - COLUNA',
      quantity: 1,
      width: 60,
      height: 240,
      depth: 60,
      doors: 1,
      drawers: 2,
      interior: 'Melamina F067 HidrÃ³fuga - 16mm',
      exterior: 'Termolaminado Cinza Alto Brilho - 19mm',
      paintDoor: 'Nenhuma',
      doorSystem: 'Normal',
      topBottomEdges: 'Sim',
      sideEdges: 'Sim',
      hinge: 'DobradiÃ§a Standard (com mola)',
      shelves: 0,
      back: 1,
      divider: 0,
      unitClient: 229.5732,
      unitCost: 85.3516,
      description: 'ARMÃRIO COZINHA - COLUNA / 60(L)x240(A)x60(P) / 1 Portas / 2 Gavetas / INT: Melamina F067 HidrÃ³fuga - 16mm / EXT: Termolaminado Cinza Alto Brilho - 19mm'
    },
    {
      id: 'superior_83',
      family: 'ARMÃRIO COZINHA - CAIXOTES SUPERIORES',
      quantity: 1,
      width: 83,
      height: 100,
      depth: 40,
      doors: 2,
      drawers: 0,
      interior: 'Melamina F067 HidrÃ³fuga - 16mm',
      exterior: 'Termolaminado Cinza Alto Brilho - 19mm',
      paintDoor: 'Nenhuma',
      doorSystem: 'Normal',
      topBottomEdges: 'Sim',
      sideEdges: 'Sim',
      hinge: 'DobradiÃ§a Standard (com mola)',
      shelves: 1,
      back: 1,
      divider: 0,
      unitClient: 660.2973,
      unitCost: 239.7738,
      description: 'ARMÃRIO COZINHA - CAIXOTES SUPERIORES / 83(L)x100(A)x40(P) / 2 Portas / INT: Melamina F067 HidrÃ³fuga - 16mm / EXT: Termolaminado Cinza Alto Brilho - 19mm'
    },
    {
      id: 'inferior_83',
      family: 'ARMÃRIO COZINHA - CAIXOTES INFERIORES',
      quantity: 1,
      width: 83,
      height: 78,
      depth: 60,
      doors: 2,
      drawers: 0,
      interior: 'Melamina F067 HidrÃ³fuga - 16mm',
      exterior: 'Melamina Branca HidrÃ³fuga B3768 - 16mm',
      paintDoor: 'Nenhuma',
      doorSystem: 'Normal',
      topBottomEdges: 'Sim',
      sideEdges: 'Sim',
      hinge: 'DobradiÃ§a Standard (com mola)',
      shelves: 1,
      back: 1,
      divider: 0,
      unitClient: 304.519,
      unitCost: 116.1032,
      description: 'ARMÃRIO COZINHA - CAIXOTES INFERIORES / 83(L)x78(A)x60(P) / 2 Portas / INT: Melamina F067 HidrÃ³fuga - 16mm / EXT: Melamina Branca HidrÃ³fuga B3768 - 16mm'
    },
    {
      id: 'extra_caixote',
      family: 'ARMÃRIO COZINHA',
      quantity: 1,
      width: 60,
      height: 78,
      depth: 60,
      doors: 1,
      drawers: 0,
      interior: 'Melamina F067 HidrÃ³fuga - 16mm',
      exterior: 'Melamina Branca HidrÃ³fuga B3768 - 16mm',
      paintDoor: 'Nenhuma',
      doorSystem: 'Normal',
      topBottomEdges: 'Sim',
      sideEdges: 'Sim',
      hinge: 'DobradiÃ§a Standard (com mola)',
      shelves: 1,
      back: 1,
      divider: 0,
      unitClient: 232.5301,
      unitCost: 82.7521,
      description: 'ARMÃRIO COZINHA / valores importados da folha OrÃ§amento_Final'
    }
  ],
  extras: [
    { id: 'rodape', group: 'RodapÃ©s (metros)', item: 'RodapÃ© PVC AlumÃ­nio Escovado (Altura 100mm)', quantity: 3, unitClient: 10, unitCost: 5.9783333333 },
    { id: 'acessorio', group: 'AcessÃ³rios Cozinha', item: 'Porta-Garrafas ExtraÃ­vel Ring (M15)', quantity: 1, unitClient: 74, unitCost: 46.1666666667 },
    { id: 'perfil_led', group: 'LEDÂ´S (metros)', item: 'Perfil LED Embutir AlumÃ­nio (Ares)', quantity: 1, unitClient: 8, unitCost: 4.925 },
    { id: 'difusor_led', group: 'LEDÂ´S (metros)', item: 'Difusor Fosco p/ Perfil (5MT)', quantity: 1, unitClient: 7, unitCost: 3.99 },
    { id: 'fita_led', group: 'LEDÂ´S (metros)', item: 'Rolo Fita LED Luz Neutra (50MT)', quantity: 1, unitClient: 6, unitCost: 3.3 },
    { id: 'transformador_led', group: 'LEDÂ´S (metros)', item: 'Transformador LED 24V (36W)', quantity: 1, unitClient: 26, unitCost: 15.9333333333 },
    { id: 'interruptor_led', group: 'LEDÂ´S (metros)', item: 'Interruptor Touch Embutir Preto', quantity: 1, unitClient: 21, unitCost: 12.8333333333 },
    { id: 'tomada_1', group: 'Tomadas', item: '', quantity: 0, unitClient: 0, unitCost: 0 }
  ],
  lists
};

quoteSeed.modules = enrichModules(quoteSeed.modules);
quoteSeed.typePresets = typePresets;
quoteSeed.catalog = catalog;

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function mergeCatalogPrices(target, incoming, matcher) {
  if (!Array.isArray(target) || !Array.isArray(incoming)) return;
  incoming.forEach(source => {
    const item = target.find(candidate => matcher(candidate, source));
    if (!item) {
      if (source.userAdded === true) target.push({ ...source });
      return;
    }
    ['supplier', 'reference'].forEach(field => {
      if (typeof source[field] === 'string') item[field] = source[field];
    });
    ['supplierPrice', 'cost', 'client', 'reseller'].forEach(field => {
      if (Number.isFinite(Number(source[field]))) item[field] = Number(source[field]);
    });
    ['manualClient', 'manualReseller'].forEach(field => {
      if (source[field] !== undefined) item[field] = source[field] === true;
    });
  });
}

function materialCodeThicknessKey(value) {
  const text = comparableText(value).replace(/\|/g, ' ');
  const thickness = text.match(/\b(\d+(?:[,.]\d+)?)\s*MM\b/) || text.match(/(?:^|\s|-)(\d+(?:[,.]\d+)?)\s*$/);
  if (thickness && text.includes('MDF') && /HIDR[OI]FUG/.test(text)) return 'MDF HIDROFUGO|' + thickness[1].replace(',', '.');
  if (thickness && text.includes('MDF') && text.includes('STANDARD')) return 'MDF STANDARD|' + thickness[1].replace(',', '.');
  const code = text.match(/\b([A-Z]{1,4}\d{2,5}|\d{3,5})\b(?:\s+(ST\d+|SC|TL|BRI|GLOSS|FUN|FA|FH))?/);
  if (!thickness || !code) return '';
  let plateCode = comparableText(code[1]) === 'F067' ? 'F067 SC' : code[1];
  if (code[2] && !String(plateCode).includes(' ')) plateCode += ' ' + code[2];
  return plateCode + '|' + thickness[1].replace(',', '.');
}

function sameMaterialPrice(item, source) {
  if (item.name === source.name) return true;
  if (comparableText(item.name) === comparableText(source.name)) return true;
  const sourceKey = materialCodeThicknessKey(source.name || source.reference || source.comparisonKey);
  if (!sourceKey) return false;
  return materialCodeThicknessKey(item.name) === sourceKey ||
    materialCodeThicknessKey(item.reference) === sourceKey ||
    materialCodeThicknessKey(item.comparisonKey) === sourceKey;
}

const knownDrawerRunnerRatios = [
  { key: '760H TICTAC 40KG 250', cost: 37.16, client: 75 },
  { key: '561HT TIC TAC 30KG 435', cost: 23.231, client: 52 },
  { key: '551H AMORT PARCIAL 30KG 360', cost: 6.992, client: 17 }
];

function drawerRunnerKnownEntry(value) {
  const text = comparableText(value).replace(/[^A-Z0-9]+/g, ' ');
  return knownDrawerRunnerRatios.find(entry => {
    const keyParts = entry.key.split(/\s+/).filter(Boolean);
    return keyParts.every(part => text.includes(part));
  }) || null;
}

function uniqueDrawerComponentsForFamily(family) {
  const wanted = comparableText(family);
  const seen = new Set();
  return (catalog.drawerComponents || []).filter(component => {
    const parent = comparableText([component.family, component.usedIn].join(' '));
    if (!wanted || parent !== wanted) return false;
    const key = [component.item, component.supplier, component.reference].map(comparableText).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDrawerRunnerExtras() {
  const drawerExtras = (catalog.extras || []).filter(item => comparableText(item.group) === comparableText('Gavetas'));
  drawerExtras.forEach(item => {
    const known = drawerRunnerKnownEntry([item.item, item.label, item.name, item.reference].join(' '));
    if (!known) return;
    const components = uniqueDrawerComponentsForFamily(item.item || item.reference);
    const componentCost = money(components.reduce((sum, component) => sum + (Number(component.cost ?? component.supplierPrice) || 0), 0));
    const cost = componentCost || known.cost;
    const ratio = known.cost ? known.client / known.cost : 1.7;
    item.cost = money(cost);
    if (item.manualClient !== true) item.client = Math.ceil(cost * ratio);
    if (item.manualReseller !== true) item.reseller = Number(item.client) || Math.ceil(cost * ratio);
  });
}

function applyCatalogOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return;
  mergeCatalogPrices(catalog.plates, overrides.plates, sameMaterialPrice);
  mergeCatalogPrices(catalog.paintings, overrides.paintings, (item, source) => item.name === source.name);
  mergeCatalogPrices(catalog.edges, overrides.edges, (item, source) => item.name === source.name);
  mergeCatalogPrices(catalog.doorSystems, overrides.doorSystems, (item, source) => item.name === source.name);
  mergeCatalogPrices(catalog.hinges, overrides.hinges, (item, source) => item.name === source.name);
  mergeCatalogPrices(catalog.extras, overrides.extras, catalogExtraMatches);
  mergeCatalogPrices(catalog.drawerComponents, overrides.drawerComponents, (item, source) => comparableItemText(item.item || item.reference) === comparableItemText(source.item || source.reference));
  normalizeDrawerRunnerExtras();
}

function findMaterialForAudit(value) {
  if (!String(value || '').trim()) return null;
  return catalog.plates.find(item => sameMaterialPrice(item, { name: value, reference: value, comparisonKey: value })) || null;
}

function findDrawerRunner(value) {
  const wanted = comparableItemText(value);
  if (!wanted) return null;
  const drawerExtras = (catalog.extras || []).filter(item => comparableText(item.group) === comparableText('Gavetas'));
  const components = catalog.drawerComponents || [];
  const candidateText = item => comparableItemText(item.item || item.label || item.name || item.reference);
  const exactExtra = drawerExtras.find(item => candidateText(item) === wanted);
  if (exactExtra) return exactExtra;
  const exactComponent = components.find(item => candidateText(item) === wanted);
  if (exactComponent) return exactComponent;
  return drawerExtras.concat(components).find(item => {
    const candidate = comparableItemText(item.item || item.label || item.name || item.reference);
    return candidate && (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
  }) || null;
}

function drawerMaterialLine(materialName, areaM2, sellKey) {
  const plate = findMaterialForAudit(materialName);
  if (!plate || areaM2 <= 0) return { cost: 0, client: 0 };
  return {
    cost: areaM2 * (Number(plate.cost) || 0),
    client: areaM2 * (Number(plate[sellKey]) || Number(plate.client) || 0)
  };
}

function materialThicknessCm(materialName) {
  const plate = findMaterialForAudit(materialName);
  const text = [materialName, plate?.name, plate?.reference, plate?.comparisonKey].filter(Boolean).join(' ');
  const match = text.match(/\b(\d+(?:[,.]\d+)?)\s*mm\b/i);
  return match ? (Number(String(match[1]).replace(',', '.')) || 0) / 10 : 0;
}

function calculateWardrobeDrawerUnit(extra, pricingMode, measures) {
  const width = Number(measures?.drawerWidth ?? extra.drawerWidth) || 0;
  const depth = Number(measures?.drawerDepth ?? extra.drawerDepth) || 0;
  const height = Number(measures?.drawerHeight ?? extra.drawerHeight) || 0;
  const sellKey = pricingMode === 'reseller' ? 'reseller' : 'client';
  const mode = comparableText(extra.drawerMaterialMode || 'Interior');
  const interior = extra.drawerInterior || extra.interior || '';
  const exterior = extra.drawerExterior || extra.exterior || interior;
  const useExteriorAll = mode === 'EXTERIOR';
  const useExteriorFront = mode.includes('FRENTE') || useExteriorAll;
  const baseMaterial = useExteriorAll ? exterior : interior;
  const frontMaterial = useExteriorFront ? exterior : interior;
  const boxWidth = Math.max(0, width - (materialThicknessCm(baseMaterial) * 2));
  const frontWidth = Math.max(0, width - (materialThicknessCm(frontMaterial) * 2));
  const bottomArea = (boxWidth * depth) / 10000;
  const sideArea = 2 * ((depth * height) / 10000);
  const frontArea = (frontWidth * height) / 10000;
  const backArea = (boxWidth * height) / 10000;
  const baseArea = bottomArea + sideArea + backArea;
  const baseLine = drawerMaterialLine(baseMaterial, baseArea, sellKey);
  const frontLine = drawerMaterialLine(frontMaterial, frontArea, sellKey);
  const runner = findDrawerRunner(extra.drawerRunner);
  const runnerCost = Number(runner?.cost ?? runner?.supplierPrice) || 0;
  const unitCost = money(baseLine.cost + frontLine.cost + runnerCost);
  const automaticMargin = pricingMode === 'reseller' ? 1.35 : 1.7;
  const automaticClient = unitCost ? Math.ceil(unitCost * automaticMargin) : Math.ceil(baseLine.client + frontLine.client);
  const unitClient = money(automaticClient);
  return {
    unitCost,
    unitClient,
    item: wardrobeDrawerItem
  };
}

function calculateWardrobeDrawerExtra(extra, pricingMode) {
  const distribution = Array.isArray(extra.moduleDistribution)
    ? extra.moduleDistribution.filter(item => (Number(item.quantity) || 0) > 0)
    : [];
  if (!distribution.length) return calculateWardrobeDrawerUnit(extra, pricingMode);
  const totals = distribution.reduce((sum, item) => {
    const quantity = Number(item.quantity) || 0;
    const unit = calculateWardrobeDrawerUnit(extra, pricingMode, item);
    return {
      quantity: sum.quantity + quantity,
      totalCost: sum.totalCost + (quantity * unit.unitCost),
      totalClient: sum.totalClient + (quantity * unit.unitClient)
    };
  }, { quantity: 0, totalCost: 0, totalClient: 0 });
  const quantity = totals.quantity || Number(extra.quantity) || 1;
  return {
    unitCost: money(totals.totalCost / quantity),
    unitClient: money(totals.totalClient / quantity),
    totalCost: money(totals.totalCost),
    totalClient: money(totals.totalClient),
    item: wardrobeDrawerItem
  };
}

function quoteWarnings(modules, extras) {
  const warnings = [];
  modules.forEach((module, index) => {
    if (module.blank || !String(module.type || '').trim()) return;
    const type = workbookData.inferType(module);
    const piecePlate = type === 'Peças/Placa' || type === 'PeÃ§as/Placa' || type === 'PeÃƒÂ§as/Placa';
    if (!String(module.interior || '').trim()) {
      warnings.push(`Módulo ${index + 1}: falta madeira interior.`);
    } else if (!findMaterialForAudit(module.interior)) {
      warnings.push(`Módulo ${index + 1}: madeira interior sem preço encontrado (${module.interior}).`);
    }
    if (!piecePlate && String(module.exterior || '').trim()) {
      if (!findMaterialForAudit(module.exterior)) {
        warnings.push(`Módulo ${index + 1}: madeira exterior sem preço encontrado (${module.exterior}).`);
      }
    }
    if (module.edgeType && !/sem orla/i.test(module.edgeType) && !catalog.edges.find(item => comparableText(item.name) === comparableText(module.edgeType))) {
      warnings.push(`Módulo ${index + 1}: orla sem preço encontrado (${module.edgeType}).`);
    }
  });
  extras.forEach((extra, index) => {
    if (!String(extra.group || '').trim()) return;
    if (!String(extra.item || '').trim()) return;
    if (isManualPricedExtra(extra)) return;
    if (isWardrobeDrawerExtra(extra)) return;
    if (
      Number(extra.unitClient) ||
      Number(extra.unitCost) ||
      Number(extra.totalClient) ||
      Number(extra.totalCost)
    ) return;
    if (!catalog.extras.find(item => catalogExtraMatches(item, extra))) {
      warnings.push(`Extra ${index + 1}: item sem preço encontrado (${extra.group} / ${extra.item || 'sem item'}).`);
    }
  });
  return warnings;
}

function calculateQuote(payload) {
  applyCatalogOverrides(payload.catalog);
  const client = payload.client || quoteSeed.client;
  const pricingMode = payload.pricingMode === 'reseller' ? 'reseller' : 'normal';
  const modules = Array.isArray(payload.modules) ? payload.modules : quoteSeed.modules;
  const extras = Array.isArray(payload.extras) ? payload.extras : quoteSeed.extras;

  const moduleLines = modules.map(module => {
    const quantity = Number(module.quantity) || 0;
    const blankModule = module.blank || !String(module.type || '').trim();
    const prices = blankModule ? { unitClient: 0, unitCost: 0 } : calculateModulePrice(module, pricingMode);
    const unitClient = prices.unitClient;
    const unitCost = prices.unitCost;
    return {
      ...module,
      quantity,
      unitClient,
      unitCost,
      totalClient: money(quantity * unitClient),
      totalCost: money(quantity * unitCost)
    };
  });

  const extraLines = extras.map(extra => {
    const quantity = Number(extra.quantity) || 0;
    const blankExtra = !String(extra.group || '').trim() || !String(extra.item || '').trim();
    const wardrobeDrawer = !blankExtra && isWardrobeDrawerExtra(extra) ? calculateWardrobeDrawerExtra(extra, pricingMode) : null;
    const manualPricedExtra = !blankExtra && isManualPricedExtra(extra);
    const catalogItem = blankExtra || manualPricedExtra ? null : catalog.extras.find(item => catalogExtraMatches(item, extra));
    const lacquerClient = isSkirtingExtra(extra) && isLacqueredExtra(extra) ? skirtingLacquerClientPerMeter : 0;
    const baseExtraClient = catalogItem
      ? (pricingMode === 'reseller' ? (Number(catalogItem.reseller) || Number(catalogItem.client) || 0) : (Number(catalogItem.client) || 0))
      : (Number(extra.unitClient) || 0);
    const baseExtraCost = catalogItem ? (Number(catalogItem.cost) || 0) : (Number(extra.unitCost) || 0);
    const rodLine = !blankExtra && !wardrobeDrawer ? wardrobeRodLine(extra, catalogItem, baseExtraClient, baseExtraCost) : null;
    const unitClient = blankExtra ? 0 : (wardrobeDrawer ? wardrobeDrawer.unitClient : (rodLine ? rodLine.unitClient : (baseExtraClient + lacquerClient)));
    const unitCost = blankExtra ? 0 : (wardrobeDrawer ? wardrobeDrawer.unitCost : (rodLine ? rodLine.unitCost : baseExtraCost));
    const totalClient = wardrobeDrawer && wardrobeDrawer.totalClient !== undefined ? wardrobeDrawer.totalClient : money(quantity * unitClient);
    const totalCost = wardrobeDrawer && wardrobeDrawer.totalCost !== undefined ? wardrobeDrawer.totalCost : money(quantity * unitCost);
    return {
      ...extra,
      item: wardrobeDrawer ? wardrobeDrawer.item : extra.item,
      quantity,
      unitClient,
      unitCost,
      totalClient,
      totalCost
    };
  });

  const moduleTotal = money(moduleLines.reduce((sum, line) => sum + line.totalClient, 0));
  const extrasTotal = money(extraLines.reduce((sum, line) => sum + line.totalClient, 0));
  const costTotal = money(moduleLines.reduce((sum, line) => sum + line.totalCost, 0) + extraLines.reduce((sum, line) => sum + line.totalCost, 0));
  const finalTotal = money(moduleTotal + extrasTotal);
  const margin = money(finalTotal - costTotal);

  return { client, pricingMode, modules: moduleLines, extras: extraLines, totals: { moduleTotal, extrasTotal, costTotal, finalTotal, margin }, warnings: quoteWarnings(modules, extras) };
}

app.get('/api/bootstrap', (req, res) => {
  refreshWorkbookData();
  res.json({ ...quoteSeed, quote: calculateQuote(quoteSeed) });
});

app.post('/api/calculate', (req, res) => {
  refreshWorkbookData();
  const payload = req.body || quoteSeed;
  res.json(calculateQuote({
    ...payload,
    pricingMode: allowedPricingModeForRequest(req, payload.pricingMode)
  }));
});

app.get('/api/supplier-prices', (req, res) => {
  refreshWorkbookData();
  res.json(supplierPricePayload());
});

app.get('/api/session', (req, res) => {
  res.json(publicSession(readAuthSession(req)));
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  try {
    let profile;
    if (useSupabaseAuth) {
      if (allowBootstrapAdmin && username === adminUser && password === adminPassword) {
        profile = { username, name: adminUser, role: 'admin' };
      } else {
        profile = await loginWithSupabase(username, password);
      }
    } else {
      if (username !== adminUser || password !== adminPassword) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }
      profile = { username, name: adminUser, role: 'admin' };
    }
    const token = createAuthSession(profile);
    const session = adminSessions.get(token);
    res.setHeader('Set-Cookie', sessionCookie(token, sessionMaxAgeSeconds));
    return res.json(publicSession(session));
  } catch (error) {
    return res.status(401).json({ error: error.message || 'Credenciais invalidas.' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).silwood_session;
  if (token) adminSessions.delete(token);
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json(publicSession(null));
});

app.get('/api/quote-history', requireAuth, async (req, res) => {
  try {
    const entries = await quoteHistoryForSession(req.authSession, req.query.userId);
    res.json({ entries });
  } catch (error) {
    res.status(400).json({ entries: [], error: error.message });
  }
});

app.post('/api/quote-history', requireAuth, async (req, res) => {
  try {
    await saveQuoteHistoryForSession(req.authSession, req.body || {});
    const entries = await quoteHistoryForSession(req.authSession);
    res.json({ entries });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/quote-history/import', requireAuth, async (req, res) => {
  try {
    await importQuoteHistoryForSession(req.authSession, req.body || {});
    const entries = await quoteHistoryForSession(req.authSession);
    res.json({ entries });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/quote-history/:id', requireAuth, async (req, res) => {
  try {
    await deleteQuoteHistoryForSession(req.authSession, req.params.id);
    const entries = await quoteHistoryForSession(req.authSession, req.query.userId);
    res.json({ entries });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    res.json({ enabled: useSupabaseAuth && Boolean(supabaseServiceRoleKey), users: await listSupabaseUsers() });
  } catch (error) {
    res.status(400).json({ enabled: false, users: [], error: error.message });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    await createSupabaseUser(req.body || {});
    res.json({ enabled: true, users: await listSupabaseUsers() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    await updateSupabaseUser(req.params.id, req.body || {});
    res.json({ enabled: true, users: await listSupabaseUsers() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/supplier-prices', requireAdmin, async (req, res) => {
  refreshWorkbookData();
  const changedKeys = [
    'plates',
    'paintings',
    'paintingComponents',
    'edges',
    'extras',
    'drawerComponents',
    'hinges',
    'hingeComponents',
    'openingSystemComponents'
  ];
  const hasChanges = changedKeys.some((key) => Array.isArray(req.body?.[key]) && req.body[key].length);
  if (!hasChanges) return res.status(400).json({ error: 'NÃ£o existem preÃ§os para guardar.' });

  try {
    const excelResult = queueSupplierPricesToExcel(req.body || {});
    res.json({ ...supplierPricePayload(), excel: excelResult });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/supplier-prices/plate', requireAdmin, async (req, res) => {
  refreshWorkbookData();
  const plate = req.body?.plate || req.body;
  if (!plate || !plate.name) return res.status(400).json({ error: 'Indique o nome da madeira.' });

  try {
    const excelResult = await saveSupplierPricesToExcel({ plates: [plate], addMissingPlates: true });
    persistPriceOverridesPayload({ plates: [plate], addMissingPlates: true });
    workbookStamp = '';
    refreshWorkbookData();
    res.json({ ...supplierPricePayload(), excel: excelResult });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (require.main === module) {
  app.listen(port, host, () => {
    console.log('Silwood simulador ativo em http://localhost:' + port);
    localNetworkUrls().forEach((url) => {
      console.log('Acesso na rede: ' + url);
    });
  });
}

module.exports = { app, calculateQuote };

