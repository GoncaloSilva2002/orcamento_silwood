const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const workbookName = 'Silwood_Calculadora_Orcamentos_Cozinhas.xlsm';

function runtimeRootDir() {
  return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
}

function resolveWorkbookPath() {
  return path.join(runtimeRootDir(), 'data', workbookName);
}

const workbookPath = resolveWorkbookPath();
const workbook = XLSX.readFile(workbookPath, { cellFormula: true, cellText: true });

function sheetText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function sheetByKeywords(keywords) {
  return workbook.SheetNames.find(name => keywords.every(keyword => sheetText(name).includes(keyword)));
}

function resolveSheetName(sheetName) {
  if (workbook.Sheets[sheetName]) return sheetName;
  const text = sheetText(sheetName);
  if (text.includes('PLACAS') && text.includes('SECCIONADORA')) return sheetByKeywords(['PLACAS', 'SECCIONADORA']);
  if (text.includes('INFORMA') && text.includes('PINTURA')) return sheetByKeywords(['INFORMACOES', 'PINTURA']);
  if (text.includes('PINTURA')) return sheetByKeywords(['PRECO', 'PINTURA']);
  if (text.includes('SISTEMA') && text.includes('ABERTURA')) return sheetByKeywords(['SISTEMA', 'ABERTURA']);
  if (text.includes('ORLAGEM')) return sheetByKeywords(['ORLAGEM']);
  if (text.includes('PUXADORES')) return sheetByKeywords(['PUXADORES']);
  if (text.includes('RODAP')) return sheetByKeywords(['RODAPE']);
  if (text.includes('ACESS') && text.includes('COZINHA')) return sheetByKeywords(['ACESSORIOS', 'COZINHA']);
  if (text.includes('CESTOS')) return sheetByKeywords(['CESTOS']);
  if (text.includes('PERFIS') || text.includes('FITAS') || text.includes('LED')) return sheetByKeywords(['PERFIS', 'FITAS']);
  if (text.includes('TOMADAS')) return sheetByKeywords(['TOMADAS']);
  if (text.includes('FIXA') || text.includes('PES')) return sheetByKeywords(['PES', 'FIXACAO']);
  if (text.includes('ROUPEIRO')) return sheetByKeywords(['ROUPEIRO']);
  if (text.includes('GAVETAS')) return sheetByKeywords(['GAVETAS']);
  return '';
}

function rows(sheetName) {
  const resolved = resolveSheetName(sheetName);
  return XLSX.utils.sheet_to_json(workbook.Sheets[resolved], { header: 1, defval: null, raw: true });
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function parseSupplierFromText(value) {
  const match = String(value || '').match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : '';
}

const plateRows = rows('PreÃ§os_Placas & Seccionadora');
const plates = plateRows
  .filter(row => typeof row[0] === 'string' && typeof row[1] === 'number' && typeof row[4] === 'number' && typeof row[5] === 'number')
  .map(row => {
    const paintRule = plateRows.find(flagRow => flagRow[8] === row[0])?.[9];
    return {
      name: row[0].trim(),
      supplierPrice: row[1],
      supplier: typeof row[2] === 'string' ? row[2].trim() : '',
      reference: typeof row[3] === 'string' ? row[3].trim() : '',
      cost: row[4],
      client: row[5],
      reseller: typeof row[6] === 'number' ? row[6] : row[5],
      paintable: paintRule !== 'NÃ£o Pintar',
      priceKey: 'MAIN|' + normalizeComparisonKey(row[0])
    };
  });


function comparisonWorkbookPath() {
  const desktop = path.join(process.env.USERPROFILE || 'C:\\Users\\USER', 'Desktop');
  if (!fs.existsSync(desktop)) return '';
  const file = fs.readdirSync(desktop).find(name => {
    const normalized = String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    return normalized.includes('COMPAR') && normalized.includes('PRE') && normalized.endsWith('.XLSX');
  });
  return file ? path.join(desktop, file) : '';
}

function normalizeComparisonKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(\d+)\s*MM\b/gi, '$1MM')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function basePlateText(value) {
  return normalizeComparisonKey(value)
    .replace(/\bDONAE\b/g, 'SONAE')
    .replace(/\bDNAE\b/g, 'SONAE')
    .replace(/\bSNAE\b/g, 'SONAE')
    .replace(/\bF167\b/g, 'L167');
}

