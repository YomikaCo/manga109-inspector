// @ts-check

/** @typedef {import('../types/manga109').Manga109Annotation} Manga109Annotation */
/** @typedef {import('../types/manga109').Manga109AnnotationKind} Manga109AnnotationKind */
/** @typedef {import('../types/manga109').Manga109BookAnnotation} Manga109BookAnnotation */
/** @typedef {import('../types/manga109').Manga109CharacterAnnotation} Manga109CharacterAnnotation */
/** @typedef {import('../types/manga109').Manga109FrameAnnotation} Manga109FrameAnnotation */
/** @typedef {import('../types/manga109').Manga109PageAnnotation} Manga109PageAnnotation */
/** @typedef {import('../types/manga109').Manga109OnomatopoeiaAnnotation} Manga109OnomatopoeiaAnnotation */
/** @typedef {import('../types/manga109').Manga109TextAnnotation} Manga109TextAnnotation */
/** @typedef {import('../types/manga109').Manga109OnomatopoeiaLink} Manga109OnomatopoeiaLink */

const HEX_ID = /^[0-9a-fA-F]{8}$/;
const KINDS = new Set(["frame", "text", "face", "body", "onomatopoeia"]);

/** @param {Element} parent @param {string} tagName */
function directChild(parent, tagName) {
  for (const child of parent.children) {
    if (child.tagName === tagName) return child;
  }
  return null;
}

/** @param {Element} element @param {string} name @param {string} context */
function requiredAttribute(element, name, context) {
  const value = element.getAttribute(name);
  if (value === null) throw new Error(`${context}: missing required attribute "${name}".`);
  return value;
}

