// @ts-check

import { LruCache } from "./lru-cache.js";
import { mapImagesToPages } from "./mapping.js";
import { mergeBookAnnotations, parseManga109Xml } from "./xml-parser.js";
import {
  basename,
  isSupportedImage,
  naturalCompare,
  nextFrame,
  normalizePath,
  numericPageIndex,
  withoutExtension,
} from "./utils.js";

/** @typedef {import('../types/manga109').Manga109Dataset} Manga109Dataset */
/** @typedef {import('../types/manga109').Manga109ImageAsset} Manga109ImageAsset */
/** @typedef {import('../types/manga109').Manga109LoadedBook} Manga109LoadedBook */

const CORE_ANNOTATION_DIRECTORY = /^(annotations(?:\.v\d{4}(?:\.\d{2}){2})?|annotations_COO)$/i;

/** @param {string[]} values */
function preferredAnnotationSet(values) {
  const exact = values.find((value) => value.toLowerCase() === "annotations");
  if (exact) return exact;
  const coo = values.find((value) => value.toLowerCase() === "annotations_coo");
  if (coo) return coo;
  return [...values].sort(naturalCompare).at(-1) ?? "";
}

/**
 * @param {string[]} values
 * @param {string} primary
 */
function preferredOnomatopoeiaSet(values, primary) {
  if (primary.toLowerCase() === "annotations_coo") return "";
  const coo = values.find((value) => value.toLowerCase() === "annotations_coo");
  return coo ?? "";
}

/**
 * Build the list of annotation directories/sets to read for a given primary
 * and optional onomatopoeia add-on set.
 * @param {string} primary
 * @param {string} secondary
 */
function includedAnnotationSetNames(primary, secondary) {
  if (!secondary || primary.toLowerCase() === secondary.toLowerCase()) return [primary];
  return [primary, secondary];
}

/** @param {FileSystemDirectoryHandle} directory */
async function directoryEntries(directory) {
  /** @type {[string, FileSystemFileHandle | FileSystemDirectoryHandle][]} */
  const entries = [];
  for await (const entry of directory.entries()) entries.push(entry);
  return entries;
}

/** @param {unknown} error */
function isNotFound(error) {
  return error instanceof DOMException && error.name === "NotFoundError";
}

class DatasetBase {
  /**
   * @param {Manga109Dataset["kind"]} kind
   * @param {string} rootName
   * @param {readonly string[]} annotationSetNames
   * @param {string[]} discoveryWarnings
   */
  constructor(kind, rootName, annotationSetNames, discoveryWarnings) {
    this.kind = kind;
    this.rootName = rootName;
    this.annotationSetNames = [...annotationSetNames].sort(naturalCompare);
    this.selectedAnnotationSet = preferredAnnotationSet(this.annotationSetNames);
    this.selectedOnomatopoeiaSet = preferredOnomatopoeiaSet(this.annotationSetNames, this.selectedAnnotationSet);
    this.discoveryWarnings = discoveryWarnings;
    /**
     * Map of book name to the list of annotation sources that should be merged.
     * @type {Map<string, {sourceName: string; resource: File | FileSystemFileHandle}[]>}
     */
    this.annotationIndex = new Map();
    /** @type {LruCache<string, Promise<Manga109LoadedBook>>} */
    this.bookCache = new LruCache(4);
  }

  get onomatopoeiaSetNames() {
    const coo = this.annotationSetNames.filter((name) => name.toLowerCase() === "annotations_coo");
    return ["", ...coo];
  }

  /** @param {string} _primary @param {string} _secondary @returns {Promise<void>} */
  async indexAnnotationSets(_primary, _secondary) {
    throw new Error("Not implemented");
  }

  /**
   * @param {string} _bookName
   * @returns {Promise<{name: string; xml: string}[]>}
   */
  async readAnnotationXmls(_bookName) {
    throw new Error("Not implemented");
  }

  /** @param {string} _bookName @returns {Promise<Manga109ImageAsset[]>} */
  async listImageAssets(_bookName) {
    throw new Error("Not implemented");
  }

  /** @returns {readonly string[]} */
  imageBookNames() {
    throw new Error("Not implemented");
  }

