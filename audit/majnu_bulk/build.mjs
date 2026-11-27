import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SpreadsheetFile, Workbook } from 'file:///C:/Users/MSI-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const listingRoot = 'C:/WorkStation/Projects/Ecom/Listing';
const casperRoot = 'C:/WorkStation/Projects/Python/Casper';
const outputDir = path.join(casperRoot, 'outputs', '01a153c1-d097-7493-9be0-3c7656b08bb6');
const previewDir = path.join(casperRoot, 'audit', 'majnu_bulk');
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(listingRoot, relative), 'utf8'));

const headers = [
  'Operation', 'SKU Code', 'Product Name', 'Vendor SKU', 'Vendor', 'Category', 'HSN Code',
  'Series', 'Description', 'Status', 'Stock Item', 'Units per SKU', 'On Hand Base Units',
  'Stock Date', 'Stock Reason', 'Cost per Base Unit', 'Cost Date', 'Cost Note', 'Platform',
  'Price / SKU', 'Package', 'Logistics', 'Addons', 'GST', 'Profit %', 'Misc Total',
  'CR %', 'CR Cost', 'Reverse Shipping / Return', 'Damage %', 'Damage Cost',
  'Image URL', 'Image File',
];
const rows = [];
const provenance = [];
const billNameByDesign = {
  'MBG-WG-AMR': { name: 'CELLO AMORE TUM 325 ML', ref: '9228' },
};
const add = (values, source, sourceStatus, note = '') => {
  const row = Object.fromEntries(headers.map((label) => [label, '']));
  Object.assign(row, { Operation: 'create', Status: 'Inactive', Platform: 'Flipkart', GST: 18 }, values);
  if (!row['SKU Code']) throw new Error('Missing SKU in source');
  if (rows.some((item) => item['SKU Code'].toUpperCase() === row['SKU Code'].toUpperCase())) {
    throw new Error(`Duplicate SKU: ${row['SKU Code']}`);
  }
  if (row['Image URL'] && !row['Image URL'].startsWith('https://res.cloudinary.com/a32ykgih/')) {
    throw new Error(`Unexpected image account: ${row['SKU Code']}`);
  }
  rows.push(row);
  provenance.push([row['SKU Code'], source, sourceStatus, note]);
};

const whiskyPath = 'listings/Flipkart/whiskey-glass/listing-record.json';
const whisky = await readJson(whiskyPath);
for (const [designCode, design] of Object.entries(whisky.designs)) {
  const supplierPath = `datasets/scrapes/Glass/Whisky Glass/${design.groupId}/product-data.json`;
  const supplier = await readJson(supplierPath);
  if (supplier.supplierSkuVerified !== true || !supplier.supplierProductCode) throw new Error(`Unverified supplier SKU for ${design.groupId}`);
  const bill = billNameByDesign[designCode];
  for (const variant of design.variants) {
    const image = variant.images?.[0]?.cdnUrl || '';
    add({
      'SKU Code': variant.sku,
      'Product Name': variant.modelNumber,
      'Vendor SKU': bill?.name || '',
      Vendor: 'JDS Enterprise',
      Category: 'Whisky Glass',
      'HSN Code': '7013',
      Series: design.groupId,
      Description: design.description,
      'Stock Item': design.groupId,
      'Units per SKU': variant.packOf,
      'Image URL': image,
    }, `${whiskyPath} + ${supplierPath}${bill ? ' + archived JDS bill ref ' + bill.ref : ''}`, whisky.status,
    `Design ${designCode}; image from Majnu Bhai Cloudinary; physical glasses per SKU from packOf. ${bill ? 'Vendor SKU is exact bill item wording.' : 'Supplier catalogue code is not a bill item; Vendor SKU needs a verified bill match.'}`);
  }
}