function basePlateFamilyKey(name, reference) {
  const text = basePlateText([name, reference].filter(Boolean).join(' '));
  const thicknessMatch = text.match(/\b(\d+(?:[,.]\d+)?)\s*MM\b/) || text.match(/(?:^|\s|-)(\d+(?:[,.]\d+)?)\s*$/);
  const thickness = thicknessMatch ? thicknessMatch[1].replace(',', '.') : '';
  if (text.includes('LUNAWOOD') && /\b212\b/.test(text)) return 'LUNAWOOD 212|3000';
  if (!thickness) return '';
  if (text.includes('TR MAX') || text.includes('TRMAX')) return 'TR-MAX|' + thickness;
  if (text.includes('CONTRAPLACADO') && text.includes('WBP')) return 'CONTRAPLACADO WBP|' + thickness;
  if (text.includes('MDF') && /HIDR[OI]FUG/.test(text)) return 'MDF HIDROFUGO|' + thickness;
  if (text.includes('MDF') && text.includes('STANDARD')) return 'MDF STANDARD|' + thickness;
  if (text.includes('VALCHROMAT')) return 'VALCHROMAT|' + thickness;
  if (text.includes('OSB')) return 'OSB|' + thickness;
  if (text.includes('FOLHA') || text.includes('FOLHEADO')) {
    const wood = text
      .replace(/\b\d+(?:[,.]\d+)?\s*MM\b/g, '')
      .replace(/\bAGLOMERADO\b|\bMDF\b|\bFOLHA\b|\bFOLHEADO\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return 'FOLHEADO ' + wood + '|' + thickness;
  }
  const knownCodeMatch = text.match(/\b(0080 FH|0085 FH|0026 FH|0074 FH|B3768|B3822|B030|B117|B070|B116|C104|C182|C202|CF026|CIF026|CINF026|F026|F067|F6012|F755|G003|G029|G075|H1316|H1357|H1384|H1386|H1714|H1715|H3146|H3368|L166|L167|L3031|M100|M2112|M6341|N005|P001|P114|U156|U608|U702|U705|U707|U750|U775|U999|W1000|W1200)\b(?:\s+(ST\d+|SC|TL|BRI|GLOSS|FUN|FA|FH))?/);
  if (knownCodeMatch) {
    let code = knownCodeMatch[1];
    if (['CF026', 'CIF026', 'CINF026'].includes(code)) code = 'F026';
    if (knownCodeMatch[2] && !code.includes(' ')) code += ' ' + knownCodeMatch[2];
    return code + '|' + thickness;
  }
  const codeMatch = text.match(/\b([A-Z]{1,4}\d{2,5}|\d{3,5})\b(?:\s+(ST\d+|SC|TL|BRI|GLOSS|FUN|FA|FH))?/);
  if (codeMatch) return (codeMatch[1] + (codeMatch[2] ? ' ' + codeMatch[2] : '')) + '|' + thickness;
  return text.replace(/\b\d+(?:[,.]\d+)?\s*MM\b/g, '').trim() + '|' + thickness;
}

function basePlateDisplayName(name, reference, familyKey) {
  let cleanName = String(name || '').replace(/\s+/g, ' ').trim();
  if (/^L167\|16$/.test(familyKey) && basePlateText([name, reference].join(' ')).includes('CINZA ESCURO')) {
    return 'L167 TL SONAE CINZA ESCURO - 16mm';
  }
  if (/^F026\|20$/.test(familyKey) && basePlateText([name, reference].join(' ')).includes('CINZA')) {
    return 'F026 FA C/F POLYREY CINZA - 20mm';
  }
  return cleanName;
}

function basePlateQualityScore(candidate) {
  const text = basePlateText(candidate.name + ' ' + candidate.reference);
  let score = text.length;
  ['SONAE', 'EGGER', 'POLYREY', 'HIDRO', 'HIDROFUG', 'CINZA', 'BRANCO', 'CARVALHO', 'NOGUEIRA', 'TR MAX', 'LUNAWOOD'].forEach(word => {
    if (text.includes(word)) score += 20;
  });
  if (text.includes('DONAE') || text.includes('DNAE') || text.includes('SNAE') || text.includes('F167')) score -= 80;
  return score;
}

function addBaseSupplierPlateOptions() {
  const baseRows = rows('Base_Fornecedores Madeiras');
  const seen = new Set(plates.map(item => [
    basePlateFamilyKey(item.name, item.reference) || normalizeComparisonKey(item.name),
    normalizeComparisonKey(item.supplier),
    Number(item.supplierPrice).toFixed(4)
  ].join('|')));
  const candidates = new Map();

  baseRows.forEach(row => {
    const name = typeof row[1] === 'string' ? row[1].trim() : '';
    const reference = typeof row[2] === 'string' ? row[2].trim() : name;
    const supplierPrice = Number(row[9]);
    const supplier = typeof row[10] === 'string' ? row[10].trim() : '';
    if (!name || !Number.isFinite(supplierPrice) || supplierPrice <= 0) return;
    const familyKey = basePlateFamilyKey(name, reference);
    if (!familyKey) return;

    const key = [
      familyKey,
      normalizeComparisonKey(supplier),
      supplierPrice.toFixed(4)
    ].join('|');
    if (seen.has(key)) return;
    const candidate = { name, reference, supplier, supplierPrice, familyKey };
    const previous = candidates.get(key);
    if (!previous || basePlateQualityScore(candidate) > basePlateQualityScore(previous)) {
      candidates.set(key, candidate);
    }
  });

  candidates.forEach(candidate => {
    const key = [
      candidate.familyKey,
      normalizeComparisonKey(candidate.supplier),
      candidate.supplierPrice.toFixed(4)
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);

    const name = basePlateDisplayName(candidate.name, candidate.reference, candidate.familyKey);
    const cost = candidate.supplierPrice + 2.02;
    plates.push({
      name,
      supplierPrice: candidate.supplierPrice,
      supplier: candidate.supplier,
      reference: candidate.reference,
      cost,
      client: cost * 3,
      reseller: cost * 1.4,
      paintable: true,
      comparisonKey: candidate.familyKey,
      comparisonSource: 'Base_Fornecedores Madeiras',
      priceKey: 'BASE|' + candidate.familyKey + '|' + normalizeComparisonKey(candidate.supplier || candidate.reference)
    });
  });
}

addBaseSupplierPlateOptions();

function addComparisonPlateOptions() {
  const file = comparisonWorkbookPath();
  if (!fs.existsSync(file)) return;
  let comparisonWorkbook;
  try {
    comparisonWorkbook = XLSX.readFile(file, { cellFormula: true, cellText: true });
  } catch (error) {
    return;
  }
  const sheet = comparisonWorkbook.Sheets.PLACAS_26;
  if (!sheet) return;
  const comparisonRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const supplierRow = comparisonRows[3] || [];
  const seen = new Set(plates.map(item => [
    normalizeComparisonKey(item.comparisonKey || item.name),
    normalizeComparisonKey(item.supplier),
    normalizeComparisonKey(item.reference),
    Number(item.supplierPrice).toFixed(4)
  ].join('|')));
  comparisonRows.slice(5).forEach((row, rowIndex) => {
    const family = typeof row[0] === 'string' ? row[0].trim() : '';
    const thickness = typeof row[1] === 'string' ? row[1].replace(/\s+/g, '').trim() : '';
    if (!family || !thickness) return;
    const groupName = family + ' - ' + thickness;
    const comparisonKey = basePlateFamilyKey(groupName, groupName) || normalizeComparisonKey(groupName);
    // Cada fornecedor ocupa duas colunas (designacao + preco). O ficheiro foi
    // crescendo e ja nao termina necessariamente na coluna K, por isso lemos
    // todos os pares anunciados na linha de fornecedores.
    for (let col = 2; col < supplierRow.length; col += 2) {
      const supplier = typeof supplierRow[col] === 'string' ? supplierRow[col].trim() : '';
      const reference = typeof row[col] === 'string' ? row[col].trim() : '';
      const supplierPrice = Number(row[col + 1]);
      if (!supplier || !reference || reference === '-' || !Number.isFinite(supplierPrice) || supplierPrice <= 0) continue;
      const key = [
        comparisonKey,
        normalizeComparisonKey(supplier),
        normalizeComparisonKey(reference),
        supplierPrice.toFixed(4)
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      plates.push({
        name: groupName,
        supplierPrice,
        supplier,
        reference,
        cost: supplierPrice + 2.02,
        client: (supplierPrice + 2.02) * 3,
        reseller: (supplierPrice + 2.02) * 1.4,
        paintable: true,
        comparisonKey,
        comparisonSource: 'PLACAS_26',
        comparisonRow: rowIndex + 6,
        comparisonColumn: col + 1,
        priceKey: ['CMP', comparisonKey, col + 1].join('|')
      });
    }
  });
}

addComparisonPlateOptions();

const paintingRows = rows('PreÃ§o_Pintura');
const paintingInfoRows = rows('InformaÃ§Ãµes Adicionais- Pintura');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

const paintingMaterials = paintingRows.slice(17, 73)
  .filter(row => typeof row[1] === 'string' && typeof row[3] === 'number')
  .map(row => ({
    item: row[1].trim(),
    supplier: 'Lage & SÃ¡',
    reference: row[1].trim(),
    rowNumber: paintingRows.findIndex(candidate => candidate === row) + 1,
    liters: Number(row[2]) || 0,
    rowNumber: paintingRows.findIndex(candidate => candidate === row) + 1,
    supplierPrice: Number(row[3]) || 0,
    cost: Number(row[4]) || Number(row[3]) || 0,
    costPerLiter: Number(row[5]) || 0
  }));

function paintingMaterial(patterns) {
  const normalizedPatterns = patterns.map(normalizeText);
  return paintingMaterials.find(material => {
    const item = normalizeText(material.item);
    return normalizedPatterns.every(pattern => item.includes(pattern));
  }) || null;
}

function exactPaintingMaterial(name) {
  const normalizedName = normalizeText(name);
  return paintingMaterials.find(material => normalizeText(material.item) === normalizedName) || null;
}

function paintingRecipeInfo(recipe, role) {
  const normalizedRecipe = normalizeText(recipe);
  const normalizedRole = normalizeText(role);
  let activeRecipe = '';
  return paintingInfoRows
    .slice(3, 15)
    .map(row => {
      if (typeof row[0] === 'string' && row[0].trim()) activeRecipe = row[0].trim();
      return {
        recipe: activeRecipe,
        liters: Number(row[1]) || 0,
        component: typeof row[2] === 'string' ? row[2].trim() : ''
      };
    })
    .filter(row => normalizeText(row.recipe) === normalizedRecipe && normalizeText(row.component) === normalizedRole)
    .map(row => row.liters + 'L')
    .join(' / ');
}

function mixRecipe(rowNumber, combination, serviceNames) {
  const row = paintingRows[rowNumber - 1] || [];
  const mixName = typeof row[9] === 'string' ? row[9].trim() : '';
  const liters = row[10] || '';
  return {
    group: 'Pinturas - produtos por tipo',
    item: mixName,
    supplier: 'Lage & SÃ¡',
    reference: combination,
    supplierPrice: Number(row[11]) || 0,
    cost: Number(row[17]) || Number(row[12]) || 0,
    client: 0,
    serviceNames,
    detail: (liters ? 'Mistura Excel: ' + liters + 'L / ' : '') + 'CombinaÃ§Ã£o: ' + combination
  };
}

function recipeRow() {
  return null;
}

const oldPaintRecipes = [
  recipeRow('TAPA-POROS POLIRETANO', 'otafond poliretano', [
    paintingMaterial(['OTAFOND', 'POLIURETANO', '1028']),
    paintingMaterial(['FUNDO', 'POLIURETANO', 'OTAFOND'])
  ], ['Tapa-poros Poliretano']),
  recipeRow('TAPA-POROS POLIRETANO', 'catalizador', [
    paintingMaterial(['CATALIZADOR', '1028'])
  ], ['Tapa-poros Poliretano']),
  recipeRow('VERNIZ POLIRETANO', 'verniz otadur ou stone 2k mate', [
    paintingMaterial(['VERNIZ', 'OTADUR', 'MATE']),
    paintingMaterial(['STONE', '2K', 'MATE'])
  ], ['Verniz Mate Poliretano', 'Verniz Poliretano Meio Brilhante', 'Verniz Poliretano Alto Brilhante']),
  recipeRow('VERNIZ POLIRETANO', 'catalizador ou endurecedor', [
    paintingMaterial(['CATALIZADOR', '2011']),
    paintingMaterial(['ENDURECEDOR', 'ELITE'])
  ], ['Verniz Mate Poliretano', 'Verniz Poliretano Meio Brilhante', 'Verniz Poliretano Alto Brilhante']),
  recipeRow('TAPA-POROS ACRÃLICO', 'azpifond', [
    paintingMaterial(['AZPIFOND'])
  ], ['Tapa-poros Acrilico']),
  recipeRow('TAPA-POROS ACRÃLICO', 'catalizador', [
    paintingMaterial(['CATALIZADOR', 'C 212-N', '4L'])
  ], ['Tapa-poros Acrilico']),
  recipeRow('VERNIZ ACRÃLICO / NATUR', 'goyake ou otacril', [
    paintingMaterial(['GOYLAKE']),
    paintingMaterial(['OTACRIL'])
  ], ['Verniz Natur / Acrilico']),
  recipeRow('VERNIZ ACRÃLICO / NATUR', 'catalizador', [
    paintingMaterial(['CATALIZADOR', 'C 212-N', '2L'])
  ], ['Verniz Natur / Acrilico']),
  recipeRow('SUBCAPA', 'otafond ou iguaprim branco', [
    paintingMaterial(['OTAFOND', 'FPP', 'BRANCO']),
    paintingMaterial(['IGUAPRIM', 'BRANCO'])
  ], ['Subcapa Branco', 'Subcapa Preto']),
  recipeRow('SUBCAPA', 'endurecedor', [
    paintingMaterial(['ENDURECEDOR', 'EN 266'])
  ], ['Subcapa Branco', 'Subcapa Preto']),
  recipeRow('ESMALTE', 'esmalte ou otalil', [
    paintingMaterial(['ESMALTE', 'OTADUR', 'BRANCO']),
    paintingMaterial(['OTALIL'])
  ], ['Esmalte Mate Branco', 'Esmalte Mate Cores Claras com AfinaÃ§Ã£o', 'Esmalte Mate Cores Escuras com AfinaÃ§Ã£o', 'Esmalte Brilhante']),
  recipeRow('ESMALTE', 'catalizador ou acelerante', [
    exactPaintingMaterial('CATALIZADOR EN 4444 2,5L'),
    paintingMaterial(['ACELARANTE'])
  ], ['Esmalte Mate Branco', 'Esmalte Mate Cores Claras com AfinaÃ§Ã£o', 'Esmalte Mate Cores Escuras com AfinaÃ§Ã£o', 'Esmalte Brilhante'])
].filter(Boolean);

const paintRecipes = [
  mixRecipe(18, 'OTAFOND POLIURETANO + CATALIZADOR', ['Tapa-poros Poliretano']),
  mixRecipe(19, 'VERNIZ OTADUR + CATALIZADOR / STONE 2K MATE + ENDURECEDOR', ['Verniz Mate Poliretano']),
  mixRecipe(20, 'VERNIZ OTADUR + CATALIZADOR / STONE 2K MATE + ENDURECEDOR', ['Verniz Poliretano Meio Brilhante']),
  mixRecipe(21, 'VERNIZ OTADUR + CATALIZADOR / STONE 2K MATE + ENDURECEDOR', ['Verniz Poliretano Alto Brilhante']),
  mixRecipe(22, 'AZPIFOND + CATALIZADOR', ['Tapa-poros Acrilico']),
  mixRecipe(23, 'GOYLAKE OU OTACRIL + CATALIZADOR', ['Verniz Natur / Acrilico']),
  mixRecipe(24, 'OTAFOND OU IGUAPRIM + ENDURECEDOR', ['Subcapa Branco']),
  mixRecipe(25, 'OTAFOND OU IGUAPRIM + ENDURECEDOR', ['Subcapa Preto']),
  mixRecipe(26, 'ESMALTE + CATALIZADOR / OTALIL + ACELARANTE', ['Esmalte Mate Branco']),
  mixRecipe(27, 'ESMALTE + CATALIZADOR / OTALIL + ACELARANTE', ['Esmalte Mate Cores Claras com AfinaÃ§Ã£o']),
  mixRecipe(28, 'ESMALTE + CATALIZADOR / OTALIL + ACELARANTE', ['Esmalte Mate Cores Escuras com AfinaÃ§Ã£o']),
  mixRecipe(29, 'ESMALTE + CATALIZADOR / OTALIL + ACELARANTE', ['Esmalte Brilhante'])
];

const paintingComponents = paintingRows.slice(17, 73)
  .filter(row => typeof row[1] === 'string' && typeof row[4] === 'number')
  .map(row => ({
    group: 'Pinturas - componentes',
    item: row[1].trim(),
    supplier: 'Lage & SÃ¡',
    reference: row[1].trim(),
    supplierPrice: Number(row[3]) || 0,
    cost: Number(row[4]) || 0,
    client: 0,
    detail: 'Qtd: ' + (row[2] || '') + 'L'
  }));
const paintingMixDetails = paintingRows.slice(17, 46)
  .filter(row => typeof row[9] === 'string' && typeof row[12] === 'number')
  .map(row => ({
    group: 'Pinturas - misturas',
    item: row[9].trim(),
    supplier: 'Lage & SÃ¡',
    reference: row[9].trim(),
    supplierPrice: Number(row[12]) || 0,
    cost: Number(row[17]) || Number(row[12]) || 0,
    client: 0,
    detail: 'Mistura: ' + (row[10] || '') + 'L / ' + (row[13] || '') + ' mao(s)'
  }));
const paintingClientPrices = new Map(
  paintingRows.slice(49, 60)
    .filter(row => typeof row[9] === 'string' && typeof row[10] === 'number')
    .map(row => [row[9].trim(), row[10]])
);
const paintingServiceDetails = {
  'Verniz Mate Poliretano': 'tapa-poros poliretano + verniz poliretano mate',
  'Verniz Poliretano Meio Brilhante': 'tapa-poros poliretano + verniz poliretano meio brilhante',
  'Verniz Poliretano Alto Brilhante': 'tapa-poros poliretano + verniz poliretano alto brilho',
  'Verniz Natur / Acrilico': 'verniz acrilico / natur',
  'Velaturas Claras c/ AfinaÃ§Ã£o': 'velatura + tapa-poros acrilico + verniz acrilico / natur',
  'Velaturas Escuras c/ AfinaÃ§Ã£o': 'velatura + tapa-poros poliretano + verniz poliretano',
  'Esmalte Mate Branco': 'subcapa branco + esmalte branco',
  'Esmalte Mate Cores Claras com AfinaÃ§Ã£o': 'subcapa branco + esmalte cores claras',
  'Esmalte Mate Cores Escuras com AfinaÃ§Ã£o': 'subcapa preto + esmalte cores escuras',
  'Esmalte Brilhante': 'subcapa + esmalte alto brilho'
};
function paintingServiceReference(name) {
  const text = normalizeText(name);
  if (text.includes('VERNIZ') && text.includes('MATE') && text.includes('POLI')) return 'tapa-poros poliuretano + verniz poliuretano mate';
  if (text.includes('VERNIZ') && text.includes('MEIO') && text.includes('BRILHANTE')) return 'tapa-poros poliuretano + verniz poliuretano meio brilhante';
  if (text.includes('VERNIZ') && text.includes('ALTO') && text.includes('BRILHANTE')) return 'tapa-poros poliuretano + verniz poliuretano alto brilho';
  if (text.includes('VERNIZ') && text.includes('NATUR')) return 'verniz acrilico / natur';
  if (text.includes('VELATURAS') && text.includes('CLARAS')) return 'velatura + tapa-poros acrilico + verniz acrilico / natur';
  if (text.includes('VELATURAS') && text.includes('ESCURAS')) return 'velatura + tapa-poros poliuretano + verniz poliuretano';
  if (text.includes('ESMALTE') && text.includes('BRANCO')) return 'subcapa branco + esmalte branco';
  if (text.includes('ESMALTE') && text.includes('CLARAS')) return 'subcapa branco + esmalte cores claras';
  if (text.includes('ESMALTE') && text.includes('ESCURAS')) return 'subcapa preto + esmalte cores escuras';
  if (text.includes('ESMALTE') && text.includes('BRILHANTE')) return 'subcapa + esmalte alto brilho';
  return paintingServiceDetails[name] || '';
}
const paintings = [{ name: 'Nenhuma', cost: 0, client: 0 }].concat(
  paintingRows.slice(36, 46)
    .filter(row => typeof row[9] === 'string' && typeof row[10] === 'number')
    .map(row => ({
      name: row[9].trim(),
      supplier: 'Lage & SÃ¡',
      reference: paintingServiceReference(row[9].trim()),
      supplierPrice: paintingClientPrices.get(row[9].trim()) || 0,
      cost: row[10],
      client: paintingClientPrices.get(row[9].trim()) || 0
    }))
);

const systemRows = rows('PreÃ§o_Sistema Abertura Portas');
function referencedItems(reference) {
  return String(reference || '')
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s*\d+(?:[.,]\d+)?\s*x\s*/i, '')
      .replace(/\s*\([^)]*\)\s*$/g, '')
      .trim())
    .filter(Boolean);
}

