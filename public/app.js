const euro = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const storageKey = 'silwood-orcamento-v1';
const supplierAdditionsKey = 'silwood-supplier-additions-v1';
const supplierDraftKey = 'silwood-supplier-draft-v1';
const supplierRemovedKey = 'silwood-supplier-removed-v1';
const quoteHistoryKey = 'silwood-quote-history-v1';
const quoteDraftsKey = 'silwood-quote-drafts-v1';
const activeQuoteDraftKey = 'silwood-active-quote-draft-v1';
const doorSystemExtraGroup = 'Sistema de abertura';
const legacyDoorSystemExtraGroup = 'Sistema de abertura de portas';
const otherExtraGroup = 'Outros';
const transportExtraGroup = 'Transporte e embalamento';
const transportExtraItems = ['CARGA + TRANSPORTE + EMBALAMENTO', 'EMBALAMENTO + CARGA'];
const wardrobeDrawerGroup = 'Gavetas Roupeiro';
const wardrobeDrawerItem = 'Gaveta Roupeiro';
const state = { client: null, modules: [], extras: [], lists: {}, catalog: { extras: [] }, typePresets: {}, quote: null, original: null, pricingMode: 'normal', supplierPrices: [], pricingRules: null, supplierTab: 'Madeiras / Placas', platePriceView: 'summary', isAdmin: false, isAuthenticated: false, userRole: 'anonymous', userName: '', usesSupabase: false, users: [], usersEnabled: false, quoteHistory: [], quoteHistoryOwnerId: '', quoteHistoryOwnerLabel: '' };
let plateDuplicateReferenceKeysCache = null;
let plateKnownNameCache = null;
let knownPlateCodesCache = null;
let supplierRenderTimer = null;
let supplierRecalculationTimer = null;
let supplierRecalculationNeedsPlateRefresh = false;
let supplierDraftPersistTimer = null;
let visualPreviewTimer = null;
let calculateTimer = null;
let supplierSearchTimer = null;
let quotePersistTimer = null;
let pendingQuoteSnapshot = null;
let drawerSplitState = null;
let moduleSplitState = null;
const drawerQuantityMemory = new Map();
const supplierDirtyChanges = {
  plates: new Map(),
  paintings: new Map(),
  paintingComponents: new Map(),
  edges: new Map(),
  extras: new Map(),
  drawerComponents: new Map(),
  hinges: new Map(),
  hingeComponents: new Map(),
  openingSystemComponents: new Map()
};
let baseDoorSystemsByName = new Map();

const sourceStatus = document.querySelector('#sourceStatus');
const clientBlock = document.querySelector('#clientBlock');
const kpiBlock = document.querySelector('#kpiBlock');
const modulesGrid = document.querySelector('#modulesGrid');
const finalGrid = document.querySelector('#finalGrid');
const visualPreviewGrid = document.querySelector('#visualPreviewGrid');
const printSheet = document.querySelector('#printSheet');
const quoteView = document.querySelector('#quoteView');
const visualView = document.querySelector('#visualView');
const supplierView = document.querySelector('#supplierView');
const usersView = document.querySelector('#usersView');
const supplierPricesGrid = document.querySelector('#supplierPricesGrid');
const usersGrid = document.querySelector('#usersGrid');
const supplierSearchInput = document.querySelector('#supplierSearchInput');
const quoteActions = document.querySelector('#quoteActions');
const quoteHistoryList = document.querySelector('#quoteHistoryList');
const saveHistoryButton = document.querySelector('#saveHistoryButton');
const pageTitle = document.querySelector('#pageTitle');
const quoteTitle = document.querySelector('#quoteTitle');
const authState = document.querySelector('#authState');
const authForm = document.querySelector('#authForm');
const loginUser = document.querySelector('#loginUser');
const loginPassword = document.querySelector('#loginPassword');
const loginButton = document.querySelector('#loginButton');
const authError = document.querySelector('#authError');
const logoutButton = document.querySelector('#logoutButton');

function money(value) { return euro.format(Number(value) || 0); }
function scheduleVisualPreview(delay) {
  window.clearTimeout(visualPreviewTimer);
  visualPreviewTimer = window.setTimeout(renderVisualPreview, delay === undefined ? 80 : delay);
}
function scheduleCalculate(options, delay) {
  window.clearTimeout(calculateTimer);
  calculateTimer = window.setTimeout(function () {
    calculate(options).catch(function (error) { sourceStatus.textContent = error.message; });
  }, delay === undefined ? 180 : delay);
}
function scheduleSupplierSearch(delay) {
  window.clearTimeout(supplierSearchTimer);
  supplierSearchTimer = window.setTimeout(applySupplierSearch, delay === undefined ? 120 : delay);
}
function canManagePrices() { return state.isAdmin === true; }
function setLoginError(message) {
  if (!authError) return;
  authError.textContent = message || '';
  authError.hidden = !message;
}
function updateAccessUi() {
  document.body.classList.toggle('is-admin', canManagePrices());
  document.body.classList.toggle('is-standard-user', !canManagePrices());
  document.querySelectorAll('[data-view="suppliers"], [data-view="users"]').forEach(function (button) {
    button.hidden = !canManagePrices();
  });
  if (authState) {
    authState.textContent = canManagePrices()
      ? 'Modo administrador'
      : (state.isAuthenticated ? 'Utilizador' : 'Modo normal');
  }
  if (authForm) authForm.hidden = state.isAuthenticated;
  if (logoutButton) logoutButton.hidden = !state.isAuthenticated;
  const saveButton = document.querySelector('#saveSupplierPricesButton');
  if (saveButton) saveButton.disabled = !canManagePrices();
  if (!canManagePrices() && ((supplierView && !supplierView.hidden) || (usersView && !usersView.hidden))) {
    showView('quote', state.pricingMode, false).catch(function (error) { sourceStatus.textContent = error.message; });
  }
}

async function loadSession() {
  const response = await fetch('/api/session');
  if (!response.ok) return;
  const data = await response.json();
  state.isAdmin = data.admin === true;
  state.isAuthenticated = data.authenticated === true;
  state.userRole = data.role || (state.isAdmin ? 'admin' : 'anonymous');
  state.userName = data.name || '';
  state.usesSupabase = data.supabase === true;
  updateAccessUi();
}

async function loginAdmin() {
  const username = loginUser ? loginUser.value.trim() : '';
  const password = loginPassword ? loginPassword.value : '';
  setLoginError('');
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    const message = response.status === 401
      ? 'Utilizador ou palavra-passe incorretos.'
      : (data.error || 'Não foi possível iniciar sessão.');
    setLoginError(message);
    throw new Error(message);
  }
  state.isAdmin = data.admin === true;
  state.isAuthenticated = data.authenticated === true;
  state.userRole = data.role || (state.isAdmin ? 'admin' : 'user');
  state.userName = data.name || username;
  state.usesSupabase = data.supabase === true;
  if (loginPassword) loginPassword.value = '';
  updateAccessUi();
  await loadQuoteHistoryList();
  // O login altera permissões e conteúdo disponível. Reativa a vista atual
  // imediatamente, tal como aconteceria ao clicar numa aba, para que a app
  // fique pronta sem exigir uma navegação manual.
  if (visualView && !visualView.hidden) {
    await showView('visual', state.pricingMode, false);
  } else {
    await showView('quote', state.pricingMode, true);
  }
  sourceStatus.textContent = canManagePrices() ? 'Modo administrador ativo' : 'Sessao iniciada';
}

async function logoutAdmin() {
  const response = await fetch('/api/logout', { method: 'POST' }).catch(function () { return null; });
  const data = response ? await response.json().catch(function () { return {}; }) : {};
  state.isAdmin = false;
  state.isAuthenticated = false;
  state.userRole = 'anonymous';
  state.userName = '';
  state.usesSupabase = data.supabase === true || state.usesSupabase;
  state.quoteHistory = [];
  state.quoteHistoryOwnerId = '';
  state.quoteHistoryOwnerLabel = '';
  updateAccessUi();
  renderQuoteHistory();
  await showView('quote', state.pricingMode, false);
  sourceStatus.textContent = 'Modo normal ativo';
}

function renderUserRoleOptions(current) {
  return ['user', 'admin'].map(function (role) {
    return '<option value="' + role + '"' + (role === current ? ' selected' : '') + '>' + (role === 'admin' ? 'Admin' : 'Utilizador') + '</option>';
  }).join('');
}

function renderUsersPanel(message) {
  if (!usersGrid) return;
  const disabled = state.usersEnabled ? '' : ' disabled';
  const rows = (state.users || []).map(function (user) {
    return '<tr>' +
      '<td><input data-user-id="' + attrEsc(user.id) + '" data-user-field="email" value="' + attrEsc(user.email || '') + '"' + disabled + '></td>' +
      '<td><input data-user-id="' + attrEsc(user.id) + '" data-user-field="name" value="' + attrEsc(user.name || '') + '"' + disabled + '></td>' +
      '<td><select data-user-id="' + attrEsc(user.id) + '" data-user-field="role"' + disabled + '>' + renderUserRoleOptions(user.role || 'user') + '</select></td>' +
      '<td class="text-center"><input type="checkbox" data-user-id="' + attrEsc(user.id) + '" data-user-field="active"' + (user.active !== false ? ' checked' : '') + disabled + '></td>' +
      '<td><input type="password" data-user-id="' + attrEsc(user.id) + '" data-user-field="password" placeholder="Nova palavra-passe"' + disabled + '></td>' +
      '<td class="user-actions-cell">' +
        '<button class="soft-inline-button" data-show-user-history="' + attrEsc(user.id) + '" data-user-history-label="' + attrEsc(user.name || user.email || 'Utilizador') + '" type="button"' + disabled + '>Histórico</button>' +
        '<button class="soft-inline-button" data-save-user="' + attrEsc(user.id) + '" type="button"' + disabled + '>Guardar</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  usersGrid.innerHTML =
    '<section class="user-card">' +
      '<h3>Criar utilizador</h3>' +
      '<div class="user-form-grid">' +
        '<label><span>Email</span><input id="newUserEmail" type="email" placeholder="nome@empresa.pt"' + disabled + '></label>' +
        '<label><span>Nome</span><input id="newUserName" type="text" placeholder="Nome"' + disabled + '></label>' +
        '<label><span>Palavra-passe</span><input id="newUserPassword" type="password" placeholder="Mín. 6 caracteres"' + disabled + '></label>' +
        '<label><span>Permissão</span><select id="newUserRole"' + disabled + '>' + renderUserRoleOptions('user') + '</select></label>' +
        '<label class="user-active-field"><span>Ativo</span><input id="newUserActive" type="checkbox" checked' + disabled + '></label>' +
        '<button id="createUserButton" type="button"' + disabled + '>Criar utilizador</button>' +
      '</div>' +
      (message ? '<p class="user-message">' + esc(message) + '</p>' : '') +
      (!state.usersEnabled ? '<p class="user-message">Para criar utilizadores aqui, configura SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY no servidor.</p>' : '') +
    '</section>' +
    '<section class="user-card">' +
      '<h3>Utilizadores existentes</h3>' +
      '<table class="supplier-table users-table"><thead><tr>' +
        '<th>Email</th><th>Nome</th><th>Permissão</th><th>Ativo</th><th>Nova password</th><th>Ações</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6">Sem utilizadores para mostrar.</td></tr>') + '</tbody></table>' +
    '</section>';
}

async function loadUsers() {
  const response = await fetch('/api/users');
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    state.users = [];
    state.usersEnabled = false;
    renderUsersPanel(data.error || 'Não foi possível carregar utilizadores.');
    return;
  }
  state.users = data.users || [];
  state.usersEnabled = data.enabled === true;
  renderUsersPanel(data.error || '');
}

async function createUserFromForm() {
  const payload = {
    email: document.querySelector('#newUserEmail')?.value || '',
    name: document.querySelector('#newUserName')?.value || '',
    password: document.querySelector('#newUserPassword')?.value || '',
    role: document.querySelector('#newUserRole')?.value || 'user',
    active: document.querySelector('#newUserActive')?.checked !== false
  };
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || 'Não foi possível criar utilizador.');
  state.users = data.users || [];
  state.usersEnabled = data.enabled === true;
  renderUsersPanel('Utilizador criado.');
}

async function saveUserFromRow(userId) {
  const fields = Array.from(document.querySelectorAll('[data-user-id]')).filter(function (field) {
    return field.dataset.userId === userId;
  });
  const payload = fields.reduce(function (sum, field) {
    const key = field.dataset.userField;
    if (!key) return sum;
    if (key === 'active') sum.active = field.checked;
    else if (key === 'password') {
      if (field.value) sum.password = field.value;
    } else {
      sum[key] = field.value;
    }
    return sum;
  }, {});
  const response = await fetch('/api/users/' + encodeURIComponent(userId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || 'Não foi possível guardar utilizador.');
  state.users = data.users || [];
  state.usersEnabled = data.enabled === true;
  renderUsersPanel('Utilizador guardado.');
}

function markSupplierPricesDirty() {
  sourceStatus.textContent = 'Existem preços por guardar';
}
function supplierDirtyKey(item, fallback) {
  if (!item) return String(fallback || '');
  if (item.__dirtyIndex !== undefined && item.__dirtyIndex !== null) return 'INDEX|' + String(item.__dirtyIndex);
  return [
    item.priceKey,
    item.name,
    item.item,
    item.group,
    item.supplier,
    item.reference,
    fallback
  ].map(function (value) { return comparableText(value); }).filter(Boolean).join('|');
}
function trackSupplierChange(type, item, fallback) {
  if (!supplierDirtyChanges[type] || !item) return;
  const draftItem = clone(item);
  if (fallback !== undefined) draftItem.__dirtyIndex = fallback;
  supplierDirtyChanges[type].set(supplierDirtyKey(draftItem, fallback), draftItem);
  persistSupplierDraftChangesSoon();
  markSupplierPricesDirty();
}
function supplierDirtyPayload() {
  const payload = {};
  Object.keys(supplierDirtyChanges).forEach(function (type) {
    const values = dedupeSupplierItems(type, Array.from(supplierDirtyChanges[type].values()).map(function (item) {
      const copy = clone(item);
      delete copy.__dirtyIndex;
      return copy;
    }));
    if (values.length) payload[type] = values;
  });
  return payload;
}
function hasSupplierDirtyChanges() {
  return Object.keys(supplierDirtyChanges).some(function (type) {
    return supplierDirtyChanges[type].size > 0;
  });
}
function clearSupplierDirtyChanges() {
  Object.keys(supplierDirtyChanges).forEach(function (type) {
    supplierDirtyChanges[type].clear();
  });
  localStorage.removeItem(supplierDraftKey);
}
function persistSupplierDraftChanges() {
  const payload = supplierDirtyPayload();
  if (Object.keys(payload).length) {
    localStorage.setItem(supplierDraftKey, JSON.stringify(payload));
  } else {
    localStorage.removeItem(supplierDraftKey);
  }
}
function persistSupplierDraftChangesSoon() {
  if (supplierDraftPersistTimer) clearTimeout(supplierDraftPersistTimer);
  supplierDraftPersistTimer = setTimeout(function () {
    supplierDraftPersistTimer = null;
    persistSupplierDraftChanges();
  }, 500);
}
function flushSupplierDraftPersist() {
  if (!supplierDraftPersistTimer) return;
  clearTimeout(supplierDraftPersistTimer);
  supplierDraftPersistTimer = null;
  persistSupplierDraftChanges();
}
function supplierDraftStore() {
  try {
    return JSON.parse(localStorage.getItem(supplierDraftKey) || '{}') || {};
  } catch (error) {
    return {};
  }
}
function restoreSupplierDirtyChanges() {
  const draft = supplierDraftStore();
  Object.keys(supplierDirtyChanges).forEach(function (type) {
    supplierDirtyChanges[type].clear();
    (draft[type] || []).forEach(function (item, index) {
      supplierDirtyChanges[type].set(supplierDirtyKey(item, item.__dirtyIndex ?? index), clone(item));
    });
  });
  return hasSupplierDirtyChanges();
}
function cleanDisplayText(value) {
  let text = String(value ?? '');
  for (let i = 0; i < 3 && /Ã|Â|â|�/.test(text); i += 1) {
    try {
      text = decodeURIComponent(escape(text));
    } catch (error) {
      break;
    }
  }
  return text
    .replace(/ServiÃ§o/g, 'Serviço')
    .replace(/ServiÃƒÂ§o/g, 'Serviço')
    .replace(/preÃ§o/g, 'preço')
    .replace(/PreÃ§o/g, 'Preço')
    .replace(/MÃ³dulo/g, 'Módulo')
    .replace(/mÃ³dulo/g, 'módulo')
    .replace(/referÃªncia/g, 'referência')
    .replace(/ReferÃªncia/g, 'Referência')
    .replace(/descriÃ§Ã£o/g, 'descrição')
    .replace(/DescriÃ§Ã£o/g, 'Descrição')
    .replace(/orÃ§amento/g, 'orçamento')
    .replace(/OrÃ§amento/g, 'Orçamento')
    .replace(/NÃ£o/g, 'Não')
    .replace(/NÃƒÂ£o/g, 'Não')
    .replace(/nÃ£o/g, 'não')
    .replace(/nÃƒÂ£o/g, 'não')
    .replace(/SÃ³/g, 'Só')
    .replace(/Lage & Sã/g, 'Lage & Sá')
    .replace(/Lage & SÃ¡/g, 'Lage & Sá')
    .replace(/Ã‡/g, 'Ç')
    .replace(/ÃƒO/g, 'ÃO')
    .replace(/Ãƒo/g, 'ão')
    .replace(/ÃŠ/g, 'Ê')
    .replace(/Ã“/g, 'Ó')
    .replace(/Poliretano/g, 'Poliuretano')
    .replace(/poliretano/g, 'poliuretano')
    .replace(/Acrilico/g, 'Acrílico')
    .replace(/acrilico/g, 'acrílico');
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function esc(value) { return escapeHtml(cleanDisplayText(value)); }
function attrEsc(value) { return escapeHtml(value); }
function num(value) { return Number(String(value).replace(',', '.')) || 0; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanMaterialName(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/lunawood/i.test(text) && /212/i.test(text) && /3000\s*mm/i.test(text)) {
    return 'LUNAWOOD ST 212ºC TRIPLE SHAD - 3000mm (32*140)';
  }
  const matches = Array.from(text.matchAll(/\b\d+(?:[,.]\d+)?\s*mm\b/gi));
  if (matches.length > 1) {
    const first = matches[0];
    const head = text.slice(0, first.index + first[0].length).trim();
    const tail = text.slice(first.index + first[0].length).trim();
    const headBase = head.replace(/\s*-?\s*\d+(?:[,.]\d+)?\s*mm$/i, '').trim();
    if (headBase && comparableText(tail).startsWith(comparableText(headBase))) return head;
  }
  return text;
}
function optionList(values, current) { return (values || []).map(function (value) { return '<option value="' + attrEsc(value) + '"' + (value === current ? ' selected' : '') + '>' + esc(value) + '</option>'; }).join(''); }
function optionListWithBlank(values, current) { return '<option value=""' + (!current ? ' selected' : '') + '></option>' + optionList(values, current); }
function datalistOptions(id, values) { return '<datalist id="' + attrEsc(id) + '">' + (values || []).map(function (value) { return '<option value="' + attrEsc(value) + '">' + esc(value) + '</option>'; }).join('') + '</datalist>'; }
function extraItems(group) { return state.catalog.extras.filter(item => normalizeExtraGroupName(item.group) === normalizeExtraGroupName(group)).map(item => item.item); }
function isOtherExtra(extra) { return comparableText(extra?.group) === comparableText(otherExtraGroup); }
function isTransportExtra(extra) { return comparableText(extra?.group) === comparableText(transportExtraGroup); }
function isManualPricedExtra(extra) { return isOtherExtra(extra) || isTransportExtra(extra); }
function isSkirtingExtra(extra) { return comparableText(extra?.group).includes('RODAP'); }
function isLacqueredExtra(extra) { return extra?.lacquered === true || extra?.lacquered === 'Sim'; }
function isWardrobeDrawerExtra(extra) { return comparableText(extra?.group) === comparableText(wardrobeDrawerGroup); }
function isKitchenDrawerExtra(extra) { return normalizeExtraGroupName(extra?.group) === 'Gavetas'; }
function wardrobeRodLengthCmFromText(text) {
  const raw = cleanDisplayText(text).toUpperCase();
  const normalized = comparableText(raw);
  let longest = 0;
  Array.from(raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:M|MT|METRO|METROS)\b/g)).forEach(function (match) {
    longest = Math.max(longest, num(match[1]) * 100);
  });
  Array.from(raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:CM|CENTIMETROS)\b/g)).forEach(function (match) {
    longest = Math.max(longest, num(match[1]));
  });
  Array.from(raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:MM|MILIMETROS)\b/g)).forEach(function (match) {
    longest = Math.max(longest, num(match[1]) / 10);
  });
  Array.from(normalized.matchAll(/\b(?:MOD|AAF)\s*\.?\s*(\d{2,3})\b/g)).forEach(function (match) {
    longest = Math.max(longest, Number(match[1]) || 0);
  });
  Array.from(normalized.matchAll(/\b(\d{2,4})\s*[-/]\s*(\d{2,4})\b/g)).forEach(function (match) {
    const value = Math.max(Number(match[1]) || 0, Number(match[2]) || 0);
    longest = Math.max(longest, value > 300 ? value / 10 : value);
  });
  return longest;
}
function isWardrobeRodExtra(extra) {
  if (normalizeExtraGroupName(extra?.group) !== 'Acessórios Roupeiro') return false;
  const catalogItem = findCatalogExtraForQuote(extra);
  const text = comparableText([extra?.item, extra?.reference, catalogItem?.item, catalogItem?.label, catalogItem?.name, catalogItem?.reference].join(' '));
  return text.includes('VARAO') || text.includes('EXTENSIVEL') || /\bASSA\s*75\s*125\b/.test(text) || wardrobeRodLengthCmFromText(text) > 80;
}
function wardrobeRodSegments(extra) {
  return String(extra?.rodLengths || extra?.rodLengthCm || '')
    .split(/[+;,|/\n]+/)
    .map(function (value) { return num(value); })
    .filter(function (value) { return value > 0; });
}
function wardrobeRodDescription(extra) {
  const segments = wardrobeRodSegments(extra);
  if (!segments.length) return '';
  return ' / Varão: ' + segments.map(function (value) { return cmValue(value) + 'cm'; }).join(' + ');
}
function moduleStableId(module, index) {
  if (!module.id) module.id = 'module_' + Date.now() + '_' + index + '_' + Math.round(Math.random() * 100000);
  return module.id;
}
function moduleOptionLabel(module, index) {
  return (index + 1) + ' - ' + modulePreviewTitle(module) + ' ' + (module.width || 0) + 'x' + (module.height || 0) + 'x' + (module.depth || 0);
}
function drawerCompatibleModules(extra) {
  const modules = state.modules || [];
  if (isWardrobeDrawerExtra(extra)) return modules.filter(function (module) {
    return module && !module.blank && ['Roupeiro', 'Inferior'].includes(module.type);
  });
  if (isKitchenDrawerExtra(extra)) return modules.filter(function (module) {
    return module && !module.blank && ['Inferior', 'Superior', 'Coluna'].includes(module.type);
  });
  return [];
}
function drawerTargetModule(extra) {
  const compatible = drawerCompatibleModules(extra);
  if (!compatible.length) return null;
  const selected = compatible.find(function (module) { return moduleStableId(module, state.modules.indexOf(module)) === extra.targetModuleId; });
  return selected || compatible[0];
}
function drawerModuleOptionList(extra) {
  const compatible = drawerCompatibleModules(extra);
  if (!compatible.length) return '<option value="">Sem módulo compatível</option>';
  const target = drawerTargetModule(extra);
  return compatible.map(function (module) {
    const index = state.modules.indexOf(module);
    const id = moduleStableId(module, index);
    return '<option value="' + attrEsc(id) + '"' + (target && id === target.id ? ' selected' : '') + '>' + esc(moduleOptionLabel(module, index)) + '</option>';
  }).join('');
}

function syncDrawerDistributionQuantity(extra, index) {
  if (!extra || (!isKitchenDrawerExtra(extra) && !isWardrobeDrawerExtra(extra))) return;
  const quantity = num(extra.quantity);
  drawerQuantityMemory.set(extra.id || String(index), quantity);
  if (!Array.isArray(extra.moduleDistribution) || !extra.moduleDistribution.length) return;
  const total = extra.moduleDistribution.reduce(function (sum, item) { return sum + num(item.quantity); }, 0);
  const diff = quantity - total;
  if (Math.abs(diff) <= 0.001) return;
  if (quantity <= 0) {
    extra.moduleDistribution = [];
    return;
  }
  if (diff > 0) {
    const target = [...extra.moduleDistribution].reverse().find(function (item) { return num(item.quantity) > 0; }) || extra.moduleDistribution[extra.moduleDistribution.length - 1];
    target.quantity = num(target.quantity) + diff;
    return;
  }
  let remainingReduction = Math.abs(diff);
  for (let itemIndex = extra.moduleDistribution.length - 1; itemIndex >= 0 && remainingReduction > 0; itemIndex -= 1) {
    const item = extra.moduleDistribution[itemIndex];
    const itemQuantity = num(item.quantity);
    const reduction = Math.min(itemQuantity, remainingReduction);
    item.quantity = itemQuantity - reduction;
    remainingReduction -= reduction;
  }
  extra.moduleDistribution = extra.moduleDistribution.filter(function (item) { return num(item.quantity) > 0; });
  if (!extra.moduleDistribution.length) {
    const module = drawerTargetModule(extra);
    if (!module) return;
    const moduleId = moduleStableId(module, state.modules.indexOf(module));
    extra.moduleDistribution = [{
      moduleId,
      quantity,
      drawerWidth: num(extra.drawerWidth) || module.width || 0,
      drawerDepth: num(extra.drawerDepth) || module.depth || 0,
      drawerHeight: num(extra.drawerHeight) || 16
    }];
  }
}
function drawerRunnerOptions() {
  const drawerExtras = (state.catalog.extras || []).filter(function (item) {
    return comparableText(item.group) === comparableText('Gavetas');
  });
  const components = (state.catalog.drawerComponents || []).concat(drawerExtras).filter(function (item) {
    const text = comparableText([item.item, item.reference, item.label].join(' '));
    return text.includes('CORRED');
  });
  const seen = new Set();
  return components.map(function (item) { return item.item || item.label || item.reference; }).filter(function (value) {
    const key = comparableText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function ensureWardrobeDrawerExtra(extra) {
  if (!extra) return extra;
  if (!isWardrobeDrawerExtra(extra)) return extra;
  const module = drawerTargetModule(extra);
  extra.group = wardrobeDrawerGroup;
  extra.item = wardrobeDrawerItem;
  if (module) extra.targetModuleId = moduleStableId(module, state.modules.indexOf(module));
  if (!extra.quantity) extra.quantity = 1;
  if (!extra.drawerWidth) extra.drawerWidth = module?.width || 60;
  if (!extra.drawerDepth) extra.drawerDepth = module?.depth || 50;
  if (!extra.drawerHeight) extra.drawerHeight = 16;
  if (!extra.drawerMaterialMode) extra.drawerMaterialMode = 'Interior';
  if (!extra.drawerRunner) extra.drawerRunner = drawerRunnerOptions()[0] || '';
  extra.drawerInterior = module?.interior || extra.drawerInterior || '';
  extra.drawerExterior = module?.exterior || extra.drawerExterior || extra.drawerInterior || '';
  return extra;
}
function ensureKitchenDrawerExtra(extra) {
  if (!extra || !isKitchenDrawerExtra(extra)) return extra;
  const module = drawerTargetModule(extra);
  if (module) extra.targetModuleId = moduleStableId(module, state.modules.indexOf(module));
  return extra;
}
function prepareWardrobeDrawerExtras() {
  (state.modules || []).forEach(moduleStableId);
  (state.extras || []).forEach(function (extra) {
    ensureWardrobeDrawerExtra(extra);
    ensureKitchenDrawerExtra(extra);
  });
}
function materialThicknessCmFromText(materialName) {
  const text = String(materialName || '');
  const match = text.match(/\b(\d+(?:[,.]\d+)?)\s*mm\b/i);
  return match ? (Number(String(match[1]).replace(',', '.')) || 0) / 10 : 0;
}
function wardrobeDrawerMaterials(extra) {
  const mode = comparableText(extra?.drawerMaterialMode || 'Interior');
  const interior = extra?.drawerInterior || '';
  const exterior = extra?.drawerExterior || interior;
  const useExteriorAll = mode === 'EXTERIOR';
  const useExteriorFront = mode.includes('FRENTE') || useExteriorAll;
  return {
    base: useExteriorAll ? exterior : interior,
    front: useExteriorFront ? exterior : interior
  };
}
function wardrobeDrawerUsefulWidth(extra, materialName) {
  return Math.max(0, (Number(extra?.drawerWidth) || 0) - (materialThicknessCmFromText(materialName) * 2));
}
function cmValue(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  return String(Number.isInteger(rounded) ? rounded : rounded.toFixed(1)).replace('.', ',');
}
function wardrobeDrawerUsefulSummary(extra) {
  const materials = wardrobeDrawerMaterials(extra);
  const baseWidth = wardrobeDrawerUsefulWidth(extra, materials.base);
  const frontWidth = wardrobeDrawerUsefulWidth(extra, materials.front);
  const baseText = 'útil ' + cmValue(baseWidth) + 'cm';
  if (Math.abs(baseWidth - frontWidth) < 0.05) return baseText;
  return baseText + ' / frente ' + cmValue(frontWidth) + 'cm';
}
function wardrobeDrawerDescription(extra) {
  const distribution = Array.isArray(extra?.moduleDistribution) && extra.moduleDistribution.length;
  if (distribution) {
    return wardrobeDrawerItem + ' / Medidas por módulo / ' + (extra.drawerMaterialMode || 'Interior') + ' / Distribuído: ' +
      extra.moduleDistribution.map(function (item) { return num(item.quantity); }).filter(Boolean).join(' + ');
  }
  return wardrobeDrawerItem + ' / ' + (extra.drawerWidth || 0) + '(largura)x' + (extra.drawerDepth || 0) + '(P)x' + (extra.drawerHeight || 0) + '(A)' + ' / ' + (extra.drawerMaterialMode || 'Interior');
}
function hydrateExtra(extra) {
  const hydrated = clone(extra);
  hydrated.group = normalizeExtraGroupName(hydrated.group);
  hydrated.lacquered = isLacqueredExtra(hydrated);
  if (isWardrobeDrawerExtra(hydrated)) return ensureWardrobeDrawerExtra(hydrated);
  if (isOtherExtra(hydrated)) return hydrated;
  const items = extraItems(hydrated.group);
  if (!items.includes(hydrated.item)) {
    const legacyItem = state.catalog.extras.find(item => normalizeExtraGroupName(item.group) === hydrated.group && item.label === hydrated.item);
    hydrated.item = legacyItem ? legacyItem.item : (items[0] || '');
  }
  return hydrated;
}
function input(type, value, attrs) { return '<input type="' + type + '" value="' + attrEsc(value) + '" ' + (attrs || '') + '>'; }
function searchInput(value, listId, attrs) { return input('text', value, 'list="' + attrEsc(listId) + '" autocomplete="off" class="searchable-wood" ' + (attrs || '')); }

function promptText(label, fallback) {
  const value = window.prompt(label, fallback || '');
  return value === null ? null : String(value).trim();
}

function promptMoney(label, fallback) {
  const value = promptText(label, fallback === undefined ? '0' : String(fallback));
  return value === null ? null : num(value);
}

function enhanceWoodSearchFields() {
  const listIds = { interior: 'moduleInteriorOptions', exterior: 'moduleExteriorOptions' };
  modulesGrid.querySelectorAll('select[data-field="interior"], select[data-field="exterior"]').forEach(function (select) {
    const field = select.dataset.field;
    const wrap = document.createElement('span');
    const el = document.createElement('input');
    const button = document.createElement('button');
    el.type = 'text';
    el.value = select.value;
    el.setAttribute('list', listIds[field]);
    el.autocomplete = 'off';
    el.className = 'searchable-wood';
    el.placeholder = field === 'interior' ? 'Pesquisar interior...' : 'Pesquisar exterior...';
    el.disabled = select.disabled;
    el.dataset.module = select.dataset.module;
    el.dataset.field = field;
    button.type = 'button';
    button.className = 'wood-search-button';
    button.setAttribute('aria-label', 'Pesquisar madeira');
    button.title = 'Pesquisar madeira';
    button.textContent = '\u2315';
    button.disabled = select.disabled;
    button.addEventListener('click', function () {
      el.value = '';
      if (state.modules[Number(select.dataset.module)]?.[field]) {
        updateModule(Number(select.dataset.module), field, '');
      }
      el.focus();
    });
    el.addEventListener('change', function () {
      if (!el.value.trim() && state.modules[Number(select.dataset.module)]?.[field]) {
        updateModule(Number(select.dataset.module), field, '');
      }
    });
    el.addEventListener('focus', function () {
      el.select();
    });
    wrap.className = 'wood-search-wrap';
    wrap.appendChild(button);
    wrap.appendChild(el);
    select.replaceWith(wrap);
  });
}

function enhanceExtraItemSearchFields() {
  document.querySelectorAll('[data-extra-search-menu-root="1"]').forEach(function (menu) {
    menu.remove();
  });
  finalGrid.querySelectorAll('select[data-extra-item-select][data-field="item"]').forEach(function (select) {
    const extraIndex = Number(select.dataset.extra);
    const options = Array.from(select.options).map(function (option) { return option.value; }).filter(Boolean);
    const wrap = document.createElement('span');
    const el = document.createElement('input');
    const button = document.createElement('button');
    const menu = document.createElement('div');
    let activeOptions = options.slice();
    el.type = 'text';
    el.value = select.value;
    el.autocomplete = 'off';
    el.className = 'searchable-wood searchable-extra';
    el.placeholder = 'Pesquisar extra...';
    el.disabled = select.disabled;
    el.dataset.extraSearchInput = String(extraIndex);
    menu.className = 'extra-search-menu';
    menu.dataset.extraSearchMenuRoot = '1';
    menu.hidden = true;

    function positionMenu() {
      const rect = el.getBoundingClientRect();
      const gap = 6;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
      const width = Math.min(Math.max(rect.width, 360), Math.max(260, viewportWidth - 16));
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const spaceBelow = viewportHeight - rect.bottom - gap - 8;
      const spaceAbove = rect.top - gap - 8;
      const opensUp = spaceBelow < 170 && spaceAbove > spaceBelow;
      const availableHeight = opensUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(120, Math.min(280, availableHeight));
      const top = opensUp
        ? Math.max(8, rect.top - gap - maxHeight)
        : Math.min(rect.bottom + gap, viewportHeight - maxHeight - 8);
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.style.width = width + 'px';
      menu.style.maxWidth = Math.max(260, viewportWidth - left - 8) + 'px';
      menu.style.maxHeight = maxHeight + 'px';
    }

    function filteredOptions() {
      const query = comparableText(el.value);
      if (!query) return options.slice(0, 80);
      const words = query.split(' ').filter(Boolean);
      return options.filter(function (option) {
        const text = comparableText(option);
        return words.every(function (word) { return text.includes(word); });
      }).slice(0, 80);
    }

    function hideMenu() {
      menu.hidden = true;
    }

    function selectOption(value) {
      el.value = value;
      hideMenu();
      updateExtra(extraIndex, 'item', value);
    }

    function renderMenu() {
      activeOptions = filteredOptions();
      positionMenu();
      if (!activeOptions.length || el.disabled) {
        menu.innerHTML = '<div class="extra-search-empty">Sem resultados</div>';
        menu.hidden = false;
        return;
      }
      menu.innerHTML = activeOptions.map(function (option) {
        return '<button type="button" class="extra-search-option" data-extra-search-value="' + attrEsc(option) + '">' + esc(option) + '</button>';
      }).join('');
      menu.hidden = false;
    }

    button.type = 'button';
    button.className = 'wood-search-button';
    button.setAttribute('aria-label', 'Pesquisar extra');
    button.title = 'Pesquisar extra';
    button.textContent = '\u2315';
    button.disabled = select.disabled;
    button.addEventListener('click', function () {
      el.value = '';
      el.focus();
      renderMenu();
    });
    el.addEventListener('focus', function () {
      el.select();
      renderMenu();
    });
    el.addEventListener('input', function () {
      renderMenu();
    });
    el.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        hideMenu();
        return;
      }
      if (event.key === 'Enter' && !menu.hidden && activeOptions[0]) {
        event.preventDefault();
        selectOption(activeOptions[0]);
      }
    });
    menu.addEventListener('mousedown', function (event) {
      event.preventDefault();
    });
    menu.addEventListener('click', function (event) {
      const optionButton = event.target.closest('[data-extra-search-value]');
      if (!optionButton) return;
      selectOption(optionButton.dataset.extraSearchValue);
    });
    el.addEventListener('blur', function () {
      window.setTimeout(hideMenu, 120);
    });
    window.addEventListener('resize', function () {
      if (!menu.hidden) positionMenu();
    });
    window.addEventListener('scroll', function () {
      if (!menu.hidden) positionMenu();
    }, true);
    wrap.className = 'wood-search-wrap extra-search-wrap';
    wrap.appendChild(button);
    wrap.appendChild(el);
    select.replaceWith(wrap);
    document.body.appendChild(menu);
  });
}

function quoteSnapshotFromState() {
  return { client: state.client, modules: state.modules, extras: state.extras, pricingMode: state.pricingMode };
}

function writeQuoteSnapshot(snapshot) {
  if (!snapshot || !snapshot.client) return;
  localStorage.setItem(storageKey, JSON.stringify(snapshot));
}

function persistQuote() {
  if (!state.client) return;
  if (quotePersistTimer) {
    clearTimeout(quotePersistTimer);
    quotePersistTimer = null;
  }
  pendingQuoteSnapshot = null;
  writeQuoteSnapshot(quoteSnapshotFromState());
}

function persistQuoteSoon() {
  if (!state.client) return;
  pendingQuoteSnapshot = clone(quoteSnapshotFromState());
  if (quotePersistTimer) clearTimeout(quotePersistTimer);
  quotePersistTimer = setTimeout(function () {
    quotePersistTimer = null;
    writeQuoteSnapshot(pendingQuoteSnapshot);
    pendingQuoteSnapshot = null;
  }, 450);
}

function flushPendingQuotePersist() {
  if (!pendingQuoteSnapshot) return;
  if (quotePersistTimer) {
    clearTimeout(quotePersistTimer);
    quotePersistTimer = null;
  }
  writeQuoteSnapshot(pendingQuoteSnapshot);
  pendingQuoteSnapshot = null;
}

function persistCurrentQuoteOnly() {
  if (!state.client) return;
  localStorage.setItem(storageKey, JSON.stringify({ client: state.client, modules: state.modules, extras: state.extras, pricingMode: state.pricingMode }));
}

function quoteHistoryStore() {
  if (state.usesSupabase) return state.quoteHistory || [];
  try {
    return JSON.parse(localStorage.getItem(quoteHistoryKey) || '[]') || [];
  } catch (error) {
    return [];
  }
}

function quoteHistoryLabel(snapshot) {
  const client = String(snapshot?.client?.name || 'Sem cliente').trim() || 'Sem cliente';
  const date = String(snapshot?.client?.date || 'Sem data').trim() || 'Sem data';
  return client + ' - ' + date;
}

function quoteSnapshotId(snapshot) {
  return comparableText(quoteHistoryLabel(snapshot)) || String(Date.now());
}

function clearQuoteDraftStorage() {
  localStorage.removeItem(quoteDraftsKey);
  localStorage.removeItem(activeQuoteDraftKey);
}