// The seller's original XLS has the exact ROTA-D SKU spelling and pack counts.
// This source's image links point at another seller's Cloudinary account, so omit them.
const xlsExtract = String.raw`
import json, pathlib, xlrd, zipfile, sqlite3
r=pathlib.Path(r'C:\WorkStation\Projects\Ecom\Listing')
files=[('rotd','listings/Flipkart/Glass/Filled/C_glass_2758bc43e4f84b88_1509-0338FK_REQAEXVALJQ62.xls','glass'),('serving','listings/Flipkart/Serving Sets/Filled/C_serving-set_2758bc43e4f84b88_2209-1446FK_REQETIFOQ6YX8.xls','serving_set')]
out={}
for key,rel,sheet in files:
 s=xlrd.open_workbook(str(r/rel)).sheet_by_name(sheet)
 header=[str(s.cell_value(0,i)).strip() for i in range(s.ncols)]
 out[key]=[{name:str(s.cell_value(row,i)).strip() for i,name in enumerate(header) if name in {'Seller SKU ID','Group ID','Model Number','Description','Main Image URL','Pack of'}} for row in range(4,s.nrows) if str(s.cell_value(row,6)).strip()]
backup=pathlib.Path(r'C:\WorkStation\Projects\Python\Casper\audit\backups\casper-before-majnu-delete-20261024-004059.zip')
with zipfile.ZipFile(backup) as archive:
 db=sqlite3.connect(':memory:')
 db.deserialize(archive.read('casper.db'))
 out['billItems']=[{'itemName':name,'billRefs':refs} for name,refs in db.execute("select l.item_name,group_concat(distinct b.ref_no) from purchase_bill_lines l join purchase_bills b on b.id=l.bill_id where b.company_id=8 group by l.item_name order by l.item_name")]
 out['billAliases']=[{'itemName':name,'sku':sku} for name,sku in db.execute("select a.item_name,s.shringar_sku from vendor_item_aliases a join skus s on s.id=a.sku_id where a.company_id=8")]
print(json.dumps(out))`;
const python = path.join(casperRoot, 'backend', 'env', 'Scripts', 'python.exe');
const extracted = JSON.parse(execFileSync(python, ['-c', xlsExtract], { encoding: 'utf8' }));
for (const { name, ref } of Object.values(billNameByDesign)) {
  const item = extracted.billItems.find((b) => b.itemName === name);
  if (!item || !item.billRefs.split(',').includes(ref)) throw new Error(`Bill wording/ref not verified: ${name}`);
  if (!extracted.billAliases.some((a) => a.itemName === name && a.sku.startsWith('MBG-WG-AMR-325-'))) {
    throw new Error(`No historical bill-to-AMR SKU link: ${name}`);
  }
}
const rotdPath = 'listings/Flipkart/Glass/Filled/C_glass_2758bc43e4f84b88_1509-0338FK_REQAEXVALJQ62.xls';
for (const item of extracted.rotd) {
  add({
    'SKU Code': item['Seller SKU ID'], 'Product Name': item['Model Number'],
    Category: 'Whisky Glass', 'HSN Code': '7013', Series: item['Group ID'],
    Description: item.Description, 'Stock Item': item['Group ID'],
    'Units per SKU': Number(item['Pack of']),
  }, rotdPath, 'Submitted/live per adjacent listing-record.json',
  'Vendor SKU not independently verified; image URL excluded because it uses a different seller Cloudinary account.');
}

const servingPath = 'listings/Flipkart/Serving Sets/listing-record.json';
const serving = await readJson(servingPath);
const servingXlsPath = 'listings/Flipkart/Serving Sets/Filled/C_serving-set_2758bc43e4f84b88_2209-1446FK_REQETIFOQ6YX8.xls';
const servingBySku = new Map(extracted.serving.map((item) => [item['Seller SKU ID'], item]));
for (const design of serving.designs) {
  const item = servingBySku.get(design.sku);
  if (!item) throw new Error(`Serving SKU missing from XLS: ${design.sku}`);
  const supplierCode = /^JDS Enterprise \(([^)]+)\)$/.exec(design.supplier || '')?.[1] || '';
  add({
    'SKU Code': design.sku, 'Product Name': item['Model Number'],
    Vendor: supplierCode ? 'JDS Enterprise' : '',
    Description: item.Description,
  }, `${servingPath} + ${servingXlsPath}`, serving.status,
  'Supplier catalogue code is not a bill item; Vendor SKU needs a verified bill match. Marketplace image is a competitor/reference URL and was excluded.');
}

