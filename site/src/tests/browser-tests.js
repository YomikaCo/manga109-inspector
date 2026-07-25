// @ts-check

import { createFixtureDataset } from "../core/fixture-dataset.js";
import { scaleBoundingBox } from "../core/geometry.js";
import { LruCache } from "../core/lru-cache.js";
import { mapImagesToPages } from "../core/mapping.js";
import { mergeBookAnnotations, parseManga109Xml } from "../core/xml-parser.js";

const result = document.querySelector("#result");
if (!(result instanceof HTMLElement)) throw new Error("Missing result element");

/** @type {string[]} */
const messages = [];

/** @param {unknown} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
  messages.push(`PASS  ${message}`);
}

/** @param {string} name @param {number | null} numericIndex */
function fakeAsset(name, numericIndex) {
  return {
    key: name,
    name,
    relativePath: name,
    numericIndex,
    async getFile() {
      return new File([], name);
    },
  };
}

try {
  const xmlResponse = await fetch("../../fixtures/annotations/DemoBook.xml");
  assert(xmlResponse.ok, "fixture XML is available");
  const xml = await xmlResponse.text();
  const book = parseManga109Xml(xml, "DemoBook.xml");
  assert(book.title === "DemoBook", "book title is parsed");
  assert(book.characters.length === 2, "characters are parsed");
  assert(book.pages.length === 3, "all pages are parsed");
  assert(book.pages[0].annotations[0].kind === "frame", "annotation source order is preserved");
  const multilingual = book.pages[1].byKind.text[0].text;
  assert(multilingual === "こんにちは & Page two", "XML entities and multilingual text are decoded");
  assert(book.pages[0].byKind.face[0].characterId === "00000001", "character references remain strings");

  let rejectedDoctype = false;
  try {
    parseManga109Xml('<!DOCTYPE book><book title="x"><pages /></book>');
  } catch {
    rejectedDoctype = true;
  }
  assert(rejectedDoctype, "DOCTYPE input is rejected");

  const cooXml = `<book title="COOBook"><pages><page index="0" width="100" height="100"><onomatopoeia id="00000001" x0="0" y0="0" x1="10" y1="0" x2="10" y2="10" x3="0" y3="10">ドン</onomatopoeia><onomatopoeia id="00000002" x0="20" y0="20" x1="30" y1="20" x2="30" y2="30" x3="20" y3="30">ッ</onomatopoeia><onomatopoeia id="00000003" x0="40" y0="40" x1="50" y1="40" x2="50" y2="50" x3="40" y3="50">!</onomatopoeia><onomatopoeia_link1 id="11000001" link0="00000001" link1="00000002" link2="00000003" /><onomatopoeia_link2 id="12000001" link0="00000001" link1="00000002" /></page></pages></book>`;
  const cooBook = parseManga109Xml(cooXml, "COOBook.xml");
  assert(cooBook.pages[0].byKind.onomatopoeia.length === 3, "onomatopoeia annotations are parsed");
  assert(cooBook.pages[0].links.length === 2, "onomatopoeia_link1 and onomatopoeia_link2 are both parsed");
  const link1 = cooBook.pages[0].links.find((link) => link.linkType === "onomatopoeia_link1");
  const link2 = cooBook.pages[0].links.find((link) => link.linkType === "onomatopoeia_link2");
  assert(link1 && link1.ids.length === 3, "onomatopoeia_link1 parses link0, link1, link2 attributes");
  assert(link2 && link2.ids.length === 2, "onomatopoeia_link2 parses link0 and link1 attributes");

  const mainXml = `<book title="MergeBook"><pages><page index="0" width="100" height="100"><frame id="00000001" xmin="0" ymin="0" xmax="10" ymax="10" /></page></pages></book>`;
  const cooXml2 = `<book title="MergeBook"><pages><page index="0" width="100" height="100"><onomatopoeia id="10000001" x0="20" y0="20" x1="30" y1="20" x2="30" y2="30" x3="20" y3="30">ド</onomatopoeia></page></pages></book>`;
  const merged = mergeBookAnnotations(
    [parseManga109Xml(mainXml, "main.xml"), parseManga109Xml(cooXml2, "coo.xml")],
    ["main.xml", "coo.xml"],
  );
  assert(merged.pages[0].byKind.frame.length === 1, "merged book keeps normal frame annotations");
  assert(merged.pages[0].byKind.onomatopoeia.length === 1, "merged book adds COO onomatopoeia annotations");
  assert(merged.pages[0].annotations.length === 2, "merged page renumbers source order");
  assert(merged.pages[0].annotations[0].sourceOrder === 0 && merged.pages[0].annotations[1].sourceOrder === 1, "source order is sequential after merge");

  const scaled = scaleBoundingBox(
    { xmin: 100, ymin: 50, xmax: 300, ymax: 250 },
    { width: 1654, height: 1170 },
    { width: 827, height: 585 },
  );
  assert(
    scaled.xmin === 50 && scaled.ymin === 25 && scaled.xmax === 150 && scaled.ymax === 125,
    "bounding boxes scale independently into decoded-image coordinates",
  );

  const numeric = mapImagesToPages(
    [fakeAsset("001.jpg", 1), fakeAsset("000.jpg", 0), fakeAsset("002.jpg", 2)],
    book.pages,
  );
  assert(numeric.mode === "numeric", "canonical numeric filenames map by XML page index");
  assert(numeric.pages.get(2)?.name === "002.jpg", "numeric page mapping selects the correct image");

  const ordinal = mapImagesToPages(
    [fakeAsset("page-a.jpg", null), fakeAsset("page-b.jpg", null), fakeAsset("page-c.jpg", null)],
    book.pages,
  );
  assert(ordinal.mode === "ordinal", "equal-size nonnumeric sets use explicit ordinal fallback");
  assert(ordinal.warnings.length === 1, "ordinal fallback emits a diagnostic");

  const duplicate = mapImagesToPages(
    [fakeAsset("000.jpg", 0), fakeAsset("copy-000.jpg", 0), fakeAsset("001.jpg", 1)],
    book.pages,
  );
  assert(duplicate.mode === "partial", "duplicate numeric filenames force partial mapping");
  assert(!duplicate.pages.has(0), "ambiguous duplicate image indexes are never displayed");
  assert(duplicate.pages.get(1)?.name === "001.jpg", "unambiguous numeric pairs remain available");

  /** @type {string[]} */
  const evicted = [];
  const cache = new LruCache(2, (_value, key) => evicted.push(key));
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert(evicted[0] === "b", "LRU cache evicts the least recently used entry");

  const dataset = await createFixtureDataset();
  const loaded = await dataset.loadBook("DemoBook");
  assert(loaded.images.mode === "numeric", "fixture dataset uses canonical numeric mapping");
  const thirdFile = await loaded.images.pages.get(2)?.getFile();
  assert(thirdFile instanceof File, "image assets remain lazy File providers");
  if (!thirdFile) throw new Error("Missing third fixture image file");
  const bitmap = await createImageBitmap(thirdFile);
  assert(bitmap.width === 827 && bitmap.height === 585, "dimension-mismatch fixture decodes at 827×585");
  bitmap.close();

  result.textContent = messages.join("\n");
  document.body.dataset.status = "pass";
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
  result.textContent = `${messages.join("\n")}\nFAIL  ${message}`;
  document.body.dataset.status = "fail";
  console.error(error);
}