  /**
   * @param {string} name
   * @param {string} [onomatopoeiaSet]
   */
  async setAnnotationSet(name, onomatopoeiaSet) {
    if (!this.annotationSetNames.includes(name)) {
      throw new Error(`Unknown annotation set "${name}".`);
    }
    const nextOnomatopoeia = onomatopoeiaSet ?? this.selectedOnomatopoeiaSet;
    if (!this.onomatopoeiaSetNames.includes(nextOnomatopoeia)) {
      throw new Error(`Unknown onomatopoeia set "${nextOnomatopoeia}".`);
    }
    this.selectedAnnotationSet = name;
    this.selectedOnomatopoeiaSet = nextOnomatopoeia;
    await this.indexAnnotationSets(name, nextOnomatopoeia);
    this.bookCache.clear();
  }

  listBooks() {
    const annotationBooks = new Set(this.annotationIndex.keys());
    return this.imageBookNames().filter((name) => annotationBooks.has(name)).sort(naturalCompare);
  }

  /** @param {string} name */
  loadBook(name) {
    if (!this.listBooks().includes(name)) throw new Error(`Book "${name}" is not available in both images and ${this.selectedAnnotationSet}.`);
    const cacheKey = `${this.selectedAnnotationSet}:${name}`;
    const cached = this.bookCache.get(cacheKey);
    if (cached) return cached;

    const pending = (async () => {
      const [xmlParts, assets] = await Promise.all([this.readAnnotationXmls(name), this.listImageAssets(name)]);
      // Let current input and paint work complete before the native XML parse.
      await nextFrame();
      const parts = xmlParts.map(({ name: sourceName, xml }) => parseManga109Xml(xml, sourceName));
      const partNames = xmlParts.map(({ name: sourceName }) => sourceName);
      const parsed = mergeBookAnnotations(parts, partNames);
      const titleWarning = parsed.title === name ? [] : [`XML title "${parsed.title}" does not match image directory "${name}".`];
      const annotation = titleWarning.length
        ? { ...parsed, warnings: [...parsed.warnings, ...titleWarning] }
        : parsed;
      const images = mapImagesToPages(assets, annotation.pages);
      return {
        name,
        annotation,
        images,
        charactersById: new Map(annotation.characters.map((character) => [character.id, character])),
        pagesByIndex: new Map(annotation.pages.map((page) => [page.index, page])),
      };
    })();

    this.bookCache.set(cacheKey, pending);
    pending.catch(() => this.bookCache.delete(cacheKey));
    return pending;
  }

  clearCaches() {
    this.bookCache.clear();
  }
}

class FileSystemDataset extends DatasetBase {
  /**
   * @param {FileSystemDirectoryHandle} root
   * @param {FileSystemDirectoryHandle} imagesDirectory
   * @param {Map<string, FileSystemDirectoryHandle>} annotationDirectories
   * @param {Map<string, FileSystemDirectoryHandle>} imageBooks
   * @param {string[]} warnings
   */
  constructor(root, imagesDirectory, annotationDirectories, imageBooks, warnings) {
    super("file-system-access", root.name, [...annotationDirectories.keys()], warnings);
    this.root = root;
    this.imagesDirectory = imagesDirectory;
    this.annotationDirectories = annotationDirectories;
    this.imageBooks = imageBooks;
  }

  imageBookNames() {
    return [...this.imageBooks.keys()];
  }

  /**
   * @param {string} primary
   * @param {string} secondary
   */
  async indexAnnotationSets(primary, secondary) {
    this.annotationIndex.clear();
    for (const setName of includedAnnotationSetNames(primary, secondary)) {
      const directory = this.annotationDirectories.get(setName);
      if (!directory) throw new Error(`Annotation directory "${setName}" is unavailable.`);
      for (const [filename, handle] of await directoryEntries(directory)) {
        if (handle.kind !== "file" || !/\.xml$/i.test(filename)) continue;
        const book = withoutExtension(filename);
        const sources = this.annotationIndex.get(book) ?? [];
        sources.push({ sourceName: `${setName}/${filename}`, resource: handle });
        this.annotationIndex.set(book, sources);
      }
    }
  }