const hinges = systemRows.slice(41, 44).map(row => ({
  name: row[3],
  supplier: '',
  reference: row[5] || '',
  recipeItems: referencedItems(row[5]),
  supplierPrice: 0,
  cost: Number(row[4]) || 0,
  client: Number(row[8]) || 0
}));
const doorSystems = systemRows.slice(45, 51)
  .filter(row => typeof row[3] === 'string' && typeof row[4] === 'number')
  .map(row => ({ name: row[3], supplier: '', reference: row[5] || '', supplierPrice: 0, cost: row[4], client: Number(row[8]) || 0 }));
function systemComponentRows(config) {
  return systemRows.slice(10, 32)
    .filter(row => typeof row[config.item] === 'string' && typeof row[config.supplier] === 'string' && typeof row[config.price] === 'number')
    .map(row => ({
      group: config.group,
      item: row[config.item].trim(),
      supplier: row[config.supplier].trim(),
      reference: row[config.item].trim(),
      supplierPrice: Number(row[config.price]) || 0,
      labor: Number(row[config.labor]) || 0,
      cost: Number(row[config.total]) || Number(row[config.price]) || 0,
      client: 0,
      label: typeof row[config.label] === 'string' ? row[config.label].trim() : row[config.item].trim()
    }));
}
const hingeComponents = systemComponentRows({ group: 'DobradiÃƒÂ§as / Ferragens', item: 3, supplier: 4, price: 5, labor: 6, total: 7, label: 8 });
const openingSystemComponents = [
  ...systemComponentRows({ group: 'Sistemas de abertura', item: 12, supplier: 13, price: 14, labor: 15, total: 16, label: 17 }),
  ...systemComponentRows({ group: 'Sistemas de abertura', item: 21, supplier: 22, price: 23, labor: 24, total: 25, label: 26 })
];