/** @param {Element} element @param {string} name @param {string} context */
function integerAttribute(element, name, context) {
  const raw = requiredAttribute(element, name, context);
  if (!/^\d+$/.test(raw)) throw new Error(`${context}: ${name} must be a non-negative integer; received "${raw}".`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${context}: ${name} is outside JavaScript's safe integer range.`);
  return value;
}

/**
 * @param {Element} element
 * @param {string} context
 * @param {string[]} warnings
 */
function parseBox(element, context, warnings) {
  const xmin = integerAttribute(element, "xmin", context);
  const ymin = integerAttribute(element, "ymin", context);
  const xmax = integerAttribute(element, "xmax", context);
  const ymax = integerAttribute(element, "ymax", context);
  if (xmax < xmin || ymax < ymin) {
    throw new Error(`${context}: invalid bounding box (${xmin}, ${ymin})–(${xmax}, ${ymax}).`);
  }
  const id = requiredAttribute(element, "id", context);
  if (!HEX_ID.test(id)) warnings.push(`${context}: id "${id}" is not an eight-digit hexadecimal value.`);
  return { id, xmin, ymin, xmax, ymax };
}

/**
 * @param {Element} element
 * @param {string} context
 * @param {string[]} warnings
 */
function parseOnomatopoeiaLink(element, context, warnings) {
  const id = requiredAttribute(element, "id", context);
  if (!HEX_ID.test(id)) warnings.push(`${context}: id "${id}" is not an eight-digit hexadecimal value.`);
  /** @type {string[]} */
  const ids = [];
  for (let i = 0; ; i += 1) {
    const value = element.getAttribute(`link${i}`);
    if (value === null) break;
    ids.push(value);
  }
  return { id, ids, linkType: element.tagName };
}

/**
 * @param {Element} element
 * @param {string} context
 * @param {string[]} warnings
 */
function parseOnomatopoeia(element, context, warnings) {
  const id = requiredAttribute(element, "id", context);
  if (!HEX_ID.test(id)) warnings.push(`${context}: id "${id}" is not an eight-digit hexadecimal value.`);
  /** @type {{ x: number; y: number }[]} */
  const points = [];
  for (let i = 0; ; i += 1) {
    const x = element.getAttribute(`x${i}`);
    const y = element.getAttribute(`y${i}`);
    if (x === null || y === null) break;
    if (!/^-?\d+$/.test(x) || !/^-?\d+$/.test(y)) {
      warnings.push(`${context}: malformed coordinate pair x${i}="${x}" y${i}="${y}".`);
      break;
    }
    points.push({ x: Number(x), y: Number(y) });
  }
  if (points.length < 2) {
    throw new Error(`${context}: onomatopoeia must have at least two coordinate pairs.`);
  }
  let xmin = points[0].x;
  let ymin = points[0].y;
  let xmax = points[0].x;
  let ymax = points[0].y;
  for (const p of points) {
    if (p.x < xmin) xmin = p.x;
    if (p.x > xmax) xmax = p.x;
    if (p.y < ymin) ymin = p.y;
    if (p.y > ymax) ymax = p.y;
  }
  return { id, xmin, ymin, xmax, ymax, points, text: element.textContent ?? "" };
}

/**
 * Parse the official Manga109 XML schema with the browser's native XML parser.
 * Numeric conversion is explicit so leading-zero hexadecimal IDs are never
 * misinterpreted as numbers.
 * @param {string} xml
 * @param {string} [sourceName]
 * @returns {Manga109BookAnnotation}
 */
export function parseManga109Xml(xml, sourceName = "annotation XML") {
  if (/<!DOCTYPE/i.test(xml)) {
    throw new Error(`${sourceName}: DOCTYPE declarations are not accepted.`);
  }

  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    const detail = parserError.textContent?.replace(/\s+/g, " ").trim() || "Invalid XML.";
    throw new Error(`${sourceName}: ${detail}`);
  }

  const bookElement = document.documentElement;
  if (!bookElement || bookElement.tagName !== "book") {
    throw new Error(`${sourceName}: root element must be <book>.`);
  }

  const title = requiredAttribute(bookElement, "title", sourceName);
  /** @type {string[]} */
  const warnings = [];

  const charactersElement = directChild(bookElement, "characters");
  /** @type {import('../types/manga109').Manga109Character[]} */
  const characters = [];
  const characterIds = new Set();
  const allIds = new Set();
  if (charactersElement) {
    for (const element of charactersElement.children) {
      if (element.tagName !== "character") {
        warnings.push(`${sourceName}: ignored unexpected <${element.tagName}> inside <characters>.`);
        continue;
      }
      const context = `${sourceName} character`;
      const id = requiredAttribute(element, "id", context);
      const name = requiredAttribute(element, "name", context);
      if (!HEX_ID.test(id)) warnings.push(`${context}: id "${id}" is not an eight-digit hexadecimal value.`);
      if (characterIds.has(id)) warnings.push(`${context}: duplicate character id "${id}".`);
      characterIds.add(id);
      if (allIds.has(id)) warnings.push(`${context}: duplicate dataset id "${id}" within this book.`);
      allIds.add(id);
      characters.push({ id, name });
    }
  }

  const pagesElement = directChild(bookElement, "pages");
  if (!pagesElement) throw new Error(`${sourceName}: missing <pages> element.`);

  /** @type {Manga109PageAnnotation[]} */
  const pages = [];
  const pageIndexes = new Set();
  for (const pageElement of pagesElement.children) {
    if (pageElement.tagName !== "page") {
      warnings.push(`${sourceName}: ignored unexpected <${pageElement.tagName}> inside <pages>.`);
      continue;
    }

    const index = integerAttribute(pageElement, "index", `${sourceName} page`);
    const width = integerAttribute(pageElement, "width", `${sourceName} page ${index}`);
    const height = integerAttribute(pageElement, "height", `${sourceName} page ${index}`);
    if (width <= 0 || height <= 0) throw new Error(`${sourceName} page ${index}: width and height must be positive.`);
    if (pageIndexes.has(index)) throw new Error(`${sourceName}: duplicate page index ${index}.`);
    pageIndexes.add(index);

    /** @type {Manga109Annotation[]} */
    const annotations = [];
    /** @type {Manga109FrameAnnotation[]} */
    const frame = [];
    /** @type {Manga109TextAnnotation[]} */
    const text = [];
    /** @type {Manga109CharacterAnnotation[]} */
    const face = [];
    /** @type {Manga109CharacterAnnotation[]} */
    const body = [];
    /** @type {Manga109OnomatopoeiaAnnotation[]} */
    const onomatopoeia = [];
    /** @type {import('../types/manga109').Manga109OnomatopoeiaLink[]} */
    const links = [];

    let sourceOrder = 0;
    for (const objectElement of pageElement.children) {
      const rawKind = objectElement.tagName;
      if (/^onomatopoeia_link\d+$/i.test(rawKind)) {
        const linkContext = `${sourceName} page ${index} <${rawKind}>`;
        links.push(parseOnomatopoeiaLink(objectElement, linkContext, warnings));
        continue;
      }
      if (!KINDS.has(rawKind)) {
        warnings.push(`${sourceName} page ${index}: ignored unsupported <${rawKind}> annotation.`);
        continue;
      }
      const kind = /** @type {Manga109AnnotationKind} */ (rawKind);
      const context = `${sourceName} page ${index} <${kind}>`;
      const box = kind === "onomatopoeia" ? parseOnomatopoeia(objectElement, context, warnings) : parseBox(objectElement, context, warnings);
      if (allIds.has(box.id)) warnings.push(`${context}: duplicate dataset id "${box.id}" within this book.`);
      allIds.add(box.id);
      if (box.xmax === box.xmin || box.ymax === box.ymin) {
        warnings.push(`${context} ${box.id}: bounding box has zero area; values are preserved.`);
      }
      if (box.xmax > width || box.ymax > height) {
        warnings.push(`${context} ${box.id}: coordinates exceed page size ${width}×${height}; values are preserved.`);
      }

      if (kind === "text") {
        /** @type {Manga109TextAnnotation} */
        const annotation = { ...box, kind, sourceOrder, text: objectElement.textContent ?? "" };
        annotations.push(annotation);
        text.push(annotation);
      } else if (kind === "face" || kind === "body") {
        const characterId = requiredAttribute(objectElement, "character", context);
        if (!characterIds.has(characterId)) {
          warnings.push(`${context} ${box.id}: references unknown character id "${characterId}".`);
        }
        /** @type {Manga109CharacterAnnotation} */
        const annotation = { ...box, kind, sourceOrder, characterId };
        annotations.push(annotation);
        (kind === "face" ? face : body).push(annotation);
      } else if (kind === "onomatopoeia") {
        /** @type {Manga109OnomatopoeiaAnnotation} */
        const annotation = /** @type {Manga109OnomatopoeiaAnnotation} */ (/** @type {unknown} */ (box));
        annotations.push({ ...annotation, kind, sourceOrder });
        onomatopoeia.push({ ...annotation, kind, sourceOrder });
      } else {
        /** @type {Manga109FrameAnnotation} */
        const annotation = { ...box, kind: "frame", sourceOrder };
        annotations.push(annotation);
        frame.push(annotation);
      }
      sourceOrder += 1;
    }

    pages.push({
      index,
      width,
      height,
      annotations,
      byKind: { frame, text, face, body, onomatopoeia },
      links,
    });
  }

  pages.sort((a, b) => a.index - b.index);
  return { title, characters, pages, warnings };
}