function saveQuoteHistorySnapshot(snapshot) {
  if (!snapshot || !snapshot.client) return;
  const history = quoteHistoryStore();
  const id = quoteSnapshotId(snapshot);
  const entry = { id, label: quoteHistoryLabel(snapshot), updatedAt: new Date().toISOString(), snapshot: clone(snapshot) };
  const next = [entry].concat(history.filter(function (item) { return item.id !== id; })).slice(0, 80);
  localStorage.setItem(quoteHistoryKey, JSON.stringify(next));
  renderQuoteHistory();
}

function remoteHistoryEnabled() {
  return state.usesSupabase && state.isAuthenticated;
}

async function loadQuoteHistoryList(userId, label) {
  state.quoteHistoryOwnerId = userId || '';
  state.quoteHistoryOwnerLabel = label || '';
  if (userId && quoteActions) quoteActions.hidden = false;
  if (!remoteHistoryEnabled()) {
    state.quoteHistory = [];
    renderQuoteHistory();
    return;
  }
  const query = userId ? '?userId=' + encodeURIComponent(userId) : '';
  const response = await fetch('/api/quote-history' + query);
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o histórico.');
  state.quoteHistory = data.entries || [];
  renderQuoteHistory();
  if (label) sourceStatus.textContent = 'Histórico de ' + label;
}

async function saveQuoteHistoryRemote(snapshot) {
  const response = await fetch('/api/quote-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: quoteHistoryLabel(snapshot),
      snapshotKey: quoteSnapshotId(snapshot),
      userId: state.quoteHistoryOwnerId || undefined,
      snapshot
    })
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || 'Não foi possível guardar no histórico.');
  state.quoteHistory = data.entries || [];
  renderQuoteHistory();
}

function currentQuoteSnapshot() {
  return { client: clone(state.client), modules: clone(state.modules), extras: clone(state.extras), pricingMode: state.pricingMode };
}

async function saveCurrentQuoteToHistory() {
  if (!state.client) return;
  if (state.usesSupabase && !state.isAuthenticated) {
    sourceStatus.textContent = 'Faz login para guardar no histórico.';
    return;
  }
  persistCurrentQuoteOnly();
  const snapshot = currentQuoteSnapshot();
  if (remoteHistoryEnabled()) {
    await saveQuoteHistoryRemote(snapshot);
  } else {
    saveQuoteHistorySnapshot(snapshot);
  }
  sourceStatus.textContent = 'Guardado no histórico: ' + quoteHistoryLabel(snapshot);
}

function renderQuoteHistory() {
  if (!quoteHistoryList) return;
  const history = quoteHistoryStore();
  const title = state.quoteHistoryOwnerLabel ? '<div class="quote-list-owner">A ver: ' + esc(state.quoteHistoryOwnerLabel) + '</div>' : '';
  quoteHistoryList.innerHTML = history.length
    ? title + history.map(function (entry) {
        return '<div class="quote-list-row">' +
          '<button class="quote-list-open" type="button" data-open-history="' + attrEsc(entry.id) + '">' + esc(entry.label) + '</button>' +
          '<button class="quote-list-delete" type="button" data-delete-history="' + attrEsc(entry.id) + '" title="Apagar orçamento">X</button>' +
        '</div>';
      }).join('')
    : title + '<div class="quote-list-empty">' + (state.usesSupabase && !state.isAuthenticated ? 'Faz login para ver histórico' : 'Sem histórico') + '</div>';
}

async function deleteHistoryEntry(id) {
  if (!id) return;
  const history = quoteHistoryStore();
  const entry = history.find(function (item) { return item.id === id; });
  if (!entry) return;
  if (!window.confirm('Tem a certeza que pretende eliminar este orçamento do histórico?')) return;
  if (remoteHistoryEnabled()) {
    const query = state.quoteHistoryOwnerId ? '?userId=' + encodeURIComponent(state.quoteHistoryOwnerId) : '';
    const response = await fetch('/api/quote-history/' + encodeURIComponent(id) + query, { method: 'DELETE' });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Não foi possível apagar o histórico.');
    state.quoteHistory = data.entries || [];
    renderQuoteHistory();
    sourceStatus.textContent = 'Orçamento apagado do histórico';
    return;
  }
  localStorage.setItem(quoteHistoryKey, JSON.stringify(history.filter(function (item) { return item.id !== id; })));
  renderQuoteHistory();
  sourceStatus.textContent = 'Orçamento apagado do histórico';
}

async function applyQuoteSnapshot(entry, labelPrefix) {
  if (!entry || !entry.snapshot) return;
  const selectedLabel = entry.label || quoteHistoryLabel(entry.snapshot);
  persistCurrentQuoteOnly();
  state.client = clone(entry.snapshot.client);
  state.modules = (entry.snapshot.modules || []).map(hydrateModule);
  state.extras = (entry.snapshot.extras || []).map(hydrateExtra);
  state.pricingMode = entry.snapshot.pricingMode === 'reseller' ? 'reseller' : 'normal';
  persistCurrentQuoteOnly();
  renderClient();
  renderModules();
  renderFinal();
  quoteView.hidden = false;
  supplierView.hidden = true;
  if (usersView) usersView.hidden = true;
  if (visualView) visualView.hidden = true;
  quoteActions.hidden = false;
  pageTitle.textContent = state.pricingMode === 'reseller' ? 'Orçamento revendedor' : 'Orçamento';
  quoteTitle.textContent = cleanDisplayText(state.pricingMode === 'reseller' ? 'ORÃ‡AMENTO REVENDEDOR' : 'ORÃ‡AMENTO');
  await calculate();
  sourceStatus.textContent = labelPrefix + ': ' + selectedLabel;
}

async function loadQuoteHistory(id) {
  if (!id) return;
  const entry = quoteHistoryStore().find(function (item) { return item.id === id; });
  await applyQuoteSnapshot(entry, 'Histórico carregado');
}

function inferModuleType(m) {
  if (state.lists.tipos.includes(m.type)) return m.type;
  const family = String(m.family || '').toUpperCase();
  if (family.includes('SUPERIOR')) return 'Superior';
  if (family.includes('ROUPEIRO')) return 'Roupeiro';
  if (family.includes('COLUNA')) return 'Coluna';
  return 'Inferior';
}

function plateAllowsPaint(name) {
  const wantedKey = plateCodeThicknessKeyFromText(name);
  const wantedText = comparableText(name);
  if (wantedText.includes('FOLHA') || wantedText.includes('FOLHEADO')) return true;
  if (wantedText.includes('H3395') && wantedText.includes('CARVALHO')) return true;
  const plate = state.catalog.plates.find(function (item) {
    if (item.name === name || comparableText(item.name) === wantedText) return true;
    if (!wantedKey) return false;
    return plateCodeThicknessKey(item) === wantedKey;
  });
  return Boolean(plate && plate.paintable);
}

function sanitizeModuleExterior(module) {
  if (!module || module.blank || isPiecePlate(module)) return;
  module.description = buildDescription(module);
}

function isPiecePlate(module) {
  return comparableText(module?.type).includes('PLACA');
}

function moduleCalculationType(module) {
  return module?.type === 'Roupeiro' ? 'Coluna' : module?.type;
}

function ensureRoupeiroModuleType() {
  if (!state.lists) state.lists = {};
  if (!Array.isArray(state.lists.tipos)) state.lists.tipos = ['Inferior', 'Superior', 'Coluna', 'PeÃ§as/Placa'];
  if (!Array.isArray(state.lists.tipoLateralTopo)) state.lists.tipoLateralTopo = ['Não', 'Inteira', 'Sarrafo 15cm'];
  if (!state.lists.tipos.includes('Roupeiro')) {
    const pieceIndex = state.lists.tipos.indexOf('PeÃ§as/Placa');
    if (pieceIndex >= 0) state.lists.tipos.splice(pieceIndex, 0, 'Roupeiro');
    else state.lists.tipos.push('Roupeiro');
  }
  if (!state.typePresets) state.typePresets = {};
  if (!state.typePresets.Roupeiro && state.typePresets.Coluna) {
    state.typePresets.Roupeiro = { ...clone(state.typePresets.Coluna), type: 'Roupeiro' };
  }
}

function normalizePainting(value) {
  const aliases = {
    'Verniz Mate Polioretano': 'Verniz Mate Poliretano',
    'Verniz Polioretano Brilhante': 'Verniz Poliretano Alto Brilhante',
    'Verniz Natur "AcrÃ­lico"': 'Verniz Natur / Acrilico',
    'Esmalte Cores Claras c/ AfinaÃ§Ã£o': 'Esmalte Mate Cores Claras com AfinaÃ§Ã£o',
    'Esmalte Cores Escuras c/ AfinaÃ§Ã£o': 'Esmalte Mate Cores Escuras com AfinaÃ§Ã£o'
  };
  const normalized = aliases[value] || value;
  return state.lists.pinturas.includes(normalized) ? normalized : 'Nenhuma';
}

function legacySideTopToSide(value, side) {
  const text = cleanDisplayText(value || '').toUpperCase();
  if (text === 'SIM') return 'Inteira';
  if (text === 'NAO' || text === 'NÃO') return 'Não';
  if (side === 'left' && text.includes('ESQUERDA')) return 'Inteira';
  if (side === 'right' && text.includes('DIREITA')) return 'Inteira';
  return 'Não';
}

function applyLegacySideTopFields(module) {
  if (!module) return;
  if (!module.sideLeftEdge) module.sideLeftEdge = legacySideTopToSide(module.sideEdges, 'left');
  if (!module.sideRightEdge) module.sideRightEdge = legacySideTopToSide(module.sideEdges, 'right');
}

function sideTopDescription(module) {
  applyLegacySideTopFields(module);
  function short(value) {
    if (value === 'Inteira') return 'inteira';
    if (/sarrafo/i.test(value)) return 'sarrafo 15cm';
    return 'não';
  }
  const distribution = Array.isArray(module.sideDistribution)
    ? module.sideDistribution.filter(function (row) { return num(row.quantity) > 0; })
    : [];
  if (distribution.length) {
    const parts = distribution.map(function (row) {
      return num(row.quantity) + 'x Esq. ' + short(cleanDisplayText(row.sideLeftEdge || 'Não')) +
        ' / Dir. ' + short(cleanDisplayText(row.sideRightEdge || 'Não'));
    });
    return 'LATERAIS: ' + parts.join(' + ');
  }
  const left = cleanDisplayText(module.sideLeftEdge || 'Não');
  const right = cleanDisplayText(module.sideRightEdge || 'Não');
  if (left === 'Não' && right === 'Não') return '';
  return 'LATERAIS: Esq. ' + short(left) + ' / Dir. ' + short(right);
}

function hasSideDistribution(module) {
  return Array.isArray(module?.sideDistribution) &&
    module.sideDistribution.some(function (row) { return num(row.quantity) > 0; });
}

function moduleSideSelect(index, field, value, disabled) {
  if (disabled) {
    return '<select disabled title="Laterais divididas por módulo">' + optionList(['Dividido'], 'Dividido') + '</select>';
  }
  return '<select data-module="' + index + '" data-field="' + field + '">' +
    optionListWithBlank(state.lists.tipoLateralTopo || ['Não', 'Inteira', 'Sarrafo 15cm'], value) +
    '</select>';
}

function hydrateModule(m) {
  const module = clone(m);
  if (!module.id) module.id = 'module_' + Date.now() + '_' + Math.round(Math.random() * 100000);
  if (module.blank) return module;
  module.type = inferModuleType(module);
  ensureRoupeiroModuleType();
  const preset = state.typePresets[module.type] || state.typePresets[moduleCalculationType(module)] || {};
  module.drawers = 0;
  module.drawerExtraCount = 0;
  delete module.drawerExtraType;
  ['paintInterior', 'edgeType', 'topBottomEdges', 'sideEdges', 'sideLeftEdge', 'sideRightEdge', 'back', 'divider', 'drawerExtraCount', 'drawerExtraType'].forEach(function (field) {
    if (module[field] === undefined || module[field] === null || module[field] === '') module[field] = preset[field];
  });
  applyLegacySideTopFields(module);
  module.paintDoor = normalizePainting(module.paintDoor);
  module.paintInterior = normalizePainting(module.paintInterior);
  if (isPiecePlate(module)) {
    if (!plateAllowsPaint(module.interior)) module.paintDoor = 'Nenhuma';
    Object.assign(module, {
      family: 'PEÃ‡AS / PLACA',
      depth: 0,
      doors: 0,
      drawers: 0,
      shelves: 0,
      back: 1,
      divider: 0,
      exterior: 'NÃ£o aplicÃ¡vel',
      paintInterior: 'Nenhuma',
      doorSystem: 'Normal',
      hinge: 'Nenhuma',
      edgeType: 'ServiÃ§o Sem Orla',
      topBottomEdges: 'NÃ£o',
      sideEdges: 'NÃ£o',
      sideLeftEdge: 'NÃ£o',
      sideRightEdge: 'NÃ£o'
    });
  } else {
    if (!plateAllowsPaint(module.exterior)) module.paintDoor = 'Nenhuma';
    if (!plateAllowsPaint(module.interior)) module.paintInterior = 'Nenhuma';
    if (num(module.doors) <= 0) {
      module.doorSystem = 'Normal';
      module.hinge = 'Nenhuma';
    } else if (!module.hinge || module.hinge === 'Nenhuma') {
      module.hinge = preset.hinge || state.lists.dobradicas[0];
    }
  }
  if (!module.pricingBase) {
    module.pricingBase = { ...clone(module), unitClient: num(module.unitClient), unitCost: num(module.unitCost) };
  }
  return module;
}

function buildDescription(m) {
  if (m.blank) return '';
  const interior = cleanMaterialName(m.interior);
  const exterior = cleanMaterialName(m.exterior);
  const paintInterior = cleanDisplayText(m.paintInterior || 'Nenhuma');
  const paintExterior = cleanDisplayText(m.paintDoor || 'Nenhuma');
  const family = moduleDisplayFamily(m);
  if (isPiecePlate(m)) {
    return family + ' / ' + m.width + '(L)x' + m.height + '(A) / INT: ' + interior + ' / PINTURA: ' + paintExterior;
  }
  const parts = [
    family + ' / ' + m.width + '(L)x' + m.height + '(A)x' + m.depth + '(P) / ' + m.doors + ' Portas',
    (num(m.shelves) || 0) + ' Prateleiras',
    (num(m.divider) || 0) + ' Divisórias',
    'INT: ' + interior,
    'PINTURA INT: ' + paintInterior
  ];
  if (exterior) {
    parts.push('EXT: ' + exterior);
    parts.push('PINTURA EXT: ' + paintExterior);
  }
  const sides = sideTopDescription(m);
  if (sides) parts.push(sides);
  return parts.join(' / ');
}

function moduleDisplayFamily(module) {
  if (module?.type === 'Roupeiro') return 'ARMÁRIO - ROUPEIRO';
  const family = cleanDisplayText(module?.family || '');
  return family
    .replace(/^ARMÁRIO\s+COZINHA\s*-\s*/i, 'ARMÁRIO - ')
    .replace(/^ARMARIO\s+COZINHA\s*-\s*/i, 'ARMÁRIO - ')
    .replace(/\s+COZINHA\b/gi, '');
}

function moduleFinalGroup(module) {
  return 'GERAL';
}

function moduleFinalTitle(module) {
  return moduleDisplayFamily(module);
}

async function calculate(options) {
  applySupplierAdditions();
  canonicalizeQuoteExtras();
  prepareWardrobeDrawerExtras();
  const response = await fetch('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client: state.client,
      modules: state.modules,
      extras: state.extras,
      pricingMode: state.pricingMode,
      catalog: calculationCatalogOverrides()
    })
  });
  if (!response.ok) throw new Error('Não foi possível calcular o orçamento.');
  state.quote = await response.json();
  if (Array.isArray(state.quote.warnings) && state.quote.warnings.length) {
    sourceStatus.textContent = 'Atenção: ' + cleanDisplayText(state.quote.warnings[0]) + (state.quote.warnings.length > 1 ? ' +' + (state.quote.warnings.length - 1) : '');
  } else if (sourceStatus.textContent.startsWith('Atenção:')) {
    sourceStatus.textContent = '';
  }
  (state.quote.modules || []).forEach(function (line, index) {
    if (!state.modules[index]) return;
    state.modules[index].unitClient = line.unitClient;
    state.modules[index].unitCost = line.unitCost;
  });
  (state.quote.extras || []).forEach(function (line, index) {
    if (!state.extras[index]) return;
    state.extras[index].unitClient = line.unitClient;
    state.extras[index].unitCost = line.unitCost;
  });
  renderKpis();
  updateModuleTotals();
  if (!options || options.renderFinal !== false) renderFinal();
  renderPrint();
  persistQuote();
}

function calculationCatalogOverrides() {
  syncDoorSystemExtras();
  canonicalizeQuoteExtras();
  prepareWardrobeDrawerExtras();
  return calculationSupplierPayload();
}

function mergeCalculationPayload(target, source) {
  if (!source || typeof source !== 'object') return target;
  Object.keys(supplierDirtyChanges).concat(['doorSystems']).forEach(function (type) {
    if (!Array.isArray(source[type]) || !source[type].length) return;
    const current = Array.isArray(target[type]) ? target[type] : [];
    target[type] = dedupeSupplierItems(type, current.concat(source[type].map(clone)));
  });
  if (source.addMissingPlates || target.addMissingPlates) target.addMissingPlates = true;
  return target;
}

function calculationSupplierPayload() {
  let payload = {};
  mergeCalculationPayload(payload, supplierAdditionsStore());
  mergeCalculationPayload(payload, supplierDraftStore());
  mergeCalculationPayload(payload, supplierDirtyPayload());
  if (Array.isArray(payload.plates) && payload.plates.length) payload.addMissingPlates = true;
  return payload;
}

function updateModuleTotals() {
  (state.quote?.modules || []).forEach(function (line, index) {
    const clientCell = modulesGrid.querySelector('[data-module-client-total="' + index + '"]');
    const costCell = modulesGrid.querySelector('[data-module-cost-total="' + index + '"]');
    const clientInput = modulesGrid.querySelector('[data-module-client-unit="' + index + '"]');
    const costInput = modulesGrid.querySelector('[data-module-cost-unit="' + index + '"]');
    if (clientCell) clientCell.textContent = money(line.totalClient);
    if (costCell) costCell.textContent = money(line.totalCost);
    if (clientInput) clientInput.textContent = money(line.unitClient);
    if (costInput) costInput.textContent = money(line.unitCost);
  });
}

function updateClient(field, value) {
  state.client[field] = value;
  persistQuoteSoon();
}

function updateModule(index, field, value) {
  if (field === 'type') {
    const previous = state.modules[index];
    const preset = clone(state.typePresets[value]);
    state.modules[index] = hydrateModule({ ...preset, id: previous.id, quantity: previous.quantity, type: value });
    delete state.modules[index].blank;
    state.modules[index].pricingBase = clone(preset.pricingBase);
    state.modules[index].description = buildDescription(state.modules[index]);
    renderModules();
    calculate();
    return;
  }

  const numeric = ['quantity','width','height','depth','doors','drawers','shelves','back','divider','unitClient','unitCost'].includes(field);
  state.modules[index][field] = numeric ? num(value) : value;
  if (['quantity', 'sideLeftEdge', 'sideRightEdge'].includes(field)) {
    delete state.modules[index].sideDistribution;
  }
  if (field === 'exterior' && !plateAllowsPaint(value)) state.modules[index].paintDoor = 'Nenhuma';
  if (field === 'interior' && !plateAllowsPaint(value)) {
    state.modules[index].paintInterior = 'Nenhuma';
    if (isPiecePlate(state.modules[index])) state.modules[index].paintDoor = 'Nenhuma';
  }
  if (field === 'doors') {
    if (state.modules[index].doors <= 0) {
      state.modules[index].doorSystem = 'Normal';
      state.modules[index].hinge = 'Nenhuma';
    } else if (!state.modules[index].hinge || state.modules[index].hinge === 'Nenhuma') {
      state.modules[index].hinge = state.typePresets[state.modules[index].type]?.hinge || state.lists.dobradicas[0];
    }
  }
  state.modules[index].description = buildDescription(state.modules[index]);
  if (field === 'exterior' || field === 'interior' || field === 'doors') renderModules();
  calculate();
}

function updateExtra(index, field, value) {
  if (field === 'group') {
    value = normalizeExtraGroupName(value);
    const firstItem = state.catalog.extras.find(item => normalizeExtraGroupName(item.group) === value);
    state.extras[index].group = value;
    if (comparableText(value) === comparableText(wardrobeDrawerGroup)) {
      state.extras[index].item = wardrobeDrawerItem;
      ensureWardrobeDrawerExtra(state.extras[index]);
    } else {
      state.extras[index].item = comparableText(value) === comparableText(otherExtraGroup) ? '' : (firstItem ? firstItem.item : '');
      ensureKitchenDrawerExtra(state.extras[index]);
    }
    if (!isSkirtingExtra(state.extras[index])) state.extras[index].lacquered = false;
    if (!isManualPricedExtra(state.extras[index])) {
      state.extras[index].unitClient = 0;
      state.extras[index].unitCost = 0;
    }
    if (String(state.extras[index].item || '').trim() && num(state.extras[index].quantity) <= 0) {
      state.extras[index].quantity = 1;
    }
  } else {
    const numeric = ['quantity','unitClient','unitCost','drawerWidth','drawerDepth','drawerHeight'].includes(field);
    state.extras[index][field] = field === 'lacquered' ? value === 'Sim' : (numeric ? num(value) : value);
    if (field === 'item' && String(value || '').trim() && num(state.extras[index].quantity) <= 0) {
      state.extras[index].quantity = 1;
    }
    if (field === 'quantity' && (isWardrobeDrawerExtra(state.extras[index]) || isKitchenDrawerExtra(state.extras[index]))) {
      syncDrawerDistributionQuantity(state.extras[index], index);
    }
    if (field === 'targetModuleId') {
      const module = drawerTargetModule(state.extras[index]);
      if (module && isWardrobeDrawerExtra(state.extras[index])) {
        state.extras[index].drawerWidth = module.width || state.extras[index].drawerWidth;
        state.extras[index].drawerDepth = module.depth || state.extras[index].drawerDepth;
        state.extras[index].drawerInterior = module.interior || state.extras[index].drawerInterior;
        state.extras[index].drawerExterior = module.exterior || state.extras[index].drawerExterior;
      }
    }
    ensureWardrobeDrawerExtra(state.extras[index]);
    ensureKitchenDrawerExtra(state.extras[index]);
  }
  calculate();
}

function closeDrawerSplitModal() {
  drawerSplitState = null;
  renderDrawerSplitModal();
}

function renderDrawerSplitModal() {
  let modal = document.querySelector('#drawerSplitModal');
  if (!drawerSplitState) {
    if (modal) modal.remove();
    return;
  }
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'drawerSplitModal';
    modal.className = 'drawer-split-backdrop';
    document.body.appendChild(modal);
  }
  const total = drawerSplitState.quantities.reduce(function (sum, value) { return sum + num(value); }, 0);
  const rows = drawerSplitState.modules.map(function (module, moduleIndex) {
    const measures = drawerSplitState.measures[moduleIndex] || {};
    return '<div class="drawer-split-row">' +
      '<span>' + esc(moduleOptionLabel(module, state.modules.indexOf(module))) + '</span>' +
      '<label><small>Qtd</small><input type="number" min="0" step="1" value="' + esc(drawerSplitState.quantities[moduleIndex]) + '" data-drawer-split-qty="' + moduleIndex + '"></label>' +
      '<label><small>Larg.</small><input type="number" min="0" step="1" value="' + esc(measures.width || 0) + '" data-drawer-split-measure="' + moduleIndex + '" data-field="width"></label>' +
      '<label><small>Prof.</small><input type="number" min="0" step="1" value="' + esc(measures.depth || 0) + '" data-drawer-split-measure="' + moduleIndex + '" data-field="depth"></label>' +
      '<label><small>Alt.</small><input type="number" min="0" step="1" value="' + esc(measures.height || 0) + '" data-drawer-split-measure="' + moduleIndex + '" data-field="height"></label>' +
    '</div>';
  }).join('');
  modal.innerHTML = '<div class="drawer-split-modal" role="dialog" aria-modal="true" aria-labelledby="drawerSplitTitle">' +
    '<div class="drawer-split-head"><div><span>DISTRIBUIR GAVETAS</span><h3 id="drawerSplitTitle">Escolhe quantas gavetas ficam em cada módulo</h3></div><button type="button" data-drawer-split-close>&times;</button></div>' +
    '<p class="drawer-split-help">Preenche só os módulos que levam esta gaveta. A linha mantém a quantidade total, mas a visualização usa esta distribuição.</p>' +
    '<div class="drawer-split-list">' + rows + '</div>' +
    '<div class="drawer-split-total">Total distribuído: <strong>' + total + '</strong> / ' + num(drawerSplitState.originalQuantity) + '</div>' +
    '<div class="drawer-split-actions"><button type="button" data-drawer-split-close>Cancelar</button><button type="button" data-drawer-split-apply>Aplicar distribuição</button></div>' +
  '</div>';
}

function updateDrawerSplitTotal() {
  if (!drawerSplitState) return;
  const total = drawerSplitState.quantities.reduce(function (sum, value) { return sum + num(value); }, 0);
  const totalEl = document.querySelector('.drawer-split-total');
  if (totalEl) {
    totalEl.innerHTML = 'Total distribuído: <strong>' + total + '</strong> / ' + num(drawerSplitState.originalQuantity);
    totalEl.classList.toggle('drawer-split-total-error', Math.abs(total - num(drawerSplitState.originalQuantity)) > 0.001);
  }
}

function applyDrawerSplitModal() {
  if (!drawerSplitState) return;
  const distribution = [];
  drawerSplitState.modules.forEach(function (module, moduleIndex) {
    const quantity = num(drawerSplitState.quantities[moduleIndex]);
    if (quantity <= 0) return;
    const measures = drawerSplitState.measures[moduleIndex] || {};
    distribution.push({
      moduleId: moduleStableId(module, state.modules.indexOf(module)),
      quantity,
      drawerWidth: num(measures.width) || module.width || 0,
      drawerDepth: num(measures.depth) || module.depth || 0,
      drawerHeight: num(measures.height) || drawerSplitState.extra.drawerHeight || 16
    });
  });
  if (!distribution.length) {
    sourceStatus.textContent = 'Distribuição inválida. Coloca pelo menos uma gaveta num módulo.';
    return;
  }
  const originalQuantity = num(drawerSplitState.originalQuantity);
  const distributedQuantity = distribution.reduce(function (sum, item) { return sum + num(item.quantity); }, 0);
  if (Math.abs(originalQuantity - distributedQuantity) > 0.001) {
    sourceStatus.textContent = 'Corrige a distribuição: o total tem de continuar ' + originalQuantity + ', mas está ' + distributedQuantity + '.';
    const totalEl = document.querySelector('.drawer-split-total');
    if (totalEl) totalEl.classList.add('drawer-split-total-error');
    return;
  }
  const extra = state.extras[drawerSplitState.index];
  if (!extra) return;
  extra.quantity = originalQuantity;
  extra.moduleDistribution = distribution;
  const firstTarget = distribution[0]?.moduleId || extra.targetModuleId;
  if (firstTarget) extra.targetModuleId = firstTarget;
  drawerQuantityMemory.set(extra.id || String(drawerSplitState.index), originalQuantity);
  closeDrawerSplitModal();
  sourceStatus.textContent = 'Gavetas distribuídas por módulo.';
  renderVisualPreview();
  renderPrint();
  persistQuote();
  calculate();
}

function splitDrawerExtraByModule(index, trigger) {
  const extra = state.extras[index];
  if (!extra || (!isKitchenDrawerExtra(extra) && !isWardrobeDrawerExtra(extra))) {
    sourceStatus.textContent = 'Esta linha não é uma gaveta compatível para distribuir por módulo.';
    return;
  }
  const quantityInput = trigger?.closest('tr')?.querySelector('input[data-extra="' + index + '"][data-field="quantity"]');
  const memoryKey = extra.id || String(index);
  const rememberedQuantity = drawerQuantityMemory.has(memoryKey) ? num(drawerQuantityMemory.get(memoryKey)) : 0;
  const inputQuantity = quantityInput ? num(quantityInput.value) : 0;
  const currentQuantity = Math.max(inputQuantity, rememberedQuantity, num(extra.quantity));
  if (currentQuantity !== num(extra.quantity)) extra.quantity = currentQuantity;
  const modules = drawerCompatibleModules(extra);
  if (!modules.length) {
    sourceStatus.textContent = 'Não existem módulos compatíveis para distribuir gavetas.';
    return;
  }
  const targetId = extra.targetModuleId || '';
  const savedDistribution = Array.isArray(extra.moduleDistribution) ? extra.moduleDistribution : [];
  drawerSplitState = {
    index,
    extra: clone(extra),
    modules,
    originalQuantity: currentQuantity,
    quantities: modules.map(function (module, moduleIndex) {
      const moduleId = moduleStableId(module, state.modules.indexOf(module));
      const saved = savedDistribution.find(function (item) { return item.moduleId === moduleId; });
      if (saved) return num(saved.quantity);
      return (!targetId && moduleIndex === 0) || moduleId === targetId ? currentQuantity : 0;
    }),
    measures: modules.map(function (module) {
      const moduleId = moduleStableId(module, state.modules.indexOf(module));
      const saved = savedDistribution.find(function (item) { return item.moduleId === moduleId; }) || {};
      return {
        width: num(saved.drawerWidth) || module.width || extra.drawerWidth || 0,
        depth: num(saved.drawerDepth) || module.depth || extra.drawerDepth || 0,
        height: num(saved.drawerHeight) || extra.drawerHeight || 16
      };
    })
  };
  renderDrawerSplitModal();
}

function renderClient() {
  clientBlock.innerHTML = '<div class="client-grid">' +
    '<div class="label">CLIENTE</div><div class="input-cell"><input value="' + esc(state.client.name) + '" data-client="name"></div>' +
    '<div class="label">LOCAL</div><div class="input-cell"><input value="' + esc(state.client.location) + '" data-client="location"></div>' +
    '<div class="label">DATA</div><div class="input-cell"><input type="date" value="' + esc(state.client.date) + '" data-client="date"></div>' +
  '</div>';
  clientBlock.querySelectorAll('[data-client]').forEach(function (el) {
    el.addEventListener('input', function (event) { updateClient(event.target.dataset.client, event.target.value); });
  });
}

function renderKpis() {
  const t = state.quote?.totals || { moduleTotal: 0, extrasTotal: 0, costTotal: 0, finalTotal: 0, margin: 0 };
  const sellLabel = state.pricingMode === 'reseller' ? 'REVENDEDOR' : 'CLIENTE';
  const cards = [
    ['ORÃ‡AMENTO ' + sellLabel, t.moduleTotal],
    ['EXTRAS', t.extrasTotal],
    ['ORÃ‡AMENTO ' + sellLabel + ' + EXTRAS', t.finalTotal]
  ];
  if (canManagePrices()) {
    cards.push(['CUSTO', t.costTotal], ['MARGEM', t.margin]);
  }
  kpiBlock.innerHTML = cards.map(function (pair) { return '<div class="kpi' + (pair[0] === 'CUSTO' || pair[0] === 'MARGEM' ? ' admin-only' : '') + '"><span>' + esc(pair[0]) + '</span><strong>' + money(pair[1]) + '</strong></div>'; }).join('');
}

function previewMaterialTone(value, fallback) {
  const text = comparableText(value);
  if (!text || text === 'NENHUMA' || text.includes('NAO APLICAVEL')) return fallback || '#d8d2c8';
  if (text.includes('U999') || text.includes('N005') || text.includes('PRETO') || text.includes('NEGRO')) return '#343533';
  if (text.includes('W1000') || text.includes('W1200') || text.includes('B030') || text.includes('B117') || text.includes('B3768') || text.includes('BRANCO') || text.includes('WHITE')) return '#f1eee6';
  if (text.includes('L167') || text.includes('CINZA ESCURO')) return '#6e7372';
  if (text.includes('L166') || text.includes('G003') || text.includes('CINZA CLARO')) return '#c8ccca';
  if (text.includes('F067') || text.includes('P114') || text.includes('0026') || text.includes('CINZA ALUMINIO') || text.includes('CINZA ALUMINIO')) return '#aeb4b3';
  if (text.includes('U705') || text.includes('ANGORA') || text.includes('U750') || text.includes('RATO') || text.includes('U707') || text.includes('SEDA') || text.includes('1084') || text.includes('CINZA')) return '#9fa5a4';
  if (text.includes('B116') || text.includes('U156') || text.includes('BEGE') || text.includes('NATUR')) return '#d8c8b6';
  if (text.includes('U608') || text.includes('VERDE')) return '#9fb8a5';
  if (text.includes('F755') || text.includes('AGADIR') || text.includes('LINHO')) return '#c7bda8';
  if (text.includes('F6012') || text.includes('M100') || text.includes('CASTANHO')) return '#7f6048';
  if (text.includes('H1714') || text.includes('H1715') || text.includes('NOGUEIRA')) return '#8a6747';
  if (text.includes('H1384') || text.includes('H1386') || text.includes('H3368') || text.includes('H1316') || text.includes('H3146') || text.includes('H1357') || text.includes('CARVALHO')) return '#b78b61';
  if (text.includes('M2112') || text.includes('MADEIRA') || text.includes('SUCUPIRA')) return '#ad7b55';
  if (text.includes('METAL')) return '#9da3a7';
  return fallback || '#d8d2c8';
}

function previewPaintTone(value, fallback) {
  const text = comparableText(value);
  if (!text || text === 'NENHUMA') return fallback;
  if (text.includes('BRANCO')) return '#f3f0e8';
  if (text.includes('PRETO') || text.includes('ESCURO')) return '#3c3b38';
  if (text.includes('CLARA')) return '#d9d2c6';
  if (text.includes('NATUR') || text.includes('ACRILICO')) return '#d6c5ae';
  if (text.includes('VERNIZ')) return fallback || '#c19a6f';
  return fallback || '#d8d2c8';
}

function drawerPreviewCountForModule(module, type) {
  return Math.min(5, drawerPreviewItemsForModule(module, type).length);
}

function drawerQuantityForModule(extra, moduleId) {
  if (Array.isArray(extra?.moduleDistribution) && extra.moduleDistribution.length) {
    const distribution = extra.moduleDistribution.find(function (item) { return item.moduleId === moduleId; });
    return distribution ? num(distribution.quantity) : 0;
  }
  return extra?.targetModuleId === moduleId ? num(extra.quantity) : 0;
}

function drawerMeasuresForModule(extra, module, moduleId) {
  const distribution = Array.isArray(extra?.moduleDistribution)
    ? extra.moduleDistribution.find(function (item) { return item.moduleId === moduleId; })
    : null;
  return {
    width: num(distribution?.drawerWidth) || num(extra?.drawerWidth) || num(module?.width) || 0,
    depth: num(distribution?.drawerDepth) || num(extra?.drawerDepth) || num(module?.depth) || 0,
    height: num(distribution?.drawerHeight) || num(extra?.drawerHeight) || 0
  };
}