const edgeSheetRows = rows('PreÃ§o_Orlagem');
const edgeHeader = edgeSheetRows[0] || [];
function edgeColumn(matchers, fallback) {
  const index = edgeHeader.findIndex(value => {
    const text = normalizeText(value);
    return matchers.every(matcher => text.includes(matcher));
  });
  return index >= 0 ? index : fallback;
}
const edgeSupplierColumn = edgeHeader.findIndex(value => {
  const text = normalizeText(value);
  return text.includes('FORNECEDOR') || text.includes('FONECEDOR');
});
const edgeSupplierPriceColumn = edgeColumn(['CUSTO', 'MATERIAL'], 1);
const edgeMaterialMeterColumn = edgeColumn(['MATERIAL', 'ML'], 2);
const edgeCostColumn = edgeColumn(['MOD'], 3);
const edgeClientColumn = edgeColumn(['MARGEM'], 4);
const edgeRows = edgeSheetRows.slice(1, 10);
const edges = edgeRows
  .filter(row => typeof row[0] === 'string')
  .map(row => ({
    name: row[0],
    supplier: normalizeText(row[0]) === 'SERVICO SEM ORLA'
      ? ''
      : (edgeSupplierColumn >= 0 && typeof row[edgeSupplierColumn] === 'string' ? row[edgeSupplierColumn].trim() : ''),
    reference: 'Custo material',
    supplierPrice: Number(row[edgeSupplierPriceColumn]) || 0,
    materialPerMeter: Number(row[edgeMaterialMeterColumn]) || 0,
    supplierMeters: Number(row[edgeSupplierPriceColumn]) && Number(row[edgeMaterialMeterColumn])
      ? Number(row[edgeSupplierPriceColumn]) / Number(row[edgeMaterialMeterColumn])
      : 0,
    cost: Number(row[edgeCostColumn]) || 0,
    client: Number(row[edgeClientColumn]) || 0
  }));