  /**
   * @param {string} bookName
   * @returns {Promise<{name: string; xml: string}[]>}
   */
  async readAnnotationXmls(bookName) {
    const sources = this.annotationIndex.get(bookName);
    if (!sources || !sources.length) throw new Error(`Missing XML annotation for "${bookName}".`);
    return Promise.all(
      sources.map(async ({ sourceName, resource }) => {
        if (!("getFile" in resource)) throw new Error(`Missing XML annotation for "${bookName}".`);
        return { name: sourceName, xml: await (await resource.getFile()).text() };
      }),
    );
  }

  /** @param {string} bookName */
  async listImageAssets(bookName) {
    const bookDirectory = this.imageBooks.get(bookName);
    if (!bookDirectory) throw new Error(`Missing image directory for "${bookName}".`);
    /** @type {Manga109ImageAsset[]} */
    const assets = [];

    /** @param {FileSystemDirectoryHandle} directory @param {string} prefix @param {number} depth */
    const walk = async (directory, prefix, depth) => {
      if (depth > 8) throw new Error(`Image directory nesting is too deep beneath images/${bookName}.`);
      const entries = await directoryEntries(directory);
      entries.sort(([a], [b]) => naturalCompare(a, b));
      for (const [name, handle] of entries) {
        const relativePath = normalizePath(prefix ? `${prefix}/${name}` : name);
        if (handle.kind === "directory") {
          await walk(handle, relativePath, depth + 1);
        } else if (isSupportedImage(name)) {
          assets.push({
            key: `${this.rootName}/${bookName}/${relativePath}`,
            name,
            relativePath,
            numericIndex: numericPageIndex(name),
            getFile: () => handle.getFile(),
          });
        }
      }
    };

    await walk(bookDirectory, "", 0);
    return assets;
  }
}

class DirectoryInputDataset extends DatasetBase {
  /**
   * @param {string} rootName
   * @param {Map<string, Map<string, File>>} annotationSets
   * @param {Map<string, {file: File, relativePath: string}[]>} imageBooks
   * @param {string[]} warnings
   */
  constructor(rootName, annotationSets, imageBooks, warnings) {
    super("directory-input", rootName, [...annotationSets.keys()], warnings);
    this.annotationSets = annotationSets;
    this.imageBooks = imageBooks;
  }

  imageBookNames() {
    return [...this.imageBooks.keys()];
  }

  /**
   * @param {string} primary
   * @param {string} secondary
   */
  async indexAnnotationSets(primary, secondary) {
    this.annotationIndex.clear();
    for (const setName of includedAnnotationSetNames(primary, secondary)) {
      const files = this.annotationSets.get(setName);
      if (!files) throw new Error(`Annotation directory "${setName}" is unavailable.`);
      for (const [book, file] of files) {
        const sources = this.annotationIndex.get(book) ?? [];
        sources.push({ sourceName: `${setName}/${book}.xml`, resource: file });
        this.annotationIndex.set(book, sources);
      }
    }
  }

  /**
   * @param {string} bookName
   * @returns {Promise<{name: string; xml: string}[]>}
   */
  async readAnnotationXmls(bookName) {
    const sources = this.annotationIndex.get(bookName);
    if (!sources || !sources.length) throw new Error(`Missing XML annotation for "${bookName}".`);
    return Promise.all(
      sources.map(async ({ sourceName, resource }) => {
        if (!(resource instanceof File)) throw new Error(`Missing XML annotation for "${bookName}".`);
        return { name: sourceName, xml: await resource.text() };
      }),
    );
  }

  /** @param {string} bookName */
  async listImageAssets(bookName) {
    const entries = this.imageBooks.get(bookName) ?? [];
    return entries.map(({ file, relativePath }) => {
      const name = basename(relativePath);
      return {
        key: `${this.rootName}/${bookName}/${relativePath}:${file.lastModified}:${file.size}`,
        name,
        relativePath,
        numericIndex: numericPageIndex(name),
        getFile: async () => file,
      };
    });
  }
}

export function supportsFileSystemAccess() {
  return typeof window.showDirectoryPicker === "function";
}