function drawerPreviewItemsForModule(module, type) {
  const id = moduleStableId(module, state.modules.indexOf(module));
  const matches = (state.extras || []).filter(function (extra) {
    if (type === 'wardrobe') return isWardrobeDrawerExtra(extra);
    return isKitchenDrawerExtra(extra);
  }).filter(function (extra) {
    return drawerQuantityForModule(extra, id) > 0;
  });
  const moduleWidth = Math.max(1, Number(module?.width) || 1);
  const moduleHeight = Math.max(1, Number(module?.height) || 1);
  const rawItems = [];
  let kitchenSlot = 0;
  function drawerFamilyKey(extra, text) {
    return comparableText(text)
      .replace(/\bGAVETAO?\b/g, ' ')
      .replace(/\bEXTERIOR\b/g, ' ')
      .replace(/\bINTERIOR\b/g, ' ')
      .replace(/\bFRENTE\b/g, ' ')
      .replace(/\bCOM\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || comparableText(extra.item || extra.group || '');
  }
  matches.forEach(function (extra) {
    const quantity = Math.max(0, Math.round(drawerQuantityForModule(extra, id)));
    const measures = drawerMeasuresForModule(extra, module, id);
    const drawerWidth = Math.max(0, Number(measures.width) || moduleWidth);
    const drawerHeight = Math.max(0, Number(measures.height) || 0);
    const widthPercent = Math.min(92, Math.max(12, (drawerWidth / moduleWidth) * 92));
    const heightPercent = type === 'wardrobe'
      ? (drawerHeight > 0 ? Math.min(92, Math.max(6, (drawerHeight / moduleHeight) * 92)) : 0)
      : (comparableText(extra.item).includes('GAVETAO') ? 17 : 11);
    const perRow = Math.max(1, Math.floor(92 / Math.max(widthPercent, 1)));
    const text = comparableText([extra.item, extra.drawerMaterialMode].join(' '));
    const exterior = text.includes('EXTERIOR') || text.includes('FRENTE');
    const interior = text.includes('INTERIOR') && !exterior;
    const family = drawerFamilyKey(extra, text);
    for (let count = 0; count < quantity; count += 1) {
      const slot = type === 'wardrobe' ? count : kitchenSlot;
      const column = slot % perRow;
      const row = Math.floor(slot / perRow);
      const leftPercent = widthPercent >= 91 ? 4 : 4 + (column * widthPercent);
      const bottomPercent = type === 'wardrobe'
        ? (heightPercent > 0 ? 4 + (row * heightPercent) : 0)
        : 4 + (row * (heightPercent + 2));
      rawItems.push({ widthPercent, heightPercent, leftPercent, bottomPercent, row, exterior, interior, family, type, paired: false });
      if (type !== 'wardrobe') kitchenSlot += 1;
    }
  });
  if (type !== 'wardrobe') return rawItems;
  const items = [];
  rawItems.forEach(function (item) {
    if (!item.interior || item.paired) {
      items.push(item);
      return;
    }
    const exterior = rawItems.find(function (candidate) {
      return !candidate.paired && candidate.exterior && candidate.family === item.family &&
        Math.abs(candidate.widthPercent - item.widthPercent) < 2 &&
        Math.abs(candidate.leftPercent - item.leftPercent) < 2;
    });
    if (!exterior) {
      items.push(item);
      return;
    }
    exterior.paired = true;
    item.paired = true;
    items.push(exterior);
    items.push({
      ...item,
      leftPercent: exterior.leftPercent + (exterior.widthPercent * 0.03),
      widthPercent: exterior.widthPercent * 0.94,
      heightPercent: exterior.heightPercent ? exterior.heightPercent * 0.82 : 0,
      bottomPercent: exterior.bottomPercent !== undefined ? exterior.bottomPercent + (exterior.heightPercent ? exterior.heightPercent * 0.12 : 0) : undefined,
      row: exterior.row,
      nested: true
    });
  });
  rawItems.forEach(function (item) {
    if (!item.paired && !items.includes(item)) items.push(item);
  });
  return items;
}

function modulePreviewTitle(module) {
  if (module.type === 'Roupeiro') return 'Roupeiro';
  if (module.type === 'Superior') return 'Superior';
  if (module.type === 'Inferior') return 'Inferior';
  if (module.type === 'Coluna') return 'Coluna';
  if (isPiecePlate(module)) return 'Peça / placa';
  return module.type || 'Módulo';
}

function previewFrameForType(type, width, height) {
  const text = comparableText(type);
  const maxWidth = 206;
  const maxHeight = 202;
  const minWidth = 76;
  const minHeight = 76;
  const scale = Math.min(maxWidth / Math.max(width, 1), maxHeight / Math.max(height, 1));
  const visualWidth = Math.max(minWidth, Math.round(width * scale));
  const visualHeight = Math.max(minHeight, Math.round(height * scale));
  const ratio = width / Math.max(height, 1);
  const className = [
    text === 'SUPERIOR' ? 'preview-superior' : '',
    text === 'INFERIOR' ? 'preview-inferior' : '',
    (text === 'COLUNA' || text === 'ROUPEIRO') ? 'preview-tall' : '',
    (text.includes('PECA') || text.includes('PLACA')) ? 'preview-plate' : '',
    ratio > 1.35 ? 'preview-wide' : '',
    ratio < 0.8 ? 'preview-narrow' : ''
  ].filter(Boolean).join(' ') || 'preview-square';
  return { width: visualWidth, height: visualHeight, className };
}

function renderModulePreviewDisplay(module, index) {
  if (!module || module.blank || !String(module.type || '').trim()) return '';
  const width = Math.max(40, Number(module.width) || 60);
  const height = Math.max(40, Number(module.height) || 70);
  const frame = previewFrameForType(module.type, width, height);
  const visualWidth = frame.width;
  const visualHeight = frame.height;
  const shelves = Math.max(0, Math.min(7, Math.round(Number(module.shelves) || 0)));
  const dividers = Math.max(0, Math.min(5, Math.round(Number(module.divider) || 0)));
  const doors = Math.max(0, Math.min(4, Math.round(Number(module.doors) || 0)));
  const interiorColor = previewPaintTone(module.paintInterior, previewMaterialTone(module.interior, '#d8d2c8'));
  const exteriorColor = previewPaintTone(module.paintDoor, previewMaterialTone(module.exterior, '#e5dfd5'));
  const drawerItems = drawerPreviewItemsForModule(module, 'kitchen')
    .concat(drawerPreviewItemsForModule(module, 'wardrobe'));
  const drawerCount = drawerItems.length;
  const shelfHtml = Array.from({ length: shelves }).map(function (_, shelfIndex) {
    const top = ((shelfIndex + 1) / (shelves + 1)) * 100;
    return '<span class="preview-shelf" style="top:' + top + '%"></span>';
  }).join('');
  const dividerPositions = [];
  function addDividerPosition(position) {
    if (!Number.isFinite(position)) return;
    if (position <= 4 || position >= 96) return;
    if (dividerPositions.some(function (existing) { return Math.abs(existing - position) < 1.8; })) return;
    dividerPositions.push(position);
  }
  if (doors > 1) {
    for (let doorIndex = 1; doorIndex < doors; doorIndex += 1) {
      addDividerPosition((doorIndex / doors) * 100);
    }
  }
  for (let dividerIndex = 1; dividerPositions.length < dividers && dividerIndex <= dividers + doors + 2; dividerIndex += 1) {
    addDividerPosition((dividerIndex / (dividers + 1)) * 100);
  }
  const dividerHtml = dividerPositions.slice(0, dividers).sort(function (a, b) { return a - b; }).map(function (left) {
    return '<span class="preview-divider" style="left:' + left + '%"></span>';
  }).join('');
  const drawerHtml = drawerItems.slice(0, 16).map(function (drawer, drawerIndex) {
    const row = Number.isFinite(drawer.row) ? drawer.row : drawerIndex;
    const bottom = drawer.bottomPercent !== undefined ? drawer.bottomPercent : 6 + row * 13 + (drawer.nested ? 2.4 : 0);
    const heightStyle = drawer.heightPercent ? ';height:' + drawer.heightPercent + '%' : '';
    return '<span class="preview-drawer' + (drawer.exterior ? ' preview-drawer-exterior' : '') + (drawer.nested ? ' preview-drawer-nested' : '') + '" style="bottom:' + bottom + '%;left:' + drawer.leftPercent + '%;right:auto;width:' + drawer.widthPercent + '%' + heightStyle + '"></span>';
  }).join('');
  const doorHtml = doors > 0
    ? '<div class="preview-doors" style="--door-count:' + doors + '">' + Array.from({ length: doors }).map(function (_, doorIndex) { return '<span style="background:' + attrEsc(exteriorColor) + ';--door-index:' + doorIndex + '"></span>'; }).join('') + '</div>'
    : '';
  return '<div class="visual-preview-display">' +
    '<div class="visual-preview-name">' + esc(modulePreviewTitle(module)) + '<span>' + esc(width + 'x' + height + 'x' + (module.depth || 0)) + '</span></div>' +
    '<div class="visual-cabinet-wrap">' +
      '<div class="visual-cabinet ' + attrEsc(frame.className) + '" style="width:' + visualWidth + 'px;height:' + visualHeight + 'px;background:' + attrEsc(interiorColor) + '">' +
        '<span class="preview-back"></span>' +
        shelfHtml + dividerHtml + doorHtml + drawerHtml +
      '</div>' +
    '</div>' +
    '<div class="visual-preview-meta">' +
      '<span>Prat. ' + esc(shelves) + '</span><span>Div. ' + esc(dividers) + '</span><span>Portas ' + esc(doors) + '</span>' +
      (drawerCount ? '<span>Gav. ' + esc(drawerCount) + '</span>' : '') +
    '</div>' +
  '</div>';
}

function renderModulePreview(module, index) {
  if (!module || module.blank || !String(module.type || '').trim()) return '';
  return '<article class="visual-preview-card" data-preview-card="' + index + '">' +
    renderModulePreviewDisplay(module, index) +
    '<div class="visual-preview-controls">' +
      '<label><span>Tipo</span><select data-preview-module="' + index + '" data-field="type">' + optionListWithBlank(state.lists.tipos, module.type) + '</select></label>' +
      '<label><span>Qtd</span>' + input('number', module.quantity, 'min="0" step="1" data-preview-module="' + index + '" data-field="quantity"') + '</label>' +
      '<label><span>Larg.</span>' + input('number', module.width, 'min="0" step="1" data-preview-module="' + index + '" data-field="width"') + '</label>' +
      '<label><span>Alt.</span>' + input('number', module.height, 'min="0" step="1" data-preview-module="' + index + '" data-field="height"') + '</label>' +
      '<label><span>Prof.</span>' + input('number', module.depth, 'min="0" step="1" data-preview-module="' + index + '" data-field="depth"') + '</label>' +
      '<label><span>Portas</span>' + input('number', module.doors, 'min="0" step="1" data-preview-module="' + index + '" data-field="doors"') + '</label>' +
      '<label><span>Prat.</span>' + input('number', module.shelves, 'min="0" step="1" data-preview-module="' + index + '" data-field="shelves"') + '</label>' +
      '<label><span>Div.</span>' + input('number', module.divider, 'min="0" step="1" data-preview-module="' + index + '" data-field="divider"') + '</label>' +
    '</div>' +
  '</article>';
}

function refreshPreviewCard(index) {
  if (!visualPreviewGrid || !state.modules[index]) return;
  const card = visualPreviewGrid.querySelector('[data-preview-card="' + index + '"]');
  const display = card?.querySelector('.visual-preview-display');
  if (display) display.outerHTML = renderModulePreviewDisplay(state.modules[index], index);
}

function renderVisualPreview() {
  if (!visualPreviewGrid) return;
  prepareWardrobeDrawerExtras();
  const modules = (state.modules || []).filter(function (module) { return module && !module.blank && String(module.type || '').trim(); });
  visualPreviewGrid.innerHTML = modules.length
    ? modules.map(renderModulePreview).join('')
    : '<div class="visual-preview-empty">Adiciona um módulo para ver a pré-visualização.</div>';
  visualPreviewGrid.querySelectorAll('[data-preview-module]').forEach(function (el) {
    el.addEventListener('change', function (event) {
      const index = Number(event.target.dataset.previewModule);
      const field = event.target.dataset.field;
      updateModule(index, field, event.target.value);
    });
  });
  visualPreviewGrid.querySelectorAll('input[type="number"][data-preview-module]').forEach(function (el) {
    el.addEventListener('input', function (event) {
      const index = Number(event.target.dataset.previewModule);
      const field = event.target.dataset.field;
      state.modules[index][field] = num(event.target.value);
      state.modules[index].description = buildDescription(state.modules[index]);
      refreshPreviewCard(index);
      persistQuoteSoon();
    });
  });
}

function renderPrintVisuals() {
  const modules = (state.modules || []).filter(function (module) { return module && !module.blank && String(module.type || '').trim(); });
  if (!modules.length) return '';
  const pages = [];
  for (let start = 0; start < modules.length; start += 9) {
    pages.push(modules.slice(start, start + 9).map(function (module) {
      const index = state.modules.indexOf(module);
      return '<article class="print-visual-card">' +
        renderModulePreviewDisplay(module, index) +
      '</article>';
    }).join(''));
  }
  return pages.map(function (cardsHtml, pageIndex) {
    return '<section class="print-visual-page">' +
      '<h2>VISUALIZAÇÃO DOS MÓDULOS' + (pages.length > 1 ? ' - ' + (pageIndex + 1) : '') + '</h2>' +
      '<div class="print-visual-grid">' + cardsHtml + '</div>' +
    '</section>';
  }).join('');
}

function renderModules() {
  const sellLabel = state.pricingMode === 'reseller' ? 'REVENDEDOR' : 'CLIENTE';
  const headings = ['AÃ‡ÃƒO','TIPO','QTD','LARG.','ALT.','PROF.','PORTAS','PRAT.','INTERIOR','EXTERIOR','PINTURA','SISTEMA','DOBRADIÃ‡A','P. UNIT ' + sellLabel,'TOTAL ' + sellLabel,'CUSTO UNIT.','TOTAL CUSTO'];
  modulesGrid.innerHTML = datalistOptions('moduleInteriorOptions', state.lists.interiores) + datalistOptions('moduleExteriorOptions', state.lists.exteriores) + '<table class="excel-table modules-table"><colgroup>' + '<col>'.repeat(17) + '</colgroup><thead><tr>' + headings.map(function (h, index) { return '<th' + (index >= 15 ? ' class="cost-cell"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + state.modules.map(function (m, i) {
    const piecePlate = isPiecePlate(m);
    const paintDoorDisabled = piecePlate ? !plateAllowsPaint(m.interior) : !plateAllowsPaint(m.exterior);
    const splitButton = num(m.quantity) > 1 ? '<div class="module-split-actions"><button class="soft-inline-button module-split-button" data-split-module="' + i + '" type="button">Dividir por modulo</button></div>' : '';
    const sideIsSplit = hasSideDistribution(m);
    return '<tr class="module-main-row">' +
      '<td class="text-center"><button class="remove-button" data-remove-module="' + i + '" type="button" title="Remover linha">&times;</button></td>' +
      '<td class="input-cell"><select data-module="' + i + '" data-field="type">' + optionListWithBlank(state.lists.tipos, m.type) + '</select></td>' +
      '<td class="input-cell">' + input('number', m.quantity, 'min="0" step="1" data-module="' + i + '" data-field="quantity"') + '</td>' +
      '<td class="input-cell">' + input('number', m.width, 'min="0" step="1" data-module="' + i + '" data-field="width"') + '</td>' +
      '<td class="input-cell">' + input('number', m.height, 'min="0" step="1" data-module="' + i + '" data-field="height"') + '</td>' +
      '<td class="input-cell">' + input('number', m.depth, 'min="0" step="1" data-module="' + i + '" data-field="depth"' + (piecePlate ? ' disabled' : '')) + '</td>' +
      '<td class="input-cell">' + input('number', m.doors, 'min="0" step="1" data-module="' + i + '" data-field="doors"' + (piecePlate ? ' disabled' : '')) + '</td>' +
      '<td class="input-cell">' + input('number', m.shelves, 'min="0" step="1" data-module="' + i + '" data-field="shelves"' + (piecePlate ? ' disabled' : '')) + '</td>' +
      '<td class="input-cell"><select data-module="' + i + '" data-field="interior">' + optionListWithBlank(state.lists.interiores, m.interior) + '</select></td>' +
      '<td class="input-cell"><select data-module="' + i + '" data-field="exterior"' + (piecePlate ? ' disabled' : '') + '>' + optionListWithBlank(piecePlate ? ['NÃ£o aplicÃ¡vel'] : state.lists.exteriores, m.exterior) + '</select></td>' +
      '<td class="input-cell"><select data-module="' + i + '" data-field="paintDoor"' + (paintDoorDisabled ? ' disabled' : '') + '>' + optionListWithBlank(state.lists.pinturas, m.paintDoor) + '</select></td>' +
      '<td class="input-cell"><select data-module="' + i + '" data-field="doorSystem"' + (piecePlate || num(m.doors) <= 0 ? ' disabled' : '') + '>' + optionListWithBlank(piecePlate || num(m.doors) <= 0 ? ['Normal'] : state.lists.sistemasPorta, m.doorSystem) + '</select></td>' +
      '<td class="input-cell"><select data-module="' + i + '" data-field="hinge"' + (piecePlate || num(m.doors) <= 0 ? ' disabled' : '') + '>' + optionListWithBlank(piecePlate || num(m.doors) <= 0 ? ['Nenhuma'] : state.lists.dobradicas, m.hinge) + '</select></td>' +
      '<td class="input-cell text-right money-value" data-module-client-unit="' + i + '">' + money(state.quote?.modules?.[i]?.unitClient ?? m.unitClient) + '</td>' +
      '<td class="total-cell text-right" data-module-client-total="' + i + '">' + money(state.quote?.modules?.[i]?.totalClient || m.quantity * m.unitClient) + '</td>' +
      '<td class="cost-cell text-right money-value" data-module-cost-unit="' + i + '">' + money(state.quote?.modules?.[i]?.unitCost ?? m.unitCost) + '</td>' +
      '<td class="cost-cell text-right" data-module-cost-total="' + i + '">' + money(state.quote?.modules?.[i]?.totalCost || m.quantity * m.unitCost) + '</td>' +
    '</tr>' +
    '<tr class="module-detail-row"><td colspan="17"><div class="module-details">' +
      '<label><span>PINTURA INTERIOR</span><select data-module="' + i + '" data-field="paintInterior"' + (piecePlate || !plateAllowsPaint(m.interior) ? ' disabled' : '') + '>' + optionListWithBlank(state.lists.pinturas, m.paintInterior) + '</select></label>' +
      '<label><span>TIPO DE ORLA</span><select data-module="' + i + '" data-field="edgeType"' + (piecePlate ? ' disabled' : '') + '>' + optionListWithBlank(state.lists.orlas, m.edgeType) + '</select></label>' +
      '<label><span>TOPOS CIMA/BAIXO</span><select data-module="' + i + '" data-field="topBottomEdges"' + (piecePlate ? ' disabled' : '') + '>' + optionListWithBlank(state.lists.toposHorizontais, m.topBottomEdges) + '</select></label>' +
      '<label class="module-side-field"><span>LATERAL ESQ.</span>' + moduleSideSelect(i, 'sideLeftEdge', m.sideLeftEdge, piecePlate || sideIsSplit) + '</label>' +
      '<label class="module-side-field"><span>LATERAL DIR.</span>' + moduleSideSelect(i, 'sideRightEdge', m.sideRightEdge, piecePlate || sideIsSplit) + '</label>' +
      splitButton +
      '<label><span>COSTA</span>' + input('number', m.back, 'min="0" step="1" data-module="' + i + '" data-field="back"' + (piecePlate ? ' disabled' : '')) + '</label>' +
      '<label><span>' + esc('DIVISÃ“RIA') + '</span>' + input('number', m.divider, 'min="0" step="1" data-module="' + i + '" data-field="divider"' + (piecePlate ? ' disabled' : '')) + '</label>' +
    '</div></td></tr>';
  }).join('') + '</tbody></table>';
  enhanceWoodSearchFields();

  modulesGrid.querySelectorAll('[data-module]').forEach(function (el) {
    el.addEventListener('change', function (event) { updateModule(Number(event.target.dataset.module), event.target.dataset.field, event.target.value); });
  });
  modulesGrid.querySelectorAll('input[type="number"][data-module]').forEach(function (el) {
    el.addEventListener('input', function (event) {
      const index = Number(event.target.dataset.module);
      const field = event.target.dataset.field;
      state.modules[index][field] = num(event.target.value);
      state.modules[index].description = buildDescription(state.modules[index]);
      scheduleVisualPreview();
      persistQuoteSoon();
    });
  });
  modulesGrid.querySelectorAll('[data-remove-module]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.modules.splice(Number(button.dataset.removeModule), 1);
      renderModules();
      calculate();
    });
  });
  modulesGrid.querySelectorAll('[data-split-module]').forEach(function (button) {
    button.addEventListener('click', function () {
      splitModuleQuantity(Number(button.dataset.splitModule));
    });
  });
  renderVisualPreview();
}

function closeModuleSplitModal() {
  moduleSplitState = null;
  renderModuleSplitModal();
}

function moduleSideOptions(current) {
  return optionList(state.lists.tipoLateralTopo || ['Nao', 'Inteira', 'Sarrafo 15cm'], current);
}

function renderModuleSplitModal() {
  let modal = document.querySelector('#moduleSplitModal');
  if (!moduleSplitState) {
    if (modal) modal.remove();
    return;
  }
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'moduleSplitModal';
    modal.className = 'drawer-split-backdrop';
    document.body.appendChild(modal);
  }
  const total = moduleSplitState.rows.reduce(function (sum, row) { return sum + num(row.quantity); }, 0);
  const rows = moduleSplitState.rows.map(function (row, rowIndex) {
    return '<div class="drawer-split-row module-split-row">' +
      '<span>Configuracao ' + (rowIndex + 1) + '</span>' +
      '<label><small>Qtd</small><input type="number" min="0" step="1" value="' + esc(row.quantity) + '" data-module-split-qty="' + rowIndex + '"></label>' +
      '<label><small>Lateral esq.</small><select data-module-split-side="' + rowIndex + '" data-field="sideLeftEdge">' + moduleSideOptions(row.sideLeftEdge) + '</select></label>' +
      '<label><small>Lateral dir.</small><select data-module-split-side="' + rowIndex + '" data-field="sideRightEdge">' + moduleSideOptions(row.sideRightEdge) + '</select></label>' +
    '</div>';
  }).join('');
  modal.innerHTML = '<div class="drawer-split-modal" role="dialog" aria-modal="true" aria-labelledby="moduleSplitTitle">' +
    '<div class="drawer-split-head"><div><span>DIVIDIR MODULOS</span><h3 id="moduleSplitTitle">Escolhe as laterais de cada modulo</h3></div><button type="button" data-module-split-close>&times;</button></div>' +
    '<p class="drawer-split-help">Divide a quantidade em configuracoes diferentes. Por exemplo: uma linha com lateral inteira e outra com sarrafo.</p>' +
    '<div class="drawer-split-list">' + rows + '</div>' +
    '<div class="drawer-split-total">Total dividido: <strong>' + total + '</strong> / ' + num(moduleSplitState.originalQuantity) + '</div>' +
    '<div class="drawer-split-actions"><button type="button" data-module-split-close>Cancelar</button><button type="button" data-module-split-apply>Aplicar divisao</button></div>' +
  '</div>';
}

function updateModuleSplitTotal() {
  if (!moduleSplitState) return;
  const total = moduleSplitState.rows.reduce(function (sum, row) { return sum + num(row.quantity); }, 0);
  const totalEl = document.querySelector('#moduleSplitModal .drawer-split-total');
  if (totalEl) {
    totalEl.innerHTML = 'Total dividido: <strong>' + total + '</strong> / ' + num(moduleSplitState.originalQuantity);
    totalEl.classList.toggle('drawer-split-total-error', Math.abs(total - num(moduleSplitState.originalQuantity)) > 0.001);
  }
}

function applyModuleSplitModal() {
  if (!moduleSplitState) return;
  const originalQuantity = num(moduleSplitState.originalQuantity);
  const total = moduleSplitState.rows.reduce(function (sum, row) { return sum + num(row.quantity); }, 0);
  if (Math.abs(total - originalQuantity) > 0.001) {
    sourceStatus.textContent = 'Corrige a divisao: o total tem de continuar ' + originalQuantity + ', mas esta ' + total + '.';
    const totalEl = document.querySelector('#moduleSplitModal .drawer-split-total');
    if (totalEl) totalEl.classList.add('drawer-split-total-error');
    return;
  }
  const source = state.modules[moduleSplitState.index];
  if (!source) return;
  const rows = moduleSplitState.rows.filter(function (row) { return num(row.quantity) > 0; }).map(function (row) {
    return {
      quantity: num(row.quantity),
      sideLeftEdge: row.sideLeftEdge,
      sideRightEdge: row.sideRightEdge
    };
  });
  source.quantity = originalQuantity;
  source.sideDistribution = rows;
  source.description = buildDescription(source);
  closeModuleSplitModal();
  renderModules();
  calculate();
  sourceStatus.textContent = 'Laterais distribuidas no mesmo modulo.';
}

function splitModuleQuantity(index) {
  const source = state.modules[index];
  if (!source) return;
  const quantity = Math.max(1, Math.floor(num(source.quantity)));
  if (quantity <= 1) return;
  const savedRows = Array.isArray(source.sideDistribution)
    ? source.sideDistribution.filter(function (row) { return num(row.quantity) > 0; })
    : [];
  moduleSplitState = {
    index,
    originalQuantity: quantity,
    rows: savedRows.length ? savedRows.map(function (row) {
      return {
        quantity: num(row.quantity),
        sideLeftEdge: row.sideLeftEdge || source.sideLeftEdge || legacySideTopToSide(source.sideEdges, 'left'),
        sideRightEdge: row.sideRightEdge || source.sideRightEdge || legacySideTopToSide(source.sideEdges, 'right')
      };
    }) : Array.from({ length: quantity }, function () {
      return {
        quantity: 1,
        sideLeftEdge: source.sideLeftEdge || legacySideTopToSide(source.sideEdges, 'left'),
        sideRightEdge: source.sideRightEdge || legacySideTopToSide(source.sideEdges, 'right')
      };
    })
  };
  renderModuleSplitModal();
}

function renderFinal() {
  const sellLabel = state.pricingMode === 'reseller' ? 'REVENDEDOR' : 'CLIENTE';
  const headings = ['GRUPO','DESCRIÃ‡ÃƒO','QTD','P. UNIT ' + sellLabel,'TOTAL ' + sellLabel,'CUSTO UNIT.','TOTAL CUSTO','DESCRIÃ‡ÃƒO FINAL','AÃ‡ÃƒO'];
  const extraGroups = Array.from(new Set((state.lists.extraGroups || []).concat([wardrobeDrawerGroup]).map(normalizeExtraGroupName).filter(Boolean)));
  prepareWardrobeDrawerExtras();
  finalGrid.innerHTML = '<table class="excel-table final-table"><colgroup>' + '<col>'.repeat(9) + '</colgroup><thead><tr>' + headings.map(function (h, index) { return '<th' + (index === 5 || index === 6 ? ' class="cost-cell"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    state.modules.map(function (m, i) {
      return '<tr><td>' + esc(moduleFinalGroup(m)) + '</td><td>' + esc(moduleFinalTitle(m)) + '</td><td class="text-center">' + esc(m.quantity) + '</td><td class="text-right">' + money(m.unitClient) + '</td><td class="total-cell text-right">' + money(state.quote?.modules?.[i]?.totalClient || 0) + '</td><td class="cost-cell text-right">' + money(m.unitCost) + '</td><td class="cost-cell text-right">' + money(state.quote?.modules?.[i]?.totalCost || 0) + '</td><td class="description">' + esc(buildDescription(m)) + '</td><td></td></tr>';
    }).join('') +
    state.extras.map(function (e, i) {
      const manualPriced = isManualPricedExtra(e);
      const wardrobeDrawer = isWardrobeDrawerExtra(e);
      const unitClient = state.quote?.extras?.[i]?.unitClient ?? e.unitClient;
      const unitCost = state.quote?.extras?.[i]?.unitCost ?? e.unitCost;
      const skirting = isSkirtingExtra(e);
      const lacquerCell = skirting
        ? '<div class="extra-inline-option"><span>Lacado</span><select data-extra="' + i + '" data-field="lacquered">' + optionList(['Não', 'Sim'], isLacqueredExtra(e) ? 'Sim' : 'Não') + '</select></div>'
        : '';
      const drawerDescription = wardrobeDrawer
        ? wardrobeDrawerDescription(e)
        : '';
      const rodExtra = isWardrobeRodExtra(e);
      const description = wardrobeDrawer ? drawerDescription : (e.group ? e.group + (e.item ? ' - ' + e.item : '') + (skirting && isLacqueredExtra(e) ? ' / Lacado' : '') + (rodExtra ? wardrobeRodDescription(e) : '') : '');
      const drawerCell = '<div class="wardrobe-drawer-config">' +
        '<strong>' + esc(wardrobeDrawerItem) + '</strong>' +
        '<label><span>Material</span><select data-wardrobe-extra="' + i + '" data-field="drawerMaterialMode">' + optionList(['Interior', 'Exterior', 'Interior + frente exterior'], e.drawerMaterialMode || 'Interior') + '</select></label>' +
        '<label><span>Corrediça</span><select data-wardrobe-extra="' + i + '" data-field="drawerRunner">' + optionListWithBlank(drawerRunnerOptions(), e.drawerRunner || '') + '</select></label>' +
        '<div class="wardrobe-drawer-useful">' + esc(Array.isArray(e.moduleDistribution) && e.moduleDistribution.length ? 'Medidas por módulo' : 'Largura ' + wardrobeDrawerUsefulSummary(e)) + '</div>' +
        '<button class="soft-inline-button" type="button" data-split-drawer-extra="' + i + '">Dividir por módulo</button>' +
      '</div>';
      const rodCell = rodExtra
        ? '<div class="rod-extra-config"><select data-extra="' + i + '" data-field="item" data-extra-item-select="' + i + '">' + optionList(extraItems(e.group), e.item) + '</select><label><span>Cm usados</span>' + input('text', e.rodLengths || '', 'placeholder="Ex: 45 ou 15+85" data-extra="' + i + '" data-field="rodLengths"') + '</label></div>'
        : '';
      const itemCell = wardrobeDrawer ? drawerCell : isOtherExtra(e)
        ? input('text', e.item || '', 'placeholder="Descrição" data-extra="' + i + '" data-field="item"')
        : (isKitchenDrawerExtra(e)
          ? '<div class="drawer-module-picker"><label><span>Módulo</span><select data-extra="' + i + '" data-field="targetModuleId">' + drawerModuleOptionList(e) + '</select></label><select data-extra="' + i + '" data-field="item" data-extra-item-select="' + i + '">' + optionList(extraItems(e.group), e.item) + '</select><button class="soft-inline-button" type="button" data-split-drawer-extra="' + i + '">Dividir por módulo</button></div>'
          : (rodExtra ? rodCell : '<select data-extra="' + i + '" data-field="item" data-extra-item-select="' + i + '">' + optionList(extraItems(e.group), e.item) + '</select>')) + lacquerCell;
      const clientCell = manualPriced
        ? input('number', unitClient, 'min="0" step="0.01" data-extra="' + i + '" data-field="unitClient"')
        : money(unitClient);
      const costCell = manualPriced
        ? input('number', unitCost, 'min="0" step="0.01" data-extra="' + i + '" data-field="unitCost"')
        : money(unitCost);
      return '<tr><td class="input-cell"><select data-extra="' + i + '" data-field="group">' + optionListWithBlank(extraGroups, e.group) + '</select></td><td class="input-cell extra-item-cell">' + itemCell + '</td><td class="input-cell">' + input('number', e.quantity, 'min="0" step="0.01" data-extra="' + i + '" data-field="quantity"') + '</td><td class="input-cell text-right">' + clientCell + '</td><td class="total-cell text-right">' + money(state.quote?.extras?.[i]?.totalClient || 0) + '</td><td class="input-cell cost-cell text-right">' + costCell + '</td><td class="cost-cell text-right">' + money(state.quote?.extras?.[i]?.totalCost || 0) + '</td><td class="description">' + esc(description) + '</td><td class="text-center"><button class="remove-button" data-remove-extra="' + i + '" type="button" title="Remover linha">&times;</button></td></tr>';
    }).join('') +
    '<tr><td colspan="4" class="total-cell text-right">' + esc('ORÃ‡AMENTO CLIENTE + EXTRAS') + '</td><td class="total-cell text-right">' + money(state.quote?.totals?.finalTotal || 0) + '</td><td class="cost-cell text-right">CUSTO</td><td class="cost-cell text-right">' + money(state.quote?.totals?.costTotal || 0) + '</td><td class="total-cell text-right margin-cell">MARGEM: ' + money(state.quote?.totals?.margin || 0) + '</td><td></td></tr>' +
    '</tbody></table>';

  enhanceExtraItemSearchFields();
  finalGrid.querySelectorAll('[data-extra]').forEach(function (el) {
    el.addEventListener('change', function (event) { updateExtra(Number(event.target.dataset.extra), event.target.dataset.field, event.target.value); });
  });
  finalGrid.querySelectorAll('[data-wardrobe-extra]').forEach(function (el) {
    el.addEventListener('change', function (event) { updateExtra(Number(event.target.dataset.wardrobeExtra), event.target.dataset.field, event.target.value); });
  });
  finalGrid.querySelectorAll('input[data-extra]').forEach(function (el) {
    el.addEventListener('input', function (event) {
      const field = event.target.dataset.field;
      const numeric = ['quantity','unitClient','unitCost'].includes(field);
      const extraIndex = Number(event.target.dataset.extra);
      state.extras[extraIndex][field] = numeric ? num(event.target.value) : event.target.value;
      if (field === 'quantity' && (isWardrobeDrawerExtra(state.extras[extraIndex]) || isKitchenDrawerExtra(state.extras[extraIndex]))) {
        syncDrawerDistributionQuantity(state.extras[extraIndex], extraIndex);
        scheduleCalculate();
        return;
      }
      if (field === 'rodLengths') {
        scheduleCalculate({ renderFinal: false });
        return;
      }
      persistQuoteSoon();
      renderPrint();
    });
  });
  finalGrid.querySelectorAll('[data-remove-extra]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.extras.splice(Number(button.dataset.removeExtra), 1);
      calculate();
    });
  });
  scheduleVisualPreview();
}

function displayDate(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value || '';
}

function renderPrint() {
  const totals = state.quote?.totals || { finalTotal: 0 };
  const moduleRows = state.modules.map(function (module, index) {
    const calculated = state.quote?.modules?.[index] || {};
    return {
      description: buildDescription(module),
      quantity: module.quantity,
      unitClient: calculated.unitClient ?? module.unitClient,
      totalClient: calculated.totalClient ?? (module.quantity * module.unitClient)
    };
  });
  const extraRows = state.extras.map(function (extra, index) {
    const calculated = state.quote?.extras?.[index] || {};
    const drawerDescription = isWardrobeDrawerExtra(extra)
      ? wardrobeDrawerDescription(extra)
      : '';
    const rodExtra = isWardrobeRodExtra(extra);
    return {
      description: isWardrobeDrawerExtra(extra) ? drawerDescription : (extra.group ? extra.group + (extra.item ? ' - ' + extra.item : '') + (isSkirtingExtra(extra) && isLacqueredExtra(extra) ? ' / Lacado' : '') + (rodExtra ? wardrobeRodDescription(extra) : '') : ''),
      quantity: extra.quantity,
      unitClient: calculated.unitClient ?? extra.unitClient,
      totalClient: calculated.totalClient ?? (extra.quantity * extra.unitClient)
    };
  });
  const rows = moduleRows.concat(extraRows);
  const rowsHtml = rows.length ? rows.map(function (row) {
    return '<tr><td>' + esc(row.description) + '</td><td class="print-quantity">' + esc(row.quantity) + ' x ' + money(row.unitClient) + '</td><td class="print-money">' + money(row.totalClient) + '</td></tr>';
  }).join('') : '<tr class="print-empty"><td colspan="3">Sem artigos no or&ccedil;amento</td></tr>';

  printSheet.innerHTML =
    '<header class="print-header">' +
      '<div class="print-brand"><img src="/assets/silwood-logo.png" alt="Silwood"></div>' +
      '<div class="print-client">' +
        '<div class="print-client-title">DADOS DO CLIENTE</div>' +
        '<div><strong>NOME:</strong><span>' + esc(state.client.name) + '</span></div>' +
        '<div><strong>MORADA DA OBRA:</strong><span>' + esc(state.client.location) + '</span></div>' +
        '<div><strong>DATA DO OR&Ccedil;AMENTO:</strong><span>' + esc(displayDate(state.client.date)) + '</span></div>' +
        '<div class="print-client-total"><strong>OR&Ccedil;AMENTO ' + (state.pricingMode === 'reseller' ? 'REVENDEDOR' : 'CLIENTE') + ':</strong><span>' + money(totals.finalTotal) + '</span></div>' +
      '</div>' +
    '</header>' +
    '<table class="print-lines"><thead><tr><th>DESCRI&Ccedil;&Atilde;O</th><th>QTD X P. UNIT&Aacute;RIO</th><th>TOTAL</th></tr></thead><tbody>' + rowsHtml + '</tbody>' +
      '<tfoot><tr><td colspan="2">TOTAL GERAL C/ EXTRAS:</td><td>' + money(totals.finalTotal) + '</td></tr></tfoot>' +
    '</table>' +
    renderPrintVisuals();
}

function addModule() {
  state.modules.push({
    id: 'module_' + Date.now(),
    blank: true,
    type: '',
    family: '',
    quantity: 0,
    width: 0,
    height: 0,
    depth: 0,
    doors: 0,
    drawers: 0,
    shelves: 0,
    interior: '',
    exterior: '',
    paintDoor: '',
    paintInterior: '',
    doorSystem: '',
    hinge: '',
    edgeType: '',
    topBottomEdges: '',
    sideEdges: '',
    sideLeftEdge: '',
    sideRightEdge: '',
    back: 0,
    divider: 0,
    unitClient: 0,
    unitCost: 0,
    description: '',
    pricingBase: { unitClient: 0, unitCost: 0 }
  });
  renderModules();
  calculate();
}

function addExtra() {
  state.extras.push({ id: 'extra_' + Date.now(), group: '', item: '', quantity: 0, unitClient: 0, unitCost: 0, lacquered: false });
  calculate();
}

function resetQuote() {
  localStorage.removeItem(storageKey);
  clearQuoteDraftStorage();
  state.client = { name: '', location: '', date: '' };
  state.modules = [];
  state.extras = [];
  persistQuote();
  renderClient();
  renderModules();
  calculate();
  sourceStatus.textContent = 'Novo orçamento criado';
}


function supplierNumber(value) {
  return (Number(value) || 0).toFixed(2);
}

function supplierManualPriceInput(type, index, field, value) {
  const disabled = type === 'readonly';
  return '<span class="supplier-price-control">' +
    '<input class="supplier-price-manual-input" type="text" inputmode="decimal" autocomplete="off" value="' + supplierNumber(value) + '" data-manual-price-type="' + esc(type) + '" data-manual-price-index="' + index + '" data-manual-price-field="' + esc(field) + '">' +
    (disabled ? '' : '<button class="supplier-auto-price-button" type="button" data-auto-price-type="' + esc(type) + '" data-auto-price-index="' + index + '" data-auto-price-field="' + esc(field) + '" title="Voltar ao preço automático">Auto</button>') +
  '</span>';
}

function updateSupplierMoneyCell(cell, value, suffix) {
  if (!cell) return;
  const input = cell.querySelector('input[data-manual-price-field]');
  if (input) {
    input.value = supplierNumber(value);
    return;
  }
  cell.textContent = money(value) + (suffix || '');
}

function automaticPrice(item, field, value) {
  if (!item) return;
  if (field === 'client' && item.manualClient === true) return;
  if (field === 'reseller' && item.manualReseller === true) return;
  item[field] = roundSaleUp(value);
}

function applyAutomaticClientReseller(item, clientValue, resellerValue) {
  automaticPrice(item, 'client', clientValue);
  automaticPrice(item, 'reseller', resellerValue === undefined ? item.client : resellerValue);
}

function forceAutomaticPrice(item, field, value) {
  if (!item) return;
  item[field] = roundSaleUp(value);
}

function roundMeterPrice(value) {
  const number = Number(value) || 0;
  return number > 0 ? Math.round(number * 100) / 100 : 0;
}

function applyEdgeAutomaticClientReseller(item, clientValue, resellerValue) {
  if (!item) return;
  if (item.manualClient !== true) item.client = roundMeterPrice(clientValue);
  if (item.manualReseller !== true) item.reseller = roundMeterPrice(resellerValue === undefined ? item.client : resellerValue);
}

function supplierManualPriceList(type) {
  if (type === 'plates') return state.supplierPrices || [];
  if (type === 'paintings') return state.catalog.paintings || [];
  if (type === 'edges') return state.catalog.edges || [];
  if (type === 'extras') return state.catalog.extras || [];
  if (type === 'doorSystems') return state.catalog.doorSystems || [];
  if (type === 'hinges') return state.catalog.hinges || [];
  return [];
}

function trackManualPriceChange(type, item, index, before) {
  if (!item) return;
  if (type === 'plates') {
    if (item.userAdded) updateSupplierAddition('plates', before, item);
    trackSupplierChange('plates', item, index);
  } else if (type === 'paintings') {
    if (item.userAdded) updateSupplierAddition('paintings', before, item);
    trackSupplierChange('paintings', item, index);
  } else if (type === 'edges') {
    if (item.userAdded) updateSupplierAddition('edges', before, item);
    trackSupplierChange('edges', item, index);
  } else if (type === 'extras') {
    if (item.userAdded) updateSupplierAddition('extras', before, item);
    trackSupplierChange('extras', item, index);
    if (comparableText(item.group) === comparableText(doorSystemExtraGroup)) syncDoorSystemExtras();
  } else if (type === 'doorSystems') {
    if (item.userAdded) updateSupplierAddition('doorSystems', before, item);
    trackSupplierChange('openingSystemComponents', {
      item: item.name,
      label: item.name,
      name: item.name,
      supplier: item.supplier,
      reference: item.reference,
      supplierPrice: item.supplierPrice,
      cost: item.cost,
      client: item.client,
      reseller: item.reseller,
      manualSupplierPrice: item.manualSupplierPrice === true,
      manualClient: item.manualClient === true,
      manualReseller: item.manualReseller === true,
      userAdded: item.userAdded === true,
      userAddedSummary: true
    }, item.name);
    syncDoorSystemExtras();
  } else if (type === 'hinges') {
    if (item.userAdded) updateSupplierAddition('hinges', before, item);
    trackSupplierChange('hinges', item, index);
  }
}

function commitSupplierManualPriceInput(input) {
  if (!input || !input.dataset) return false;
  const type = input.dataset.manualPriceType;
  if (type === 'readonly') return false;
  const index = Number(input.dataset.manualPriceIndex);
  const field = input.dataset.manualPriceField;
  const list = supplierManualPriceList(type);
  const item = list[index];
  if (!item || (field !== 'client' && field !== 'reseller')) return false;
  const nextValue = type === 'edges' ? num(input.value) : roundSaleUp(num(input.value));
  const isManual = field === 'client' ? item.manualClient === true : item.manualReseller === true;
  if (Number(item[field]) === nextValue && isManual) {
    input.value = supplierNumber(nextValue);
    return false;
  }
  const before = clone(item);
  ensureManualPriceBaseline(item, before);
  item[field] = nextValue;
  if (field === 'client') item.manualClient = true;
  if (field === 'reseller') item.manualReseller = true;
  if (type === 'edges' && field === 'client' && item.manualReseller !== true) item.reseller = item.client;
  input.value = supplierNumber(item[field]);
  trackManualPriceChange(type, item, index, before);
  return true;
}

function commitVisibleSupplierManualPrices() {
  let changed = false;
  supplierPricesGrid.querySelectorAll('[data-manual-price-type]').forEach(function (input) {
    if (commitSupplierManualPriceInput(input)) changed = true;
  });
  if (changed) {
    renderModules();
    renderFinal();
  }
  return changed;
}