const extraConfigs = [
  { sheet: 'PreÃ§o_Puxadores', group: 'Puxadores', item: 1, label: 8, cost: 5, client: 7 },
  { sheet: 'PreÃ§o_RodapÃ©s', group: 'RodapÃ©s (metros)', item: 0, label: 6, cost: 4, client: 5 },
  { sheet: 'PreÃ§o_AcessÃ³rios Cozinha', group: 'AcessÃ³rios Cozinha', item: 0, label: 6, cost: 4, client: 5 },
  { sheet: 'PreÃ§o_Cestos Lixo', group: 'Cestos do Lixo', item: 0, label: 6, cost: 4, client: 5 },
  { sheet: 'PreÃ§o_Perfis e Fitas LED', group: 'LEDÂ´S (metros)', item: 0, label: 6, cost: 4, client: 5 },
  { sheet: 'PreÃ§os_Tomadas', group: 'Tomadas', item: 0, label: 6, cost: 4, client: 5 },
  { sheet: 'PreÃ§os_PÃ©s, FixaÃ§Ã£o e Organiza.', group: 'PÃ©s, FixaÃ§Ã£o e OrganizaÃ§Ã£o', item: 0, label: 4, cost: 2, client: 3 },
  { sheet: 'PreÃ§o_AcessÃ³rios Roupeiro', group: 'AcessÃ³rios Roupeiro', item: 0, label: 6, cost: 4, client: 5 }
];

const extras = extraConfigs.flatMap(config => rows(config.sheet)
  .filter(row => typeof row[config.item] === 'string' && typeof row[config.cost] === 'number' && typeof row[config.client] === 'number')
  .map(row => ({
    group: config.group,
    item: row[config.item].trim(),
    supplier: typeof row[config.item + 1] === 'string' ? row[config.item + 1].trim() : '',
    reference: row[config.item].trim(),
    supplierPrice: Number(row[config.item + 2]) || 0,
    label: typeof row[config.label] === 'string' ? row[config.label].trim() : row[config.item].trim(),
    cost: row[config.cost],
    client: row[config.client]
  })));

const costSheet = workbook.Sheets.Caixote_Custo;
for (let row = 59; row <= 70; row += 1) {
  const item = costSheet['B' + row]?.v;
  const cost = costSheet['E' + row]?.v;
  const client = costSheet['E' + (row + 75)]?.v;
  if (typeof item === 'string' && typeof cost === 'number' && typeof client === 'number') {
    extras.push({ group: 'Gavetas', item, label: item, cost, client });
  }
}

const feetSheetName = Object.keys(workbook.Sheets).find(name => normalizeText(name).includes('PES') && normalizeText(name).includes('FIX')) || 'PreÃ§os_PÃ©s, FixaÃ§Ã£o e Organiza.';
const feetSheet = workbook.Sheets[feetSheetName] || {};
const feetPrices = {
  small: { cost: Number(feetSheet.C25?.v) || 0, client: Number(feetSheet.C30?.v) || 0 },
  large: { cost: Number(feetSheet.C26?.v) || 0, client: Number(feetSheet.C31?.v) || 0 }
};

const drawerSheetName = Object.keys(workbook.Sheets).find(name => name.includes('Gavetas'));
const drawerRows = drawerSheetName ? rows(drawerSheetName) : [];
const drawerComponents = [];
const drawerRecipes = [];
const drawerLabor = Number(drawerRows[1]?.[7]) || 0;
function drawerTypeName(value) {
  const text = normalizeText(value);
  if ((text.includes('GAVETAO') || text.includes('GAVTEAO')) && text.includes('INTERIOR')) return 'GAVETÃƒO INTERIOR';
  if ((text.includes('GAVETAO') || text.includes('GAVTEAO')) && text.includes('EXTERIOR')) return 'GAVETÃƒO EXTERIOR';
  if (text.includes('GAVETA') && text.includes('INTERIOR')) return 'GAVETA INTERIOR';
  if (text.includes('GAVETA') && text.includes('EXTERIOR')) return 'GAVETA EXTERIOR';
  return '';
}
function drawerComponentKey(item, supplier) {
  return normalizeText(item) + '|' + normalizeText(supplier);
}
function addDrawerComponent(component) {
  const key = drawerComponentKey(component.item, component.supplier);
  if (drawerComponents.some(item => drawerComponentKey(item.item, item.supplier) === key)) return;
  drawerComponents.push(component);
}
[
  { family: 'Tandembox Antaro', offset: 0 },
  { family: 'Merivobox', offset: 6 },
  { family: 'Legrabox', offset: 12 }
].forEach(config => {
  const recipeEnd = drawerRows.findIndex(row => normalizeText(row[0]).includes('PRECO VENDA'));
  const drawerWorkingRows = drawerRows.slice(10, recipeEnd > 10 ? recipeEnd : undefined);
  drawerWorkingRows.forEach(row => {
    const item = row[config.offset];
    const supplier = row[config.offset + 1];
    const price = row[config.offset + 2];
    const label = row[config.offset + 3];
    if (typeof item === 'string' && typeof supplier === 'string' && typeof price === 'number' && typeof label === 'string' && label.trim()) {
      addDrawerComponent({
        group: 'Gavetas - componentes',
        family: config.family,
        item: item.trim(),
        supplier: supplier.trim(),
        reference: item.trim(),
        supplierPrice: price,
        cost: price,
        client: 0,
        label: typeof label === 'string' ? label.trim() : item.trim()
      });
    }
  });
  let activeType = '';
  let activeRecipe = null;
  drawerWorkingRows.forEach(row => {
    const type = drawerTypeName(row[config.offset]);
    if (type) {
      activeType = type;
      activeRecipe = { family: config.family, type, labor: drawerLabor, components: [] };
      drawerRecipes.push(activeRecipe);
      return;
    }
    if (!activeRecipe) return;
    const item = row[config.offset];
    const supplier = row[config.offset + 1];
    const quantity = row[config.offset + 2];
    const unitCost = row[config.offset + 3];
    if (typeof item !== 'string' || typeof supplier !== 'string') return;
    if (!Number.isFinite(Number(quantity)) || !Number.isFinite(Number(unitCost))) return;
    const cleanItem = item.trim();
    const cleanSupplier = supplier.trim();
    if (!cleanItem || cleanItem.toLowerCase().includes('custo') || cleanItem.toLowerCase().includes('mÃƒÂ£o')) return;
    activeRecipe.components.push({
      item: cleanItem,
      supplier: cleanSupplier,
      quantity: Number(quantity)
    });
    addDrawerComponent({
      group: 'Gavetas - componentes',
      family: config.family,
      item: cleanItem,
      supplier: cleanSupplier,
      reference: cleanItem,
      supplierPrice: Number(unitCost),
      cost: Number(unitCost),
      client: 0,
      label: cleanItem
    });
  });
});

