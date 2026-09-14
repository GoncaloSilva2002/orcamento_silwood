function createPricingEngine(data) {
const { catalog, lists, typePresets, feetPrices } = data;
function sheetText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

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


return { catalog, lists, typePresets, feetPrices, enrichModules, calculateModulePrice, inferType };
}
module.exports = { createPricingEngine };