const standalonePaths = [
  'listings/Flipkart/serving-sets/MBS-HKA-MUG-DLP-470/listing-record.json',
  'listings/Flipkart/serving-sets/MBS-SS-3P-4IN-PKTY-1P/listing-record.json',
];
for (const source of standalonePaths) {
  const item = await readJson(source);
  add({
    'SKU Code': item.sku, 'Product Name': item.productTitle_autoGenerated,
    'HSN Code': item.sku === 'MBS-SS-3P-4IN- PKTY-1P' ? '7013' : '',
    Description: typeof item.productDescription === 'string' ? item.productDescription : (item.productDescription?.description || ''),
  }, source, item.status,
  'Draft/QC source; listing stock and selling price excluded because they are not verified Casper stock or cost.');
}

const factsPath = 'datasets/flipkart-majnu-bhai-facts.json';
const facts = await readJson(factsPath);
const legacy = facts.existingLiveListings_whiskyGlassFamily.skus;
for (const code of legacy) {
  if (code.includes('(broken SKU format')) continue;
  add({ 'SKU Code': code, Category: 'Whisky Glass', 'HSN Code': '7013' }, factsPath,
    'Confirmed live in 2026-07-31 Seller Hub snapshot',
    'Only SKU identity and category are confirmed; product, vendor, pack units, stock and cost need review.');
}
if (rows.length !== 110) throw new Error(`Expected 110 SKU rows, got ${rows.length}`);
if (rows.some((r) => r['Stock Item'] && !Number.isInteger(r['Units per SKU']))) {
  throw new Error('A stock item has no integer pack size');
}