function ensureManualPriceBaseline(item, before) {
  if (!item) return;
  const source = before || item;
  if (item.baseSupplierPrice === undefined) item.baseSupplierPrice = Number(source.supplierPrice) || 0;
  if (item.baseCost === undefined) item.baseCost = Number(source.cost) || 0;
  if (item.baseClient === undefined) item.baseClient = Number(source.client) || 0;
  if (item.baseReseller === undefined) item.baseReseller = Number(source.reseller || source.client) || 0;
}

function inferredExtraAutoRatio(item, field) {
  const group = normalizeExtraGroupName(item?.group);
  const selfKey = comparableText(item?.item || item?.label || item?.name);
  const ratios = (state.catalog.extras || []).filter(function (candidate) {
    if (candidate === item) return false;
    if (normalizeExtraGroupName(candidate.group) !== group) return false;
    if (comparableText(candidate.item || candidate.label || candidate.name) === selfKey) return false;
    const cost = Number(candidate.cost) || 0;
    const price = Number(field === 'reseller' ? (candidate.reseller || candidate.client) : candidate.client) || 0;
    return cost > 0 && price > 0;
  }).map(function (candidate) {
    return (Number(field === 'reseller' ? (candidate.reseller || candidate.client) : candidate.client) || 0) / (Number(candidate.cost) || 1);
  }).filter(function (ratio) {
    return Number.isFinite(ratio) && ratio > 0;
  });
  return ratios.length ? median(ratios) : 0;
}

function recalculateManualPriceItem(type, item, index) {
  if (!item) return;
  const targetField = arguments.length > 3 ? arguments[3] : '';
  if (type === 'plates') {
    const rules = state.pricingRules || { labor: 2.02, clientMultiplier: 3, resellerMultiplier: 1.4 };
    item.cost = num(item.supplierPrice) + rules.labor;
    if (targetField === 'client') forceAutomaticPrice(item, 'client', item.cost * rules.clientMultiplier);
    else if (targetField === 'reseller') forceAutomaticPrice(item, 'reseller', item.cost * rules.resellerMultiplier);
    else calculateSupplierRow(item);
  } else if (type === 'paintings') {
    recalculatePaintingServices();
  } else if (type === 'edges') {
    const meters = Number(item.supplierMeters) || 1000;
    item.materialPerMeter = meters ? (Number(item.supplierPrice) || 0) / meters : 0;
    item.cost = item.materialPerMeter + 0.32;
    if (targetField === 'client') item.client = roundMeterPrice(item.cost * 3.5);
    else if (targetField === 'reseller') item.reseller = roundMeterPrice(item.cost * 3.5);
    else applyEdgeAutomaticClientReseller(item, item.cost * 3.5, item.cost * 3.5);
  } else if (type === 'doorSystems' || type === 'hinges') {
    if (targetField === 'client') {
      const base = type === 'doorSystems' ? baseDoorSystemFor(item) : null;
      forceAutomaticPrice(item, 'client', Number(base?.client) || Number(item.baseClient) || Number(item.client) || 0);
      return;
    }
    if (targetField === 'reseller') {
      const base = type === 'doorSystems' ? baseDoorSystemFor(item) : null;
      forceAutomaticPrice(item, 'reseller', Number(base?.reseller ?? base?.client) || Number(item.baseReseller) || Number(item.reseller ?? item.client) || 0);
      return;
    }
    recalculateSystemSummaries(type);
  } else if (type === 'extras') {
    const group = normalizeExtraGroupName(item.group);
    if (group === 'Gavetas') {
      recalculateDrawerExtras();
    } else if (comparableText(group) === comparableText(doorSystemExtraGroup)) {
      item.cost = openingSystemCostFromSupplier(item, item.supplierPrice);
      applyOpeningSystemSalePrices(item);
      syncDoorSystemExtras();
    } else if (ledKitRecipe(item)) {
      recalculateLedKits(item.group);
    } else {
      const markupMultiplier = supplierPriceMarkupMultiplier(item.group);
      if (markupMultiplier) {
        item.cost = Number(item.supplierPrice) || 0;
        if (targetField === 'client') forceAutomaticPrice(item, 'client', item.cost * markupMultiplier);
        else if (targetField === 'reseller') forceAutomaticPrice(item, 'reseller', item.cost * markupMultiplier);
        else applyAutomaticClientReseller(item, item.cost * markupMultiplier, item.cost * markupMultiplier);
      } else {
        if (item.baseSupplierPrice === undefined) item.baseSupplierPrice = Number(item.supplierPrice) || 0;
        if (item.baseCost === undefined) item.baseCost = Number(item.cost) || 0;
        if (item.baseClient === undefined) item.baseClient = Number(item.client) || 0;
        if (item.baseReseller === undefined) item.baseReseller = Number(item.reseller || item.client) || 0;
        item.cost = calculatedCostFromSupplier(item, item.supplierPrice);
        const baseCost = Number(item.baseCost) || 0;
        const inferredClientRatio = inferredExtraAutoRatio(item, 'client');
        const inferredResellerRatio = inferredExtraAutoRatio(item, 'reseller') || inferredClientRatio;
        const clientRatio = baseCost ? (((Number(item.baseClient) || 0) / baseCost) || inferredClientRatio || 1) : (inferredClientRatio || 1);
        const resellerRatio = baseCost ? (((Number(item.baseReseller) || 0) / baseCost) || inferredResellerRatio || clientRatio) : (inferredResellerRatio || clientRatio);
        if (targetField === 'client') forceAutomaticPrice(item, 'client', item.cost * clientRatio);
        else if (targetField === 'reseller') forceAutomaticPrice(item, 'reseller', item.cost * resellerRatio);
        else applySummaryPricesFromCost(item);
      }
    }
  }
}

function calculateSupplierRow(item) {
  const rules = state.pricingRules || { labor: 2.02, clientMultiplier: 3, resellerMultiplier: 1.4 };
  const supplierPrice = num(item.supplierPrice);
  item.cost = supplierPrice + rules.labor;
  applyAutomaticClientReseller(item, item.cost * rules.clientMultiplier, item.cost * rules.resellerMultiplier);
}

function calculatedCostFromSupplier(item, supplierPrice) {
  const baseSupplier = Number(item.baseSupplierPrice);
  const baseCost = Number(item.baseCost ?? item.cost) || 0;
  const labor = Number.isFinite(baseSupplier) && baseSupplier > 0 ? baseCost - baseSupplier : 0;
  return Math.max(0, (Number(supplierPrice) || 0) + labor);
}

function openingSystemLabor(value) {
  return 15 * (23 / 60);
}

function openingSystemCostFromSupplier(item, supplierPrice) {
  const price = Number(supplierPrice) || 0;
  if (price <= 0) return 0;
  const storedLabor = Number(item.labor);
  const labor = Number.isFinite(storedLabor) && storedLabor > 0
    ? storedLabor
    : openingSystemLabor([item.reference, item.name, item.item, item.label].join(' '));
  return Math.max(0, price + labor);
}

function normalizeKnownDoorSystem(item) {
  if (!item) return;
  const raw = [item.name, item.item, item.label, item.reference].join(' ');
  const name = comparableText(raw);
  const reference = String(item.reference || '').trim();
  if ((name.includes('TIP ON') || name.includes('TIP-ON')) && (name.includes('PULSADOR') || name.includes('TIC TAC') || name.includes('P/PORTAS PRETO'))) {
    const component = (state.catalog?.openingSystemComponents || []).find(function (candidate) {
      return comparableText(candidate.item).includes('TIP ON P/PORTAS PRETO');
    });
    item.name = 'Tip-on (Pulsador Preto) / Tic-Tac';
    item.item = item.name;
    item.label = item.name;
    item.reference = '1x TIP-ON P/PORTAS PRETO (CASFERIM)';
    if (!item.supplier) item.supplier = 'CASFERIM';
    if (component && !item.manualSupplierPrice) item.supplierPrice = Number(component.supplierPrice) || 2.628;
    if (!(Number(item.supplierPrice) > 0)) item.supplierPrice = component ? Number(component.supplierPrice) || 2.628 : 2.628;
  }
  const canonical = canonicalDoorSystemBase(raw);
  if (canonical && !((name.includes('TIP ON') || name.includes('TIP-ON')) && (name.includes('PULSADOR') || name.includes('TIC TAC') || name.includes('P/PORTAS PRETO')))) {
    item.name = canonical.name;
    item.item = canonical.name;
    item.label = canonical.name;
    if (!item.reference || item.reference === item.name) item.reference = canonical.reference;
    if (!item.supplier) item.supplier = canonical.supplier || supplierFromReference(item.reference);
  }
}

function baseDoorSystemFor(item) {
  const key = itemIdentity(item?.name || item?.item || item?.label);
  const fixed = canonicalDoorSystemBase(item?.name || item?.item || item?.label || item?.reference);
  return fixed || (key ? baseDoorSystemsByName.get(key) : null);
}

function openingSystemSaleRatio(item) {
  const base = baseDoorSystemFor(item);
  const baseCost = Number(item.baseCost) || Number(base?.cost) || 0;
  const baseClient = Number(item.baseClient) || Number(base?.client) || 0;
  return baseCost && baseClient ? baseClient / baseCost : 1.7;
}

function applyOpeningSystemSalePrices(item) {
  const sale = (Number(item.cost) || 0) * openingSystemSaleRatio(item);
  applyAutomaticClientReseller(item, sale, sale);
}

function openingSystemClientRatio(item) {
  const currentCost = Number(item.cost) || 0;
  const currentClient = Number(item.client) || 0;
  if (currentCost > 0 && currentClient > 0) return currentClient / currentCost;
  return averageMetric(state.catalog?.doorSystems || [], function (system) {
    return (Number(system.client) || 0) / (Number(system.cost) || 0);
  }, 2);
}

function normalizeOpeningSystemPricing(item, resetBase) {
  if (!item) return;
  normalizeKnownDoorSystem(item);
  if (!(Number(item.supplierPrice) > 0)) return;
  if (!item.supplier) item.supplier = supplierFromReference(item.reference);
  item.cost = openingSystemCostFromSupplier(item, item.supplierPrice);
  applyOpeningSystemSalePrices(item);
  if (resetBase) {
    const base = baseDoorSystemFor(item);
    item.baseSupplierPrice = Number(item.supplierPrice) || 0;
    item.baseCost = Number(base?.cost) || Number(item.cost) || 0;
    item.baseClient = Number(base?.client) || Number(item.client) || 0;
    item.baseReseller = Number(base?.reseller ?? base?.client) || Number(item.reseller) || 0;
  }
}

function applySummaryPricesFromCost(item) {
  const baseCost = Number(item.baseCost) || 0;
  const clientRatio = baseCost ? (Number(item.baseClient) || 0) / baseCost : 1;
  const resellerRatio = baseCost ? (Number(item.baseReseller) || 0) / baseCost : clientRatio;
  applyAutomaticClientReseller(item, (Number(item.cost) || 0) * clientRatio, (Number(item.cost) || 0) * resellerRatio);
}