/**
 * @typedef {{
 *   index: number;
 *   width: number;
 *   height: number;
 *   annotations: Manga109Annotation[];
 *   links: Manga109OnomatopoeiaLink[];
 *   byKind: any;
 * }} MutablePage
 */

/**
 * Merge multiple parsed Manga109 annotation books into a single book.
 * Used to combine a standard annotation file with an annotations_COO file so
 * frames, text, faces, bodies and onomatopoeia can be viewed together.
 *
 * @param {Manga109BookAnnotation[]} parts
 * @param {string[]} sourceNames
 * @returns {Manga109BookAnnotation}
 */
export function mergeBookAnnotations(parts, sourceNames = parts.map(() => "annotation XML")) {
  if (!parts.length) throw new Error("At least one annotation part is required to merge.");
  if (parts.length === 1) return parts[0];

  const [first, ...rest] = parts;
  const title = first.title;
  const warnings = [...first.warnings];

  const characters = new Map(first.characters.map((character) => [character.id, character]));
  /** @type {Map<number, MutablePage>} */
  const pageMap = new Map();
  for (const page of first.pages) {
    pageMap.set(page.index, {
      index: page.index,
      width: page.width,
      height: page.height,
      annotations: [...page.annotations],
      links: [...page.links],
      byKind: { ...page.byKind },
    });
  }

  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i];
    const sourceName = sourceNames[i + 1] ?? "annotation XML";
    if (part.title !== title) {
      warnings.push(`${sourceName}: book title "${part.title}" differs from "${title}"; using the first title.`);
    }
    warnings.push(...part.warnings);
    for (const character of part.characters) {
      if (!characters.has(character.id)) {
        characters.set(character.id, character);
      }
    }
    for (const page of part.pages) {
      const existing = pageMap.get(page.index);
      if (!existing) {
        pageMap.set(page.index, {
          index: page.index,
          width: page.width,
          height: page.height,
          annotations: [...page.annotations],
          links: [...page.links],
          byKind: { ...page.byKind },
        });
      } else {
        if (existing.width !== page.width || existing.height !== page.height) {
          warnings.push(`${sourceName} page ${page.index}: size ${page.width}x${page.height} differs from ${existing.width}x${existing.height} in the first annotation set.`);
        }
        existing.annotations.push(...Array.from(page.annotations));
        existing.links.push(...Array.from(page.links));
      }
    }
  }

  const pages = [...pageMap.values()].sort((a, b) => a.index - b.index);
  for (const page of pages) {
    page.annotations.sort((a, b) => a.sourceOrder - b.sourceOrder);
    const seenIds = new Set();
    const duplicateIds = new Set();
    const renumbered = page.annotations.map((annotation, idx) => {
      if (seenIds.has(annotation.id)) duplicateIds.add(annotation.id);
      else seenIds.add(annotation.id);
      return { ...annotation, sourceOrder: idx };
    });
    page.annotations = renumbered;
    if (duplicateIds.size) {
      warnings.push(`page ${page.index}: ${duplicateIds.size} duplicate annotation id(s) encountered during merge.`);
    }
    page.byKind = {
      frame: page.annotations.filter((a) => a.kind === "frame"),
      body: page.annotations.filter((a) => a.kind === "body"),
      face: page.annotations.filter((a) => a.kind === "face"),
      text: page.annotations.filter((a) => a.kind === "text"),
      onomatopoeia: page.annotations.filter((a) => a.kind === "onomatopoeia"),
    };
  }

  return /** @type {Manga109BookAnnotation} */ ({
    title,
    characters: [...characters.values()],
    pages,
    warnings,
  });
}