const wb = Workbook.create();
const products = wb.worksheets.add('Products');
products.showGridLines = false;
products.getRange(`A1:AG${rows.length + 1}`).values = [headers, ...rows.map((r) => headers.map((h) => r[h]))];
products.getRange(`A1:AG${rows.length + 1}`).format.font = { name: 'Aptos', size: 10, color: '#243247' };
products.getRange('A1:AG1').format = { fill: '#183153', font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' } };
products.getRange('A1:AG1').format.rowHeight = 34;
products.getRange(`A2:AG${rows.length + 1}`).format.rowHeight = 24;
for (let i = 2; i <= rows.length + 1; i += 2) products.getRange(`A${i}:AG${i}`).format.fill = '#F2F6FB';
for (const [column, width] of Object.entries({
  A: 13, B: 34, C: 64, D: 24, E: 22, F: 19, G: 11, H: 31, I: 72,
  J: 13, K: 34, L: 15, M: 18, N: 15, O: 40, P: 18, Q: 14, R: 40,
  S: 15, T: 15, U: 14, V: 14, W: 14, X: 11, Y: 13, Z: 15,
  AA: 13, AB: 14, AC: 27, AD: 15, AE: 16, AF: 72, AG: 22,
})) products.getRange(`${column}:${column}`).format.columnWidth = width;
products.getRange(`J2:J${rows.length + 1}`).format.font = { name: 'Aptos', size: 10, color: '#8E5B10' };
products.freezePanes.freezeRows(1);

const guide = wb.worksheets.add('Read Me');
guide.showGridLines = false;
const guidance = [
  ['MAJNU BHAI • CASPER CATALOGUE', '', '', '', ''],
  ['Prepared', '2026-10-24', '', 'Import sheet', 'Products (first tab)'],
  ['SKU rows', rows.length, '', 'Operation', 'Create; all rows start Inactive'],
  ['Source groups', '90 canonical whisky variants + 5 ROTA-D + 3 serving sets + 2 standalone + 10 legacy codes', '', '', ''],
  ['Before import', 'Create/select Majnu Bhai Sales company in Casper; it was deleted on 2026-10-24 at the user’s request.', '', '', ''],
  ['Reference records', 'Create company vendor JDS Enterprise and category Whisky Glass; add global HSN code 7013 before import.', '', '', ''],
  ['Vendor SKU', 'Uses exact supplier-bill item wording only for 5 AMR pack rows, supported by bill 9228 and the historical SKU link. Other 105 rows need a verified bill match.', '', '', ''],
  ['No cost/stock', 'Supplier catalogue wholesale prices and Flipkart selling prices are not verified unit costs. Listing stock is not a counted on-hand balance.', '', '', ''],
  ['GST', '18% per seller correction on 2026-10-24; the Products sheet records 18 (percent).', '', '', ''],
  ['Inactive by default', 'Review images, costs, stock and current marketplace state before activating each SKU.', '', '', ''],
  ['Pack units', 'Whisky variants use source Pack of as physical glasses per SKU; pack variants share one Stock Item.', '', '', ''],
  ['Image URLs', '90 canonical whisky images use Majnu Bhai Cloudinary a32ykgih. ROTA-D source links use another seller account and were excluded.', '', '', ''],
  ['Serving images', 'Serving-set source image links are competitor/reference images; intentionally excluded.', '', '', ''],
  ['Cost needed', 'Catalogue GST can be imported without a cost; Flipkart pricing still needs a verified Price / SKU.', '', '', ''],
  ['Unresolved', 'Broken Brilliant Whisky Glass SKU format and P&L aliases were not silently mapped to catalogue SKUs.', '', '', ''],
  ['Import limit', 'Casper supports up to 500 rows per upload; this file has 110.', '', '', ''],
  ['Review trail', 'See the Provenance tab for the source and caveat of each SKU.', '', '', ''],
];
guide.getRange('A1:E17').values = guidance;
guide.getRange('A1:E17').format.font = { name: 'Aptos', size: 11, color: '#243247' };
guide.getRange('A1:E1').format = { fill: '#183153', font: { name: 'Aptos', size: 17, bold: true, color: '#FFFFFF' } };
guide.getRange('A1:E1').format.rowHeight = 42;
guide.getRange('A2:A17').format = { fill: '#EAF2FA', font: { name: 'Aptos', size: 10, bold: true, color: '#183153' } };
guide.getRange('A:A').format.columnWidth = 23;
guide.getRange('B:B').format.columnWidth = 115;
guide.getRange('C:C').format.columnWidth = 4;
guide.getRange('D:D').format.columnWidth = 20;
guide.getRange('E:E').format.columnWidth = 40;
guide.getRange('A2:E17').format.rowHeight = 31;
guide.freezePanes.freezeRows(1);

const trace = wb.worksheets.add('Provenance');
trace.showGridLines = false;
trace.getRange(`A1:D${provenance.length + 1}`).values = [
  ['SKU Code', 'Listing source', 'Source status', 'Review note'], ...provenance,
];
trace.getRange(`A1:D${provenance.length + 1}`).format.font = { name: 'Aptos', size: 10, color: '#243247' };
trace.getRange('A1:D1').format = { fill: '#183153', font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' } };
trace.getRange('A:A').format.columnWidth = 37;
trace.getRange('B:B').format.columnWidth = 115;
trace.getRange('C:C').format.columnWidth = 92;
trace.getRange('D:D').format.columnWidth = 95;
for (let i = 2; i <= provenance.length + 1; i += 2) trace.getRange(`A${i}:D${i}`).format.fill = '#F2F6FB';
trace.freezePanes.freezeRows(1);

const billReview = wb.worksheets.add('Bill Item Review');
billReview.showGridLines = false;
const unresolvedBillMatches = {
  'CELLO BRILLIANT 325 ML ROCK TUM': ['MBG-WG-BRL-325 (candidate)', 'Name and capacity resemble BRL, but bill has no linked SKU; leave blank'],
  'LS-001 LUMINIOUS ROTATING GLASS MIX 300 ML COL BOX 60 PC CTN': ['ROTA family (unresolved)', 'Mix design does not establish a specific ROTA variant; leave blank'],
  'LZB-D LUMINIOUS ROTATING GLASS 300 ML COL BOX 60 PC CTN': ['ROTA family (unresolved)', 'Supplier reconciliation flags a model/LED conflict; leave blank'],
  'PKTY-26 3 PCS PLASTIC CANDY ON TRAY IN COL BOX 40 SET CTN': ['MBS-SS-3P-4IN- PKTY-1P (conflict)', 'Bill says plastic PKTY-26; listing says glass PKTY-1P; leave blank'],
  'Y3212 YUJING 160 ML JUICE GLASS 6 PC COL BOX 12 SET CTN': ['MBG-WG-JGL-146-Y3212-1 (conflict)', 'Bill says 160 ml Y3212; listing says 146 ml Y3212-1; leave blank'],
  'ZZB-C ROTATING GLASS 300 ML COL BOX 60 PC CTN': ['ROTA family (unresolved)', 'Bill says ZZB-C; historical link to ZZB-D is inconsistent; leave blank'],
};
const billRows = extracted.billItems.map(({ itemName, billRefs }) => {
  const match = Object.entries(billNameByDesign).find(([, b]) => b.name === itemName);
  const unresolved = unresolvedBillMatches[itemName] || ['', 'No reliable catalogue SKU match; leave Vendor SKU blank'];
  return [itemName, billRefs, match ? match[0] : unresolved[0],
    match ? 'Historical bill-to-SKU link supports AMR; used for its five pack variants' :
      unresolved[1]];
});
billReview.getRange(`A1:D${billRows.length + 1}`).values = [['Exact supplier bill item name', 'Bill ref(s)', 'Matched design', 'Decision'], ...billRows];
billReview.getRange(`A1:D${billRows.length + 1}`).format.font = { name: 'Aptos', size: 10, color: '#243247' };
billReview.getRange('A1:D1').format = { fill: '#183153', font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' } };
billReview.getRange('A:A').format.columnWidth = 85;
billReview.getRange('B:B').format.columnWidth = 30;
billReview.getRange('C:C').format.columnWidth = 25;
billReview.getRange('D:D').format.columnWidth = 65;
for (let i = 2; i <= billRows.length + 1; i += 2) billReview.getRange(`A${i}:D${i}`).format.fill = '#F2F6FB';
billReview.freezePanes.freezeRows(1);

wb.recalculate();
const inspection = await wb.inspect({ kind: 'region', sheetId: 'Products', range: 'A1:L7', maxChars: 1800 });
console.log('Workbook inspection:', JSON.stringify(inspection).slice(0, 1800));
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, range, filename] of [
  ['Products', 'A1:L9', 'preview-products.png'],
  ['Read Me', 'A1:E17', 'preview-readme.png'],
]) {
  const preview = await wb.render({ sheetName, range, scale: 1, format: 'png' });
  await fs.writeFile(path.join(previewDir, filename), new Uint8Array(await preview.arrayBuffer()));
}
const outputPath = path.join(outputDir, 'Majnu_Bhai_Casper_Bulk_Products_2026-10-24.xlsx');
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(outputPath);
// HSN 7013 is not in Casper's global reference table. Catalogue GST is now
// independent of platform pricing, so import the verified rate without cost.
const importRows = rows.map((row) => ({ ...row, 'HSN Code': '', Platform: '' }));
const uploadWb = Workbook.create();
const uploadSheet = uploadWb.worksheets.add('Products');
uploadSheet.showGridLines = false;
uploadSheet.getRange(`A1:AG${importRows.length + 1}`).values = [headers, ...importRows.map((row) => headers.map((h) => row[h]))];
uploadSheet.getRange(`A1:AG${importRows.length + 1}`).format.font = { name: 'Aptos', size: 10, color: '#243247' };
uploadSheet.getRange('A1:AG1').format = { fill: '#183153', font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' } };
uploadSheet.getRange('A1:AG1').format.rowHeight = 34;
for (let i = 2; i <= importRows.length + 1; i += 2) uploadSheet.getRange(`A${i}:AG${i}`).format.fill = '#F2F6FB';
for (const [column, width] of Object.entries({ A: 13, B: 34, C: 64, D: 36, E: 22, F: 19, G: 11, H: 31, I: 72, J: 13, K: 34, L: 15, AF: 72 })) {
  uploadSheet.getRange(`${column}:${column}`).format.columnWidth = width;
}
uploadSheet.freezePanes.freezeRows(1);
const uploadGuide = uploadWb.worksheets.add('Read Me');
uploadGuide.showGridLines = false;
uploadGuide.getRange('A1:B7').values = [
  ['MAJNU BHAI • IDENTITY IMPORT', ''],
  ['Rows', '110 create actions, all Inactive'],
  ['Before upload', 'Select the recreated Majnu Bhai Sales company. Add JDS Enterprise vendor and Whisky Glass category.'],
  ['Vendor SKU', 'Exact bill wording on 5 AMR variants; the other 105 remain blank pending a reliable bill match.'],
  ['HSN', '7013 is deferred because the global HSN record is not yet configured.'],
  ['GST', 'Seller-confirmed 18% is stored on each Catalogue SKU without a platform price.'],
  ['Original file', 'Majnu_Bhai_Casper_Bulk_Products_2026-10-24.xlsx retains HSN 7013 and GST 18% for review.'],
];
uploadGuide.getRange('A1:B7').format.font = { name: 'Aptos', size: 11, color: '#243247' };
uploadGuide.getRange('A1:B1').format = { fill: '#183153', font: { name: 'Aptos', size: 17, bold: true, color: '#FFFFFF' } };
uploadGuide.getRange('A2:A7').format = { fill: '#EAF2FA', font: { name: 'Aptos', size: 10, bold: true, color: '#183153' } };
uploadGuide.getRange('A:A').format.columnWidth = 24;
uploadGuide.getRange('B:B').format.columnWidth = 110;
uploadGuide.getRange('A1:B7').format.rowHeight = 32;
const deferred = uploadWb.worksheets.add('Deferred HSN');
deferred.showGridLines = false;
deferred.getRange(`A1:B${rows.length + 1}`).values = [['SKU Code', 'HSN Code'],
  ...rows.map((row) => [row['SKU Code'], row['HSN Code']])];
deferred.getRange(`A1:B${rows.length + 1}`).format.font = { name: 'Aptos', size: 10, color: '#243247' };
deferred.getRange('A1:B1').format = { fill: '#183153', font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' } };
for (const [column, width] of Object.entries({ A: 36, B: 16 })) deferred.getRange(`${column}:${column}`).format.columnWidth = width;
deferred.freezePanes.freezeRows(1);
uploadWb.recalculate();
await uploadWb.inspect({ kind: 'region', sheetId: 'Products', range: 'A1:L7', maxChars: 1200 });
const importPreview = await uploadWb.render({ sheetName: 'Products', range: 'A1:L9', scale: 1, format: 'png' });
await fs.writeFile(path.join(previewDir, 'preview-identity-import.png'), new Uint8Array(await importPreview.arrayBuffer()));
const importPath = path.join(outputDir, 'Majnu_Bhai_Catalogue_Identity_Import_2026-10-24.xlsx');
await (await SpreadsheetFile.exportXlsx(uploadWb)).save(importPath);
const gstWb = Workbook.create();
const gstSheet = gstWb.worksheets.add('Products');
gstSheet.showGridLines = false;
gstSheet.getRange(`A1:C${rows.length + 1}`).values = [['Operation', 'SKU Code', 'GST'],
  ...rows.map((row) => ['update', row['SKU Code'], 18])];
gstSheet.getRange(`A1:C${rows.length + 1}`).format.font = { name: 'Aptos', size: 10, color: '#243247' };
gstSheet.getRange('A1:C1').format = { fill: '#183153', font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' } };
gstSheet.getRange('A:A').format.columnWidth = 16;
gstSheet.getRange('B:B').format.columnWidth = 42;
gstSheet.getRange('C:C').format.columnWidth = 14;
gstSheet.freezePanes.freezeRows(1);
gstWb.recalculate();
const gstPath = path.join(outputDir, 'Majnu_Bhai_GST_18_Update_2026-10-28.xlsx');
await (await SpreadsheetFile.exportXlsx(gstWb)).save(gstPath);
console.log(JSON.stringify({ outputPath, importPath, skuRows: rows.length, withImages: rows.filter((r) => r['Image URL']).length,
  withPackUnits: rows.filter((r) => r['Units per SKU'] !== '').length,
  withVendorSku: rows.filter((r) => r['Vendor SKU']).length, worksheets: ['Products', 'Read Me', 'Provenance', 'Bill Item Review'] }));
