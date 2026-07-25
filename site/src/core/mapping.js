// @ts-check

import { naturalCompare } from "./utils.js";

/** @typedef {import('../types/manga109').Manga109ImageAsset} Manga109ImageAsset */
/** @typedef {import('../types/manga109').Manga109MappedImages} Manga109MappedImages */
/** @typedef {import('../types/manga109').Manga109PageAnnotation} Manga109PageAnnotation */

/**
 * Maps local image files to XML page indexes. Canonical numeric filenames are
 * authoritative. Ordinal mapping is used only as an explicit compatibility
 * fallback when every page has exactly one image.
 * @param {readonly Manga109ImageAsset[]} assets
 * @param {readonly Manga109PageAnnotation[]} pages
 * @returns {Manga109MappedImages}
 */
export function mapImagesToPages(assets, pages) {
  const orderedAssets = [...assets].sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
  const orderedPages = [...pages].sort((a, b) => a.index - b.index);
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<number, Manga109ImageAsset>} */
  const mapped = new Map();
  const duplicateIndexes = new Set();

  for (const asset of orderedAssets) {
    if (asset.numericIndex === null) continue;
    if (mapped.has(asset.numericIndex)) {
      duplicateIndexes.add(asset.numericIndex);
      continue;
    }
    mapped.set(asset.numericIndex, asset);
  }

  const pageIndexSet = new Set(orderedPages.map((page) => page.index));
  const numericMatches = [...mapped.keys()].filter((index) => pageIndexSet.has(index)).length;
  const numericCandidates = orderedAssets.filter((asset) => asset.numericIndex !== null).length;
  const extraNumericIndexes = [...mapped.keys()].filter((index) => !pageIndexSet.has(index));
  const hasCompleteNumericMapping =
    duplicateIndexes.size === 0 &&
    numericMatches === orderedPages.length &&
    orderedPages.every((page) => mapped.has(page.index));

  /** @type {"numeric" | "ordinal" | "partial"} */
  let mode;
  if (hasCompleteNumericMapping) {
    mode = "numeric";
  } else if (orderedAssets.length === orderedPages.length && numericMatches === 0 && duplicateIndexes.size === 0) {
    mode = "ordinal";
    mapped.clear();
    orderedPages.forEach((page, index) => mapped.set(page.index, orderedAssets[index]));
    warnings.push("Image filenames could not be mapped uniquely by page number; files were matched to XML pages by natural sort order.");
  } else {
    mode = "partial";
    for (const index of duplicateIndexes) mapped.delete(index);
    for (const index of [...mapped.keys()]) {
      if (!pageIndexSet.has(index)) mapped.delete(index);
    }
    if (duplicateIndexes.size) {
      warnings.push(`Duplicate numeric image indexes: ${[...duplicateIndexes].sort((a, b) => a - b).join(", ")}.`);
    }
    const missing = orderedPages.filter((page) => !mapped.has(page.index)).map((page) => page.index);
    if (missing.length) {
      const preview = missing.slice(0, 12).join(", ");
      warnings.push(`No image was found for ${missing.length} XML page(s): ${preview}${missing.length > 12 ? ", …" : ""}.`);
    }
  }

  for (const index of extraNumericIndexes) mapped.delete(index);
  if (extraNumericIndexes.length) {
    const preview = extraNumericIndexes.sort((a, b) => a - b).slice(0, 12).join(", ");
    warnings.push(
      `${extraNumericIndexes.length} numeric image file(s) do not correspond to an XML page: ${preview}${extraNumericIndexes.length > 12 ? ", …" : ""}.`,
    );
  }
  if (mode === "partial" && numericCandidates === 0 && orderedAssets.length !== orderedPages.length) {
    warnings.push("Image filenames contain no usable page indexes and the image/XML counts differ, so ordinal matching was not attempted.");
  }

  return { mode, pages: mapped, warnings };
}