const catalog = { plates, paintings, doorSystems, hinges, hingeComponents, openingSystemComponents, edges, extras, paintingComponents, paintingMixDetails, paintRecipes, drawerComponents, drawerRecipes };

const lists = {
  tipos: ['Inferior', 'Superior', 'Coluna', 'Roupeiro', 'PeÃ§as/Placa'],
  simNao: ['Sim', 'NÃ£o'],
  toposHorizontais: ['Sim', 'NÃ£o', 'SÃ³ Cima', 'SÃ³ Baixo'],
  toposLaterais: ['Sim', 'NÃ£o', 'SÃ³ Esquerda', 'SÃ³ Direita'],
  tipoLateralTopo: ['NÃ£o', 'Inteira', 'Sarrafo 15cm'],
  pinturas: paintings.map(item => item.name),
  sistemasPorta: doorSystems.map(item => item.name),
  dobradicas: hinges.map(item => item.name),
  interiores: unique(plates.map(item => item.name)),
  exteriores: unique(plates.map(item => item.name)),
  orlas: edges.map(item => item.name),
  extraGroups: unique(extras.map(item => item.group))
};

const typePresets = {
  Inferior: {
    type: 'Inferior',
    family: 'ARMÃRIO COZINHA - CAIXOTES INFERIORES',
    width: 15,
    height: 78,
    depth: 60,
    doors: 1,
    drawers: 0,
    shelves: 0,
    back: 1,
    divider: 0,
    interior: 'Melamina F067 HidrÃ³fuga - 16mm',
    exterior: 'Melamina Branca HidrÃ³fuga B3768 - 16mm',
    paintDoor: 'Velaturas Claras c/ AfinaÃ§Ã£o',
    paintInterior: 'Nenhuma',
    doorSystem: 'Normal',
    hinge: 'DobradiÃ§a Standard (com mola)',
    edgeType: 'Orla - Ã€ Cor',
    topBottomEdges: 'Sim',
    sideEdges: 'Sim',
    sideLeftEdge: 'Inteira',
    sideRightEdge: 'Inteira',
    unitClient: 103.00077712,
    unitCost: 37.0520144533
  },
  Superior: {
    type: 'Superior',
    family: 'ARMÃRIO COZINHA - CAIXOTES SUPERIORES',
    width: 90,
    height: 100,
    depth: 40,
    doors: 2,
    drawers: 0,
    shelves: 1,
    back: 1,
    divider: 0,
    interior: 'Melamina F067 HidrÃ³fuga - 16mm',
    exterior: 'Termolaminado Cinza Alto Brilho - 19mm',
    paintDoor: 'Nenhuma',
    paintInterior: 'Nenhuma',
    doorSystem: 'Tip-on (Pulsador Preto) / Tic-Tac',
    hinge: 'DobradiÃ§a Standard (com mola)',
    edgeType: 'Orla - Standard 1mm',
    topBottomEdges: 'Sim',
    sideEdges: 'Sim',
    sideLeftEdge: 'Inteira',
    sideRightEdge: 'Inteira',
    unitClient: 316.4267467844,
    unitCost: 120.0217755948
  },
  Coluna: {
    type: 'Coluna',
    family: 'ARMÃRIO COZINHA - COLUNA',
    width: 60,
    height: 240,
    depth: 60,
    doors: 1,
    drawers: 0,
    shelves: 3,
    back: 1,
    divider: 0,
    interior: 'Melamina F067 HidrÃ³fuga - 16mm',
    exterior: 'Termolaminado Cinza Alto Brilho - 19mm',
    paintDoor: 'Esmalte Mate Branco',
    paintInterior: 'Esmalte Mate Branco',
    doorSystem: 'Tip-on (Pulsador Preto) / Tic-Tac',
    hinge: 'DobradiÃ§a Standard (com mola)',
    edgeType: 'Orla - Ã€ Cor',
    topBottomEdges: 'Sim',
    sideEdges: 'Sim',
    sideLeftEdge: 'Inteira',
    sideRightEdge: 'Inteira',
    unitClient: 660.2972606042,
    unitCost: 239.7737551481
  },
  Roupeiro: {
    type: 'Roupeiro',
    family: 'ARMÃRIO COZINHA - ROUPEIRO',
    width: 60,
    height: 240,
    depth: 60,
    doors: 1,
    drawers: 0,
    shelves: 3,
    back: 1,
    divider: 0,
    interior: 'Melamina F067 HidrÃ³fuga - 16mm',
    exterior: 'Termolaminado Cinza Alto Brilho - 19mm',
    paintDoor: 'Esmalte Mate Branco',
    paintInterior: 'Esmalte Mate Branco',
    doorSystem: 'Tip-on (Pulsador Preto) / Tic-Tac',
    hinge: 'DobradiÃ§a Standard (com mola)',
    edgeType: 'Orla - Ã€ Cor',
    topBottomEdges: 'Sim',
    sideEdges: 'Sim',
    sideLeftEdge: 'Inteira',
    sideRightEdge: 'Inteira',
    unitClient: 660.2972606042,
    unitCost: 239.7737551481
  },
  'PeÃ§as/Placa': {
    type: 'PeÃ§as/Placa',
    family: 'PEÃ‡AS / PLACA',
    width: 100,
    height: 100,
    depth: 0,
    doors: 0,
    drawers: 0,
    shelves: 0,
    back: 1,
    divider: 0,
    interior: 'Melamina F067 HidrÃ³fuga - 16mm',
    exterior: 'NÃ£o aplicÃ¡vel',
    paintDoor: 'Nenhuma',
    paintInterior: 'Nenhuma',
    doorSystem: 'Normal',
    hinge: 'Nenhuma',
    edgeType: 'ServiÃ§o Sem Orla',
    topBottomEdges: 'NÃ£o',
    sideEdges: 'NÃ£o',
    sideLeftEdge: 'NÃ£o',
    sideRightEdge: 'NÃ£o',
    unitClient: 0,
    unitCost: 0
  }
};