function searchTokens(value) {
  return comparableText(value)
    .replace(/(\d+)\s*MM\b/g, '$1')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function applySupplierSearch() {
  const queryTokens = searchTokens(supplierSearchInput?.value || '');
  function matchesSearch(value) {
    if (!queryTokens.length) return true;
    const haystack = searchTokens(value).join(' ');
    return queryTokens.every(function (token) { return haystack.includes(token); });
  }
  supplierPricesGrid.querySelectorAll('.supplier-price-section').forEach(function (section) {
    const groups = section.querySelectorAll('.plate-compare-group');
    if (groups.length) {
      let visibleGroups = 0;
      groups.forEach(function (group) {
        const match = matchesSearch(group.dataset.supplierSearch || '');
        group.hidden = !match;
        if (match) visibleGroups += 1;
      });
      const emptyGroup = section.querySelector('.supplier-empty');
      if (emptyGroup) emptyGroup.hidden = visibleGroups > 0;
      return;
    }
    let visible = 0;
    section.querySelectorAll('tbody tr[data-supplier-search]').forEach(function (row) {
      const match = matchesSearch(row.dataset.supplierSearch || '');
      row.hidden = !match;
      if (match) visible += 1;
    });
    const empty = section.querySelector('.supplier-empty');
    if (empty) empty.hidden = visible > 0;
  });
}

function clearSupplierSearch() {
  if (!supplierSearchInput || !supplierSearchInput.value) return;
  supplierSearchInput.value = '';
}

function supplierAdditionsStore() {
  try {
    return JSON.parse(localStorage.getItem(supplierAdditionsKey) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function persistSupplierAddition(type, item) {
  const store = supplierAdditionsStore();
  if (!Array.isArray(store[type])) store[type] = [];
  const stored = { ...clone(item), userAdded: true };
  normalizeKnownDrawerComponentName(stored);
  if (type === 'extras') stored.group = normalizeExtraGroupName(stored.group);
  const storedKey = supplierRemovalKey(type, stored);
  const existingIndex = store[type].findIndex(function (candidate) {
    return supplierRemovalKey(type, candidate) === storedKey;
  });
  if (existingIndex >= 0) store[type][existingIndex] = stored;
  else store[type].push(stored);
  localStorage.setItem(supplierAdditionsKey, JSON.stringify(store));
}

function updateSupplierAddition(type, before, item) {
  const store = supplierAdditionsStore();
  if (!Array.isArray(store[type])) return;
  normalizeKnownDrawerComponentName(before);
  normalizeKnownDrawerComponentName(item);
  const beforeName = comparableText(before?.name || before?.item);
  const beforeSupplier = comparableText(before?.supplier);
  const beforeReference = comparableText(before?.reference);
  const beforePrice = supplierNumber(before?.supplierPrice);
  const match = store[type].find(function (stored) {
    return comparableText(stored.name || stored.item) === beforeName &&
      comparableText(stored.supplier) === beforeSupplier &&
      comparableText(stored.reference) === beforeReference &&
      supplierNumber(stored.supplierPrice) === beforePrice;
  });
  if (!match) return;
  Object.assign(match, clone(item), { userAdded: true });
  localStorage.setItem(supplierAdditionsKey, JSON.stringify(store));
}

function correctKnownSupplierPriceIssues() {
  let changedDraft = false;
  const fixFlexa = function (item) {
    const text = comparableText([item?.item, item?.label, item?.name, item?.reference].join(' '));
    const compact = text.replace(/[^A-Z0-9]+/g, '');
    if (!text.includes('FLEXA') || !text.includes('TIRADOR PIEL') || !compact.includes('2270')) return false;
    if (Number(item.client) !== 20 || item.manualClient === true) return false;
    item.client = 18;
    item.manualClient = false;
    if (item.baseClient === 0 || item.baseClient === undefined || Number(item.baseClient) === 20) item.baseClient = 18;
    if (!Number(item.reseller)) item.reseller = 18;
    return true;
  };
  const fixDrawer760H = function (item) {
    const text = comparableText([item?.group, item?.item, item?.label, item?.name, item?.reference].join(' '));
    if (!text.includes('GAVETAS') || !text.includes('760H') || !text.includes('TICTAC') || !text.includes('40KG') || !text.includes('250')) return false;
    if ((Number(item.cost) || 0) <= 50 && (Number(item.client) || 0) <= 100) return false;
    item.cost = 37.16;
    item.client = 75;
    item.reseller = 75;
    item.baseCost = 37.16;
    item.baseClient = 75;
    item.baseReseller = 75;
    item.manualClient = true;
    item.manualReseller = true;
    return true;
  };
  (state.catalog?.extras || []).forEach(function (item) {
    fixFlexa(item);
    fixDrawer760H(item);
  });
  const draft = supplierDraftStore();
  (draft.extras || []).forEach(function (item) {
    if (fixFlexa(item)) changedDraft = true;
    if (fixDrawer760H(item)) changedDraft = true;
  });
  if (changedDraft) {
    localStorage.setItem(supplierDraftKey, JSON.stringify(draft));
    restoreSupplierDirtyChanges();
  }
}

function addUniqueListItem(listName, value) {
  if (!value) return;
  if (listName === 'extraGroups') value = normalizeExtraGroupName(value);
  if (!Array.isArray(state.lists[listName])) state.lists[listName] = [];
  if (!state.lists[listName].some(function (item) { return comparableText(item) === comparableText(value); })) {
    state.lists[listName].push(value);
  }
}

function supplierRemovalStore() {
  try {
    return JSON.parse(localStorage.getItem(supplierRemovedKey) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function supplierRemovalKey(type, item) {
  const nameValue = item?.name || item?.item || item?.label;
  return [
    type,
    normalizeExtraGroupName(item?.group),
    cleanDuplicatedSupplierName(nameValue, item?.reference),
    item?.supplier,
    item?.reference
  ].map(function (value) { return comparableText(value); }).filter(Boolean).join('|');
}

function cleanDuplicatedSupplierName(name, reference) {
  let value = cleanDisplayText(name);
  const ref = cleanDisplayText(reference);
  if (ref && comparableText(value).startsWith(comparableText(ref))) {
    value = value.slice(ref.length).trim() || value;
  }
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(' ');
    const right = words.slice(half).join(' ');
    if (comparableText(left) === comparableText(right)) value = left;
  }
  return value;
}

function isBadHingeSummary(item) {
  const text = comparableText([item?.name, item?.item, item?.label, item?.reference].join(' '));
  return text.includes('CORRED') || text.includes('GAVETAS ROUPEIRO');
}

const wardrobeBlumRunnerName = 'Corrediças BLUM gavetas roupeiro 760H TICTAC 40KG*250';
const wardrobeBlumRunnerLegacyNames = [
  'Corrediças BLUM gavetas roupeiro',
  'Corredicas BLUM gavetas roupeiro'
];
const drawer561ParentName = 'Corrediças BLUM gavetas roupeiro 561HT TIC-TAC 30KG*435';
const drawer561SyncComponentName = 'TIP-ON BLUM TANDEM HT EIXO SINCRON 1140M';
const drawerBoxCapMainExtra = {
  group: 'Gavetas',
  item: 'BOX CAP',
  label: 'BOX CAP',
  supplier: 'LAGE E SA',
  reference: 'BOX CAP',
  supplierPrice: 11.7,
  cost: 11.7,
  client: 25,
  reseller: 25,
  userAdded: true,
  createdAt: 1784719111860,
  baseSupplierPrice: 11.7,
  baseCost: 11.7,
  baseClient: 25,
  baseReseller: 25,
  manualClient: true,
  manualReseller: true
};

function isLegacyWardrobeBlumRunnerName(value) {
  const text = comparableText(value);
  const compact = text.replace(/[^A-Z0-9]+/g, '');
  return wardrobeBlumRunnerLegacyNames.some(function (name) {
    return comparableText(name) === text;
  }) || (compact.includes('CORRED') && compact.includes('BLUM') && compact.includes('GAVETAS') && compact.includes('ROUPEIRO') && compact.includes('760H') && compact.includes('40KG') && compact.includes('250'));
}

function normalizeKnownDrawerComponentName(item) {
  if (!item) return false;
  let changed = false;
  ['name', 'item', 'label', 'reference', 'usedIn', 'family'].forEach(function (field) {
    if (isLegacyWardrobeBlumRunnerName(item[field])) {
      item[field] = wardrobeBlumRunnerName;
      changed = true;
    }
  });
  const parentText = comparableText([item.usedIn, item.family].join(' '));
  const itemText = comparableText([item.name, item.item, item.label, item.reference].join(' '));
  if (parentText.includes('561HT') && (itemText.includes('EIXO SINCRON') || itemText.includes('1140'))) {
    ['name', 'item', 'label', 'reference'].forEach(function (field) {
      if (item[field] !== undefined && item[field] !== drawer561SyncComponentName) {
        item[field] = drawer561SyncComponentName;
        changed = true;
      }
    });
  }
  return changed;
}

function isMistakenDrawerBoxCapComponent(item) {
  if (!item) return false;
  const itemText = comparableText(item.name || item.item || item.label || item.reference);
  const parentText = comparableText([item.usedIn, item.family].join(' '));
  return itemText === 'BOX CAP' && parentText.includes('561HT');
}

function isDuplicateDrawer760HComponent(item) {
  if (!item) return false;
  const itemText = comparableText(item.name || item.item || item.label || item.reference);
  const parentText = comparableText([item.usedIn, item.family].join(' '));
  return parentText.includes('760H') && parentText.includes('TICTAC') &&
    itemText.includes('760H') && itemText.includes('TIC-TAC') && itemText.includes('ESQ');
}

function ensureBoxCapMainExtra(list) {
  if (!Array.isArray(list)) return false;
  const exists = list.some(function (item) {
    return normalizeExtraGroupName(item.group) === 'Gavetas' &&
      comparableText(item.item || item.name || item.label || item.reference) === 'BOX CAP';
  });
  if (exists) return false;
  list.push(clone(drawerBoxCapMainExtra));
  return true;
}

function normalizeKnownDrawerData() {
  if (!state.catalog) return;
  state.catalog.drawerComponents = (state.catalog.drawerComponents || []).filter(function (item) {
    return !isMistakenDrawerBoxCapComponent(item) && !isDuplicateDrawer760HComponent(item);
  });
  ensureBoxCapMainExtra(state.catalog.extras || (state.catalog.extras = []));
}

function dedupeSupplierItems(type, items) {
  if (!Array.isArray(items)) return items || [];
  const seen = new Map();
  return items.filter(function (item) {
    if (type === 'drawerComponents' || type === 'extras') normalizeKnownDrawerComponentName(item);
    if (type === 'hinges' && isBadHingeSummary(item)) return false;
    const cleanedName = cleanDuplicatedSupplierName(item?.name || item?.item || item?.label, item?.reference);
    if (cleanedName) {
      if (item.name) item.name = cleanedName;
      if (item.item && comparableText(item.item) !== comparableText(item.reference)) item.item = cleanedName;
      if (item.label && comparableText(item.label) !== comparableText(item.reference)) item.label = cleanedName;
    }
    const key = supplierRemovalKey(type, item);
    if (!key) return true;
    const existing = seen.get(key);
    if (existing) {
      Object.assign(existing, clone(item));
      return false;
    }
    seen.set(key, item);
    return true;
  });
}

function dedupeSupplierStores() {
  state.supplierPrices = dedupeSupplierItems('plates', state.supplierPrices);
  if (!state.catalog) return;
  state.catalog.plates = dedupeSupplierItems('plates', state.catalog.plates);
  state.catalog.paintings = dedupeSupplierItems('paintings', state.catalog.paintings);
  state.catalog.paintingComponents = dedupeSupplierItems('paintingComponents', state.catalog.paintingComponents);
  state.catalog.edges = dedupeSupplierItems('edges', state.catalog.edges);
  state.catalog.doorSystems = dedupeSupplierItems('doorSystems', state.catalog.doorSystems);
  state.catalog.openingSystemComponents = dedupeSupplierItems('openingSystemComponents', state.catalog.openingSystemComponents);
  state.catalog.hinges = dedupeSupplierItems('hinges', state.catalog.hinges);
  state.catalog.hingeComponents = dedupeSupplierItems('hingeComponents', state.catalog.hingeComponents);
  state.catalog.drawerComponents = dedupeSupplierItems('drawerComponents', state.catalog.drawerComponents);
  state.catalog.extras = dedupeSupplierItems('extras', state.catalog.extras);
  normalizeKnownDrawerData();
}

function normalizeExtraGroupName(group) {
  const original = cleanDisplayText(group).replace(/\s+/g, ' ').trim();
  const text = comparableText(original);
  if (!text) return '';
  if (text === comparableText(legacyDoorSystemExtraGroup) || text === comparableText(doorSystemExtraGroup)) return doorSystemExtraGroup;
  if (text === comparableText(wardrobeDrawerGroup)) return wardrobeDrawerGroup;
  if (text === comparableText(otherExtraGroup)) return otherExtraGroup;
  if (text === comparableText(transportExtraGroup) || (text.includes('TRANSPORTE') && text.includes('EMBAL'))) return transportExtraGroup;
  if (text.includes('ACESS') && text.includes('COZINHA')) return 'Acessórios Cozinha';
  if (text.includes('ACESS') && text.includes('ROUPEIRO')) return 'Acessórios Roupeiro';
  if (text === 'RODAPES (METROS)' || text === 'RODAPES' || text.includes('RODAP')) return 'Rodapés (metros)';
  if (text === 'LEDS (METROS)' || text === "LED'S (METROS)" || text.includes('LED')) return "LED'S (metros)";
  if (text === 'CESTOS DO LIXO') return 'Cestos do Lixo';
  if (text === 'PUXADORES') return 'Puxadores';
  if (text === 'TOMADAS') return 'Tomadas';
  if (text === 'GAVETAS') return 'Gavetas';
  if (text.includes('PES') && text.includes('FIXACAO') && text.includes('ORGANIZACAO')) return 'Pés, Fixação e Organização';
  return original;
}

function normalizeExtraGroupsState() {
  if (state.catalog?.extras) {
    state.catalog.extras.forEach(function (item) {
      item.group = normalizeExtraGroupName(item.group);
    });
  }
  if (!state.lists) return;
  const seen = new Set();
  state.lists.extraGroups = (state.lists.extraGroups || [])
    .concat((state.catalog?.extras || []).map(function (item) { return item.group; }))
    .concat([wardrobeDrawerGroup, transportExtraGroup])
    .map(normalizeExtraGroupName)
    .filter(Boolean)
    .filter(function (group) {
      const key = comparableText(group);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function ensureTransportExtras() {
  if (!state.catalog) state.catalog = {};
  if (!Array.isArray(state.catalog.extras)) state.catalog.extras = [];
  transportExtraItems.forEach(function (item) {
    const exists = state.catalog.extras.some(function (entry) {
      return normalizeExtraGroupName(entry.group) === transportExtraGroup && comparableText(entry.item) === comparableText(item);
    });
    if (!exists) {
      state.catalog.extras.push({
        group: transportExtraGroup,
        item,
        label: item,
        supplier: '',
        reference: '',
        supplierPrice: 0,
        cost: 0,
        client: 0,
        reseller: 0,
        manualPrice: true,
        systemManaged: true
      });
    }
  });
  addUniqueListItem('extraGroups', transportExtraGroup);
}

function isSupplierRemoved(type, item) {
  const store = supplierRemovalStore();
  return Array.isArray(store[type]) && store[type].includes(supplierRemovalKey(type, item));
}

function persistSupplierRemoval(type, item) {
  const store = supplierRemovalStore();
  if (!Array.isArray(store[type])) store[type] = [];
  const key = supplierRemovalKey(type, item);
  if (key && !store[type].includes(key)) store[type].push(key);
  localStorage.setItem(supplierRemovedKey, JSON.stringify(store));
}

function clearSupplierRemoval(type, item) {
  const store = supplierRemovalStore();
  const key = supplierRemovalKey(type, item);
  if (!key || !Array.isArray(store[type])) return;
  const next = store[type].filter(function (existing) { return existing !== key; });
  if (next.length === store[type].length) return;
  store[type] = next;
  localStorage.setItem(supplierRemovedKey, JSON.stringify(store));
}

function applySupplierRemovals() {
  state.supplierPrices = (state.supplierPrices || []).filter(function (item) { return !isSupplierRemoved('plates', item); });
  if (state.catalog?.plates) state.catalog.plates = state.catalog.plates.filter(function (item) { return !isSupplierRemoved('plates', item); });
  if (state.catalog?.paintings) state.catalog.paintings = state.catalog.paintings.filter(function (item) { return !isSupplierRemoved('paintings', item); });
  if (state.catalog?.paintingComponents) state.catalog.paintingComponents = state.catalog.paintingComponents.filter(function (item) { return !isSupplierRemoved('paintingComponents', item); });
  if (state.catalog?.edges) state.catalog.edges = state.catalog.edges.filter(function (item) { return !isSupplierRemoved('edges', item); });
  if (state.catalog?.doorSystems) state.catalog.doorSystems = state.catalog.doorSystems.filter(function (item) { return !isSupplierRemoved('doorSystems', item); });
  if (state.catalog?.openingSystemComponents) state.catalog.openingSystemComponents = state.catalog.openingSystemComponents.filter(function (item) { return !isSupplierRemoved('openingSystemComponents', item); });
  if (state.catalog?.hinges) state.catalog.hinges = state.catalog.hinges.filter(function (item) { return !isSupplierRemoved('hinges', item); });
  if (state.catalog?.hingeComponents) state.catalog.hingeComponents = state.catalog.hingeComponents.filter(function (item) { return !isSupplierRemoved('hingeComponents', item); });
  if (state.catalog?.drawerComponents) state.catalog.drawerComponents = state.catalog.drawerComponents.filter(function (item) { return !isSupplierRemoved('drawerComponents', item); });
  if (state.catalog?.extras) state.catalog.extras = state.catalog.extras.filter(function (item) { return !isSupplierRemoved('extras', item); });
  if (state.lists) {
    state.lists.sistemasPorta = (state.catalog?.doorSystems || []).map(function (item) { return item.name; });
    state.lists.dobradicas = (state.catalog?.hinges || []).map(function (item) { return item.name; });
    state.lists.orlas = (state.catalog?.edges || []).map(function (item) { return item.name; });
    state.lists.extraGroups = Array.from(new Set((state.catalog?.extras || []).map(function (item) { item.group = normalizeExtraGroupName(item.group); return item.group; }).filter(Boolean)));
    addUniqueListItem('extraGroups', otherExtraGroup);
    addUniqueListItem('extraGroups', doorSystemExtraGroup);
  }
}

function supplierListByType(type) {
  if (type === 'plates') return state.supplierPrices || [];
  if (type === 'paintings') return state.catalog.paintings || [];
  if (type === 'paintingComponents') return state.catalog.paintingComponents || [];
  if (type === 'edges') return state.catalog.edges || [];
  if (type === 'doorSystems') return state.catalog.doorSystems || [];
  if (type === 'openingSystemComponents') return state.catalog.openingSystemComponents || [];
  if (type === 'hinges') return state.catalog.hinges || [];
  if (type === 'hingeComponents') return state.catalog.hingeComponents || [];
  if (type === 'drawerComponents') return state.catalog.drawerComponents || [];
  if (type === 'extras') return state.catalog.extras || [];
  return [];
}

function deleteSupplierItem(type, index) {
  const list = supplierListByType(type);
  const item = list[Number(index)];
  if (!item) return;
  const label = item.name || item.item || item.label || 'este item';
  if (!window.confirm('Tens a certeza que pretendes eliminar "' + label + '" da lista?')) return;
  persistSupplierRemoval(type, item);
  if (type === 'plates') {
    persistSupplierRemoval('plates', item);
    state.supplierPrices = (state.supplierPrices || []).filter(function (candidate) {
      return supplierRemovalKey('plates', candidate) !== supplierRemovalKey('plates', item);
    });
    if (state.catalog?.plates) state.catalog.plates = state.catalog.plates.filter(function (candidate) {
      return supplierRemovalKey('plates', candidate) !== supplierRemovalKey('plates', item);
    });
  } else if (type === 'extras' && normalizeExtraGroupName(item.group) === doorSystemExtraGroup) {
    const system = (state.catalog.doorSystems || []).find(function (candidate) {
      return itemIdentity(candidate.name || candidate.item || candidate.label) === itemIdentity(item.item || item.name || item.label);
    });
    if (system) persistSupplierRemoval('doorSystems', system);
    list.splice(Number(index), 1);
    state.catalog.doorSystems = (state.catalog.doorSystems || []).filter(function (candidate) {
      return itemIdentity(candidate.name || candidate.item || candidate.label) !== itemIdentity(item.item || item.name || item.label);
    });
  } else {
    list.splice(Number(index), 1);
  }
  applySupplierRemovals();
  if (type === 'openingSystemComponents') recalculateSystemSummaries('doorSystems');
  if (type === 'hingeComponents') recalculateSystemSummaries('hinges');
  if (type === 'drawerComponents') recalculateDrawerExtras();
  if (type === 'extras' || type === 'doorSystems' || type === 'openingSystemComponents') syncDoorSystemExtras();
  renderSupplierPrices();
  calculate({ renderFinal: false }).catch(function (error) { sourceStatus.textContent = error.message; });
  sourceStatus.textContent = 'Item eliminado da lista';
}

function supplierDeleteButton(type, index) {
  return '<button class="supplier-delete-button" type="button" data-delete-supplier-type="' + attrEsc(type) + '" data-delete-supplier-index="' + attrEsc(index) + '" title="Eliminar">X</button>';
}

function syncDoorSystemExtras() {
  if (!state.catalog || !Array.isArray(state.catalog.extras)) return;
  cleanRejectedDoorSystems();
  state.catalog.extras = state.catalog.extras.filter(function (item) {
    return normalizeExtraGroupName(item.group) !== doorSystemExtraGroup && item.systemExtra !== true;
  });
  (state.catalog.doorSystems || []).forEach(function (system) {
    state.catalog.extras.push({
      group: doorSystemExtraGroup,
      item: system.name,
      label: system.name,
      supplier: system.supplier || '',
      reference: system.reference || '',
      supplierPrice: Number(system.supplierPrice) || 0,
      cost: Number(system.cost) || 0,
      client: Number(system.client) || 0,
      reseller: Number(system.reseller || system.client) || 0,
      baseSupplierPrice: Number(system.baseSupplierPrice) || 0,
      baseCost: Number(system.baseCost) || 0,
      baseClient: Number(system.baseClient) || 0,
      baseReseller: Number(system.baseReseller) || 0,
      manualSupplierPrice: system.manualSupplierPrice === true,
      manualClient: system.manualClient === true,
      manualReseller: system.manualReseller === true,
      userAdded: true,
      systemExtra: true
    });
  });
  addUniqueListItem('extraGroups', doorSystemExtraGroup);
}

function rejectedDoorSystemName(value) {
  return false;
}

function cleanRejectedDoorSystems() {
  if (!Array.isArray(state.catalog.doorSystems)) return;
  state.catalog.doorSystems = state.catalog.doorSystems.filter(function (item) {
    return !rejectedDoorSystemName(item.name);
  });
  state.lists.sistemasPorta = state.catalog.doorSystems.map(function (item) { return item.name; });
}

function upsertCatalogItem(list, item, nameField) {
  if (!Array.isArray(list) || !item) return;
  const field = nameField || 'name';
  const target = list.find(function (candidate) {
    return itemIdentity(candidate[field] || candidate.item || candidate.name) === itemIdentity(item[field] || item.item || item.name) &&
      comparableText(candidate.supplier) === comparableText(item.supplier);
  });
  if (target) {
    Object.assign(target, clone(item), { userAdded: target.userAdded || item.userAdded });
  } else {
    list.push(clone(item));
  }
}

function upsertDoorSystemItem(item) {
  if (!Array.isArray(state.catalog.doorSystems) || !item) return;
  const wanted = itemIdentity(item.name || item.item || item.label);
  const target = state.catalog.doorSystems.find(function (candidate) {
    return itemIdentity(candidate.name || candidate.item || candidate.label) === wanted;
  });
  if (target) {
    Object.assign(target, clone(item), { userAdded: target.userAdded || item.userAdded });
  } else {
    state.catalog.doorSystems.push(clone(item));
  }
}

function cleanupDoorSystemDuplicates() {
  if (!Array.isArray(state.catalog.doorSystems)) return;
  const seen = new Set();
  const cleaned = [];
  const customManualPrices = new Set();
  state.catalog.doorSystems.forEach(function (item) {
    normalizeKnownDoorSystem(item);
    const key = itemIdentity(item.name || item.item || item.label);
    if (!baseDoorSystemsByName.has(key) && Number(item.supplierPrice) > 0) {
      customManualPrices.add(supplierNumber(item.supplierPrice));
    }
  });
  state.catalog.doorSystems.forEach(function (item) {
    normalizeKnownDoorSystem(item);
    const key = itemIdentity(item.name || item.item || item.label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const base = baseDoorSystemsByName.get(key);
    if (base) {
      if (item.manualSupplierPrice && customManualPrices.has(supplierNumber(item.supplierPrice))) {
        cleaned.push(clone(base));
        return;
      }
      cleaned.push({ ...clone(base), ...clone(item), name: base.name, item: base.name, label: base.name });
      return;
    }
    normalizeOpeningSystemPricing(item, true);
    cleaned.push(item);
  });
  state.catalog.doorSystems = cleaned;
  state.lists.sistemasPorta = state.catalog.doorSystems.map(function (item) { return item.name; });
}

function itemExists(items, field, name, group) {
  const wanted = comparableText(name);
  return (items || []).some(function (item) {
    if (group !== undefined && normalizeExtraGroupName(item.group) !== normalizeExtraGroupName(group)) return false;
    return comparableText(item[field]) === wanted;
  });
}

function itemIdentity(value) {
  return comparableText(value)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(\d+)\s*MM\b/g, '$1MM')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function canonicalDoorSystemBase(value) {
  const text = comparableText(value);
  if ((text.includes('TIP ON') || text.includes('TIP-ON')) && (text.includes('PULSADOR') || text.includes('TIC TAC') || text.includes('P/PORTAS PRETO'))) {
    return {
      name: 'Tip-on (Pulsador Preto) / Tic-Tac',
      item: 'Tip-on (Pulsador Preto) / Tic-Tac',
      label: 'Tip-on (Pulsador Preto) / Tic-Tac',
      supplier: 'CASFERIM',
      reference: '1x TIP-ON P/PORTAS PRETO (CASFERIM)',
      supplierPrice: 2.25,
      cost: 4.54,
      client: 8,
      reseller: 8
    };
  }
  if (text.includes('AVENTOS HK TOP')) {
    return {
      name: 'Aventos HK Top (standard)',
      item: 'Aventos HK Top (standard)',
      label: 'Aventos HK Top (standard)',
      supplier: 'CASFERIM',
      reference: '1x AVENTOS HK TOP ACUMULADOR FORÇAS FR=1730-5200 (CASFERIM) 1x KIT CAPAS HK TOP CINZA CLARO (CASFERIM) 1x KIT FIXADOR PORTA P/AVENTOS (CASFERIM)',
      supplierPrice: 44.10,
      cost: 51.76,
      client: 95,
      reseller: 95
    };
  }
  if (text.includes('AVENTOS HL TOP')) {
    return {
      name: 'Aventos HL Top (elevador vertical)',
      item: 'Aventos HL Top (elevador vertical)',
      label: 'Aventos HL Top (elevador vertical)',
      supplier: 'LAGE & SA',
      reference: '1x ACUMULADOR AVENTOS HL TOP 22L25 390 X 580 (KIT) (LAGE & SÁ)',
      supplierPrice: 104.66,
      cost: 112.33,
      client: 235,
      reseller: 235
    };
  }
  if (text.includes('MICRO') && text.includes('ONDAS')) {
    return {
      name: 'Avento Porta Micro-ondas Kessebohmer',
      item: 'Avento Porta Micro-ondas Kessebohmer',
      label: 'Avento Porta Micro-ondas Kessebohmer',
      supplier: 'LAGE & SA',
      reference: '1x FERRAGEM MICRO-ONDAS KESSEBOHMER FREE SLIDE M060 (LAGE & SÁ)',
      supplierPrice: 78.65,
      cost: 88.23,
      client: 155,
      reseller: 155
    };
  }
  if (text.includes('AVENTOS HK XS') || text.includes('AVENTOS HK-XS')) {
    return {
      name: 'Aventos HK-XS',
      item: 'Aventos HK-XS',
      label: 'Aventos HK-XS',
      supplier: 'LAGE & SA',
      reference: '1x ACUMULADOR AVENTOS HK-XS 20K1501 (LAGE & SÁ) 1x FIXADOR FRONTAL AVENTOS HK-XS 20K4101 (LAGE & SÁ) 1x FIXADOR LATERAL AVENTOS HK-XS 20K5101 (LAGE & SÁ)',
      supplierPrice: 8.60,
      cost: 16.27,
      client: 50,
      reseller: 50
    };
  }
  if (text === 'NORMAL') {
    return {
      name: 'Normal',
      item: 'Normal',
      label: 'Normal',
      supplier: '',
      reference: 'Normal',
      supplierPrice: 0,
      cost: 0,
      client: 0,
      reseller: 0
    };
  }
  return null;
}

function plateReferenceIdentity(value) {
  return normalizePlateAliasText(value)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(\d+(?:[,.]\d+)?)\s*MM\b/g, function (_, size) {
      return size.replace(',', '.') + 'MM';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlateAliasText(value) {
  let text = comparableText(value)
    .replace(/\bDONAE\b/g, 'SONAE')
    .replace(/\bDO\s*-\s*/g, 'SONAE ');
  if ((text.includes('CINZA ESCURO') || text.includes('SONAE')) && /\bF167\b/.test(text)) {
    text = text.replace(/\bF167\b/g, 'L167');
  }
  return text;
}

function plateCodeThicknessKeyFromText(value) {
  const text = normalizePlateAliasText(value).replace(/\|/g, ' ');
  if (text.includes('LUNAWOOD') && /\b212\b/.test(text) && /\b3000\s*MM\b/.test(text)) return '212|3000';
  const thicknessMatch = text.match(/\b(\d+(?:[,.]\d+)?)\s*MM\b/) || text.match(/(?:^|\s|-)(\d+(?:[,.]\d+)?)\s*$/);
  if (!thicknessMatch) return '';
  const thickness = thicknessMatch[1].replace(',', '.');
  if (text.includes('CONTRAPLACADO') && text.includes('WBP')) return 'CONTRAPLACADO WBP|' + thickness;
  if (text.includes('MDF') && /HIDR[OI]FUG/.test(text)) return 'MDF HIDROFUGO|' + thickness;
  if (text.includes('MDF') && text.includes('STANDARD')) return 'MDF STANDARD|' + thickness;
  if (text.includes('B3768') && /\b16\s*MM\b|\b16\b/.test(text)) return 'B3768|16';
  if (text.includes('B3768') && /\b10\s*MM\b|\b10\b/.test(text)) return 'B3768|10';
  const knownCode = knownPlateCodeFromText(text);
  const codeMatch = text.match(/\b([A-Z]{1,4}\d{2,5}|\d{3,5})\b(?:\s+(ST\d+|SC|TL|BRI|GLOSS|FUN|FA|FH))?/);
  if (!codeMatch && !knownCode) return '';
  const rawCode = knownCode || (codeMatch[1] + (codeMatch[2] ? ' ' + codeMatch[2] : ''));
  const code = canonicalPlateCode(rawCode);
  if (/^\d+$/.test(code) && !officialPlateNames[code]) return '';
  if (code === 'RAL9003') return '';
  return code + '|' + thickness;
}

function canonicalPlateCode(code) {
  const normalized = comparableText(code);
  if (normalized === 'F067' || normalized.startsWith('F067 ')) return 'F067 SC';
  return code;
}

function plateCodeThicknessKey(item) {
  return plateCodeThicknessKeyFromText(item?.reference) ||
    plateCodeThicknessKeyFromText(item?.name) ||
    plateCodeThicknessKeyFromText([item?.name, item?.reference].join(' '));
}

const officialPlateNames = {
  G029: 'G029 POLYREY CINZA PRATA',
  G075: 'G075 POLYREY CINZA CENDRE',
  N005: 'N005 POLYREY PRETO',
  C182: 'C182 POLYREY CHEN ADRIEN',
  P001: 'P001 POLYREY CASTANHO PIERRE DE LUNE',
  '0080 FH': '0080 FH NEGRO',
  '0085 FH': '0085 FH BRANCO',
  C202: 'C202 POLYREY CHENE ZERMATT',
  'F6012 TL': 'F6012 TL SONAE BROWN TWIST',
  'B3768 SC': 'B3768 SC SONAE PRIME WHITE',
  'L167 TL': 'L167 TL SONAE CINZA ESCURO',
  'F755 TL': 'F755 TL SONAE AGADIR LINHO',
  'W1200 ST9': 'W1200 ST9 EGGER BRANCO PORCELANA',
  'H1384 ST40': 'H1384 ST40 EGGER CASTANHO CASELLA',
  'F067 SC': 'F067 SC SONAE CINZA ALUMINIO',
  'H1386 ST40': 'H1386 ST40 EGGER CARVALHO CASTANHO',
  'H3395 ST12': 'H3395 ST12 EGGER CARVALHO NATURAL',
  'U156 ST9': 'U156 ST9 EGGER BEGE ROSADO',
  'U999 ST7': 'U999 ST7 EGGER PRETO',
  'U705 ST9': 'U705 ST9 EGGER CINZA ANGORA',
  'H3368 ST9': 'H3368 ST9 EGGER CARVALHO NATURAL',
  'H1316 ST17': 'H1316 ST17 EGGER CARVALHO BOOKMATCH',
  'L166 SC': 'L166 SC SONAE CINZA CLARO',
  'W1000 ST9': 'W1000 ST9 EGGER BRANCO PREMIUM',
  'H3146 ST19': 'H3146 ST19 EGGER CARVALHO LORENZO',
  'B116 BRI': 'B116 BRI POLYREY BEGE NATUR',
  'U608 ST9': 'U608 ST9 EGGER VERDE OPALA',
  'L3031 SC': 'L3031 SC SONAE PRETO',
  'U702 ST9': 'U702 ST9 EGGER CINZA CAXEMIRA',
  'U999 ST19': 'U999 ST19 EGGER PRETO',
  'H1357 ST10': 'H1357 ST10 EGGER CARVALHO CINZA BEGE',
  'H1715 ST12': 'H1715 ST12 EGGER NOGUEIRA PARONA',
  'U750 ST9': 'U750 ST9 EGGER CINZA RATO',
  'U707 ST9': 'U707 ST9 EGGER SEDA CINZA',
  'M6341 FUN': 'M6341 FUN SONAE ITALIEN ECHO',
  'D091 GLOSS': 'D091 GLOSS BRANCO BRILHO',
  'H1714 ST19': 'H1714 ST19 EGGER NOGUEIRA LINCOLN',
  'U775 ST9': 'U775 ST9 EGGER CINZA BRUMA',
  F067: 'F067 SC SONAE CINZA ALUMINIO',
  F755: 'F755 TL SONAE AGADIR LINHO',
  L167: 'L167 TL SONAE CINZA ESCURO',
  B116: 'B116 BRI POLYREY BEGE NATUR',
  B3768: 'B3768 SC SONAE PRIME WHITE',
  L166: 'L166 SC SONAE CINZA CLARO',
  U999: 'U999 EGGER PRETO',
  W1200: 'W1200 ST9 EGGER BRANCO PORCELANA',
  H1384: 'H1384 ST40 EGGER CASTANHO CASELLA',
  H1386: 'H1386 ST40 EGGER CARVALHO CASTANHO',
  H3395: 'H3395 ST12 EGGER CARVALHO NATURAL',
  U156: 'U156 ST9 EGGER BEGE ROSADO',
  U705: 'U705 ST9 EGGER CINZA ANGORA',
  H3368: 'H3368 ST9 EGGER CARVALHO NATURAL',
  H1316: 'H1316 ST17 EGGER CARVALHO BOOKMATCH',
  W1000: 'W1000 ST9 EGGER BRANCO PREMIUM',
  H3146: 'H3146 ST19 EGGER CARVALHO LORENZO',
  U608: 'U608 ST9 EGGER VERDE OPALA',
  L3031: 'L3031 SC SONAE PRETO',
  U702: 'U702 ST9 EGGER CINZA CAXEMIRA',
  H1357: 'H1357 ST10 EGGER CARVALHO CINZA BEGE',
  H1715: 'H1715 ST12 EGGER NOGUEIRA PARONA',
  U750: 'U750 ST9 EGGER CINZA RATO',
  U707: 'U707 ST9 EGGER SEDA CINZA',
  M6341: 'M6341 FUN SONAE ITALIEN ECHO',
  D091: 'D091 GLOSS BRANCO BRILHO',
  H1714: 'H1714 ST19 EGGER NOGUEIRA LINCOLN',
  U775: 'U775 ST9 EGGER CINZA BRUMA',
  B030: 'B030 BRANCO',
  B117: 'B117 BRANCO ACETINADO',
  M2112: 'M2112 MADEIRAS',
  B070: 'B070 MEGEVE BRANCO',
  M100: 'M100 CASTANHO MOSCADO',
  P114: 'P114 CINZA',
  '0026 FH': '0026 FH CINZA',
  '0074 FH': '0074 FH CINZA',
  G003: 'G003 CINZA CLARO',
  1084: '1084 CINZA MEDIO',
  'CONTRAPLACADO WBP': 'Contraplacado WBP'
  ,
  'MDF HIDROFUGO': 'MDF Hidrófugo',
  'MDF STANDARD': 'MDF Cru Standard'
};

const officialPlateFullNames = {
  '212|3000': 'LUNAWOOD ST 212ºC TRIPLE SHAD - 3000mm (32*140)'
};

function knownPlateCodeFromText(text) {
  const normalized = comparableText(text);
  if (!knownPlateCodesCache) knownPlateCodesCache = Object.keys(officialPlateNames).sort(function (a, b) { return b.length - a.length; });
  return knownPlateCodesCache.find(function (code) {
    return new RegExp('(^|\\s|-)'+ escapeRegExp(comparableText(code)) + '(\\s|-|$)').test(normalized);
  }) || '';
}

function plateOfficialNameFromKey(key) {
  if (!key) return '';
  const parts = key.split('|');
  const code = parts[0];
  const baseCode = code.split(' ')[0];
  const officialName = officialPlateNames[code] || officialPlateNames[baseCode];
  return officialName ? officialName + ' - ' + parts[1] + 'mm' : '';
}

function plateGroupLabel(item) {
  const key = plateCodeThicknessKey(item);
  if (!key) return cleanMaterialName(item?.name || item?.reference || '');
  if (officialPlateFullNames[key]) return officialPlateFullNames[key];
  const officialName = plateOfficialNameFromKey(key);
  if (officialName) return officialName;
  const parts = key.split('|');
  const codeLabels = {
    F067: 'Cinza',
    B030: 'branco',
    F755: 'cinza linho agadir',
    B117: 'branco acetinado',
    M2112: 'madeiras',
    L167: 'cinza escuro',
    B116: 'bege natur',
    B070: 'MegÃ¨ve Branco',
    M100: 'castanho moscado',
    P114: 'Cinza',
    '0026': 'Cinza',
    G003: 'cinza claro',
    '1084': 'cinza medio'
  };
  const code = parts[0];
  const baseCode = code.split(' ')[0];
  const knownName = bestKnownPlateNameForKey(key);
  if (knownName) return knownName;
  return code + (codeLabels[baseCode] ? ' ' + codeLabels[baseCode] : '') + ' - ' + parts[1] + 'mm';
}

function canonicalPlateNameFromReference(value) {
  const key = plateCodeThicknessKeyFromText(value);
  if (!key) return cleanMaterialName(value);
  if (officialPlateFullNames[key]) return officialPlateFullNames[key];
  const officialName = plateOfficialNameFromKey(key);
  if (officialName) return officialName;
  const fromText = descriptivePlateNameFromText(value, key);
  if (fromText) return fromText;
  const knownName = bestKnownPlateNameForKey(key);
  if (knownName) return knownName;
  const parts = key.split('|');
  return parts[0] + ' - ' + parts[1] + 'mm';
}

function descriptivePlateNameFromText(value, key) {
  const text = cleanDisplayText(value).replace(/\s+/g, ' ').trim();
  if (!text || !key) return '';
  const parts = key.split('|');
  const code = parts[0];
  const thickness = parts[1];
  const baseCode = code.split(' ')[0];
  const codePattern = new RegExp('\\b' + escapeRegExp(baseCode) + '\\b', 'i');
  const match = text.match(codePattern);
  if (!match) return '';
  let name = text.slice(match.index).trim();
  name = name
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' - ')
    .replace(new RegExp('\\s*-?\\s*' + escapeRegExp(thickness) + '\\s*mm\\b.*$', 'i'), '')
    .replace(/\s*[-–—]\s*$/g, '')
    .trim();
  if (!name || comparableText(name) === comparableText(baseCode) || comparableText(name) === comparableText(code)) return '';
  if (!comparableText(name).includes(comparableText(baseCode))) return '';
  if (name.split(/\s+/).length < 3) return '';
  return name + ' - ' + thickness + 'mm';
}

function bestKnownPlateNameForKey(key) {
  if (!plateKnownNameCache) {
    plateKnownNameCache = new Map();
    const lists = (state.supplierPrices || []).concat(state.catalog?.plates || []);
    lists.forEach(function (item) {
      const itemKey = plateCodeThicknessKey(item);
      if (!itemKey) return;
      [item.name, item.reference].forEach(function (value) {
        const candidate = descriptivePlateNameFromText(value, itemKey);
        if (!candidate) return;
        const current = plateKnownNameCache.get(itemKey) || '';
        if (!current || candidate.length > current.length) plateKnownNameCache.set(itemKey, candidate);
      });
    });
  }
  return plateKnownNameCache.get(key) || '';
}

function normalizePlateItemName(item) {
  if (!item) return item;
  if (item.name) item.name = cleanMaterialName(String(item.name).replace(/\bDONAE\b/gi, 'SONAE').replace(/\bF167\b/gi, 'L167'));
  if (item.reference) item.reference = cleanMaterialName(String(item.reference).replace(/\bDONAE\b/gi, 'SONAE').replace(/\bF167\b/gi, 'L167').replace(/\bDO\s*-\s*/gi, 'SONAE '));
  const canonical = canonicalPlateNameFromReference([item.reference, item.name].filter(Boolean).join(' '));
  if (canonical) item.name = cleanMaterialName(canonical);
  if (item.reference) item.reference = cleanMaterialName(item.reference);
  return item;
}

function basePlateGroupKey(item) {
  return item && item.comparisonKey ? item.comparisonKey : itemIdentity(item?.name || item);
}

function duplicatePlateReferenceKeys() {
  if (plateDuplicateReferenceKeysCache) return plateDuplicateReferenceKeysCache;
  const refs = new Map();
  (state.catalog.plates || []).concat(state.supplierPrices || []).forEach(function (item) {
    const referenceKey = plateReferenceIdentity(item.reference);
    if (!referenceKey || referenceKey === '-' || referenceKey.length < 8) return;
    if (!refs.has(referenceKey)) refs.set(referenceKey, new Set());
    refs.get(referenceKey).add(basePlateGroupKey(item));
  });
  const duplicates = new Set();
  refs.forEach(function (groups, referenceKey) {
    if (groups.size > 1) duplicates.add(referenceKey);
  });
  plateDuplicateReferenceKeysCache = duplicates;
  return duplicates;
}

function plateGroupKey(item) {
  const codeThicknessKey = plateCodeThicknessKey(item);
  if (codeThicknessKey) {
    const parts = codeThicknessKey.split('|');
    const reference = parts[0].trim();
    const thickness = parts.slice(1).join('|');
    // Acabamentos como TL, SC, ST9, FH, etc. fazem parte da descrição
    // comercial, não da referência usada no comparador. Assim, por exemplo,
    // F755 e F755 TL de 10 mm ficam no mesmo grupo e mostram todos os
    // fornecedores disponíveis.
    const referenceMatch = reference.match(/^([A-Z]{1,4}\d{2,5}|\d{3,5})(?:\s+.+)?$/);
    const comparisonReference = referenceMatch ? referenceMatch[1] : reference;
    return 'CODE|' + comparisonReference + '|' + thickness;
  }
  const referenceKey = plateReferenceIdentity(item?.reference);
  if (referenceKey && duplicatePlateReferenceKeys().has(referenceKey)) return 'REF|' + referenceKey;
  return basePlateGroupKey(item);
}

function itemSupplierExists(items, field, name, supplier, group, type) {
  const wanted = itemIdentity(name);
  const wantedSupplier = comparableText(supplier);
  return (items || []).some(function (item) {
    if (type && isSupplierRemoved(type, item)) return false;
    if (group !== undefined && normalizeExtraGroupName(item.group) !== normalizeExtraGroupName(group)) return false;
    if (itemIdentity(item[field]) === wanted && comparableText(item.supplier) === wantedSupplier) return true;
    if ((normalizeExtraGroupName(group) === 'Gavetas' || normalizeExtraGroupName(item.group) === 'Gavetas') && isLegacyWardrobeBlumRunnerName(name)) {
      return [item[field], item.item, item.label, item.reference].some(isLegacyWardrobeBlumRunnerName) &&
        (wantedSupplier ? comparableText(item.supplier) === wantedSupplier : true);
    }
    return false;
  });
}

function plateOptionKey(item) {
  return [
    plateGroupKey(item),
    comparableText(item.supplier),
    comparableText(item.reference),
    supplierNumber(item.supplierPrice)
  ].join('|');
}

function plateMarketOptionKey(item) {
  return comparableText(item.supplier || '');
}

function plateBestOptionKey(item) {
  return [
    plateGroupKey(item),
    comparableText(item.supplier),
    plateReferenceIdentity(item.reference) || itemIdentity(item.reference || item.name),
    supplierNumber(item.supplierPrice)
  ].join('|');
}

function dedupePlateMarketEntries(entries) {
  const bestBySupplier = new Map();
  entries.forEach(function (entry) {
    const key = plateMarketOptionKey(entry.item);
    const current = bestBySupplier.get(key);
    const currentPrice = current ? Number(current.item.supplierPrice) || Infinity : Infinity;
    const entryPrice = Number(entry.item.supplierPrice) || Infinity;
    if (!current || entryPrice < currentPrice) bestBySupplier.set(key, entry);
  });
  return Array.from(bestBySupplier.values());
}

function dedupePlateOptions() {
  const seen = new Set();
  state.supplierPrices = (state.supplierPrices || []).filter(function (item) {
    const key = plateOptionKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const catalogSeen = new Set();
  state.catalog.plates = (state.catalog.plates || []).filter(function (item) {
    const key = plateOptionKey(item);
    if (catalogSeen.has(key)) return false;
    catalogSeen.add(key);
    return true;
  });
}

function warnDuplicateItem(name) {
  const message = 'O item "' + name + '" já existe.';
  sourceStatus.textContent = message;
  window.alert(message);
}

function applySupplierAdditions() {
  const store = supplierAdditionsStore();
  let cleanedStore = false;
  normalizeExtraGroupsState();
  if (Array.isArray(store.drawerComponents)) {
    store.drawerComponents.forEach(function (item) {
      if (normalizeKnownDrawerComponentName(item)) cleanedStore = true;
    });
    const nextDrawerComponents = store.drawerComponents.filter(function (item) {
      return !isMistakenDrawerBoxCapComponent(item);
    });
    cleanedStore = cleanedStore || nextDrawerComponents.length !== store.drawerComponents.length;
    store.drawerComponents = nextDrawerComponents;
    store.drawerComponents = dedupeSupplierItems('drawerComponents', store.drawerComponents);
  }
  if (Array.isArray(store.doorSystems)) {
    const nextDoorSystems = store.doorSystems.filter(function (item) {
      const key = itemIdentity(item.name || item.item || item.label);
      return !rejectedDoorSystemName(item.name) && !baseDoorSystemsByName.has(key);
    });
    cleanedStore = cleanedStore || nextDoorSystems.length !== store.doorSystems.length;
    store.doorSystems = nextDoorSystems;
  }
  if (Array.isArray(store.extras)) {
    store.extras.forEach(function (item) {
      if (normalizeKnownDrawerComponentName(item)) cleanedStore = true;
    });
    const nextExtras = store.extras.filter(function (item) {
      const key = itemIdentity(item.item || item.name || item.label);
      return !(normalizeExtraGroupName(item.group) === doorSystemExtraGroup && (rejectedDoorSystemName(item.item || item.name || item.label) || baseDoorSystemsByName.has(key)));
    });
    cleanedStore = cleanedStore || nextExtras.length !== store.extras.length;
    cleanedStore = ensureBoxCapMainExtra(nextExtras) || cleanedStore;
    store.extras = dedupeSupplierItems('extras', nextExtras);
    cleanedStore = cleanedStore || store.extras.length !== nextExtras.length;
  }
  if (Array.isArray(store.hinges)) {
    const nextHinges = store.hinges.filter(function (item) { return !isBadHingeSummary(item); });
    cleanedStore = cleanedStore || nextHinges.length !== store.hinges.length;
    store.hinges = dedupeSupplierItems('hinges', nextHinges);
  }
  if (cleanedStore) localStorage.setItem(supplierAdditionsKey, JSON.stringify(store));
  (store.plates || []).forEach(function (item) {
    item.userAdded = true;
    normalizePlateItemName(item);
    if (!itemSupplierExists(state.supplierPrices, 'name', item.name, item.supplier)) state.supplierPrices.push(clone(item));
    if (!itemSupplierExists(state.catalog.plates, 'name', item.name, item.supplier)) state.catalog.plates.push(clone(item));
    addUniqueListItem('interiores', item.name);
    addUniqueListItem('exteriores', item.name);
  });
  (store.paintings || []).forEach(function (item) {
    item.userAdded = true;
    if (itemExists(state.catalog.paintings, 'name', item.name)) return;
    state.catalog.paintings.push(clone(item));
    addUniqueListItem('pinturas', item.name);
  });
  (store.paintingComponents || []).forEach(function (item) {
    item.userAdded = true;
    if (itemSupplierExists(state.catalog.paintingComponents, 'item', item.item, item.supplier)) return;
    state.catalog.paintingComponents.push(clone(item));
  });
  (store.edges || []).forEach(function (item) {
    item.userAdded = true;
    if (itemSupplierExists(state.catalog.edges, 'name', item.name, item.supplier)) return;
    state.catalog.edges.push(clone(item));
    addUniqueListItem('orlas', item.name);
  });
  (store.doorSystems || []).forEach(function (item) {
    item.userAdded = true;
    normalizeOpeningSystemPricing(item, true);
    upsertDoorSystemItem(item);
    addUniqueListItem('sistemasPorta', item.name);
  });
  (store.hinges || []).forEach(function (item) {
    item.userAdded = true;
    if (itemSupplierExists(state.catalog.hinges, 'name', item.name, item.supplier)) return;
    state.catalog.hinges.push(clone(item));
    addUniqueListItem('dobradicas', item.name);
  });
  (store.extras || []).forEach(function (item) {
    item.userAdded = true;
    item.group = normalizeExtraGroupName(item.group);
    if (normalizeExtraGroupName(item.group) === doorSystemExtraGroup) {
      const system = {
        name: item.item || item.name || item.label,
        supplier: item.supplier || '',
        reference: item.reference || item.item || item.name || '',
        supplierPrice: Number(item.supplierPrice) || 0,
        cost: Number(item.cost) || 0,
        client: Number(item.client) || 0,
        reseller: Number(item.reseller || item.client) || 0,
        userAdded: true
      };
      normalizeOpeningSystemPricing(system, true);
      upsertDoorSystemItem(system);
      addUniqueListItem('sistemasPorta', system.name);
      return;
    }
    if (itemSupplierExists(state.catalog.extras, 'item', item.item, item.supplier, item.group)) return;
    state.catalog.extras.push(clone(item));
    addUniqueListItem('extraGroups', item.group);
  });
  normalizeExtraGroupsState();
  cleanRejectedDoorSystems();
  dedupeSupplierStores();
  dedupePlateOptions();
}

function findSupplierDraftTarget(list, item, nameField) {
  const draftIndex = Number(item.__dirtyIndex);
  if (Number.isInteger(draftIndex) && draftIndex >= 0 && list[draftIndex]) return list[draftIndex];
  const wantedName = comparableText(item[nameField] || item.name || item.item);
  const wantedSupplier = comparableText(item.supplier);
  const wantedReference = comparableText(item.reference);
  return list.find(function (candidate) {
    const sameName = comparableText(candidate[nameField] || candidate.name || candidate.item) === wantedName;
    const sameSupplier = !wantedSupplier || comparableText(candidate.supplier) === wantedSupplier;
    const sameReference = !wantedReference || comparableText(candidate.reference) === wantedReference;
    return sameName && sameSupplier && sameReference;
  });
}

function mergeSupplierDraftList(list, items, nameField) {
  if (!Array.isArray(list) || !Array.isArray(items)) return;
  items.forEach(function (item) {
    const copy = clone(item);
    normalizeKnownDrawerComponentName(copy);
    if (nameField === 'name') normalizePlateItemName(copy);
    const target = findSupplierDraftTarget(list, copy, nameField);
    if (target) {
      Object.assign(target, copy);
    } else {
      list.push(copy);
    }
  });
}

function applySupplierDraftChanges() {
  const draft = supplierDraftStore();
  (draft.extras || []).forEach(function (item) { item.group = normalizeExtraGroupName(item.group); });
  if (Array.isArray(draft.hinges)) {
    draft.hinges = dedupeSupplierItems('hinges', draft.hinges);
  }
  mergeSupplierDraftList(state.supplierPrices, draft.plates, 'name');
  mergeSupplierDraftList(state.catalog.plates, draft.plates, 'name');
  mergeSupplierDraftList(state.catalog.paintings, draft.paintings, 'name');
  mergeSupplierDraftList(state.catalog.paintingComponents, draft.paintingComponents, 'item');
  mergeSupplierDraftList(state.catalog.edges, draft.edges, 'name');
  mergeSupplierDraftList(state.catalog.extras, draft.extras, 'item');
  mergeSupplierDraftList(state.catalog.drawerComponents, draft.drawerComponents, 'item');
  mergeSupplierDraftList(state.catalog.hinges, draft.hinges, 'name');
  mergeSupplierDraftList(state.catalog.hingeComponents, draft.hingeComponents, 'item');
  (draft.hinges || []).forEach(function (item) {
    addUniqueListItem('dobradicas', item.name || item.item || item.label);
  });
  (draft.paintings || []).forEach(function (item) {
    addUniqueListItem('pinturas', item.name || item.item || item.label);
  });
  mergeSupplierDraftList(state.catalog.openingSystemComponents, (draft.openingSystemComponents || []).filter(function (item) {
    return !item.userAddedSummary && !rejectedDoorSystemName(item.item || item.name || item.label);
  }), 'item');
  (draft.openingSystemComponents || []).filter(function (item) {
    return item.userAddedSummary && !rejectedDoorSystemName(item.item || item.name || item.label);
  }).forEach(function (item) {
    const system = {
      name: item.name || item.item || item.label,
      item: item.name || item.item || item.label,
      label: item.name || item.item || item.label,
      supplier: item.supplier || '',
      reference: item.reference || item.name || item.item || '',
      supplierPrice: Number(item.supplierPrice) || 0,
      cost: Number(item.cost) || 0,
      client: Number(item.client) || 0,
      reseller: Number(item.reseller || item.client) || 0,
      manualSupplierPrice: item.manualSupplierPrice === true,
      manualClient: item.manualClient === true,
      manualReseller: item.manualReseller === true,
      userAdded: item.userAdded === true,
      userAddedSummary: true
    };
    normalizeOpeningSystemPricing(system, true);
    upsertDoorSystemItem(system);
  });
  (draft.extras || []).filter(function (item) {
    return normalizeExtraGroupName(item.group) === doorSystemExtraGroup && !rejectedDoorSystemName(item.item || item.name || item.label);
  }).forEach(function (item) {
    const system = {
      name: item.name || item.item || item.label,
      item: item.name || item.item || item.label,
      label: item.name || item.item || item.label,
      supplier: item.supplier || '',
      reference: item.reference || item.name || item.item || '',
      supplierPrice: Number(item.supplierPrice) || 0,
      cost: Number(item.cost) || 0,
      client: Number(item.client) || 0,
      reseller: Number(item.reseller || item.client) || 0,
      manualSupplierPrice: item.manualSupplierPrice === true,
      manualClient: item.manualClient === true,
      manualReseller: item.manualReseller === true,
      userAdded: item.userAdded === true
    };
    normalizeOpeningSystemPricing(system, true);
    upsertDoorSystemItem(system);
  });
  cleanRejectedDoorSystems();
  cleanupDoorSystemDuplicates();
  dedupeSupplierStores();
  if (restoreSupplierDirtyChanges()) markSupplierPricesDirty();
}

function applySupplierPayloadChanges(payload) {
  if (!payload || typeof payload !== 'object') return;
  (payload.extras || []).forEach(function (item) { item.group = normalizeExtraGroupName(item.group); });
  mergeSupplierDraftList(state.supplierPrices, payload.plates, 'name');
  mergeSupplierDraftList(state.catalog.plates, payload.plates, 'name');
  mergeSupplierDraftList(state.catalog.paintings, payload.paintings, 'name');
  mergeSupplierDraftList(state.catalog.paintingComponents, payload.paintingComponents, 'item');
  mergeSupplierDraftList(state.catalog.edges, payload.edges, 'name');
  mergeSupplierDraftList(state.catalog.extras, payload.extras, 'item');
  mergeSupplierDraftList(state.catalog.drawerComponents, payload.drawerComponents, 'item');
  mergeSupplierDraftList(state.catalog.hinges, payload.hinges, 'name');
  mergeSupplierDraftList(state.catalog.hingeComponents, payload.hingeComponents, 'item');
  mergeSupplierDraftList(state.catalog.openingSystemComponents, (payload.openingSystemComponents || []).filter(function (item) {
    return !item.userAddedSummary;
  }), 'item');
  mergeSupplierDraftList(state.catalog.doorSystems, (payload.openingSystemComponents || []).filter(function (item) {
    return item.userAddedSummary || item.name;
  }).map(function (item) {
    return {
      name: item.name || item.item || item.label,
      item: item.name || item.item || item.label,
      label: item.name || item.item || item.label,
      supplier: item.supplier || '',
      reference: item.reference || item.name || item.item || '',
      supplierPrice: Number(item.supplierPrice) || 0,
      cost: Number(item.cost) || 0,
      client: Number(item.client) || 0,
      reseller: Number(item.reseller || item.client) || 0,
      manualSupplierPrice: item.manualSupplierPrice === true,
      manualClient: item.manualClient === true,
      manualReseller: item.manualReseller === true,
      userAdded: item.userAdded === true,
      userAddedSummary: true
    };
  }), 'name');
  dedupeSupplierStores();
}

function normalizeAllPlateNames() {
  plateKnownNameCache = null;
  (state.supplierPrices || []).forEach(normalizePlateItemName);
  (state.catalog.plates || []).forEach(normalizePlateItemName);
  const names = bestPlateNames();
  if (names.length) {
    state.lists.interiores = names;
    state.lists.exteriores = names;
    (state.modules || []).forEach(function (module) {
      module.interior = canonicalModulePlateSelection(module.interior);
      module.exterior = canonicalModulePlateSelection(module.exterior);
    });
  }
  syncDoorSystemExtras();
}

function runSupplierRecalculation(needsPlateRefresh) {
  if (needsPlateRefresh) {
    normalizeAllPlateNames();
    refreshPlateComparatorBestRows();
  }
  renderModules();
  calculate({ renderFinal: false }).catch(function (error) { sourceStatus.textContent = error.message; });
}

function scheduleSupplierRecalculation(needsPlateRefresh) {
  supplierRecalculationNeedsPlateRefresh = supplierRecalculationNeedsPlateRefresh || !!needsPlateRefresh;
  if (supplierRecalculationTimer) clearTimeout(supplierRecalculationTimer);
  supplierRecalculationTimer = setTimeout(function () {
    const refreshPlates = supplierRecalculationNeedsPlateRefresh;
    supplierRecalculationTimer = null;
    supplierRecalculationNeedsPlateRefresh = false;
    runSupplierRecalculation(refreshPlates);
  }, 350);
}

function supplierItemsForTab(tab) {
  tab = normalizeExtraGroupName(tab) || tab;
  if (tab === 'Madeiras / Placas') return state.supplierPrices || [];
  if (tab === 'Pinturas') return (state.catalog.paintings || []).concat(state.catalog.paintingComponents || []);
  if (tab === 'Orlas') return state.catalog.edges || [];
  if (tab === 'Sistemas de abertura') return state.catalog.doorSystems || [];
  if (tab === doorSystemExtraGroup) return state.catalog.doorSystems || [];
  if (tab === 'Dobradicas / Ferragens') return state.catalog.hinges || [];
  return (state.catalog.extras || []).filter(function (item) { return normalizeExtraGroupName(item.group) === tab; });
}

function bestSupplierPriceGroups() {
  const groups = new Map();
  (state.supplierPrices || []).forEach(function (item) {
    const key = plateGroupKey(item);
    const current = groups.get(key);
    const currentPrice = current ? Number(current.supplierPrice) || Infinity : Infinity;
    const itemPrice = Number(item.supplierPrice) || Infinity;
    if (!current || itemPrice < currentPrice) groups.set(key, item);
  });
  return groups;
}

function bestSupplierPriceSummary() {
  return Array.from(bestSupplierPriceGroups().values());
}

function bestSupplierPrices() {
  return bestSupplierPriceSummary().map(function (item) {
    const normalized = normalizePlateItemName(clone(item));
    if (normalized.userAdded || normalized.paintable === undefined) normalized.paintable = true;
    return normalized;
  });
}

function bestPlateNames() {
  const seen = new Set();
  return bestSupplierPrices()
    .map(function (item) { return item.name; })
    .filter(function (name) {
      const key = comparableText(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(function (a, b) { return a.localeCompare(b, 'pt-PT', { numeric: true, sensitivity: 'base' }); });
}

function canonicalModulePlateSelection(value) {
  const currentKey = plateCodeThicknessKeyFromText(value);
  if (!currentKey) return value;
  const best = bestSupplierPrices().find(function (item) {
    return plateCodeThicknessKey(item) === currentKey;
  });
  return best ? best.name : canonicalPlateNameFromReference(value);
}

function averageMetric(items, getter, fallback) {
  const values = (items || []).map(getter).filter(function (value) { return Number.isFinite(value) && value > 0; });
  return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : fallback;
}

function roundSaleUp(value) {
  const number = Number(value) || 0;
  return number > 0 ? Math.ceil(number) : 0;
}

function roundSaleFields(item) {
  if (!item) return item;
  if ('client' in item) item.client = roundSaleUp(item.client);
  if ('reseller' in item) item.reseller = roundSaleUp(item.reseller ?? item.client);
  return item;
}

function normalizeCatalogSalePrices() {
  (state.supplierPrices || []).forEach(roundSaleFields);
  if (!state.catalog) return;
  [
    state.catalog.plates,
    state.catalog.paintings,
    state.catalog.doorSystems,
    state.catalog.hinges,
    state.catalog.extras
  ].forEach(function (items) {
    (items || []).forEach(roundSaleFields);
  });
}

function supplierPriceMarkupMultiplier(group) {
  const normalized = normalizeExtraGroupName(group);
  if (normalized === 'Acessórios Cozinha') return 1.8;
  if (normalized === otherExtraGroup) return 1.7;
  return null;
}

function pricingFromClosestExistingItem(tab, supplierPrice) {
  const price = num(supplierPrice);
  const candidates = supplierItemsForTab(tab)
    .filter(function (item) {
      return Number(item.supplierPrice) > 0 && Number(item.cost) > 0 && Number(item.client) > 0;
    })
    .sort(function (a, b) {
      return Math.abs((Number(a.supplierPrice) || 0) - price) - Math.abs((Number(b.supplierPrice) || 0) - price);
    });
  if (!candidates.length) return null;
  const closest = candidates[0];
  const closestSupplier = Number(closest.supplierPrice) || 0;
  const closestCost = Number(closest.cost) || closestSupplier;
  const labor = Math.max(0, closestCost - closestSupplier);
  const cost = price + labor;
  const clientRatio = closestCost ? (Number(closest.client) || 0) / closestCost : 1.7;
  const resellerRatio = closestCost ? (Number(closest.reseller || closest.client) || 0) / closestCost : clientRatio;
  return {
    supplierPrice: price,
    cost,
    client: roundSaleUp(cost * clientRatio),
    reseller: roundSaleUp(cost * resellerRatio)
  };
}

function newItemPricing(tab, supplierPrice, options) {
  const price = num(supplierPrice);
  options = options || {};
  if (tab === 'Madeiras / Placas') {
    const item = { supplierPrice: price };
    calculateSupplierRow(item);
    item.client = roundSaleUp(item.client);
    item.reseller = roundSaleUp(item.reseller);
    return item;
  }
  const markupMultiplier = supplierPriceMarkupMultiplier(tab);
  if (markupMultiplier) {
    const sale = roundSaleUp(price * markupMultiplier);
    return { supplierPrice: price, cost: price, client: sale, reseller: sale };
  }
  if (tab === 'Orlas') {
    const meters = Number(options.supplierMeters) || 1000;
    const materialPerMeter = meters ? price / meters : 0;
    const cost = materialPerMeter + 0.32;
    const sale = roundMeterPrice(cost * 3.5);
    return { supplierPrice: price, cost, client: sale, reseller: sale, materialPerMeter, supplierMeters: meters };
  }
  if (tab === 'Pinturas') {
    const items = supplierItemsForTab(tab);
    const cost = price * 1.08;
    const ratio = averageMetric(items, function (item) { return (Number(item.client) || 0) / (Number(item.cost) || 0); }, 2.5);
    const sale = roundSaleUp(cost * ratio);
    return { supplierPrice: price, cost, client: sale, reseller: sale };
  }
  if (tab === 'Sistemas de abertura' || tab === doorSystemExtraGroup) {
    const cost = openingSystemCostFromSupplier({}, price);
    const sale = roundSaleUp(cost * 1.7);
    return { supplierPrice: price, cost, client: sale, reseller: sale };
  }
  const closestPricing = pricingFromClosestExistingItem(tab, price);
  if (closestPricing) return closestPricing;
  const items = supplierItemsForTab(tab);
  const laborItems = items.filter(function (item) { return Number(item.supplierPrice) > 0; });
  const labor = averageMetric(laborItems, function (item) { return (Number(item.cost) || 0) - (Number(item.supplierPrice) || 0); }, 0);
  const ratio = averageMetric(items, function (item) { return (Number(item.client) || 0) / (Number(item.cost) || 0); }, 2.5);
  const cost = price + labor;
  const sale = roundSaleUp(cost * ratio);
  return { supplierPrice: price, cost, client: sale, reseller: sale };
}

function supplierNamesForTab(tab) {
  const names = new Map();
  supplierItemsForTab(tab).forEach(function (item) {
    const key = comparableText(item.supplier);
    if (!key) return;
    names.set(key, supplierDisplayName(names.get(key), item.supplier));
  });
  return Array.from(names.values()).sort(function (a, b) { return comparableText(a).localeCompare(comparableText(b)); });
}

function supplierComponentConfig(tab) {
  if (tab === 'Pinturas') {
    return {
      componentType: 'paintingComponents',
      principalType: 'paintings',
      principals: (state.catalog.paintings || []).filter(function (item) { return item.name !== 'Nenhuma'; }).map(function (item) { return item.name; })
    };
  }
  if (tab === 'Sistemas de abertura' || tab === doorSystemExtraGroup) {
    return {
      componentType: 'openingSystemComponents',
      principalType: 'doorSystems',
      principals: (state.catalog.doorSystems || []).map(function (item) { return item.name; })
    };
  }
  if (tab === 'Dobradicas / Ferragens') {
    return {
      componentType: 'hingeComponents',
      principalType: 'hinges',
      principals: (state.catalog.hinges || []).map(function (item) { return item.name; })
    };
  }
  if (tab === 'Gavetas') {
    return {
      componentType: 'drawerComponents',
      principalType: 'extras',
      principals: (state.catalog.extras || []).filter(function (item) { return normalizeExtraGroupName(item.group) === 'Gavetas'; }).map(function (item) { return item.item; })
    };
  }
  return null;
}

function supplierAddModeHtml(config) {
  if (!config) return '';
  return '<label><span>Tipo de item</span><select data-new-item-field="itemMode">' +
    '<option value="principal">Principal</option>' +
    '<option value="component">Componente</option>' +
  '</select></label>' +
  '<label data-component-parent-field hidden><span>Componente de</span><select data-new-item-field="componentParent">' +
    optionListWithBlank(config.principals || [], '') +
  '</select></label>';
}

function newItemMode() {
  return supplierPricesGrid.querySelector('[data-new-item-field="itemMode"]')?.value || 'principal';
}

function newItemParentName() {
  return String(supplierPricesGrid.querySelector('[data-new-item-field="componentParent"]')?.value || '').trim();
}

function updateSupplierAddModeFields() {
  const componentMode = newItemMode() === 'component';
  const hasComponentConfig = !!supplierComponentConfig(state.supplierTab);
  supplierPricesGrid.querySelectorAll('[data-component-parent-field]').forEach(function (field) {
    field.hidden = !componentMode;
    field.querySelectorAll('select, input').forEach(function (input) { input.disabled = !componentMode; });
  });
  supplierPricesGrid.querySelectorAll('[data-new-item-field="supplierPrice"]').forEach(function (input) {
    if (!hasComponentConfig) return;
    const blockPrincipalPrice = !componentMode;
    input.disabled = blockPrincipalPrice;
    input.classList.toggle('input-locked', blockPrincipalPrice);
    if (blockPrincipalPrice) input.value = '';
    const label = input.closest('label');
    if (label) label.classList.toggle('supplier-field-disabled', blockPrincipalPrice);
  });
  supplierPricesGrid.querySelectorAll('[data-new-item-client-preview], [data-new-item-reseller-preview]').forEach(function (element) {
    const previewBox = element.closest('.supplier-add-preview');
    if (previewBox) previewBox.hidden = false;
  });
  supplierPricesGrid.querySelectorAll('[data-paint-quantity-field]').forEach(function (field) {
    field.hidden = state.supplierTab === 'Pinturas' && !componentMode;
    field.querySelectorAll('input').forEach(function (input) { input.disabled = state.supplierTab === 'Pinturas' && !componentMode; });
  });
}

function supplierAddFormHtml() {
  const suppliers = supplierNamesForTab(state.supplierTab);
  const componentConfig = supplierComponentConfig(state.supplierTab);
  if (state.supplierTab === 'Madeiras / Placas') {
    return '<div class="supplier-add-row supplier-add-row-plate">' +
      '<label><span>Item / refer&ecirc;ncia</span><input data-new-item-field="name" name="silwood_item_reference" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Refer&ecirc;ncia da madeira"></label>' +
      '<label><span>Fornecedor</span><input data-new-item-field="supplier" name="silwood_supplier" autocomplete="new-password" autocapitalize="off" spellcheck="false" list="supplierNameOptions" placeholder="Escolher fornecedor"></label>' +
      '<datalist id="supplierNameOptions">' + suppliers.map(function (supplier) { return '<option value="' + esc(supplier) + '"></option>'; }).join('') + '</datalist>' +
      '<label><span>Tipo de pre&ccedil;o</span><select data-new-item-field="platePriceMode"><option value="m2">Valor por m&sup2;</option><option value="sheet">Valor da placa</option></select></label>' +
      '<label><span>Pre&ccedil;o fornecedor / m&sup2;</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="supplierPrice" placeholder="0,00"></label>' +
      '<label data-plate-sheet-field hidden><span>Largura placa (mm)</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="sheetWidth" placeholder="2500"></label>' +
      '<label data-plate-sheet-field hidden><span>Altura placa (mm)</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="sheetHeight" placeholder="1250"></label>' +
      '<label data-plate-sheet-field hidden><span>Pre&ccedil;o da placa</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="sheetPrice" placeholder="0,00"></label>' +
      '<div class="supplier-add-preview" data-plate-sheet-field hidden><span>Fornecedor / m&sup2;</span><strong data-new-item-sheet-preview>0,00 EUR</strong></div>' +
      '<div class="supplier-add-preview"><span>Pre&ccedil;o cliente</span><strong data-new-item-client-preview>0,00 EUR</strong></div>' +
      '<div class="supplier-add-preview"><span>Pre&ccedil;o revendedor</span><strong data-new-item-reseller-preview>0,00 EUR</strong></div>' +
      '<button type="button" data-add-supplier-item>Adicionar</button>' +
    '</div>';
  }
  if (state.supplierTab === 'Pinturas') {
    return '<div class="supplier-add-row supplier-add-row-painting">' +
      supplierAddModeHtml(componentConfig) +
      '<label><span>Item</span><input data-new-item-field="name" name="silwood_paint_item" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Nome do item"></label>' +
      '<label><span>Fornecedor</span><input data-new-item-field="supplier" name="silwood_paint_supplier" autocomplete="new-password" autocapitalize="off" spellcheck="false" list="supplierNameOptions" placeholder="Escolher fornecedor"></label>' +
      '<datalist id="supplierNameOptions">' + suppliers.map(function (supplier) { return '<option value="' + esc(supplier) + '"></option>'; }).join('') + '</datalist>' +
      '<label><span>Refer&ecirc;ncia</span><input data-new-item-field="reference" name="silwood_paint_reference" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Nome / refer&ecirc;ncia do componente"></label>' +
      '<label data-paint-quantity-field><span>Qtd. comprada (L)</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="quantity" placeholder="0"></label>' +
      '<label><span>Pre&ccedil;o fornecedor</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="supplierPrice" placeholder="0,00"></label>' +
      '<strong data-new-item-client-preview hidden>0,00 EUR</strong>' +
      '<strong data-new-item-reseller-preview hidden>0,00 EUR</strong>' +
      '<button type="button" data-add-supplier-item>Adicionar</button>' +
    '</div>';
  }
  if (state.supplierTab === 'Orlas') {
    return '<div class="supplier-add-row supplier-add-row-edge">' +
      '<label><span>Item</span><input data-new-item-field="name" name="silwood_edge_item" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Nome da orla"></label>' +
      '<label><span>Fornecedor</span><input data-new-item-field="supplier" name="silwood_edge_supplier" autocomplete="new-password" autocapitalize="off" spellcheck="false" list="supplierNameOptions" placeholder="Escolher fornecedor"></label>' +
      '<datalist id="supplierNameOptions">' + suppliers.map(function (supplier) { return '<option value="' + esc(supplier) + '"></option>'; }).join('') + '</datalist>' +
      '<label><span>Pre&ccedil;o fornecedor / rolo</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="supplierPrice" placeholder="0,00"></label>' +
      '<label><span>Metros comprados</span><input type="text" inputmode="decimal" autocomplete="off" data-new-item-field="supplierMeters" placeholder="1000"></label>' +
      '<div class="supplier-add-preview"><span>Custo / ml</span><strong data-new-item-cost-preview>0,00 EUR/ml</strong></div>' +
      '<div class="supplier-add-preview"><span>Pre&ccedil;o cliente / ml</span><strong data-new-item-client-preview>0,00 EUR/ml</strong></div>' +
      '<button type="button" data-add-supplier-item>Adicionar</button>' +
    '</div>';
  }
  return '<div class="supplier-add-row">' +
    supplierAddModeHtml(componentConfig) +
    '<label><span>Item / referencia</span><input data-new-item-field="name" name="silwood_extra_item_reference" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Referencia do item"></label>' +
    '<label><span>Fornecedor</span><input data-new-item-field="supplier" name="silwood_extra_supplier" autocomplete="new-password" autocapitalize="off" spellcheck="false" list="supplierNameOptions" placeholder="Escolher fornecedor"></label>' +
    '<datalist id="supplierNameOptions">' + suppliers.map(function (supplier) { return '<option value="' + esc(supplier) + '"></option>'; }).join('') + '</datalist>' +
    '<label><span>Preco fornecedor</span><input type="number" min="0" step="0.001" autocomplete="off" data-new-item-field="supplierPrice" placeholder="0,00"></label>' +
    '<div class="supplier-add-preview"><span>Preco cliente</span><strong data-new-item-client-preview>0,00 EUR</strong></div>' +
    (state.supplierTab === otherExtraGroup ? '' : '<div class="supplier-add-preview"><span>Preco revendedor</span><strong data-new-item-reseller-preview>0,00 EUR</strong></div>') +
    '<button type="button" data-add-supplier-item>Adicionar</button>' +
  '</div>';
}

function refreshNewItemPreview() {
  const priceInput = supplierPricesGrid.querySelector('[data-new-item-field="supplierPrice"]');
  const costPreview = supplierPricesGrid.querySelector('[data-new-item-cost-preview]');
  const clientPreview = supplierPricesGrid.querySelector('[data-new-item-client-preview]');
  const resellerPreview = supplierPricesGrid.querySelector('[data-new-item-reseller-preview]');
  if (!clientPreview || !priceInput) return;
  updatePlateSheetFields();
  updateSupplierAddModeFields();
  if (supplierComponentConfig(state.supplierTab) && newItemMode() !== 'component') {
    if (costPreview) costPreview.textContent = money(0);
    clientPreview.textContent = money(0);
    if (resellerPreview) resellerPreview.textContent = money(0);
    return;
  }
  if (newItemMode() === 'component') {
    const componentPricing = newItemPricing(state.supplierTab, newSupplierPriceValue(), { supplierMeters: newSupplierMetersValue() });
    if (costPreview) costPreview.textContent = money(componentPricing.cost);
    clientPreview.textContent = money(componentPricing.client);
    if (resellerPreview) resellerPreview.textContent = money(componentPricing.reseller || componentPricing.client);
    return;
  }
  const sheetPreview = supplierPricesGrid.querySelector('[data-new-item-sheet-preview]');
  if (sheetPreview) sheetPreview.textContent = money(newSupplierPriceValue());
  if (state.supplierTab === 'Pinturas') {
    const quantityInput = supplierPricesGrid.querySelector('[data-new-item-field="quantity"]');
    const cost = num(priceInput.value) * 1.08;
    const quantity = num(quantityInput?.value || 0);
    clientPreview.textContent = money(cost);
    if (resellerPreview) resellerPreview.textContent = quantity ? money(cost / quantity) : money(0);
    return;
  }
  const pricing = newItemPricing(state.supplierTab, newSupplierPriceValue(), { supplierMeters: newSupplierMetersValue() });
  if (costPreview) costPreview.textContent = money(pricing.cost) + (state.supplierTab === 'Orlas' ? '/ml' : '');
  clientPreview.textContent = money(pricing.client) + (state.supplierTab === 'Orlas' ? '/ml' : '');
  if (resellerPreview) resellerPreview.textContent = money(pricing.reseller);
}

function findPrincipalForComponent(tab, parentName) {
  const wanted = comparableText(parentName);
  if (tab === 'Pinturas') return (state.catalog.paintings || []).find(function (item) { return comparableText(item.name) === wanted; });
  if (tab === 'Sistemas de abertura' || tab === doorSystemExtraGroup) return (state.catalog.doorSystems || []).find(function (item) { return comparableText(item.name) === wanted; });
  if (tab === 'Dobradicas / Ferragens') return (state.catalog.hinges || []).find(function (item) { return comparableText(item.name) === wanted; });
  if (tab === 'Gavetas') return (state.catalog.extras || []).find(function (item) { return normalizeExtraGroupName(item.group) === 'Gavetas' && comparableText(item.item) === wanted; });
  return null;
}

function appendComponentReference(parent, component) {
  if (!parent || !component) return;
  const line = '1x ' + (component.item || component.name || component.label) + (component.supplier ? ' (' + component.supplier + ')' : '');
  const current = String(parent.reference || '').trim();
  if (!current) {
    parent.reference = line;
    return;
  }
  if (!comparableText(current).includes(comparableText(component.item || component.name || component.label))) {
    parent.reference = current + '\n' + line;
  }
}

function addComponentToPrincipal(tab, parentName, component) {
  const parent = findPrincipalForComponent(tab, parentName);
  if (!parent) return;
  if (tab === 'Sistemas de abertura' || tab === doorSystemExtraGroup) {
    appendComponentReference(parent, component);
    recalculateSystemSummaries('doorSystems');
    syncDoorSystemExtras();
    return;
  }
  if (tab === 'Dobradicas / Ferragens') {
    appendComponentReference(parent, component);
    if (!Array.isArray(parent.recipeItems)) parent.recipeItems = [];
    if (!parent.recipeItems.some(function (item) { return comparableText(item) === comparableText(component.item); })) parent.recipeItems.push(component.item);
    recalculateSystemSummaries('hinges');
    return;
  }
  if (tab === 'Gavetas') {
    const recipe = ensureCustomDrawerRecipe(parent.item);
    if (!Array.isArray(recipe.components)) recipe.components = [];
    if (!recipe.components.some(function (entry) {
      return comparableText(entry.item) === comparableText(component.item) &&
        comparableText(entry.supplier) === comparableText(component.supplier);
    })) {
      recipe.components.push({ item: component.item, supplier: component.supplier, quantity: 1 });
    }
    component.usedIn = parent.item;
    recalculateDrawerExtras();
    return;
  }
  if (tab === 'Pinturas') {
    component.usedIn = parent.name;
    component.detail = (component.detail || '') + (parent.name ? ' / usado em: ' + parent.name : '');
  }
}

function newSupplierPriceValue() {
  if (state.supplierTab !== 'Madeiras / Placas') {
    return supplierPricesGrid.querySelector('[data-new-item-field="supplierPrice"]')?.value || 0;
  }
  const mode = supplierPricesGrid.querySelector('[data-new-item-field="platePriceMode"]')?.value || 'm2';
  if (mode !== 'sheet') return supplierPricesGrid.querySelector('[data-new-item-field="supplierPrice"]')?.value || 0;
  const width = num(supplierPricesGrid.querySelector('[data-new-item-field="sheetWidth"]')?.value || 0);
  const height = num(supplierPricesGrid.querySelector('[data-new-item-field="sheetHeight"]')?.value || 0);
  const sheetPrice = num(supplierPricesGrid.querySelector('[data-new-item-field="sheetPrice"]')?.value || 0);
  const areaM2 = (width * height) / 1000000;
  return areaM2 ? sheetPrice / areaM2 : 0;
}

function newSupplierMetersValue() {
  return num(supplierPricesGrid.querySelector('[data-new-item-field="supplierMeters"]')?.value || 0);
}

function updatePlateSheetFields() {
  if (state.supplierTab !== 'Madeiras / Placas') return;
  const mode = supplierPricesGrid.querySelector('[data-new-item-field="platePriceMode"]')?.value || 'm2';
  const sheetMode = mode === 'sheet';
  supplierPricesGrid.querySelectorAll('[data-plate-sheet-field]').forEach(function (field) {
    field.hidden = !sheetMode;
    field.querySelectorAll('input').forEach(function (input) { input.disabled = !sheetMode; });
  });
  const supplierPriceInput = supplierPricesGrid.querySelector('[data-new-item-field="supplierPrice"]');
  if (!supplierPriceInput) return;
  supplierPriceInput.closest('label').hidden = sheetMode;
  supplierPriceInput.disabled = sheetMode;
}

async function addSupplierItem() {
  const tab = state.supplierTab;
  const componentConfig = supplierComponentConfig(tab);
  const itemMode = componentConfig ? newItemMode() : 'principal';
  const parentName = itemMode === 'component' ? newItemParentName() : '';
  const nameInput = supplierPricesGrid.querySelector('[data-new-item-field="name"]');
  const supplierInput = supplierPricesGrid.querySelector('[data-new-item-field="supplier"]');
  const referenceInput = supplierPricesGrid.querySelector('[data-new-item-field="reference"]');
  const quantityInput = supplierPricesGrid.querySelector('[data-new-item-field="quantity"]');
  const priceInput = supplierPricesGrid.querySelector('[data-new-item-field="supplierPrice"]');
  const referenceValue = String(referenceInput?.value || '').trim();
  const name = String((tab === 'Pinturas' && itemMode === 'component' ? referenceValue : nameInput?.value) || '').trim();
  if (!name) return;
  const supplier = canonicalSupplierName(supplierInput?.value || '', tab);
  const pricing = newItemPricing(tab, newSupplierPriceValue(), { supplierMeters: newSupplierMetersValue() });
  const principalFromComponents = !!componentConfig && itemMode === 'principal';
  const supplierPrice = principalFromComponents ? 0 : pricing.supplierPrice;
  let cost = pricing.cost;
  let client = pricing.client;
  let reseller = pricing.reseller;
  if (principalFromComponents) {
    cost = 0;
    client = 0;
    reseller = 0;
  }
  const reference = referenceValue || name;
  if (tab === 'Sistemas de abertura' || tab === doorSystemExtraGroup) {
    if (principalFromComponents) {
      cost = 0;
      client = 0;
      reseller = 0;
    } else {
      cost = openingSystemCostFromSupplier({ reference, name, item: name, label: name }, supplierPrice);
      client = roundSaleUp(cost * 1.7);
      reseller = client;
    }
  }
  let addedPlate = null;
  let addedExtra = false;

  if (tab !== 'Pinturas' && !principalFromComponents && (!name || !supplier || !supplierPrice)) {
    sourceStatus.textContent = 'Preenche nome, fornecedor e preço fornecedor.';
    window.alert('Preenche nome, fornecedor e preço fornecedor.');
    return;
  }
  if (tab === 'Orlas' && !pricing.supplierMeters) {
    sourceStatus.textContent = 'Preenche os metros comprados.';
    window.alert('Preenche os metros comprados.');
    return;
  }

  if (itemMode === 'component' && componentConfig) {
    if (!parentName) {
      sourceStatus.textContent = 'Escolhe o item principal deste componente.';
      window.alert('Escolhe o item principal deste componente.');
      return;
    }
    if (!supplier || !supplierPrice) {
      sourceStatus.textContent = 'Preenche fornecedor e preço fornecedor.';
      window.alert('Preenche fornecedor e preço fornecedor.');
      return;
    }
    if (componentConfig.componentType === 'paintingComponents') {
      const quantity = num(quantityInput?.value || 0);
      if (!reference || !quantity) {
        sourceStatus.textContent = 'Preenche referência e quantidade.';
        window.alert('Preenche referência e quantidade.');
        return;
      }
      if (itemSupplierExists(state.catalog.paintingComponents, 'item', name, supplier, undefined, 'paintingComponents')) return warnDuplicateItem(name);
      const item = {
        group: 'Pinturas - componentes',
        item: name,
        supplier,
        reference,
        supplierPrice,
        cost: supplierPrice * 1.08,
        client: 0,
        detail: 'Qtd: ' + String(quantity).replace('.', ',') + 'L',
        usedIn: parentName,
        userAdded: true
      };
      addComponentToPrincipal(tab, parentName, item);
      clearSupplierRemoval('paintingComponents', item);
      state.catalog.paintingComponents.push(item);
      persistSupplierAddition('paintingComponents', item);
      trackSupplierChange('paintingComponents', item, name);
      recalculatePaintingServices();
    } else if (componentConfig.componentType === 'openingSystemComponents') {
      if (itemSupplierExists(state.catalog.openingSystemComponents, 'item', name, supplier, undefined, 'openingSystemComponents')) return warnDuplicateItem(name);
      const item = { group: 'Sistemas de abertura', item: name, label: name, supplier, reference, supplierPrice, cost: openingSystemCostFromSupplier({ reference, item: name, label: name }, supplierPrice), client: 0, usedIn: parentName, userAdded: true };
      clearSupplierRemoval('openingSystemComponents', item);
      state.catalog.openingSystemComponents.push(item);
      addComponentToPrincipal(tab, parentName, item);
      persistSupplierAddition('openingSystemComponents', item);
      trackSupplierChange('openingSystemComponents', item, name);
    } else if (componentConfig.componentType === 'hingeComponents') {
      if (itemSupplierExists(state.catalog.hingeComponents, 'item', name, supplier, undefined, 'hingeComponents')) return warnDuplicateItem(name);
      const item = { group: 'Dobradicas / Ferragens', item: name, label: name, supplier, reference, supplierPrice, cost: supplierPrice, client: 0, usedIn: parentName, userAdded: true };
      clearSupplierRemoval('hingeComponents', item);
      state.catalog.hingeComponents.push(item);
      addComponentToPrincipal(tab, parentName, item);
      persistSupplierAddition('hingeComponents', item);
      trackSupplierChange('hingeComponents', item, name);
    } else if (componentConfig.componentType === 'drawerComponents') {
      if (itemSupplierExists(state.catalog.drawerComponents, 'item', name, supplier, undefined, 'drawerComponents')) return warnDuplicateItem(name);
      const item = { group: 'Gavetas - componentes', family: parentName, item: name, label: name, supplier, reference, supplierPrice, cost: supplierPrice, client: 0, usedIn: parentName, userAdded: true };
      clearSupplierRemoval('drawerComponents', item);
      state.catalog.drawerComponents.push(item);
      addComponentToPrincipal(tab, parentName, item);
      persistSupplierAddition('drawerComponents', item);
      trackSupplierChange('drawerComponents', item, name);
    }
    renderSupplierPrices();
    renderModules();
    renderFinal();
    calculate({ renderFinal: false }).catch(function (error) { sourceStatus.textContent = error.message; });
    sourceStatus.textContent = 'Componente adicionado em ' + parentName + '.';
    return;
  }

  if (tab === 'Madeiras / Placas') {
    const item = normalizePlateItemName({ name, supplier, reference, supplierPrice, cost, client, reseller, paintable: true, userAdded: true });
    if ((state.supplierPrices || []).some(function (existing) { return plateOptionKey(existing) === plateOptionKey(item) && !isSupplierRemoved('plates', existing); })) return warnDuplicateItem(name);
    clearSupplierRemoval('plates', item);
    state.supplierPrices.push(item);
    state.catalog.plates.push(clone(item));
    normalizeAllPlateNames();
    persistSupplierAddition('plates', item);
    state.platePriceView = 'summary';
    addedPlate = item;
  } else if (tab === 'Pinturas') {
    if (itemSupplierExists(state.catalog.paintings, 'name', name, supplier, undefined, 'paintings')) return warnDuplicateItem(name);
    const item = { name, supplier, reference, supplierPrice, cost, client, reseller: client, userAdded: true };
    clearSupplierRemoval('paintings', item);
    state.catalog.paintings.push(item);
    addUniqueListItem('pinturas', name);
    persistSupplierAddition('paintings', item);
    trackSupplierChange('paintings', item, name);
  } else if (tab === 'Orlas') {
    if (itemSupplierExists(state.catalog.edges, 'name', name, supplier, undefined, 'edges')) return warnDuplicateItem(name);
    const item = { name, supplier, reference, supplierPrice, supplierMeters: pricing.supplierMeters, cost, client, reseller, materialPerMeter: pricing.materialPerMeter || supplierPrice / pricing.supplierMeters, userAdded: true };
    clearSupplierRemoval('edges', item);
    state.catalog.edges.push(item);
    addUniqueListItem('orlas', name);
    persistSupplierAddition('edges', item);
    trackSupplierChange('edges', item, name);
  } else if (tab === 'Sistemas de abertura' || tab === doorSystemExtraGroup) {
    if (itemSupplierExists(state.catalog.doorSystems, 'name', name, supplier, undefined, 'doorSystems')) return warnDuplicateItem(name);
    const item = { name, supplier, reference, supplierPrice, cost, client, reseller, manualSupplierPrice: true, userAdded: true };
    normalizeOpeningSystemPricing(item, true);
    item.client = roundSaleUp(item.client);
    item.reseller = roundSaleUp(item.reseller || item.client);
    clearSupplierRemoval('doorSystems', item);
    clearSupplierRemoval('openingSystemComponents', { item: name, label: name, supplier, reference });
    clearSupplierRemoval('extras', { group: doorSystemExtraGroup, item: name, label: name, supplier, reference });
    upsertDoorSystemItem(item);
    addUniqueListItem('sistemasPorta', name);
    persistSupplierAddition('doorSystems', item);
    trackSupplierChange('openingSystemComponents', { item: name, label: name, supplier, reference, supplierPrice: item.supplierPrice, cost: item.cost, client: item.client, reseller: item.reseller, userAdded: true, userAddedSummary: true }, name);
    persistSupplierDraftChanges();
    syncDoorSystemExtras();
  } else if (tab === 'Dobradicas / Ferragens') {
    if (itemSupplierExists(state.catalog.hinges, 'name', name, supplier, undefined, 'hinges')) return warnDuplicateItem(name);
    const item = { name, supplier, reference, supplierPrice, cost, client, reseller, userAdded: true };
    clearSupplierRemoval('hinges', item);
    state.catalog.hinges.push(item);
    addUniqueListItem('dobradicas', name);
    persistSupplierAddition('hinges', item);
    trackSupplierChange('hinges', item, name);
  } else {
    const group = normalizeExtraGroupName(tab);
    if (itemSupplierExists(state.catalog.extras, 'item', name, supplier, group, 'extras')) return warnDuplicateItem(name);
    const item = { group, item: name, label: name, supplier, reference, supplierPrice, cost, client, reseller, userAdded: true, createdAt: Date.now() };
    clearSupplierRemoval('extras', item);
    state.catalog.extras.push(item);
    addUniqueListItem('extraGroups', group);
    persistSupplierAddition('extras', item);
    trackSupplierChange('extras', item, name);
    state.supplierTab = group;
    addedExtra = true;
  }

  clearSupplierSearch();
  renderSupplierPrices();
  if (addedExtra) supplierPricesGrid.scrollTop = 0;
  if (false && saveButton) {
    const excel = data.excel || {};
    const total = Number(excel.updated || 0) + Number(excel.updatedPaint || 0) + Number(excel.updatedEdges || 0) +
      Number(excel.updatedDrawers || 0) + Number(excel.updatedSystems || 0) + Number(excel.updatedExtras || 0) +
      Number(excel.insertedPlates || 0) + Number(excel.insertedPlateSuppliers || 0) + Number(excel.updatedComparison || 0);
    sourceStatus.textContent = total ? 'Preços guardados no Excel' : 'Guardar terminado';
    saveButton.disabled = false;
    return;
  }
  renderModules();
  renderFinal();
  calculate({ renderFinal: false }).catch(function (error) { sourceStatus.textContent = error.message; });
  if (addedPlate) {
    sourceStatus.textContent = 'A guardar madeira no Excel...';
    try {
      await saveSupplierPlateToExcel(addedPlate);
      sourceStatus.textContent = 'Madeira adicionada e gravada no Excel.';
    } catch (error) {
      trackSupplierChange('plates', addedPlate, addedPlate.name);
      sourceStatus.textContent = 'Madeira adicionada na app, mas nao foi gravada no Excel: ' + error.message;
    }
    return;
  }
  sourceStatus.textContent = 'Item adicionado. Ainda não foi gravado no Excel.';
}

function readonlyPriceRow(search, name, supplier, reference, supplierPrice, cost, client, reseller, deleteType, deleteIndex) {
  if (arguments.length <= 5) {
    const oldCost = supplier;
    const oldClient = reference;
    const oldReseller = supplierPrice;
    const catalogs = [state.catalog.paintings, state.catalog.doorSystems, state.catalog.hinges, state.catalog.edges, state.catalog.extras, state.catalog.paintingComponents, state.catalog.paintingMixDetails, state.catalog.paintRecipes, state.catalog.drawerComponents].flat().filter(Boolean);
    const found = catalogs.find(function (item) { return item.name === name || item.item === name; }) || {};
    supplier = found.supplier || (String(found.reference || '').match(/\(([^()]+)\)\s*$/)?.[1] || '');
    reference = found.reference || found.item || '';
    supplierPrice = found.supplierPrice || found.cost || 0;
    cost = oldCost;
    client = oldClient;
    reseller = oldReseller;
  }
  return '<tr data-supplier-search="' + esc(String(search || '').toLowerCase()) + '">' +
    '<td>' + esc(name) + '</td>' +
    '<td>' + (supplier ? esc(supplier) : '') + '</td>' +
    '<td>' + (reference ? esc(reference) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td class="supplier-money">' + (supplierPrice ? money(supplierPrice) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td class="supplier-money">' + money(cost) + '</td>' +
    '<td class="supplier-money">' + supplierManualPriceInput(deleteType || 'readonly', deleteIndex ?? '', 'client', client) + '</td>' +
    '<td class="supplier-money">' + supplierManualPriceInput(deleteType || 'readonly', deleteIndex ?? '', 'reseller', reseller || client) + '</td>' +
    '<td>' + (deleteType ? supplierDeleteButton(deleteType, deleteIndex) : '') + '</td>' +
  '</tr>';
}

function supplierFromReference(reference) {
  return String(reference || '').match(/\(([^()]+)\)\s*$/)?.[1] || '';
}

function paintingPriceRow(item, index) {
  return '<tr data-supplier-search="' + esc(['pinturas servico', item.name, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc('Serviço - ' + item.name) + '</td>' +
    '<td>' + esc(item.supplier || 'Lage & SÃ¡') + '</td>' +
    '<td>' + (item.reference ? esc(item.reference) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td class="supplier-money" data-painting-client="' + index + '">' + supplierManualPriceInput('paintings', index, 'client', item.client) + '</td>' +
    '<td class="supplier-money" data-painting-cost="' + index + '">' + money(item.cost) + '</td>' +
    '<td>' + supplierDeleteButton('paintings', index) + '</td>' +
  '</tr>';
}

function paintingComponentLiters(item) {
  const match = String(item.detail || '').match(/Qtd:\s*([\d.,]+)/i);
  return match ? num(match[1]) : 0;
}

function paintingComponentRow(item, index) {
  const liters = paintingComponentLiters(item);
  const costPerLiter = liters ? (Number(item.cost) || 0) / liters : 0;
  return '<tr data-supplier-search="' + esc(['pinturas componentes', item.item, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc('Componente - ' + item.item) + '</td>' +
    '<td>' + (item.supplier ? esc(item.supplier) : '') + '</td>' +
    '<td>' + (item.reference ? esc(item.reference) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td>' + (liters ? esc(String(liters).replace('.', ',') + ' L') : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td><input type="text" inputmode="decimal" value="' + supplierNumber(item.supplierPrice) + '" data-component-type="paintingComponents" data-component-index="' + index + '" data-component-field="supplierPrice"></td>' +
    '<td class="supplier-money" data-component-cost="paintingComponents-' + index + '">' + money(item.cost) + '</td>' +
    '<td class="supplier-money" data-component-liter-cost="paintingComponents-' + index + '">' + money(costPerLiter) + '</td>' +
    '<td>' + supplierDeleteButton('paintingComponents', index) + '</td>' +
  '</tr>';
}

function editableComponentRow(type, index, search, name, supplier, reference, supplierPrice, cost) {
  return '<tr data-supplier-search="' + esc(String(search || '').toLowerCase()) + '">' +
    '<td>' + esc(name) + '</td>' +
    '<td>' + (supplier ? esc(supplier) : '') + '</td>' +
    '<td>' + (reference ? esc(reference) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td><input type="number" min="0" step="0.001" value="' + supplierNumber(supplierPrice) + '" data-component-type="' + esc(type) + '" data-component-index="' + index + '" data-component-field="supplierPrice"></td>' +
    '<td class="supplier-money" data-component-cost="' + esc(type) + '-' + index + '">' + money(cost) + '</td>' +
    '<td>' + supplierDeleteButton(type, index) + '</td>' +
  '</tr>';
}

function supplierRowClass(item) {
  return item?.userAdded ? ' class="supplier-user-row"' : '';
}

function supplierExtraSort(a, b) {
  const aUser = a.item?.userAdded ? 1 : 0;
  const bUser = b.item?.userAdded ? 1 : 0;
  if (aUser !== bUser) return bUser - aUser;
  const aTime = Number(a.item?.createdAt) || 0;
  const bTime = Number(b.item?.createdAt) || 0;
  if (aTime !== bTime) return bTime - aTime;
  return String(a.item?.item || '').localeCompare(String(b.item?.item || ''), 'pt-PT', { numeric: true, sensitivity: 'base' });
}

function editableExtraPriceRow(index, item) {
  const kitRecipe = ledKitRecipe(item);
  const isDrawerMainItem = normalizeExtraGroupName(item.group) === 'Gavetas';
  const reference = kitRecipe ? ledKitRecipeText(item) : (item.reference || item.label || item.item);
  const supplierInput = isDrawerMainItem
    ? '<span class="supplier-muted">-</span>'
    : kitRecipe
    ? '<input type="number" min="0" step="0.001" value="" disabled>'
    : '<input type="number" min="0" step="0.001" value="' + supplierNumber(item.supplierPrice) + '" data-extra-price-index="' + index + '">';
  return '<tr' + supplierRowClass(item) + ' data-supplier-search="' + esc([item.group, item.item, item.label, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc(item.item) + '</td>' +
    '<td>' + (item.supplier ? esc(item.supplier) : '') + '</td>' +
    '<td>' + esc(reference) + '</td>' +
    '<td>' + supplierInput + '</td>' +
    '<td class="supplier-money" data-extra-cost="' + index + '">' + money(item.cost) + '</td>' +
    '<td class="supplier-money" data-extra-client="' + index + '">' + supplierManualPriceInput('extras', index, 'client', item.client) + '</td>' +
    '<td class="supplier-money" data-extra-reseller="' + index + '">' + supplierManualPriceInput('extras', index, 'reseller', item.reseller || item.client) + '</td>' +
    '<td>' + supplierDeleteButton('extras', index) + '</td>' +
  '</tr>';
}

function editableDoorSystemExtraRow(index, item) {
  const supplierPriceCell = '<td><input type="number" min="0" step="0.01" value="' + supplierNumber(item.supplierPrice ?? item.cost) + '" data-extra-edit-index="' + index + '" data-extra-edit-field="supplierPrice"></td>';
  const supplier = item.supplier || supplierFromReference(item.reference);
  return '<tr' + supplierRowClass(item) + ' data-supplier-search="' + esc([item.group, item.item, item.label, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc(item.item) + '</td>' +
    '<td><input value="' + esc(supplier || '') + '" data-extra-edit-index="' + index + '" data-extra-edit-field="supplier"></td>' +
    '<td><input value="' + esc(item.reference || item.label || item.item || '') + '" data-extra-edit-index="' + index + '" data-extra-edit-field="reference"></td>' +
    supplierPriceCell +
    '<td class="supplier-money" data-extra-cost="' + index + '">' + money(item.cost) + '</td>' +
    '<td class="supplier-money" data-extra-client="' + index + '">' + supplierManualPriceInput('extras', index, 'client', item.client) + '</td>' +
    '<td class="supplier-money" data-extra-reseller="' + index + '">' + supplierManualPriceInput('extras', index, 'reseller', item.reseller || item.client) + '</td>' +
    '<td>' + supplierDeleteButton('extras', index) + '</td>' +
  '</tr>';
}

function extraSummaryRow(index, item) {
  const hideSupplierPrice = normalizeExtraGroupName(item.group) === 'Gavetas';
  return '<tr' + supplierRowClass(item) + ' data-supplier-search="' + esc([item.group, item.item, item.label, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc(item.item) + '</td>' +
    '<td>' + (item.supplier ? esc(item.supplier) : '') + '</td>' +
    '<td>' + (item.reference ? esc(item.reference) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td class="supplier-money">' + (hideSupplierPrice || !item.supplierPrice ? '<span class="supplier-muted">-</span>' : money(item.supplierPrice)) + '</td>' +
    '<td class="supplier-money" data-extra-cost="' + index + '">' + money(item.cost) + '</td>' +
    '<td class="supplier-money" data-extra-client="' + index + '">' + supplierManualPriceInput('extras', index, 'client', item.client) + '</td>' +
    '<td class="supplier-money" data-extra-reseller="' + index + '">' + supplierManualPriceInput('extras', index, 'reseller', item.reseller || item.client) + '</td>' +
    '<td>' + supplierDeleteButton('extras', index) + '</td>' +
  '</tr>';
}

function edgePriceRow(item, index) {
  const meters = Number(item.supplierMeters) || (Number(item.materialPerMeter) ? Number(item.supplierPrice) / Number(item.materialPerMeter) : 0);
  return '<tr data-supplier-search="' + esc(['orlas orlagem', item.name, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc(item.name) + '</td>' +
    '<td>' + (item.supplier ? esc(item.supplier) : '') + '</td>' +
    '<td><input type="text" inputmode="decimal" autocomplete="off" value="' + supplierNumber(item.supplierPrice) + '" data-component-type="edges" data-component-index="' + index + '" data-component-field="supplierPrice"></td>' +
    '<td><input type="text" inputmode="decimal" autocomplete="off" value="' + (meters ? supplierNumber(meters) : '') + '" data-component-type="edges" data-component-index="' + index + '" data-component-field="supplierMeters"></td>' +
    '<td class="supplier-money" data-component-cost="edges-' + index + '">' + money(item.cost) + '/ml</td>' +
    '<td class="supplier-money" data-edge-client="' + index + '">' + supplierManualPriceInput('edges', index, 'client', item.client) + '/ml</td>' +
    '<td>' + supplierDeleteButton('edges', index) + '</td>' +
  '</tr>';
}

function systemSummaryRow(kind, index, item) {
  const supplierPriceCell = '<td><input type="number" min="0" step="0.01" value="' + supplierNumber(item.supplierPrice ?? item.cost) + '" data-system-summary-kind="' + esc(kind) + '" data-system-summary-index="' + index + '" data-system-summary-field="supplierPrice"></td>';
  const supplier = item.supplier || (kind === 'doorSystems' ? supplierFromReference(item.reference) : '');
  return '<tr data-supplier-search="' + esc([kind, item.name, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc(item.name) + '</td>' +
    '<td><input value="' + esc(supplier || '') + '" data-system-summary-kind="' + esc(kind) + '" data-system-summary-index="' + index + '" data-system-summary-field="supplier"></td>' +
    '<td><input value="' + esc(item.reference || '') + '" data-system-summary-kind="' + esc(kind) + '" data-system-summary-index="' + index + '" data-system-summary-field="reference"></td>' +
    supplierPriceCell +
    '<td class="supplier-money" data-system-cost="' + esc(kind) + '-' + index + '">' + money(item.cost) + '</td>' +
    '<td class="supplier-money" data-system-client="' + esc(kind) + '-' + index + '">' + supplierManualPriceInput(kind, index, 'client', item.client) + '</td>' +
    '<td class="supplier-money" data-system-reseller="' + esc(kind) + '-' + index + '">' + supplierManualPriceInput(kind, index, 'reseller', item.reseller ?? item.client) + '</td>' +
    '<td>' + supplierDeleteButton(kind, index) + '</td>' +
  '</tr>';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referencedQuantity(reference, component) {
  const text = String(reference || '');
  if (!text.includes(component.item)) return 0;
  const pattern = new RegExp('(\\d+(?:[\\.,]\\d+)?)\\s*x\\s+' + escapeRegExp(component.item), 'i');
  const match = text.match(pattern);
  return match ? num(match[1]) : 1;
}

function systemRecipeTotals(summary, componentList) {
  const totals = { supplier: 0, cost: 0 };
  if (!summary?.reference) return totals;
  componentList.forEach(function (component) {
    const quantity = referencedQuantity(summary.reference, component);
    if (!quantity) return;
    totals.supplier += quantity * (Number(component.supplierPrice) || 0);
    totals.cost += quantity * (Number(component.cost) || 0);
  });
  return totals;
}

function applySystemSupplierTotal(summary) {
  const baseSupplier = Number(summary.baseSupplierPrice) || 0;
  const baseCost = Number(summary.baseCost) || 0;
  const labor = Math.max(0, baseCost - baseSupplier);
  summary.cost = (Number(summary.supplierPrice) || 0) + labor;
  applySummaryPricesFromCost(summary);
}

function comparableText(value) {
  return cleanDisplayText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function comparableItemText(value) {
  return comparableText(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findCatalogExtraForQuote(extra) {
  if (!extra || isOtherExtra(extra) || !String(extra.group || '').trim() || !String(extra.item || '').trim()) return null;
  const wantedGroup = normalizeExtraGroupName(extra.group);
  const wantedItem = comparableItemText(extra.item);
  return (state.catalog.extras || []).find(function (item) {
    if (normalizeExtraGroupName(item.group) !== wantedGroup) return false;
    const candidate = comparableItemText(item.item || item.label || item.name || item.reference);
    return candidate && wantedItem && (candidate === wantedItem || candidate.includes(wantedItem) || wantedItem.includes(candidate));
  }) || null;
}

function canonicalizeQuoteExtras() {
  (state.extras || []).forEach(function (extra) {
    const catalogItem = findCatalogExtraForQuote(extra);
    if (!catalogItem) return;
    extra.group = normalizeExtraGroupName(catalogItem.group);
    extra.item = catalogItem.item;
  });
}

function supplierDisplayName(existing, next) {
  const left = String(existing || '').trim();
  const right = String(next || '').trim();
  if (!left) return right;
  if (!right) return left;
  const leftAccentScore = left.length - left.normalize('NFD').replace(/[\u0300-\u036f]/g, '').length;
  const rightAccentScore = right.length - right.normalize('NFD').replace(/[\u0300-\u036f]/g, '').length;
  if (rightAccentScore > leftAccentScore) return right;
  if (rightAccentScore === leftAccentScore && right.length > left.length) return right;
  return left;
}

function canonicalSupplierName(value, tab) {
  const wanted = comparableText(value);
  if (!wanted) return '';
  const match = supplierItemsForTab(tab).find(function (item) {
    return comparableText(item.supplier) === wanted;
  });
  return match ? supplierDisplayName(value, match.supplier) : String(value || '').trim();
}

function componentByFragments(componentList, fragments, excludes) {
  return componentList.find(function (component) {
    const text = comparableText(component.item);
    const hasFragments = fragments.every(function (fragment) { return text.includes(comparableText(fragment)); });
    const hasExcludes = (excludes || []).some(function (fragment) { return text.includes(comparableText(fragment)); });
    return hasFragments && !hasExcludes;
  });
}

function hingeRecipeCost(name, componentList) {
  const base = componentByFragments(componentList, ['V500', 'BASE CRUZ']);
  const label = String(name || '').toUpperCase();
  let hinge = null;
  if (label.includes('STANDARD')) {
    hinge = componentByFragments(componentList, ['V250', 'C/ MOLA'], ['BLUMOTION']);
  } else if (label.includes('AMORTECIDA')) {
    hinge = componentByFragments(componentList, ['DOBRAD COPO 35 BLUM 110']);
  } else if (label.includes('LIVRE')) {
    hinge = componentByFragments(componentList, ['V50', 'S/ MOLA']);
  }
  return (hinge ? Number(hinge.cost) || 0 : 0) + (base ? Number(base.cost) || 0 : 0);
}

function summaryRecipeCost(summary, componentList) {
  if (!Array.isArray(summary.recipeItems) || !summary.recipeItems.length) return 0;
  return summary.recipeItems.reduce(function (total, itemName) {
    const wanted = comparableText(itemName);
    const component = componentList.find(function (candidate) {
      const candidateText = comparableText(candidate.item);
      return candidateText === wanted || candidateText.includes(wanted) || wanted.includes(candidateText);
    });
    if (!component) return total;
    const quantity = referencedQuantity(summary.reference, component) || referencedQuantity(summary.reference, { item: itemName }) || 1;
    return total + ((Number(component.cost) || 0) * quantity);
  }, 0);
}

function hingeExtraLinkedItems(name) {
  const label = comparableText(name);
  if (label.includes('AMORTECIDA')) return ['V250 DOBRADIÇA 110º RECTA C/ BLUMOTION'];
  return [];
}

function componentByComparableName(componentList, itemName) {
  const wanted = comparableText(itemName);
  return componentList.find(function (candidate) {
    const candidateText = comparableText(candidate.item);
    return candidateText === wanted || candidateText.includes(wanted) || wanted.includes(candidateText);
  });
}

function hingeExtraDelta(summary, componentList) {
  return hingeExtraLinkedItems(summary.name).reduce(function (total, itemName) {
    const component = componentByComparableName(componentList, itemName);
    if (!component) return total;
    const originalCost = component.baseCost === undefined ? Number(component.cost) || 0 : Number(component.baseCost) || 0;
    return total + ((Number(component.cost) || 0) - originalCost);
  }, 0);
}

function recalculateSystemSummaries(kind) {
  const summaryList = kind === 'hinges' ? (state.catalog.hinges || []) : (state.catalog.doorSystems || []);
  const componentList = kind === 'hinges' ? (state.catalog.hingeComponents || []) : (state.catalog.openingSystemComponents || []);
  summaryList.forEach(function (summary, index) {
    let recipeTotals = systemRecipeTotals(summary, componentList);
    if (kind === 'doorSystems') {
      normalizeKnownDoorSystem(summary);
      recipeTotals = systemRecipeTotals(summary, componentList);
      if (!summary.supplier && summary.reference) summary.supplier = supplierFromReference(summary.reference);
      if (!summary.manualSupplierPrice && recipeTotals.supplier) summary.supplierPrice = recipeTotals.supplier;
      if (Number(summary.supplierPrice) > 0) {
        const base = baseDoorSystemFor(summary);
        if (summary.baseSupplierPrice === undefined) summary.baseSupplierPrice = recipeTotals.supplier || Number(summary.supplierPrice) || 0;
        if (summary.baseCost === undefined) summary.baseCost = recipeTotals.cost || Number(base?.cost) || openingSystemCostFromSupplier(summary, summary.supplierPrice);
        if (summary.baseClient === undefined) summary.baseClient = Number(base?.client) || Number(summary.client) || 0;
        if (summary.baseReseller === undefined) summary.baseReseller = Number(base?.reseller ?? base?.client) || Number(summary.reseller ?? summary.client) || 0;
        const labor = Math.max(0, (Number(summary.baseCost) || 0) - (Number(summary.baseSupplierPrice) || 0));
        summary.cost = (Number(summary.supplierPrice) || 0) + labor;
        applyOpeningSystemSalePrices(summary);
        const supplierCell = supplierPricesGrid.querySelector('[data-system-supplier="' + kind + '-' + index + '"]');
        const costCell = supplierPricesGrid.querySelector('[data-system-cost="' + kind + '-' + index + '"]');
        const clientCell = supplierPricesGrid.querySelector('[data-system-client="' + kind + '-' + index + '"]');
        const resellerCell = supplierPricesGrid.querySelector('[data-system-reseller="' + kind + '-' + index + '"]');
        if (supplierCell) supplierCell.textContent = money(summary.supplierPrice);
        if (costCell) costCell.textContent = money(summary.cost);
        updateSupplierMoneyCell(clientCell, summary.client);
        updateSupplierMoneyCell(resellerCell, summary.reseller);
      }
      return;
    }
    let totalCost = 0;
    const hingeRecipe = kind === 'hinges'
      ? ((summaryRecipeCost(summary, componentList) || hingeRecipeCost(summary.name, componentList)) + hingeExtraDelta(summary, componentList))
      : 0;
    if (hingeRecipe) {
      totalCost = hingeRecipe;
    } else {
      if (!summary.reference) return;
      totalCost = systemRecipeTotals(summary, componentList).cost;
    }
    if (!totalCost) return;
    if (summary.baseSupplierPrice === undefined && recipeTotals.supplier) summary.baseSupplierPrice = recipeTotals.supplier;
    if (summary.baseCost === undefined) summary.baseCost = Number(summary.cost) || totalCost;
    if (summary.baseClient === undefined) summary.baseClient = Number(summary.client) || 0;
    if (summary.baseReseller === undefined) summary.baseReseller = Number(summary.reseller ?? summary.client) || 0;
    const clientRatio = summary.baseCost ? summary.baseClient / summary.baseCost : 0;
    const resellerRatio = summary.baseCost ? summary.baseReseller / summary.baseCost : 0;
    if (summary.manualSupplierPrice) {
      summary.cost = kind === 'doorSystems'
        ? openingSystemCostFromSupplier(summary, summary.supplierPrice)
        : (Number(summary.supplierPrice) || 0) + Math.max(0, (Number(summary.baseCost) || 0) - (Number(summary.baseSupplierPrice) || 0));
    } else {
      if (recipeTotals.supplier) summary.supplierPrice = recipeTotals.supplier;
      summary.cost = totalCost;
    }
    if (kind === 'doorSystems') {
      applyOpeningSystemSalePrices(summary);
    } else {
      applyAutomaticClientReseller(summary, summary.cost * clientRatio, summary.cost * resellerRatio);
    }
    const supplierCell = supplierPricesGrid.querySelector('[data-system-supplier="' + kind + '-' + index + '"]');
    const costCell = supplierPricesGrid.querySelector('[data-system-cost="' + kind + '-' + index + '"]');
    const clientCell = supplierPricesGrid.querySelector('[data-system-client="' + kind + '-' + index + '"]');
    const resellerCell = supplierPricesGrid.querySelector('[data-system-reseller="' + kind + '-' + index + '"]');
    if (supplierCell) supplierCell.textContent = money(summary.supplierPrice);
    if (costCell) costCell.textContent = money(summary.cost);
    updateSupplierMoneyCell(clientCell, summary.client);
    updateSupplierMoneyCell(resellerCell, summary.reseller);
  });
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; });
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce(function (sum, value) { return sum + value; }, 0) / numbers.length : 0;
}

function paintingCostPerLiter(rowNumber) {
  const item = (state.catalog.paintingComponents || [])[rowNumber - 18] || {};
  const litersMatch = String(item.detail || '').match(/Qtd:\s*([\d.,]+)/i);
  const liters = litersMatch ? num(litersMatch[1]) : 0;
  return liters ? (Number(item.cost) || 0) / liters : 0;
}

function paintingComponentBaseCostPerLiter(rowNumber) {
  const item = (state.catalog.paintingComponents || [])[rowNumber - 18] || {};
  const liters = paintingComponentLiters(item);
  return liters ? (Number(item.baseCost ?? item.cost) || 0) / liters : 0;
}

function ensurePaintingBaselines() {
  (state.catalog.paintingComponents || []).forEach(function (item) {
    if (item.baseSupplierPrice === undefined) item.baseSupplierPrice = Number(item.supplierPrice) || 0;
    if (item.baseCost === undefined) item.baseCost = Number(item.cost) || ((Number(item.supplierPrice) || 0) * 1.08);
  });
  (state.catalog.paintings || []).forEach(function (item) {
    if (item.baseCost === undefined) item.baseCost = Number(item.cost) || 0;
    if (item.baseClient === undefined) item.baseClient = Number(item.client) || 0;
  });
}

function addPaintingWeight(weights, rowNumber, coefficient) {
  weights[rowNumber] = (weights[rowNumber] || 0) + coefficient;
}

function addPaintingGroupWeight(weights, rows, coefficient) {
  const share = rows.length ? coefficient / rows.length : 0;
  rows.forEach(function (rowNumber) { addPaintingWeight(weights, rowNumber, share); });
}

function mixWeight(totalLiters, coats, litersInMix) {
  return totalLiters ? (litersInMix / totalLiters / 4) * coats : 0;
}

function paintingServiceWeights() {
  const groups = {
    h18: [44, 64],
    h20: [19, 21, 30, 32, 45, 47, 58, 65],
    h22: [46, 67],
    h28: [31],
    h30: [20, 23],
    h32: [25, 40],
    h36: [37, 52, 53, 55, 56, 63],
    h38: [18, 22, 28, 33, 34, 35, 36, 39, 70, 71, 72],
    h40: [42, 54, 57, 59, 69],
    h44: [24, 41, 62, 68, 61],
    h46: [27, 38, 43, 48, 73]
  };
  function w() { return {}; }
  function addR18(weights, factor) { addPaintingGroupWeight(weights, groups.h18, factor * mixWeight(37.5, 1, 25)); addPaintingGroupWeight(weights, groups.h20, factor * mixWeight(37.5, 1, 12.5)); }
  function addR19(weights, factor) { addPaintingGroupWeight(weights, groups.h22, factor * mixWeight(37.5, 1, 25)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(37.5, 1, 12.5)); }
  function addR20(weights, factor) { addPaintingGroupWeight(weights, groups.h22, factor * mixWeight(37.5, 1, 25) * 0.5); addPaintingWeight(weights, 29, factor * mixWeight(37.5, 1, 25) * 0.5); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(37.5, 1, 12.5)); }
  function addR21(weights, factor) { addPaintingWeight(weights, 29, factor * mixWeight(37.5, 1, 25)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(37.5, 1, 12.5)); }
  function addR22(weights, factor) { addPaintingGroupWeight(weights, groups.h28, factor * mixWeight(24, 1, 20)); addPaintingGroupWeight(weights, groups.h20, factor * mixWeight(24, 1, 4)); }
  function addR23(weights, factor) { addPaintingGroupWeight(weights, groups.h30, factor * mixWeight(22, 1, 20)); addPaintingGroupWeight(weights, groups.h20, factor * mixWeight(22, 1, 2)); }
  function addR24(weights, factor) { addPaintingGroupWeight(weights, groups.h32, factor * mixWeight(30, 2, 20)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(30, 2, 10)); }
  function addR25(weights, factor) { addPaintingWeight(weights, 66, factor * mixWeight(30, 2, 20)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(30, 2, 10)); }
  function addR26(weights, factor) { addPaintingGroupWeight(weights, groups.h36, factor * mixWeight(30, 2, 20)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(30, 2, 10)); }
  function addR27(weights, factor) { addPaintingGroupWeight(weights, groups.h38, factor * mixWeight(30, 2, 20)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(30, 2, 10)); }
  function addR28(weights, factor) { addPaintingGroupWeight(weights, groups.h40, factor * mixWeight(30, 2, 20)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(30, 2, 10)); }
  function addR29(weights, factor) { addPaintingWeight(weights, 57, factor * mixWeight(30, 2, 20)); addPaintingGroupWeight(weights, groups.h44, factor * mixWeight(30, 2, 10)); }
  function addR30(weights, factor) { addPaintingGroupWeight(weights, groups.h46, factor / 4); }
  const result = {};
  result[comparableText('Verniz Mate Poliretano')] = w(); addR18(result[comparableText('Verniz Mate Poliretano')], 2); addR19(result[comparableText('Verniz Mate Poliretano')], 1);
  result[comparableText('Verniz Poliretano Meio Brilhante')] = w(); addR18(result[comparableText('Verniz Poliretano Meio Brilhante')], 2); addR20(result[comparableText('Verniz Poliretano Meio Brilhante')], 1);
  result[comparableText('Verniz Poliretano Alto Brilhante')] = w(); addR18(result[comparableText('Verniz Poliretano Alto Brilhante')], 3); addR21(result[comparableText('Verniz Poliretano Alto Brilhante')], 2);
  result[comparableText('Verniz Natur / Acrilico')] = w(); addR23(result[comparableText('Verniz Natur / Acrilico')], 2);
  result[comparableText('Velaturas Claras c/ Afinação')] = w(); addR30(result[comparableText('Velaturas Claras c/ Afinação')], 1); addR22(result[comparableText('Velaturas Claras c/ Afinação')], 1); addR23(result[comparableText('Velaturas Claras c/ Afinação')], 1);
  result[comparableText('Velaturas Escuras c/ Afinação')] = w(); addR30(result[comparableText('Velaturas Escuras c/ Afinação')], 1); addR18(result[comparableText('Velaturas Escuras c/ Afinação')], 2); addR19(result[comparableText('Velaturas Escuras c/ Afinação')], 1 / 3); addR20(result[comparableText('Velaturas Escuras c/ Afinação')], 1 / 3); addR21(result[comparableText('Velaturas Escuras c/ Afinação')], 1 / 3);
  result[comparableText('Esmalte Mate Branco')] = w(); addR24(result[comparableText('Esmalte Mate Branco')], 1); addR26(result[comparableText('Esmalte Mate Branco')], 1);
  result[comparableText('Esmalte Mate Cores Claras com Afinação')] = w(); addR24(result[comparableText('Esmalte Mate Cores Claras com Afinação')], 1); addR27(result[comparableText('Esmalte Mate Cores Claras com Afinação')], 1);
  result[comparableText('Esmalte Mate Cores Escuras com Afinação')] = w(); addR25(result[comparableText('Esmalte Mate Cores Escuras com Afinação')], 1); addR28(result[comparableText('Esmalte Mate Cores Escuras com Afinação')], 1);
  result[comparableText('Esmalte Brilhante')] = w(); addR24(result[comparableText('Esmalte Brilhante')], 0.5); addR25(result[comparableText('Esmalte Brilhante')], 0.5); addR29(result[comparableText('Esmalte Brilhante')], 2);
  return result;
}

function recalculatePaintingServices() {
  ensurePaintingBaselines();
  const weightsByService = paintingServiceWeights();
  (state.catalog.paintings || []).forEach(function (item, index) {
    const weights = weightsByService[comparableText(item.name)];
    if (!weights) return;
    const serviceCost = Number(item.baseCost) + Object.keys(weights).reduce(function (sum, rowNumber) {
      return sum + weights[rowNumber] * (paintingCostPerLiter(Number(rowNumber)) - paintingComponentBaseCostPerLiter(Number(rowNumber)));
    }, 0);
    const clientRatio = item.baseCost ? item.baseClient / item.baseCost : 0;
    item.cost = serviceCost;
    automaticPrice(item, 'client', item.cost * clientRatio);
    const cell = supplierPricesGrid.querySelector('[data-painting-cost="' + index + '"]');
    const clientCell = supplierPricesGrid.querySelector('[data-painting-client="' + index + '"]');
    if (cell) cell.textContent = money(item.cost);
    updateSupplierMoneyCell(clientCell, item.client);
  });
}

function renderSupplierSection(title, rows) {
  if (title === 'Pinturas') {
    return '<section class="supplier-price-section">' +
      '<h3>' + esc(title) + '</h3>' +
      '<table class="supplier-table"><thead><tr>' +
      '<th>ITEM</th><th>FORNECEDOR</th><th>PRODUTOS / REFER&Ecirc;NCIA</th><th>PRE&Ccedil;O CLIENTE</th><th>CUSTO</th><th>A&Ccedil;&Atilde;O</th>' +
      '</tr></thead><tbody>' + rows + '<tr class="supplier-empty" hidden><td colspan="6">Sem resultados para esta pesquisa.</td></tr></tbody></table>' +
    '</section>';
  }
  if (title === 'Orlas') {
    return '<section class="supplier-price-section">' +
      '<h3>' + esc(title) + '</h3>' +
      '<table class="supplier-table"><thead><tr>' +
      '<th>ITEM</th><th>FORNECEDOR</th><th>PRE&Ccedil;O FORNECEDOR / ROLO</th><th>METROS COMPRADOS</th><th>CUSTO / ML</th><th>PRE&Ccedil;O CLIENTE / ML</th><th>A&Ccedil;&Atilde;O</th>' +
      '</tr></thead><tbody>' + rows + '<tr class="supplier-empty" hidden><td colspan="7">Sem resultados para esta pesquisa.</td></tr></tbody></table>' +
    '</section>';
  }
  if (title === otherExtraGroup) {
    return '<section class="supplier-price-section">' +
      '<h3>' + esc(title) + '</h3>' +
      '<table class="supplier-table"><thead><tr>' +
      '<th>ITEM</th><th>FORNECEDOR</th><th>REFER&Ecirc;NCIA</th><th>PRE&Ccedil;O FORNECEDOR</th>' +
      '<th>CUSTO</th><th>PRE&Ccedil;O CLIENTE</th><th>A&Ccedil;&Atilde;O</th>' +
      '</tr></thead><tbody>' + rows + '<tr class="supplier-empty" hidden><td colspan="7">Sem resultados para esta pesquisa.</td></tr></tbody></table>' +
    '</section>';
  }
  const priceTitle = title === 'Pinturas' ? 'PRE&Ccedil;O SERVI&Ccedil;O' : 'PRE&Ccedil;O FORNECEDOR';
  return '<section class="supplier-price-section">' +
    '<h3>' + esc(title) + '</h3>' +
    '<table class="supplier-table"><thead><tr>' +
    '<th>ITEM</th><th>FORNECEDOR</th><th>REFER&Ecirc;NCIA</th><th>' + priceTitle + '</th>' +
    '<th>CUSTO</th><th>PRE&Ccedil;O CLIENTE</th><th>PRE&Ccedil;O REVENDEDOR</th><th>A&Ccedil;&Atilde;O</th>' +
    '</tr></thead><tbody>' + rows + '<tr class="supplier-empty" hidden><td colspan="8">Sem resultados para esta pesquisa.</td></tr></tbody></table>' +
  '</section>';
}

function renderPaintingSupplierSection(serviceRows, componentRows) {
  return '<section class="supplier-price-section">' +
    '<h3>Pinturas</h3>' +
    '<h4 class="supplier-subtitle">Servi&ccedil;os de pintura</h4>' +
    '<table class="supplier-table supplier-table-paint-services"><thead><tr>' +
    '<th>ITEM</th><th>FORNECEDOR</th><th>PRODUTOS / REFER&Ecirc;NCIA</th><th>PRE&Ccedil;O CLIENTE</th><th>CUSTO SERVI&Ccedil;O / M&sup2;</th><th>A&Ccedil;&Atilde;O</th>' +
    '</tr></thead><tbody>' + serviceRows + '<tr class="supplier-empty" hidden><td colspan="6">Sem resultados para esta pesquisa.</td></tr></tbody></table>' +
    '<h4 class="supplier-subtitle">Componentes / pre&ccedil;o fornecedor</h4>' +
    '<table class="supplier-table supplier-table-paint-components"><thead><tr>' +
    '<th>ITEM</th><th>FORNECEDOR</th><th>REFER&Ecirc;NCIA</th><th>QTD COMPRADA</th><th>PRE&Ccedil;O FORNECEDOR</th><th>CUSTO + 8%</th><th>CUSTO / L</th><th>A&Ccedil;&Atilde;O</th>' +
    '</tr></thead><tbody>' + componentRows + '<tr class="supplier-empty" hidden><td colspan="8">Sem resultados para esta pesquisa.</td></tr></tbody></table>' +
  '</section>';
}

function plateSummaryRow(item) {
  return '<tr data-supplier-search="' + esc([item.name, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<td>' + esc(plateGroupLabel(item) || item.name) + '</td>' +
    '<td>' + esc(item.supplier || '') + '</td>' +
    '<td class="supplier-money">' + money(item.supplierPrice) + '</td>' +
    '<td class="supplier-money">' + supplierManualPriceInput('plates', state.supplierPrices.indexOf(item), 'client', item.client) + '</td>' +
    '<td class="supplier-money">' + supplierManualPriceInput('plates', state.supplierPrices.indexOf(item), 'reseller', item.reseller) + '</td>' +
  '</tr>';
}

function otherPriceRow(search, item, index) {
  return '<tr' + supplierRowClass(item) + ' data-supplier-search="' + esc(String(search || '').toLowerCase()) + '">' +
    '<td>' + esc(item.item || item.label || item.name || '') + '</td>' +
    '<td>' + (item.supplier ? esc(item.supplier) : '') + '</td>' +
    '<td>' + (item.reference ? esc(item.reference) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td class="supplier-money">' + (item.supplierPrice ? money(item.supplierPrice) : '<span class="supplier-muted">-</span>') + '</td>' +
    '<td class="supplier-money">' + money(item.cost) + '</td>' +
    '<td class="supplier-money" data-extra-client="' + index + '">' + supplierManualPriceInput('extras', index, 'client', item.client) + '</td>' +
    '<td>' + supplierDeleteButton('extras', index) + '</td>' +
  '</tr>';
}

function plateComparatorRow(item, index, bestKeys) {
  const best = bestKeys.has(plateBestOptionKey(item));
  return '<div class="plate-option-row ' + (best ? 'supplier-best-row' : '') + '" data-plate-key="' + esc(plateGroupKey(item)) + '" data-plate-option="' + esc(plateBestOptionKey(item)) + '" data-supplier-search="' + esc([item.name, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
    '<label class="plate-reference"><span>Referencia</span><input value="' + esc(item.reference || item.name) + '" data-supplier-index="' + index + '" data-supplier-field="reference"></label>' +
    '<label class="plate-supplier"><span>Fornecedor</span><input value="' + esc(item.supplier || '') + '" data-supplier-index="' + index + '" data-supplier-field="supplier"></label>' +
    '<label class="plate-price-input"><span>Preco fornecedor</span><input type="number" min="0" step="0.01" value="' + supplierNumber(item.supplierPrice) + '" data-supplier-index="' + index + '" data-supplier-field="supplierPrice"></label>' +
    '<div class="plate-cost"><span>Custo</span><strong data-supplier-cost="' + index + '">' + money(item.cost) + '</strong></div>' +
    '<button class="supplier-delete-button plate-delete-button" type="button" data-delete-supplier-type="plates" data-delete-supplier-index="' + attrEsc(index) + '" title="Eliminar">X</button>' +
  '</div>';
}

function plateComparatorGroupsHtml() {
  const bestByKey = bestSupplierPriceGroups();
  const bestKeys = new Set(Array.from(bestByKey.values()).map(function (best) {
    return plateBestOptionKey(best);
  }));
  const grouped = new Map();
  state.supplierPrices.forEach(function (item, index) {
    const key = plateGroupKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ item, index });
  });
  return Array.from(grouped.entries()).map(function ([key, entries]) {
    entries = dedupePlateMarketEntries(entries);
    entries.sort(function (a, b) { return (Number(a.item.supplierPrice) || Infinity) - (Number(b.item.supplierPrice) || Infinity); });
    const best = bestByKey.get(key) || entries[0].item;
    const search = entries.map(function (entry) {
      return [entry.item.name, entry.item.supplier, entry.item.reference].join(' ');
    }).join(' ').toLowerCase();
    const rows = entries.map(function (entry) {
      return plateComparatorRow(entry.item, entry.index, bestKeys);
    }).join('');
    return '<div class="plate-compare-group" data-supplier-search="' + esc(search) + '">' +
      '<div class="plate-compare-header">' +
        '<div><strong>' + esc(plateGroupLabel(best) || best.name) + '</strong><small>' + entries.length + ' ' + (entries.length === 1 ? 'opcao' : 'opcoes') + ' de mercado</small></div>' +
        '<span>Melhor: ' + esc(best.supplier || '') + ' - ' + money(best.supplierPrice) + '</span>' +
      '</div>' +
      '<div class="plate-options-list">' + rows + '</div>' +
    '</div>';
  }).join('') + '<div class="supplier-empty" hidden>Sem resultados para esta pesquisa.</div>';
}

function refreshPlateComparatorBestRows() {
  if (state.supplierTab !== 'Madeiras / Placas' || state.platePriceView !== 'compare') return;
  supplierPricesGrid.querySelectorAll('.plate-compare-group').forEach(function (group) {
    const rows = Array.from(group.querySelectorAll('.plate-option-row[data-plate-key]'));
    let firstBest = null;
    rows.forEach(function (row) {
      const priceInput = row.querySelector('[data-supplier-field="supplierPrice"]');
      const price = priceInput ? num(priceInput.value) : Infinity;
      if (!firstBest || price < firstBest.price) firstBest = { row, price };
    });
    rows.forEach(function (row) { row.classList.toggle('supplier-best-row', firstBest && row === firstBest.row); });
    if (!firstBest) return;
    const supplier = firstBest.row.querySelector('[data-supplier-field="supplier"]')?.value || '';
    const price = money(firstBest.price);
    const subtitle = group.querySelector('.plate-compare-header span');
    if (subtitle) subtitle.textContent = 'Melhor: ' + supplier + ' - ' + price;
  });
}

function renderPlatePriceSection() {
  const summaryActive = state.platePriceView !== 'compare';
  const viewButtons = '<div class="supplier-subtabs">' +
    '<button type="button" class="' + (summaryActive ? 'active' : '') + '" data-plate-price-view="summary">Melhor preco</button>' +
    '<button type="button" class="' + (!summaryActive ? 'active' : '') + '" data-plate-price-view="compare">Comparador de precos</button>' +
  '</div>';
  const rows = summaryActive
    ? bestSupplierPriceSummary().map(plateSummaryRow).join('')
    : plateComparatorGroupsHtml();
  if (!summaryActive) {
    return '<section class="supplier-price-section plate-compare-section">' +
      '<h3>Madeiras / Placas</h3>' +
      viewButtons +
      rows +
    '</section>';
  }
  return '<section class="supplier-price-section">' +
    '<h3>Madeiras / Placas</h3>' +
    viewButtons +
    '<table class="supplier-table"><thead><tr>' +
    '<th>ITEM</th><th>FORNECEDOR</th><th>PRECO FORNECEDOR</th><th>PRECO CLIENTE</th><th>PRECO REVENDEDOR</th>' +
    '</tr></thead><tbody>' + rows + '<tr class="supplier-empty" hidden><td colspan="5">Sem resultados para esta pesquisa.</td></tr></tbody></table>' +
  '</section>';
}

function isEditableExtraGroup(group) {
  const text = comparableText(group);
  return text.includes('PUXADORES') ||
    text.includes('RODAP') ||
    text.includes('ACESSORIOS COZINHA') ||
    text.includes('CESTOS DO LIXO') ||
    text.includes('LED') ||
    text.includes('TOMADAS') ||
    text.includes('PES') ||
    text.includes('FIXACAO') ||
    text.includes('ORGANIZACAO') ||
    text.includes('ACESSORIOS ROUPEIRO');
}

function ledKitRecipe(item) {
  const label = comparableText(item.label || item.item);
  if (!label.includes('KIT LED')) return null;
  const profile = label.includes('ALEN') ? 'Perfil LED Canto 22Âº Preto (Alen)' : 'Perfil LED Embutir AlumÃ­nio (Ares)';
  return [
    { label: profile, factor: 1 },
    { label: 'Difusor Fosco p/ Perfil (3MT)', factor: 1 / 3 },
    { label: 'Rolo Fita LED Luz Neutra (50MT)', factor: 1 }
  ];
}

function findExtraByLabel(group, label) {
  const wanted = comparableText(label);
  const normalizedGroup = normalizeExtraGroupName(group);
  return (state.catalog.extras || []).find(function (item) {
    return normalizeExtraGroupName(item.group) === normalizedGroup && comparableText(item.label || item.item) === wanted;
  });
}

function ledKitRecipeText(item) {
  const recipe = ledKitRecipe(item);
  if (!recipe) return item.reference || item.label || item.item;
  const group = item.group;
  const total = recipe.reduce(function (sum, part) {
    const component = findExtraByLabel(group, part.label);
    return sum + (component ? (Number(component.cost) || 0) * part.factor : 0);
  }, 0);
  return recipe.map(function (part) {
    const component = findExtraByLabel(group, part.label);
    const value = component ? (Number(component.cost) || 0) * part.factor : 0;
    const share = total ? Math.round((value / total) * 100) : 0;
    return part.label + ' (' + share + '%)';
  }).join(' + ');
}

function recalculateLedKits(group) {
  const normalizedGroup = normalizeExtraGroupName(group);
  (state.catalog.extras || []).forEach(function (item, index) {
    if (normalizeExtraGroupName(item.group) !== normalizedGroup) return;
    const recipe = ledKitRecipe(item);
    if (!recipe) return;
    if (item.baseCost === undefined) item.baseCost = Number(item.cost) || 0;
    if (item.baseClient === undefined) item.baseClient = Number(item.client) || 0;
    const ratio = item.baseCost ? item.baseClient / item.baseCost : 1;
    const totalCost = recipe.reduce(function (sum, part) {
      const component = findExtraByLabel(group, part.label);
      return sum + (component ? (Number(component.cost) || 0) * part.factor : 0);
    }, 0);
    if (!totalCost) return;
    item.cost = totalCost;
    applyAutomaticClientReseller(item, totalCost * ratio, totalCost * ratio);
    const costCell = supplierPricesGrid.querySelector('[data-extra-cost="' + index + '"]');
    const clientCell = supplierPricesGrid.querySelector('[data-extra-client="' + index + '"]');
    const resellerCell = supplierPricesGrid.querySelector('[data-extra-reseller="' + index + '"]');
    if (costCell) costCell.textContent = money(item.cost);
    updateSupplierMoneyCell(clientCell, item.client);
    updateSupplierMoneyCell(resellerCell, item.reseller || item.client);
  });
}

function drawerRecipeLabel(recipe) {
  if (recipe?.customLabel) return comparableText(recipe.customLabel);
  const type = comparableText(recipe.type);
  const family = comparableText(recipe.family);
  const kind = type.includes('GAVETAO') ? 'GAVETAO' : 'GAVETA';
  const place = type.includes('INTERIOR') ? 'INTERIOR' : 'EXTERIOR';
  let familyName = '';
  if (family.includes('ANTARO')) familyName = 'ANTARO';
  if (family.includes('MERIVOBOX')) familyName = 'MERIVOBOX';
  if (family.includes('LEGRABOX')) familyName = 'LEGRABOX';
  return [kind, familyName, place].join(' ');
}

function ensureCustomDrawerRecipe(parentName) {
  if (!state.catalog) state.catalog = {};
  if (!Array.isArray(state.catalog.drawerRecipes)) state.catalog.drawerRecipes = [];
  const wanted = comparableText(parentName);
  let recipe = state.catalog.drawerRecipes.find(function (candidate) {
    return drawerRecipeLabel(candidate) === wanted;
  });
  if (!recipe) {
    recipe = { family: parentName, type: parentName, customLabel: parentName, labor: 0, components: [], userAdded: true };
    state.catalog.drawerRecipes.push(recipe);
  }
  return recipe;
}

function ensureCustomDrawerRecipesFromComponents() {
  (state.catalog.drawerComponents || []).forEach(function (component) {
    const parentName = component.usedIn || component.family;
    if (!parentName) return;
    const parent = (state.catalog.extras || []).find(function (item) {
      return normalizeExtraGroupName(item.group) === 'Gavetas' &&
        comparableText(item.item) === comparableText(parentName);
    });
    if (!parent) return;
    const recipe = ensureCustomDrawerRecipe(parent.item);
    if (!Array.isArray(recipe.components)) recipe.components = [];
    if (recipe.components.some(function (entry) {
      return comparableText(entry.item) === comparableText(component.item) &&
        comparableText(entry.supplier) === comparableText(component.supplier);
    })) return;
    recipe.components.push({ item: component.item, supplier: component.supplier, quantity: 1 });
  });
}

function drawerComponentCost(recipeComponent) {
  const wantedItem = comparableText(recipeComponent.item);
  const wantedSupplier = comparableText(recipeComponent.supplier);
  const component = (state.catalog.drawerComponents || []).find(function (item) {
    return comparableText(item.item) === wantedItem && comparableText(item.supplier) === wantedSupplier;
  });
  return component ? Number(component.cost) || 0 : 0;
}

function uniqueDrawerRecipeComponents(components) {
  const seen = new Set();
  return (components || []).filter(function (component) {
    const key = [component.item, component.supplier].map(comparableText).join('|');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recalculateDrawerExtras() {
  ensureCustomDrawerRecipesFromComponents();
  (state.catalog.extras || []).forEach(function (item, index) {
    if (normalizeExtraGroupName(item.group) !== 'Gavetas') return;
    const itemName = comparableText(item.item);
    const recipe = (state.catalog.drawerRecipes || []).find(function (candidate) {
      return drawerRecipeLabel(candidate) === itemName;
    });
    if (!recipe) return;
    recipe.components = uniqueDrawerRecipeComponents(recipe.components);
    if (item.baseCost === undefined) item.baseCost = Number(item.cost) || 0;
    if (item.baseClient === undefined) item.baseClient = Number(item.client) || 0;
    const clientRatio = item.baseCost ? item.baseClient / item.baseCost : 1;
    const materialCost = (recipe.components || []).reduce(function (sum, component) {
      return sum + drawerComponentCost(component) * (Number(component.quantity) || 0);
    }, 0);
    const totalCost = materialCost + (Number(recipe.labor) || 0);
    if (!totalCost) return;
    item.cost = totalCost;
    automaticPrice(item, 'client', totalCost * clientRatio);
    automaticPrice(item, 'reseller', item.client);
    const costCell = supplierPricesGrid.querySelector('[data-extra-cost="' + index + '"]');
    const clientCell = supplierPricesGrid.querySelector('[data-extra-client="' + index + '"]');
    const resellerCell = supplierPricesGrid.querySelector('[data-extra-reseller="' + index + '"]');
    if (costCell) costCell.textContent = money(item.cost);
    updateSupplierMoneyCell(clientCell, item.client);
    updateSupplierMoneyCell(resellerCell, item.reseller || item.client);
  });
}

function renderSupplierPrices() {
  plateDuplicateReferenceKeysCache = null;
  plateKnownNameCache = null;
  state.supplierTab = normalizeExtraGroupName(state.supplierTab) || state.supplierTab;
  applySupplierAdditions();
  applySupplierRemovals();
  dedupeSupplierStores();
  normalizeCatalogSalePrices();
  normalizeExtraGroupsState();
  correctKnownSupplierPriceIssues();
  recalculateSystemSummaries('doorSystems');
  recalculateSystemSummaries('hinges');
  recalculateDrawerExtras();
  syncDoorSystemExtras();
  applySupplierRemovals();
  dedupeSupplierStores();
  const rows = state.supplierPrices.map(function (item, index) {
    return '<tr data-supplier-search="' + esc([item.name, item.supplier, item.reference].join(' ').toLowerCase()) + '">' +
      '<td>' + esc(item.name) + '</td>' +
      '<td><input value="' + esc(item.supplier) + '" data-supplier-index="' + index + '" data-supplier-field="supplier"></td>' +
      '<td><input value="' + esc(item.reference) + '" data-supplier-index="' + index + '" data-supplier-field="reference"></td>' +
      '<td><input type="number" min="0" step="0.01" value="' + supplierNumber(item.supplierPrice) + '" data-supplier-index="' + index + '" data-supplier-field="supplierPrice"></td>' +
      '<td class="supplier-money" data-supplier-cost="' + index + '">' + money(item.cost) + '</td>' +
      '<td class="supplier-money" data-supplier-client="' + index + '">' + supplierManualPriceInput('plates', index, 'client', item.client) + '</td>' +
      '<td class="supplier-money" data-supplier-reseller="' + index + '">' + supplierManualPriceInput('plates', index, 'reseller', item.reseller) + '</td>' +
      '<td>' + supplierDeleteButton('plates', index) + '</td>' +
    '</tr>';
  }).join('');

  supplierPricesGrid.innerHTML = '<table class="supplier-table"><thead><tr>' +
    '<th>PLACA</th><th>MELHOR FORNECEDOR</th><th>REFERÃŠNCIA</th><th>PREÃ‡O FORNECEDOR / MÂ²</th>' +
    '<th>CUSTO C/ MÃƒO DE OBRA</th><th>PREÃ‡O CLIENTE</th><th>PREÃ‡O REVENDEDOR</th><th>A&Ccedil;&Atilde;O</th>' +
    '</tr></thead><tbody>' + rows + '<tr class="supplier-empty" hidden><td colspan="8">Sem resultados para esta pesquisa.</td></tr></tbody></table>';
  const paintCleanRowsHtml = state.catalog.paintings.filter(function (item) { return item.name !== 'Nenhuma'; }).map(function (item) {
    return paintingPriceRow(item, state.catalog.paintings.indexOf(item));
  }).join('');
  const paintComponentRowsHtml = (state.catalog.paintingComponents || []).map(function (item, index) {
    return paintingComponentRow(item, index);
  }).join('');

  const sections = [
    renderPlatePriceSection(),
    renderSupplierSection('Pinturas', state.catalog.paintings.map(function (item) {
      return readonlyPriceRow('pinturas serviÃ§o ' + item.name + ' ' + item.reference, item.name, item.supplier, item.reference, item.supplierPrice, item.cost, item.client, item.client);
    }).join('') + (state.catalog.paintingMixDetails || []).map(function (item) {
      return readonlyPriceRow('pinturas mistura ' + item.item + ' ' + item.detail, 'Mistura - ' + item.item, item.supplier, item.reference + ' / ' + item.detail, item.supplierPrice, item.cost, item.client, item.client);
    }).join('') + (state.catalog.paintingComponents || []).map(function (item) {
      return readonlyPriceRow('pinturas tinta diluente endurecedor catalizador ' + item.item + ' ' + item.detail, 'Componente - ' + item.item, item.supplier, item.reference + ' / ' + item.detail, item.supplierPrice, item.cost, item.client, item.client);
    }).join('')),
    renderSupplierSection('Sistemas de abertura', state.catalog.doorSystems.map(function (item) {
      return readonlyPriceRow('sistemas abertura portas ' + item.name + ' ' + item.reference, item.name, item.supplier || supplierFromReference(item.reference), item.reference, item.supplierPrice || item.cost, item.cost, item.client, item.client);
    }).join('') + (state.catalog.openingSystemComponents || []).filter(function (item) {
      return item.userAddedSummary !== true;
    }).map(function (item, index) {
      return editableComponentRow('openingSystemComponents', index, 'sistemas abertura componentes ' + item.item + ' ' + item.supplier + ' ' + item.label, 'Componente - ' + item.label, item.supplier, item.reference, item.supplierPrice, item.cost);
    }).join('')),
    renderSupplierSection('Dobradicas / Ferragens', state.catalog.hinges.map(function (item) {
      return readonlyPriceRow('dobradicas ferragens ' + item.name, item.name, item.cost, item.client, item.client);
    }).join('')),
    renderSupplierSection('Orlas', state.catalog.edges.map(function (item, index) {
      return edgePriceRow(item, index);
    }).join(''))
  ];
  sections[1] = renderPaintingSupplierSection(paintCleanRowsHtml, paintComponentRowsHtml);
  sections[2] = renderSupplierSection('Sistemas de abertura', state.catalog.doorSystems.map(function (item) {
    return systemSummaryRow('doorSystems', state.catalog.doorSystems.indexOf(item), item);
  }).join('') + (state.catalog.openingSystemComponents || []).filter(function (item) {
    return item.userAddedSummary !== true;
  }).map(function (item, index) {
    return editableComponentRow('openingSystemComponents', index, 'sistemas abertura componentes ' + item.item + ' ' + item.supplier + ' ' + item.label, 'Componente - ' + item.label, item.supplier, item.reference, item.supplierPrice, item.cost);
  }).join(''));
  sections[3] = renderSupplierSection('Dobradicas / Ferragens', state.catalog.hinges.map(function (item) {
    return systemSummaryRow('hinges', state.catalog.hinges.indexOf(item), item);
  }).join('') + (state.catalog.hingeComponents || []).map(function (item, index) {
    const usedIn = (state.catalog.hinges || [])
      .filter(function (hinge) {
        return (hinge.recipeItems || []).some(function (recipeItem) { return comparableText(recipeItem) === comparableText(item.item); }) ||
          hingeExtraLinkedItems(hinge.name).some(function (recipeItem) { return comparableText(recipeItem) === comparableText(item.item); });
      })
      .map(function (hinge) { return hinge.name; })
      .join(', ');
    const detail = item.reference + (usedIn ? ' / usado em: ' + usedIn : ' / nao usado nos 3 itens principais');
    return editableComponentRow('hingeComponents', index, 'dobradicas ferragens componentes ' + item.item + ' ' + item.supplier + ' ' + item.label + ' ' + usedIn, 'Componente - ' + item.label, item.supplier, detail, item.supplierPrice, item.cost);
  }).join(''));
  (state.lists.extraGroups || []).filter(function (group) {
    return normalizeExtraGroupName(group) !== doorSystemExtraGroup;
  }).forEach(function (group) {
    group = normalizeExtraGroupName(group);
    const extraRows = state.catalog.extras
      .map(function (item, index) { return { item, index }; })
      .filter(function (entry) { return normalizeExtraGroupName(entry.item.group) === group; })
      .sort(supplierExtraSort)
      .map(function (entry) {
        const item = entry.item;
        const index = entry.index;
        if (normalizeExtraGroupName(group) === doorSystemExtraGroup) return editableDoorSystemExtraRow(index, item);
        if (isEditableExtraGroup(group)) return editableExtraPriceRow(index, item);
        if (normalizeExtraGroupName(group) === 'Gavetas') return extraSummaryRow(index, item);
        if (normalizeExtraGroupName(group) === otherExtraGroup) return otherPriceRow(group + ' ' + item.item + ' ' + item.label + ' ' + item.reference, item, index);
        return readonlyPriceRow(group + ' ' + item.item + ' ' + item.label, item.item, item.supplier, item.reference, item.supplierPrice, item.cost, item.client, item.client, 'extras', index);
      })
      .join('');
    const drawerRows = normalizeExtraGroupName(group) === 'Gavetas'
      ? (state.catalog.drawerComponents || []).map(function (item, index) {
          return editableComponentRow('drawerComponents', index, 'gavetas componentes ' + item.family + ' ' + item.item + ' ' + item.label + ' ' + item.supplier, item.family + ' - ' + item.item, item.supplier, item.reference, item.supplierPrice, item.cost);
        }).join('')
      : '';
    sections.push(renderSupplierSection(group, extraRows + drawerRows));
  });

  if (!sections.some(function (html) { return html.includes('<h3>' + esc(state.supplierTab) + '</h3>'); })) {
    state.supplierTab = 'Madeiras / Placas';
  }
  const tabs = sections.map(function (html) {
    const title = (html.match(/<h3>(.*?)<\/h3>/) || [null, ''])[1];
    const active = title === esc(state.supplierTab);
    return '<button class="' + (active ? 'active' : '') + '" type="button" data-supplier-tab="' + title + '">' + title + '</button>';
  }).join('');
  const activeSection = sections.find(function (html) { return html.includes('<h3>' + esc(state.supplierTab) + '</h3>'); }) || sections[0];
  supplierPricesGrid.innerHTML = '<div class="supplier-tabs">' + tabs + '</div>' + supplierAddFormHtml() + activeSection;
  applySupplierSearch();

  supplierPricesGrid.querySelectorAll('[data-supplier-tab]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.supplierTab = normalizeExtraGroupName(button.textContent) || button.textContent;
      renderSupplierPrices();
    });
  });
  supplierPricesGrid.querySelectorAll('[data-plate-price-view]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.platePriceView = button.dataset.platePriceView;
      renderSupplierPrices();
    });
  });
  const addButton = supplierPricesGrid.querySelector('[data-add-supplier-item]');
  if (addButton) addButton.addEventListener('click', addSupplierItem);
  supplierPricesGrid.querySelectorAll('[data-delete-supplier-type]').forEach(function (button) {
    button.addEventListener('click', function () {
      deleteSupplierItem(button.dataset.deleteSupplierType, button.dataset.deleteSupplierIndex);
    });
  });
  supplierPricesGrid.querySelectorAll('[data-new-item-field]').forEach(function (element) {
    const updateNewItemField = function () {
      if (element.dataset.newItemField === 'itemMode') {
        updateSupplierAddModeFields();
      }
      if (state.supplierTab === 'Pinturas' && newItemMode() === 'component' && element.dataset.newItemField === 'reference') {
        const nameInput = supplierPricesGrid.querySelector('[data-new-item-field="name"]');
        if (nameInput) nameInput.value = element.value;
      }
      refreshNewItemPreview();
    };
    element.addEventListener('input', updateNewItemField);
    element.addEventListener('change', updateNewItemField);
  });
  refreshNewItemPreview();

  supplierPricesGrid.querySelectorAll('[data-supplier-index]').forEach(function (element) {
    element.addEventListener('input', function (event) {
      const index = Number(event.target.dataset.supplierIndex);
      const field = event.target.dataset.supplierField;
      const item = state.supplierPrices[index];
      const before = clone(item);
      item[field] = field === 'supplierPrice' ? num(event.target.value) : event.target.value;
      if (field === 'reference' && item.reference && (item.userAdded || item.comparisonSource === 'PLACAS_26')) {
        item.name = canonicalPlateNameFromReference([item.reference, item.name].filter(Boolean).join(' ')) || String(item.reference).trim();
      }
      calculateSupplierRow(item);
      if (item.userAdded) updateSupplierAddition('plates', before, item);
      plateDuplicateReferenceKeysCache = null;
      plateKnownNameCache = null;
      const supplierCostCell = supplierPricesGrid.querySelector('[data-supplier-cost="' + index + '"]');
      const supplierClientCell = supplierPricesGrid.querySelector('[data-supplier-client="' + index + '"]');
      const supplierResellerCell = supplierPricesGrid.querySelector('[data-supplier-reseller="' + index + '"]');
      if (supplierCostCell) supplierCostCell.textContent = money(item.cost);
      updateSupplierMoneyCell(supplierClientCell, item.client);
      updateSupplierMoneyCell(supplierResellerCell, item.reseller);
      const row = event.target.closest('.plate-option-row[data-plate-key]');
      if (row) {
        row.dataset.plateKey = plateGroupKey(item);
        row.dataset.plateOption = plateBestOptionKey(item);
      }
      trackSupplierChange('plates', item, index);
      scheduleSupplierRecalculation(true);
    });
  });

  supplierPricesGrid.querySelectorAll('[data-extra-price-index]').forEach(function (element) {
    element.addEventListener('input', function (event) {
      const index = Number(event.target.dataset.extraPriceIndex);
      const item = state.catalog.extras[index];
      if (!item) return;
      if (item.baseSupplierPrice === undefined) item.baseSupplierPrice = Number(item.supplierPrice) || 0;
      if (item.baseCost === undefined) item.baseCost = Number(item.cost) || 0;
      if (item.baseClient === undefined) item.baseClient = Number(item.client) || 0;
      item.supplierPrice = num(event.target.value);
      const markupMultiplier = supplierPriceMarkupMultiplier(item.group);
      if (markupMultiplier) {
        item.cost = item.supplierPrice;
        applyAutomaticClientReseller(item, item.supplierPrice * markupMultiplier, item.supplierPrice * markupMultiplier);
      } else {
        const labor = item.baseCost - item.baseSupplierPrice;
        const clientRatio = item.baseCost ? item.baseClient / item.baseCost : 1;
        item.cost = item.supplierPrice + labor;
        applyAutomaticClientReseller(item, item.cost * clientRatio, item.cost * clientRatio);
      }
      if (comparableText(item.group).includes('LED') && !ledKitRecipe(item)) recalculateLedKits(item.group);
      const costCell = supplierPricesGrid.querySelector('[data-extra-cost="' + index + '"]');
      const clientCell = supplierPricesGrid.querySelector('[data-extra-client="' + index + '"]');
      const resellerCell = supplierPricesGrid.querySelector('[data-extra-reseller="' + index + '"]');
      if (costCell) costCell.textContent = money(item.cost);
      updateSupplierMoneyCell(clientCell, item.client);
      updateSupplierMoneyCell(resellerCell, item.reseller || item.client);
      trackSupplierChange('extras', item, index);
      scheduleSupplierRecalculation(false);
    });
  });

  supplierPricesGrid.querySelectorAll('[data-extra-edit-index]').forEach(function (element) {
    element.addEventListener('input', function (event) {
      const index = Number(event.target.dataset.extraEditIndex);
      const field = event.target.dataset.extraEditField;
      const item = state.catalog.extras[index];
      if (!item) return;
      if (item.baseCost === undefined) item.baseCost = Number(item.cost) || 0;
      if (item.baseSupplierPrice === undefined) item.baseSupplierPrice = Number(item.supplierPrice) || 0;
      if (item.baseClient === undefined) item.baseClient = Number(item.client) || 0;
      if (item.baseReseller === undefined) item.baseReseller = Number(item.reseller || item.client) || 0;
      const before = clone(item);
      if (field === 'supplier' || field === 'reference') {
        item[field] = event.target.value;
        if (field === 'reference' && comparableText(item.group) === comparableText(doorSystemExtraGroup) && Number(item.supplierPrice) > 0) {
          item.cost = openingSystemCostFromSupplier(item, item.supplierPrice);
          applyOpeningSystemSalePrices(item);
        }
      } else if (field === 'supplierPrice') {
        item.supplierPrice = num(event.target.value);
        item.manualSupplierPrice = comparableText(item.group) === comparableText(doorSystemExtraGroup);
        item.cost = item.manualSupplierPrice
          ? openingSystemCostFromSupplier(item, item.supplierPrice)
          : calculatedCostFromSupplier(item, item.supplierPrice);
      }
      if (comparableText(item.group) === comparableText(doorSystemExtraGroup) && Number(item.supplierPrice) > 0) {
        applyOpeningSystemSalePrices(item);
      } else {
        applySummaryPricesFromCost(item);
      }
      if (comparableText(item.group) === comparableText(doorSystemExtraGroup)) {
        const system = (state.catalog.doorSystems || []).find(function (candidate) {
          return comparableText(candidate.name || candidate.item) === comparableText(item.item || item.name);
        });
        if (system) {
          if (system.baseCost === undefined) system.baseCost = item.baseCost;
          if (system.baseSupplierPrice === undefined) system.baseSupplierPrice = item.baseSupplierPrice;
          if (system.baseClient === undefined) system.baseClient = item.baseClient;
          if (system.baseReseller === undefined) system.baseReseller = item.baseReseller;
          Object.assign(system, {
            supplier: item.supplier,
            reference: item.reference,
            supplierPrice: item.supplierPrice,
            cost: item.cost,
            client: item.client,
            reseller: item.reseller,
            manualSupplierPrice: item.manualSupplierPrice === true
          });
        }
      }
      const costCell = supplierPricesGrid.querySelector('[data-extra-cost="' + index + '"]');
      const clientCell = supplierPricesGrid.querySelector('[data-extra-client="' + index + '"]');
      const resellerCell = supplierPricesGrid.querySelector('[data-extra-reseller="' + index + '"]');
      if (costCell) costCell.textContent = money(item.cost);
      updateSupplierMoneyCell(clientCell, item.client);
      updateSupplierMoneyCell(resellerCell, item.reseller || item.client);
      if (item.userAdded) updateSupplierAddition('extras', before, item);
      trackSupplierChange('extras', item, index);
      if (comparableText(item.group) === comparableText(doorSystemExtraGroup)) {
        trackSupplierChange('openingSystemComponents', {
          item: item.item,
          label: item.item,
          name: item.item,
          supplier: item.supplier,
          reference: item.reference,
          supplierPrice: item.supplierPrice,
          cost: item.cost,
          client: item.client,
          reseller: item.reseller,
          manualSupplierPrice: item.manualSupplierPrice === true,
          userAdded: item.userAdded === true,
          userAddedSummary: true
        }, item.item);
      }
      syncDoorSystemExtras();
      scheduleSupplierRecalculation(false);
    });
  });

  supplierPricesGrid.querySelectorAll('[data-system-summary-kind]').forEach(function (element) {
    element.addEventListener('input', function (event) {
      const kind = event.target.dataset.systemSummaryKind;
      const index = Number(event.target.dataset.systemSummaryIndex);
      const field = event.target.dataset.systemSummaryField;
      const list = kind === 'hinges' ? (state.catalog.hinges || []) : (state.catalog.doorSystems || []);
      const item = list[index];
      if (!item) return;
      if (item.baseCost === undefined) item.baseCost = Number(item.cost) || 0;
      if (item.baseSupplierPrice === undefined) item.baseSupplierPrice = Number(item.supplierPrice) || 0;
      if (item.baseClient === undefined) item.baseClient = Number(item.client) || 0;
      if (item.baseReseller === undefined) item.baseReseller = Number(item.reseller ?? item.client) || 0;
      const before = clone(item);
      if (field === 'supplier' || field === 'reference') {
        item[field] = event.target.value;
        if (field === 'reference' && kind === 'doorSystems' && Number(item.supplierPrice) > 0) {
          item.cost = openingSystemCostFromSupplier(item, item.supplierPrice);
          applyOpeningSystemSalePrices(item);
        }
      } else if (field === 'supplierPrice') {
        item.supplierPrice = num(event.target.value);
        item.manualSupplierPrice = kind === 'doorSystems';
        item.cost = item.manualSupplierPrice
          ? openingSystemCostFromSupplier(item, item.supplierPrice)
          : calculatedCostFromSupplier(item, item.supplierPrice);
      }
      if (kind === 'doorSystems' && Number(item.supplierPrice) > 0) {
        applyOpeningSystemSalePrices(item);
      } else {
        applySummaryPricesFromCost(item);
      }
      const costCell = supplierPricesGrid.querySelector('[data-system-cost="' + kind + '-' + index + '"]');
      const clientCell = supplierPricesGrid.querySelector('[data-system-client="' + kind + '-' + index + '"]');
      const resellerCell = supplierPricesGrid.querySelector('[data-system-reseller="' + kind + '-' + index + '"]');
      if (costCell) costCell.textContent = money(item.cost);
      updateSupplierMoneyCell(clientCell, item.client);
      updateSupplierMoneyCell(resellerCell, item.reseller);
      if (item.userAdded) updateSupplierAddition(kind === 'hinges' ? 'hinges' : 'doorSystems', before, item);
      trackSupplierChange(kind === 'hinges' ? 'hinges' : 'openingSystemComponents', {
        item: item.name,
        label: item.name,
        name: item.name,
        supplier: item.supplier,
        reference: item.reference,
        supplierPrice: item.supplierPrice,
        cost: item.cost,
        client: item.client,
        reseller: item.reseller,
        manualSupplierPrice: item.manualSupplierPrice === true,
        userAdded: item.userAdded === true,
        userAddedSummary: true
      }, item.name);
      if (kind === 'doorSystems') syncDoorSystemExtras();
      scheduleSupplierRecalculation(false);
    });
  });

  supplierPricesGrid.querySelectorAll('[data-component-type]').forEach(function (element) {
    element.addEventListener('input', function (event) {
      const type = event.target.dataset.componentType;
      const index = Number(event.target.dataset.componentIndex);
      const list = state.catalog[type] || [];
      if (!list[index]) return;
      if (type === 'paintingComponents') ensurePaintingBaselines();
      const before = clone(list[index]);
      if (list[index].baseCost === undefined) list[index].baseCost = Number(list[index].cost) || 0;
      const field = event.target.dataset.componentField || 'supplierPrice';
      list[index][field] = num(event.target.value);
      if (type === 'paintingComponents') {
        list[index].cost = list[index].supplierPrice * 1.08;
        recalculatePaintingServices();
      } else if (type === 'edges') {
        const meters = Number(list[index].supplierMeters) || 1000;
        list[index].materialPerMeter = meters ? list[index].supplierPrice / meters : 0;
        list[index].cost = list[index].materialPerMeter + 0.32;
        applyEdgeAutomaticClientReseller(list[index], list[index].cost * 3.5, list[index].cost * 3.5);
      } else if (type === 'hingeComponents' || type === 'openingSystemComponents') {
        list[index].cost = type === 'openingSystemComponents'
          ? openingSystemCostFromSupplier(list[index], list[index].supplierPrice)
          : list[index].supplierPrice + (Number(list[index].labor) || 0);
        recalculateSystemSummaries(type === 'hingeComponents' ? 'hinges' : 'doorSystems');
        if (type === 'openingSystemComponents') syncDoorSystemExtras();
      } else if (type === 'drawerComponents') {
        list[index].cost = list[index].supplierPrice;
        recalculateDrawerExtras();
      } else {
        list[index].cost = list[index].supplierPrice;
      }
      const costCell = supplierPricesGrid.querySelector('[data-component-cost="' + type + '-' + index + '"]');
      if (costCell) costCell.textContent = money(list[index].cost) + (type === 'edges' ? '/ml' : '');
      const literCostCell = supplierPricesGrid.querySelector('[data-component-liter-cost="' + type + '-' + index + '"]');
      if (literCostCell) {
        const liters = type === 'paintingComponents' ? paintingComponentLiters(list[index]) : 0;
        literCostCell.textContent = liters ? money((Number(list[index].cost) || 0) / liters) : money(0);
      }
      const edgeClientCell = supplierPricesGrid.querySelector('[data-edge-client="' + index + '"]');
      updateSupplierMoneyCell(edgeClientCell, list[index].client, '/ml');
      if (list[index].userAdded && type === 'edges') updateSupplierAddition('edges', before, list[index]);
      if (list[index].userAdded && type === 'paintingComponents') updateSupplierAddition('paintingComponents', before, list[index]);
      if (list[index].userAdded && type === 'drawerComponents') updateSupplierAddition('drawerComponents', before, list[index]);
      trackSupplierChange(type, list[index], index);
      scheduleSupplierRecalculation(false);
    });
  });

  supplierPricesGrid.querySelectorAll('[data-manual-price-type]').forEach(function (element) {
    const updateManualPrice = function (event) {
      const type = event.target.dataset.manualPriceType;
      if (type === 'readonly') return;
      const index = Number(event.target.dataset.manualPriceIndex);
      const field = event.target.dataset.manualPriceField;
      const list = supplierManualPriceList(type);
      const item = list[index];
      if (!item || (field !== 'client' && field !== 'reseller')) return;
      const before = clone(item);
      ensureManualPriceBaseline(item, before);
      item[field] = type === 'edges' ? num(event.target.value) : roundSaleUp(num(event.target.value));
      if (field === 'client') item.manualClient = true;
      if (field === 'reseller') item.manualReseller = true;
      if (type === 'edges' && field === 'client' && item.manualReseller !== true) item.reseller = item.client;
      event.target.value = supplierNumber(item[field]);
      trackManualPriceChange(type, item, index, before);
      renderModules();
      renderFinal();
      calculate({ renderFinal: false }).catch(function (error) { sourceStatus.textContent = error.message; });
      scheduleSupplierRecalculation(false);
    };
    element.addEventListener('change', updateManualPrice);
  });

  supplierPricesGrid.querySelectorAll('[data-auto-price-type]').forEach(function (button) {
    button.addEventListener('click', function () {
      const type = button.dataset.autoPriceType;
      const index = Number(button.dataset.autoPriceIndex);
      const field = button.dataset.autoPriceField;
      const list = supplierManualPriceList(type);
      const item = list[index];
      if (!item || (field !== 'client' && field !== 'reseller')) return;
      const before = clone(item);
      if (field === 'client') item.manualClient = false;
      if (field === 'reseller') item.manualReseller = false;
      recalculateManualPriceItem(type, item, index, field);
      const input = supplierPricesGrid.querySelector('[data-manual-price-type="' + type + '"][data-manual-price-index="' + index + '"][data-manual-price-field="' + field + '"]');
      if (input) input.value = supplierNumber(item[field]);
      trackManualPriceChange(type, item, index, before);
      renderModules();
      renderFinal();
      calculate({ renderFinal: false }).catch(function (error) { sourceStatus.textContent = error.message; });
      scheduleSupplierRecalculation(false);
    });
  });
}

async function saveSupplierPlateToExcel(item) {
  const response = await fetch('/api/supplier-prices/plate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plate: item })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Nao foi possivel gravar a madeira no Excel.');
  state.pricingRules = data.rules;
  state.supplierPrices = data.plates;
  normalizeAllPlateNames();
  const bootstrapResponse = await fetch('/api/bootstrap');
  if (bootstrapResponse.ok) {
    const fresh = await bootstrapResponse.json();
    state.catalog = fresh.catalog;
    state.lists = fresh.lists;
    state.typePresets = fresh.typePresets;
    ensureRoupeiroModuleType();
    applySupplierAdditions();
    applySupplierDraftChanges();
    normalizeAllPlateNames();
    normalizeCatalogSalePrices();
  }
  renderSupplierPrices();
  if (false && saveButton) {
    const excel = data.excel || {};
    const total = Number(excel.updated || 0) + Number(excel.updatedPaint || 0) + Number(excel.updatedEdges || 0) +
      Number(excel.updatedDrawers || 0) + Number(excel.updatedSystems || 0) + Number(excel.updatedExtras || 0) +
      Number(excel.insertedPlates || 0) + Number(excel.insertedPlateSuppliers || 0) + Number(excel.updatedComparison || 0);
    sourceStatus.textContent = total ? 'Preços guardados no Excel' : 'Guardar terminado';
    saveButton.disabled = false;
    return;
  }
  renderModules();
  renderFinal();
  await calculate({ renderFinal: false });
}

async function saveSupplierPrices() {
  if (!canManagePrices()) {
    sourceStatus.textContent = 'Faz login como administrador para guardar preços.';
    return;
  }
  const saveButton = document.querySelector('#saveSupplierPricesButton');
  commitVisibleSupplierManualPrices();
  flushSupplierDraftPersist();
  if (supplierRecalculationTimer) {
    clearTimeout(supplierRecalculationTimer);
    supplierRecalculationTimer = null;
    supplierRecalculationNeedsPlateRefresh = false;
  }
  if (!hasSupplierDirtyChanges()) restoreSupplierDirtyChanges();
  if (!hasSupplierDirtyChanges()) {
    sourceStatus.textContent = 'Sem alterações para guardar';
    return;
  }
  if (saveButton) saveButton.disabled = true;
  sourceStatus.textContent = 'A guardar preços no Excel...';
  try {
    const payload = supplierDirtyPayload();
    if (Array.isArray(payload.plates) && payload.plates.length) payload.addMissingPlates = true;
    const response = await fetch('/api/supplier-prices', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel guardar os precos.');
    state.pricingRules = data.rules;
    state.supplierPrices = data.plates;
    normalizeAllPlateNames();
    data.plates.forEach(function (updated) {
      const plate = state.catalog.plates.find(function (item) { return item.name === updated.name; });
      if (plate) Object.assign(plate, updated);
    });
    const bootstrapResponse = await fetch('/api/bootstrap');
    if (bootstrapResponse.ok) {
      const fresh = await bootstrapResponse.json();
      state.catalog = fresh.catalog;
      state.lists = fresh.lists;
      state.typePresets = fresh.typePresets;
      ensureRoupeiroModuleType();
    applySupplierAdditions();
    applySupplierDraftChanges();
    normalizeAllPlateNames();
    normalizeCatalogSalePrices();
  }
    applySupplierPayloadChanges(payload);
    renderSupplierPrices();
    const excel = data.excel || {};
    const total = Number(excel.updated || 0) + Number(excel.updatedPaint || 0) + Number(excel.updatedEdges || 0) +
      Number(excel.updatedDrawers || 0) + Number(excel.updatedSystems || 0) + Number(excel.updatedExtras || 0) +
      Number(excel.insertedPlates || 0) + Number(excel.insertedPlateSuppliers || 0) + Number(excel.updatedComparison || 0);
    clearSupplierDirtyChanges();
    renderModules();
    renderFinal();
    await calculate({ renderFinal: false });
    sourceStatus.textContent = excel.queued
      ? 'Preços guardados na app. Excel a sincronizar em segundo plano.'
      : (total ? 'Preços guardados no Excel' : 'Guardar terminado');
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function showView(view, mode, recalculate) {
  if (view !== 'users' && state.quoteHistoryOwnerId) {
    await loadQuoteHistoryList().catch(function (error) { sourceStatus.textContent = error.message; });
  }
  if ((view === 'suppliers' || view === 'users') && !canManagePrices()) {
    sourceStatus.textContent = view === 'users'
      ? 'Faz login como administrador para gerir utilizadores.'
      : 'Faz login como administrador para mudar preços.';
    view = 'quote';
    mode = state.pricingMode;
    recalculate = false;
  }
  document.querySelectorAll('.side-nav button').forEach(function (button) {
    const selected = view === 'quote'
      ? button.dataset.view === 'quote' && button.dataset.mode === mode
      : button.dataset.view === view;
    button.classList.toggle('active', selected);
  });

  if (view === 'suppliers') {
    quoteView.hidden = true;
    if (visualView) visualView.hidden = true;
    if (usersView) usersView.hidden = true;
    supplierView.hidden = false;
    quoteActions.hidden = true;
    pageTitle.textContent = 'Mudar preço fornecedores';
    renderSupplierPrices();
    return;
  }

  if (view === 'users') {
    quoteView.hidden = true;
    supplierView.hidden = true;
    if (visualView) visualView.hidden = true;
    if (usersView) usersView.hidden = false;
    quoteActions.hidden = true;
    pageTitle.textContent = 'Utilizadores';
    await loadUsers();
    return;
  }

  if (view === 'visual') {
    quoteView.hidden = true;
    supplierView.hidden = true;
    if (usersView) usersView.hidden = true;
    if (visualView) visualView.hidden = false;
    quoteActions.hidden = false;
    pageTitle.textContent = 'Visualização';
    renderVisualPreview();
    return;
  }

  state.pricingMode = mode === 'reseller' ? 'reseller' : 'normal';
  quoteView.hidden = false;
  if (visualView) visualView.hidden = true;
  supplierView.hidden = true;
  if (usersView) usersView.hidden = true;
  quoteActions.hidden = false;
  pageTitle.textContent = state.pricingMode === 'reseller' ? 'Orçamento revendedor' : 'Orçamento';
  quoteTitle.textContent = cleanDisplayText(state.pricingMode === 'reseller' ? 'ORÃ‡AMENTO REVENDEDOR' : 'ORÃ‡AMENTO');
  renderModules();
  renderKpis();
  renderFinal();
  persistQuote();
  if (recalculate !== false) await calculate();
}

async function boot() {
  await loadSession();
  const response = await fetch('/api/bootstrap');
  if (!response.ok) throw new Error('Não foi possível carregar os dados base.');
  const data = await response.json();
  state.lists = data.lists;
  state.catalog = data.catalog;
  baseDoorSystemsByName = new Map((state.catalog.doorSystems || []).map(function (item) {
    return [itemIdentity(item.name || item.item || item.label), clone(item)];
  }));
  state.typePresets = data.typePresets;
  ensureRoupeiroModuleType();
  addUniqueListItem('extraGroups', otherExtraGroup);
  ensureTransportExtras();
  data.modules = data.modules.map(hydrateModule);
  data.extras = data.extras.map(hydrateExtra);
  state.original = { client: clone(data.client), modules: clone(data.modules), extras: clone(data.extras) };
  localStorage.removeItem(storageKey);
  clearQuoteDraftStorage();
  state.client = { name: '', location: '', date: '' };
  state.modules = [];
  state.extras = [];
  state.pricingMode = 'normal';
  sourceStatus.textContent = data.source.present ? 'Novo orçamento vazio' : 'Base Excel não encontrada; novo orçamento vazio';
  const supplierResponse = await fetch('/api/supplier-prices');
  if (!supplierResponse.ok) throw new Error('Não foi possível carregar os preços dos fornecedores.');
  const supplierData = await supplierResponse.json();
  state.pricingRules = supplierData.rules;
  state.supplierPrices = supplierData.plates;
  normalizeAllPlateNames();
  applySupplierAdditions();
  applySupplierDraftChanges();
  applySupplierRemovals();
  normalizeAllPlateNames();
  normalizeCatalogSalePrices();
  ensureTransportExtras();

  state.quote = await (await fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: state.client, modules: state.modules, extras: state.extras, pricingMode: state.pricingMode, catalog: calculationCatalogOverrides() }) })).json();
  renderClient();
  renderKpis();
  renderModules();
  renderFinal();
  await loadQuoteHistoryList().catch(function (error) { sourceStatus.textContent = error.message; });
  clearQuoteDraftStorage();
  // Ativa a vista inicial pelo mesmo fluxo usado ao mudar de tab. O recálculo
  // final garante que controlos, totais e dependências ficam funcionais logo
  // na primeira entrada na aplicação.
  await showView('quote', state.pricingMode, true);
  updateAccessUi();
}

document.querySelectorAll('.side-nav button').forEach(function (button) {
  button.addEventListener('click', function () {
    showView(button.dataset.view, button.dataset.mode || state.pricingMode).catch(function (error) {
      sourceStatus.textContent = error.message;
    });
  });
});
function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem('silwoodSidebarCollapsed', collapsed ? '1' : '0');
}

setSidebarCollapsed(localStorage.getItem('silwoodSidebarCollapsed') === '1');

document.querySelector('#sidebarToggle').addEventListener('click', function () {
  setSidebarCollapsed(true);
});

document.querySelector('#sidebarOpenButton').addEventListener('click', function () {
  setSidebarCollapsed(false);
});

supplierSearchInput.addEventListener('input', scheduleSupplierSearch);
if (loginButton) {
  loginButton.addEventListener('click', function () {
    loginAdmin().catch(function (error) { sourceStatus.textContent = error.message; });
  });
}
if (loginUser) loginUser.addEventListener('input', function () { setLoginError(''); });
if (loginPassword) loginPassword.addEventListener('input', function () { setLoginError(''); });
if (loginPassword) {
  loginPassword.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      loginAdmin().catch(function (error) { sourceStatus.textContent = error.message; });
    }
  });
}
if (logoutButton) {
  logoutButton.addEventListener('click', function () {
    logoutAdmin().catch(function (error) { sourceStatus.textContent = error.message; });
  });
}
window.addEventListener('beforeunload', function () {
  flushPendingQuotePersist();
  flushSupplierDraftPersist();
});

function triggerSaveSupplierPrices(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const saveButton = document.querySelector('#saveSupplierPricesButton');
  if (saveButton?.dataset.saving === '1') return;
  if (saveButton) saveButton.dataset.saving = '1';
  sourceStatus.textContent = 'A preparar gravação...';
  setTimeout(function () {
    saveSupplierPrices()
      .catch(function (error) { sourceStatus.textContent = 'Erro ao guardar: ' + error.message; })
      .finally(function () {
        const button = document.querySelector('#saveSupplierPricesButton');
        if (button) {
          button.disabled = false;
          delete button.dataset.saving;
        }
      });
  }, 0);
}

document.querySelector('#saveSupplierPricesButton').onclick = triggerSaveSupplierPrices;
document.addEventListener('click', function (event) {
  if (event.target.closest('#saveSupplierPricesButton')) triggerSaveSupplierPrices(event);
}, true);
document.addEventListener('click', function (event) {
  const createButton = event.target.closest('#createUserButton');
  const saveButton = event.target.closest('[data-save-user]');
  const historyButton = event.target.closest('[data-show-user-history]');
  if (!createButton && !saveButton && !historyButton) return;
  event.preventDefault();
  const action = createButton
    ? createUserFromForm()
    : (saveButton
        ? saveUserFromRow(saveButton.dataset.saveUser)
        : loadQuoteHistoryList(historyButton.dataset.showUserHistory, historyButton.dataset.userHistoryLabel));
  action
    .then(function () {
      if (createButton) sourceStatus.textContent = 'Utilizador criado.';
      else if (saveButton) sourceStatus.textContent = 'Utilizador guardado.';
      else if (historyButton) sourceStatus.textContent = 'Histórico de ' + historyButton.dataset.userHistoryLabel;
    })
    .catch(function (error) { sourceStatus.textContent = error.message; });
});
document.addEventListener('click', function (event) {
  const splitButton = event.target.closest('[data-split-drawer-extra]');
  if (!splitButton) return;
  event.preventDefault();
  splitDrawerExtraByModule(Number(splitButton.dataset.splitDrawerExtra), splitButton);
});
document.addEventListener('input', function (event) {
  const input = event.target.closest('[data-drawer-split-qty]');
  const measureInput = event.target.closest('[data-drawer-split-measure]');
  if (input) {
    if (!drawerSplitState) return;
    drawerSplitState.quantities[Number(input.dataset.drawerSplitQty)] = num(input.value);
    updateDrawerSplitTotal();
    return;
  }
  if (measureInput) {
    if (!drawerSplitState) return;
    const index = Number(measureInput.dataset.drawerSplitMeasure);
    const field = measureInput.dataset.field;
    if (!drawerSplitState.measures[index]) drawerSplitState.measures[index] = {};
    drawerSplitState.measures[index][field] = num(measureInput.value);
    return;
  }
  const moduleQty = event.target.closest('[data-module-split-qty]');
  if (moduleQty) {
    if (!moduleSplitState) return;
    const index = Number(moduleQty.dataset.moduleSplitQty);
    if (!moduleSplitState.rows[index]) return;
    moduleSplitState.rows[index].quantity = num(moduleQty.value);
    updateModuleSplitTotal();
  }
});
document.addEventListener('change', function (event) {
  const sideSelect = event.target.closest('[data-module-split-side]');
  if (!sideSelect || !moduleSplitState) return;
  const index = Number(sideSelect.dataset.moduleSplitSide);
  const field = sideSelect.dataset.field;
  if (!moduleSplitState.rows[index]) return;
  moduleSplitState.rows[index][field] = sideSelect.value;
});
document.addEventListener('click', function (event) {
  if (event.target.closest('[data-drawer-split-close]') || event.target.id === 'drawerSplitModal') {
    closeDrawerSplitModal();
    return;
  }
  if (event.target.closest('[data-drawer-split-apply]')) {
    applyDrawerSplitModal();
  }
  if (event.target.closest('[data-module-split-close]') || event.target.id === 'moduleSplitModal') {
    closeModuleSplitModal();
    return;
  }
  if (event.target.closest('[data-module-split-apply]')) {
    applyModuleSplitModal();
  }
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && drawerSplitState) closeDrawerSplitModal();
  if (event.key === 'Escape' && moduleSplitState) closeModuleSplitModal();
});

document.querySelector('#addModuleButton').addEventListener('click', addModule);
document.querySelector('#addExtraButton').addEventListener('click', addExtra);
document.querySelector('#resetButton').addEventListener('click', resetQuote);
if (saveHistoryButton) {
  saveHistoryButton.addEventListener('click', function () {
    saveCurrentQuoteToHistory().catch(function (error) { sourceStatus.textContent = error.message; });
  });
}
if (quoteHistoryList) {
  quoteHistoryList.addEventListener('click', function (event) {
    const openButton = event.target.closest('[data-open-history]');
    const deleteButton = event.target.closest('[data-delete-history]');
    if (deleteButton) {
      deleteHistoryEntry(deleteButton.dataset.deleteHistory).catch(function (error) { sourceStatus.textContent = error.message; });
      return;
    }
    if (openButton) {
      loadQuoteHistory(openButton.dataset.openHistory).catch(function (error) { sourceStatus.textContent = error.message; });
    }
  });
}
function waitForPrintImages() {
  const images = Array.from(printSheet.querySelectorAll('img'));
  return Promise.all(images.map(function (image) {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    return new Promise(function (resolve) {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
}

function safeFilePart(value, fallback) {
  const text = cleanDisplayText(value || fallback || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback || '';
}

function printDocumentTitle() {
  const client = safeFilePart(state.client?.name, 'Sem cliente').replace(/\s+/g, '_');
  const date = safeFilePart(state.client?.date, new Date().toLocaleDateString('pt-PT')).replace(/[.\s/]+/g, '-');
  return ['Silwood_Orçamento', client, date].filter(Boolean).join('_');
}

document.querySelector('#printButton').addEventListener('click', async function () {
  const previousTitle = document.title;
  document.title = printDocumentTitle();
  renderPrint();
  await waitForPrintImages();
  window.print();
  setTimeout(function () { document.title = previousTitle; }, 1000);
});

boot().catch(function (error) {
  sourceStatus.textContent = 'Erro';
  document.querySelector('.excel-sheet').innerHTML = '<div class="sheet-title">Erro</div><div style="padding:16px">' + esc(error.message) + '</div>';
});