/** @returns {Promise<Manga109Dataset>} */
export async function openFileSystemDataset() {
  if (!window.showDirectoryPicker) throw new Error("This browser does not support the directory picker API.");
  const root = await window.showDirectoryPicker({ id: "manga109-root", mode: "read" });
  let imagesDirectory;
  try {
    imagesDirectory = await root.getDirectoryHandle("images");
  } catch (error) {
    if (isNotFound(error)) throw new Error(`The selected folder "${root.name}" does not contain an images/ directory.`);
    throw error;
  }

  const rootEntries = await directoryEntries(root);
  /** @type {Map<string, FileSystemDirectoryHandle>} */
  const annotationDirectories = new Map();
  for (const [name, handle] of rootEntries) {
    if (handle.kind === "directory" && CORE_ANNOTATION_DIRECTORY.test(name)) annotationDirectories.set(name, handle);
  }
  if (!annotationDirectories.size) {
    throw new Error(`The selected folder "${root.name}" does not contain annotations/, annotations.vYYYY.MM.DD/, or annotations_COO/.`);
  }

  /** @type {Map<string, FileSystemDirectoryHandle>} */
  const imageBooks = new Map();
  for (const [name, handle] of await directoryEntries(imagesDirectory)) {
    if (handle.kind === "directory") imageBooks.set(name, handle);
  }
  if (!imageBooks.size) throw new Error("No book directories were found beneath images/.");

  /** @type {string[]} */
  const warnings = [];
  const dataset = new FileSystemDataset(root, imagesDirectory, annotationDirectories, imageBooks, warnings);
  await dataset.setAnnotationSet(dataset.selectedAnnotationSet);
  const annotationOnly = [...dataset.annotationIndex.keys()].filter((name) => !imageBooks.has(name));
  const imageOnly = [...imageBooks.keys()].filter((name) => !dataset.annotationIndex.has(name));
  if (annotationOnly.length) warnings.push(`${annotationOnly.length} annotation XML file(s) have no matching image directory.`);
  if (imageOnly.length) warnings.push(`${imageOnly.length} image book director${imageOnly.length === 1 ? "y has" : "ies have"} no matching XML file in ${dataset.selectedAnnotationSet}.`);
  return dataset;
}

/**
 * Fallback for browsers without showDirectoryPicker. File objects are indexed,
 * but image bytes are still read only when a page is displayed.
 * @param {FileList | readonly File[]} fileList
 * @returns {Promise<Manga109Dataset>}
 */
export async function openDirectoryInputDataset(fileList) {
  const files = Array.from(fileList);
  if (!files.length) throw new Error("No files were selected.");
  const relativePaths = files.map((file) => normalizePath(file.webkitRelativePath || file.name));
  const firstSegments = new Set(relativePaths.map((path) => path.split("/")[0]));
  const commonRoot = firstSegments.size === 1 ? [...firstSegments][0] : "Selected folder";

  /** @type {Map<string, Map<string, File>>} */
  const annotationSets = new Map();
  /** @type {Map<string, {file: File, relativePath: string}[]>} */
  const imageBooks = new Map();

  files.forEach((file, index) => {
    const original = relativePaths[index];
    const segments = original.split("/");
    const stripped = segments[0] === commonRoot && segments.length > 1 ? segments.slice(1) : segments;
    if (stripped[0] === "images" && stripped.length >= 3 && isSupportedImage(stripped.at(-1) ?? "")) {
      const book = stripped[1];
      const relativePath = stripped.slice(2).join("/");
      const entries = imageBooks.get(book) ?? [];
      entries.push({ file, relativePath });
      imageBooks.set(book, entries);
    } else if (CORE_ANNOTATION_DIRECTORY.test(stripped[0] ?? "") && stripped.length === 2 && /\.xml$/i.test(stripped[1])) {
      const setName = stripped[0];
      const set = annotationSets.get(setName) ?? new Map();
      set.set(withoutExtension(stripped[1]), file);
      annotationSets.set(setName, set);
    }
  });

  if (!imageBooks.size) throw new Error("The selected folder does not contain images/<book>/<page image> files.");
  if (!annotationSets.size) throw new Error("The selected folder does not contain annotations/<book>.xml or annotations_COO/<book>.xml files.");

  const warnings = ["Compatibility folder input is active. The browser enumerated all file handles up front, but page bytes remain lazy-loaded."];
  const dataset = new DirectoryInputDataset(commonRoot, annotationSets, imageBooks, warnings);
  await dataset.setAnnotationSet(dataset.selectedAnnotationSet);
  return dataset;
}