function inferType(module) {
  if (lists.tipos.includes(module.type)) return module.type;
  const typeText = sheetText(module.type);
  if (typeText.includes('PLACA')) return 'PeÃ§as/Placa';
  const family = sheetText(module.family);
  if (family.includes('PECAS') || family.includes('PLACA')) return 'PeÃ§as/Placa';
  if (family.includes('SUPERIOR')) return 'Superior';
  if (family.includes('ROUPEIRO')) return 'Roupeiro';
  if (family.includes('COLUNA')) return 'Coluna';
  return 'Inferior';
}

function pricingSnapshot(module) {
  return {
    width: Number(module.width) || 0,
    height: Number(module.height) || 0,
    depth: Number(module.depth) || 0,
    doors: Number(module.doors) || 0,
    shelves: Number(module.shelves) || 0,
    back: Number(module.back) || 0,
    divider: Number(module.divider) || 0,
    interior: module.interior,
    exterior: module.exterior,
    paintDoor: module.paintDoor || 'Nenhuma',
    paintInterior: module.paintInterior || 'Nenhuma',
    doorSystem: module.doorSystem || 'Normal',
    hinge: module.hinge || 'DobradiÃ§a Standard (com mola)',
    edgeType: module.edgeType || 'Orla - Ã€ Cor',
    topBottomEdges: module.topBottomEdges || 'Sim',
    sideEdges: module.sideEdges || 'Sim',
    sideLeftEdge: module.sideLeftEdge || '',
    sideRightEdge: module.sideRightEdge || '',
    unitClient: Number(module.unitClient) || 0,
    unitCost: Number(module.unitCost) || 0
  };
}

function enrichModules(modules) {
  return modules.map(module => {
    const type = inferType(module);
    const enriched = { ...typePresets[type], ...module, type };
    enriched.pricingBase = module.pricingBase || pricingSnapshot(enriched);
    return enriched;
  });
}

function findPrice(items, name) {
  const wanted = sheetText(name);
  if (!wanted) return { cost: 0, client: 0, reseller: 0 };
  return items.find(item => item.name === name) ||
    items.find(item => sheetText(item.name) === wanted) ||
    { cost: 0, client: 0, reseller: 0 };
}

function plateCodeThicknessKey(value) {
  const text = sheetText(value).replace(/\|/g, ' ');
  const thickness = text.match(/\b(\d+(?:[,.]\d+)?)\s*MM\b/) || text.match(/(?:^|\s|-)(\d+(?:[,.]\d+)?)\s*$/);
  if (thickness && text.includes('MDF') && /HIDR[OI]FUG/.test(text)) return 'MDF HIDROFUGO|' + thickness[1].replace(',', '.');
  if (thickness && text.includes('MDF') && text.includes('STANDARD')) return 'MDF STANDARD|' + thickness[1].replace(',', '.');
  const code = text.match(/\b([A-Z]{1,4}\d{2,5}|\d{3,5})\b/);
  if (!thickness || !code) return '';
  return code[1] + '|' + thickness[1].replace(',', '.');
}

function findPlatePrice(name) {
  const exact = findPrice(catalog.plates, name);
  if (exact.name || exact.cost || exact.client || exact.reseller) return exact;
  const wantedKey = plateCodeThicknessKey(name);
  if (!wantedKey) return exact;
  return catalog.plates.find(item => {
    return plateCodeThicknessKey(item.name) === wantedKey ||
      plateCodeThicknessKey(item.reference) === wantedKey ||
      plateCodeThicknessKey(item.comparisonKey) === wantedKey;
  }) || exact;
}

function selectionCount(value) {
  const text = sheetText(value).replace(/[^A-Z]/g, '');
  if (text === 'SIM') return 2;
  if (text === 'NAO' || text === 'NO') return 0;
  return 1;
}

function sideTopTypeFromLegacy(value, side) {
  const text = sheetText(value).replace(/[^A-Z]/g, '');
  if (text === 'SIM') return 'Inteira';
  if (text === 'NAO' || text === 'NO') return 'NÃ£o';
  if (side === 'left' && text.includes('ESQUERDA')) return 'Inteira';
  if (side === 'right' && text.includes('DIREITA')) return 'Inteira';
  return 'NÃ£o';
}

function sideTopDepth(value, moduleDepth) {
  const text = sheetText(value).replace(/[^A-Z]/g, '');
  if (!text || text.includes('NAO') || text.includes('NO')) return 0;
  if (text.includes('SARRAFO')) return Math.min(15, moduleDepth);
  return moduleDepth;
}

function plateThicknessCm(...values) {
  for (const value of values) {
    const text = sheetText(value);
    const match = text.match(/\b(\d+(?:[,.]\d+)?)\s*MM\b/) || text.match(/(?:^|\s|-)(\d+(?:[,.]\d+)?)\s*$/);
    if (match) return Number(match[1].replace(',', '.')) / 10;
  }
  return 1.9;
}

function sidePaintArea(value, moduleHeight, moduleDepth, thicknessCm) {
  const depth = sideTopDepth(value, moduleDepth);
  if (!depth) return 0;
  return moduleHeight * (depth + thicknessCm) / 10000;
}

