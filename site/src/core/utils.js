// @ts-check

/** @param {unknown} error */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {number} value @param {number} min @param {number} max */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {number} value */
export function padPageIndex(value) {
  return String(value).padStart(3, "0");
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** @param {string} a @param {string} b */
export function naturalCompare(a, b) {
  return collator.compare(a, b);
}

/** @param {string} filename */
export function withoutExtension(filename) {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(0, index) : filename;
}

/** @param {string} filename */
export function isSupportedImage(filename) {
  return /\.(?:jpe?g|png|webp|gif|bmp|avif|svg)$/i.test(filename);
}

/** @param {string} path */
export function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

/** @param {string} path */
export function dirname(path) {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

/** @param {string} path */
export function basename(path) {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? normalized : normalized.slice(slash + 1);
}

/**
 * Reads a zero-based page index from a canonical numeric filename stem.
 * A terminal digit run is accepted to tolerate names such as page_006.jpg.
 * @param {string} filename
 */
export function numericPageIndex(filename) {
  const match = withoutExtension(filename).match(/(?:^|\D)(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/** @returns {Promise<void>} */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