function calculateModulePrice(module, pricingMode = 'normal') {
  const type = inferType(module);
  const calculationType = type === 'Roupeiro' ? 'Coluna' : type;
  const isPiecePlate = sheetText(type).includes('PLACA');
  const w = Number(module.width) || 0;
  const h = Number(module.height) || 0;
  const d = isPiecePlate ? 0 : (Number(module.depth) || 0);
  const doors = isPiecePlate ? 0 : (Number(module.doors) || 0);
  const shelves = isPiecePlate ? 0 : (Number(module.shelves) || 0);
  const back = isPiecePlate ? 1 : (Number(module.back) || 0);
  const divider = isPiecePlate ? 0 : (Number(module.divider) || 0);
  const drawerCount = 0;
  const plateSellKey = pricingMode === 'reseller' ? 'reseller' : 'client';
  const accessorySellKey = pricingMode === 'reseller' ? 'reseller' : 'client';

  if (!String(module.interior || '').trim()) return { unitCost: 0, unitClient: 0 };
  const hasExterior = !isPiecePlate && Boolean(String(module.exterior || '').trim());

  const interior = findPlatePrice(module.interior);
  const exterior = hasExterior ? findPlatePrice(module.exterior) : { cost: 0, client: 0, reseller: 0, paintable: false };
  if (!interior.name && !interior.cost && !interior.client && !interior.reseller) return { unitCost: 0, unitClient: 0 };
  if (hasExterior && !exterior.name && !exterior.cost && !exterior.client && !exterior.reseller) return { unitCost: 0, unitClient: 0 };
  const interiorPaint = !isPiecePlate ? findPrice(catalog.paintings, module.paintInterior || 'Nenhuma') : { cost: 0, client: 0 };
  const doorPaint = hasExterior || isPiecePlate ? findPrice(catalog.paintings, module.paintDoor || 'Nenhuma') : { cost: 0, client: 0 };
  const selectedEdge = findPrice(catalog.edges, module.edgeType || 'Orla - Ã€ Cor');
  const edge = isPiecePlate || /sem orla/i.test(module.edgeType || '')
    ? { cost: 0, client: 0 }
    : selectedEdge;
  const system = findPrice(catalog.doorSystems, module.doorSystem || 'Normal');
  const selectedHinge = findPrice(catalog.hinges, module.hinge || 'DobradiÃ§a Standard (com mola)');
  const isTipOnSystem = sheetText(module.doorSystem).includes('TIP-ON') || sheetText(module.doorSystem).includes('TIP ON');
  const effectiveHinge = isTipOnSystem
    ? findPrice(catalog.hinges, 'DobradiÃ§a Livre (sem mola)')
    : selectedHinge;

  const uprightArea = 2 * h * d / 10000;
  const topBottomArea = 2 * w * d / 10000;
  const shelfArea = shelves * w * d / 10000;
  const backArea = back * h * w / 10000;
  const dividerArea = divider * h * d / 10000;
  const rawBoxPaintArea = (w * h + 2 * w * d + 2 * h * d) / 10000 + shelfArea + dividerArea;
  const drawerBottomArea = drawerCount * Math.max(0, w * d - 32.5 - 17) / 10000;
  const piecePaintArea = isPiecePlate ? w * h / 10000 : 0;
  const topFaceCount = hasExterior ? selectionCount(module.topBottomEdges) : 0;
  const topFaceArea = topFaceCount * w * d / 10000;
  const leftSideTop = module.sideLeftEdge || sideTopTypeFromLegacy(module.sideEdges, 'left');
  const rightSideTop = module.sideRightEdge || sideTopTypeFromLegacy(module.sideEdges, 'right');
  const exteriorThicknessCm = plateThicknessCm(module.exterior, exterior.name, exterior.reference);
  const topPaintingArea = topFaceCount * (w * d + w * exteriorThicknessCm + d * exteriorThicknessCm) / 10000;
  const sideDistribution = Array.isArray(module.sideDistribution)
    ? module.sideDistribution.filter(row => Number(row.quantity) > 0)
    : [];
  const sideDistributionQty = sideDistribution.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const sideMaterialArea = hasExterior
    ? (sideDistribution.length && sideDistributionQty > 0
        ? sideDistribution.reduce((sum, row) => {
            const qty = Number(row.quantity) || 0;
            return sum + qty * h * (
              sideTopDepth(row.sideLeftEdge || leftSideTop, d) +
              sideTopDepth(row.sideRightEdge || rightSideTop, d)
            ) / 10000;
          }, 0) / sideDistributionQty
        : h * (sideTopDepth(leftSideTop, d) + sideTopDepth(rightSideTop, d)) / 10000)
    : 0;
  const sidePaintingArea = hasExterior
    ? (sideDistribution.length && sideDistributionQty > 0
        ? sideDistribution.reduce((sum, row) => {
            const qty = Number(row.quantity) || 0;
            return sum + qty * (
              sidePaintArea(row.sideLeftEdge || leftSideTop, h, d, exteriorThicknessCm) +
              sidePaintArea(row.sideRightEdge || rightSideTop, h, d, exteriorThicknessCm)
            );
          }, 0) / sideDistributionQty
        : sidePaintArea(leftSideTop, h, d, exteriorThicknessCm) + sidePaintArea(rightSideTop, h, d, exteriorThicknessCm))
    : 0;
  const coveredBoxPaintArea = hasExterior
    ? topFaceArea + sideMaterialArea
    : 0;
  const boxPaintArea = Math.max(0, rawBoxPaintArea - coveredBoxPaintArea);
  const boxEdgeLength = (
    4 * w + 4 * h + 4 * d +
    divider * h + divider * d +
    shelves * w + shelves * d
  ) / 100;

  const plateArea = uprightArea + topBottomArea + shelfArea + backArea + dividerArea + drawerBottomArea;
  const feet = calculationType === 'Superior' || isPiecePlate
    ? { cost: 0, client: 0 }
    : (w < 80 ? feetPrices.small : feetPrices.large);

  const cabinetCost =
    plateArea * interior.cost +
    boxPaintArea * interiorPaint.cost +
    (topFaceArea + sideMaterialArea) * exterior.cost +
    (topPaintingArea + sidePaintingArea + piecePaintArea) * doorPaint.cost +
    boxEdgeLength * edge.cost +
    feet.cost;

  const cabinetClient =
    plateArea * interior[plateSellKey] +
    boxPaintArea * interiorPaint.client +
    (topFaceArea + sideMaterialArea) * exterior[plateSellKey] +
    (topPaintingArea + sidePaintingArea + piecePaintArea) * doorPaint.client +
    boxEdgeLength * edge.client +
    feet.client;

  let doorsCost = 0;
  let doorsClient = 0;
  if (doors > 0 && hasExterior) {
    const doorWidth = Math.max(0, (w - (0.3 * doors + 0.3)) / doors);
    const doorMaterialArea = doorWidth * h / 10000;
    const doorEdgeLength = (doorWidth * 2 + h * 2) / 100;
    const doorPaintArea = doorMaterialArea;
    const hingeHeight = calculationType === 'Coluna' ? h : (h <= 89 ? h : 240);
    const hingeCount = drawerCount > 0 ? 0 : (hingeHeight <= 89 ? 2 : hingeHeight <= 180 ? 3 : hingeHeight <= 240 ? 4 : 5);

    const oneDoorCost =
      doorMaterialArea * exterior.cost +
      doorEdgeLength * edge.cost +
      doorPaintArea * doorPaint.cost +
      hingeCount * effectiveHinge.cost +
      system.cost;

    const oneDoorClient =
      doorMaterialArea * exterior[plateSellKey] +
      doorEdgeLength * edge.client +
      doorPaintArea * doorPaint.client +
      hingeCount * (effectiveHinge[accessorySellKey] ?? effectiveHinge.client) +
      (system[accessorySellKey] ?? system.client);

    doorsCost = oneDoorCost * doors;
    doorsClient = oneDoorClient * doors;
  }


  return {
    unitCost: Math.max(0, Math.round((cabinetCost + doorsCost) * 10000) / 10000),
    unitClient: Math.max(0, Math.round((cabinetClient + doorsClient) * 10000) / 10000)
  };
}


Object.values(typePresets).forEach(preset => {
  preset.quantity = 1;
  preset.pricingBase = pricingSnapshot(preset);
});

module.exports = { catalog, lists, typePresets, enrichModules, calculateModulePrice, inferType, workbookPath, resolveWorkbookPath, comparisonWorkbookPath };
