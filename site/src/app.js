// @ts-check

import {
  openDirectoryInputDataset,
  openFileSystemDataset,
  supportsFileSystemAccess,
} from "./core/dataset.js";
import { calculateFitScale, scaleBoundingBox } from "./core/geometry.js";
import { ImageUrlCache } from "./core/image-cache.js";
import { clamp, errorMessage, padPageIndex } from "./core/utils.js";

/** @typedef {import('./types/manga109').Manga109Annotation} Manga109Annotation */
/** @typedef {import('./types/manga109').Manga109AnnotationKind} Manga109AnnotationKind */
/** @typedef {import('./types/manga109').Manga109Dataset} Manga109Dataset */
/** @typedef {import('./types/manga109').Manga109ImageAsset} Manga109ImageAsset */
/** @typedef {import('./types/manga109').Manga109ImageDimensions} Manga109ImageDimensions */
/** @typedef {import('./types/manga109').Manga109LoadedBook} Manga109LoadedBook */
/** @typedef {import('./types/manga109').Manga109PageAnnotation} Manga109PageAnnotation */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** @type {readonly Manga109AnnotationKind[]} */
const LAYER_ORDER = ["frame", "body", "face", "text", "onomatopoeia"];
const LAYER_LABELS = {
  frame: "Frames",
  body: "Bodies",
  face: "Faces",
  text: "Text",
  onomatopoeia: "Onomatopoeia",
};
const LAYER_SINGULAR = {
  frame: "Frame",
  body: "Body",
  face: "Face",
  text: "Text",
  onomatopoeia: "Onomatopoeia",
};

const ICONS = {
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.75A1.75 1.75 0 0 1 4.75 5h4.1c.55 0 1.08.26 1.41.7l.74 1h8.25A1.75 1.75 0 0 1 21 8.45v8.8A1.75 1.75 0 0 1 19.25 19H4.75A1.75 1.75 0 0 1 3 17.25V6.75Z"/><path d="M3.5 9h17"/></svg>`,
  image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-4.5-4.5L6 20"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`,
  minus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  fit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
  info: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.7 2.4 17.4A1.7 1.7 0 0 0 3.9 20h16.2a1.7 1.7 0 0 0 1.5-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16h.01"/></svg>`,
  database: `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>`,
  book: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`,
  fileText: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
  mousePointer: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3Z"/><path d="m13 13 6 6"/></svg>`,
  alertCircle: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1.6 1.6l-.18.02a2 2 0 0 0-1.9 1.13l-.22.38a2 2 0 0 0 .28 2.43l.13.13a2 2 0 0 1 0 2.82l-.13.13a2 2 0 0 0-.28 2.43l.22.38a2 2 0 0 0 1.9 1.13l.18.02a2 2 0 0 1 1.6 1.6v.18a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1.6-1.6l.18-.02a2 2 0 0 0 1.9-1.13l.22-.38a2 2 0 0 0-.28-2.43l-.13-.13a2 2 0 0 1 0-2.82l.13-.13a2 2 0 0 0 .28-2.43l-.22-.38a2 2 0 0 0-1.9-1.13l-.18-.02a2 2 0 0 1-1.6-1.6V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  type: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
};

const APP_TEMPLATE = `
  <div class="app-shell" id="app-shell" aria-busy="false">
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark">${ICONS.image}</span>
        <div>
          <h1>Manga109 Inspector</h1>
          <p id="dataset-subtitle">No dataset open</p>
        </div>
      </div>
      <div class="topbar-actions">
        <button class="button button-ghost button-icon" id="theme-toggle" type="button" title="Toggle theme">
          <span id="theme-icon">${ICONS.moon}</span><span class="sr-only">Toggle theme</span>
        </button>
        <button class="button button-primary" id="open-directory" type="button">
          ${ICONS.folder}<span>Open folder</span>
        </button>
      </div>
    </header>

    <aside class="sidebar panel-border-right" aria-label="Dataset and annotation controls">
      <div class="sidebar-scroll">
        <section class="control-section">
          <div class="section-heading">
            <span class="section-icon">${ICONS.database}</span>
            <h2>Dataset</h2>
          </div>
          <label class="field-label" for="annotation-set">Annotation set</label>
          <select class="select" id="annotation-set" disabled>
            <option>No dataset</option>
          </select>

          <label class="field-label" for="onomatopoeia-set">Onomatopoeia</label>
          <select class="select" id="onomatopoeia-set" disabled>
            <option value="">None</option>
          </select>

          <label class="field-label" for="book-select">Book</label>
          <select class="select" id="book-select" disabled>
            <option>No book</option>
          </select>
        </section>

        <div class="separator"></div>

        <section class="control-section" aria-labelledby="layers-heading">
          <div class="section-heading">
            <span class="section-icon">${ICONS.layers}</span>
            <h2 id="layers-heading">Annotations</h2>
          </div>
          <div class="layer-list">
            ${LAYER_ORDER.map(
              (kind) => `
                <button class="layer-row" type="button" role="switch" aria-checked="true" data-layer="${kind}">
                  <span class="layer-identity"><span class="layer-swatch layer-${kind}"></span>${LAYER_LABELS[kind]}</span>
                  <span class="layer-count" data-layer-count="${kind}">0</span>
                  <span class="switch-control" aria-hidden="true"><span></span></span>
                </button>`,
            ).join("")}
          </div>
          <button class="setting-row" id="show-labels" type="button" role="switch" aria-checked="false">
            <span>
              <strong>Labels</strong>
              <small>Type, character, or text preview</small>
            </span>
            <span class="switch-control" aria-hidden="true"><span></span></span>
          </button>
        </section>

        <div class="separator"></div>

        <section class="control-section">
          <div class="section-heading">
            <span class="section-icon">${ICONS.settings}</span>
            <h2>Session</h2>
          </div>
          <div id="dataset-summary" class="summary-card muted-card">
            <p>Open the Manga109 root folder to begin.</p>
          </div>
          <div id="sidebar-diagnostics" class="sidebar-diagnostics"></div>
        </section>
      </div>
    </aside>

    <main class="workspace">
      <div class="viewer-toolbar" aria-label="Page and zoom controls">
        <div class="toolbar-group">
          <button class="button button-ghost button-icon" id="previous-page" type="button" title="Previous page (Left Arrow)" disabled>
            ${ICONS.chevronLeft}<span class="sr-only">Previous page</span>
          </button>
          <div class="page-jump">
            <label for="page-number">Page</label>
            <input class="input page-number" id="page-number" type="number" inputmode="numeric" disabled />
            <span id="page-position">0 / 0</span>
          </div>
          <button class="button button-ghost button-icon" id="next-page" type="button" title="Next page (Right Arrow)" disabled>
            ${ICONS.chevronRight}<span class="sr-only">Next page</span>
          </button>
        </div>
        <div class="toolbar-group zoom-group">
          <button class="button button-ghost button-icon" id="zoom-out" type="button" title="Zoom out (-)" disabled>
            ${ICONS.minus}<span class="sr-only">Zoom out</span>
          </button>
          <button class="button button-ghost zoom-value" id="zoom-value" type="button" title="Set zoom to 100%" disabled>100%</button>
          <button class="button button-ghost button-icon" id="zoom-in" type="button" title="Zoom in (+)" disabled>
            ${ICONS.plus}<span class="sr-only">Zoom in</span>
          </button>
          <button class="button button-outline button-fit" id="fit-page" type="button" title="Fit page to viewport (0)" disabled>
            ${ICONS.fit}<span>Fit</span>
          </button>
        </div>
      </div>

      <div class="viewer-frame" id="viewer-frame">
        <div class="empty-state" id="empty-state">
          <div class="empty-icon">${ICONS.folder}</div>
          <h2>Open Manga109 from this device</h2>
          <p>Select the dataset root containing <code>images/</code> and <code>annotations/</code>. Image bytes are read only for the current page and a small prefetch window.</p>
          <div class="empty-actions">
            <button class="button button-primary" id="empty-open-directory" type="button">${ICONS.folder}<span>Open Manga109 folder</span></button>
            <button class="text-button" id="open-fallback" type="button">Use compatibility folder picker</button>
          </div>
          <div class="folder-example" aria-label="Expected folder structure">
            <span>manga109/</span>
            <span>├─ images/BookTitle/000.jpg</span>
            <span>└─ annotations/BookTitle.xml</span>
          </div>
        </div>

        <div class="viewer-scroll" id="viewer-scroll" hidden tabindex="0" aria-label="Manga page viewer">
          <div class="stage-host">
            <div class="image-stage" id="image-stage">
              <img id="page-image" alt="" decoding="async" />
              <svg id="annotation-overlay" aria-label="Page annotations"></svg>
            </div>
          </div>
        </div>

        <div class="loading-pill" id="loading-pill" hidden role="status" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          <span id="loading-text">Loading…</span>
        </div>
      </div>
    </main>

    <aside class="inspector panel-border-left" aria-label="Page inspector">
      <div class="inspector-scroll">
        <section class="inspector-section">
          <div class="section-heading">
            <span class="section-icon">${ICONS.fileText}</span>
            <h2>Page</h2>
          </div>
          <div id="page-inspector" class="empty-inspector">No page loaded.</div>
        </section>
        <div class="separator"></div>
        <section class="inspector-section">
          <div class="section-heading">
            <span class="section-icon">${ICONS.mousePointer}</span>
            <h2>Selection</h2>
          </div>
          <div id="selection-inspector" class="empty-inspector">Select an annotation box.</div>
        </section>
        <div class="separator"></div>
        <section class="inspector-section">
          <div class="section-heading">
            <span class="section-icon">${ICONS.alertCircle}</span>
            <h2>Diagnostics</h2>
            <span class="count-badge" id="diagnostic-count">0</span>
          </div>
          <div id="diagnostics" class="diagnostics-list">
            <div class="diagnostic-ok">No issues detected.</div>
          </div>
        </section>
      </div>
    </aside>

    <input id="folder-input" type="file" webkitdirectory multiple hidden />
    <div class="toast-region" aria-live="polite" aria-atomic="true">
      <div class="toast" id="toast" hidden></div>
    </div>
  </div>
`;

/** @param {ParentNode} root @param {string} selector */
function mustElement(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

/** @param {ParentNode} root @param {string} selector */
function mustHtmlElement(root, selector) {
  const element = mustElement(root, selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Expected HTMLElement: ${selector}`);
  return element;
}

/** @param {ParentNode} root @param {string} selector */
function mustButton(root, selector) {
  const element = mustElement(root, selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected button: ${selector}`);
  return element;
}

/** @param {ParentNode} root @param {string} selector */
function mustInput(root, selector) {
  const element = mustElement(root, selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Expected input: ${selector}`);
  return element;
}

/** @param {ParentNode} root @param {string} selector */
function mustSelect(root, selector) {
  const element = mustElement(root, selector);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Expected select: ${selector}`);
  return element;
}

/** @param {ParentNode} root @param {string} selector */
function mustImage(root, selector) {
  const element = mustElement(root, selector);
  if (!(element instanceof HTMLImageElement)) throw new Error(`Expected image: ${selector}`);
  return element;
}

/** @param {ParentNode} root @param {string} selector */
function mustSvg(root, selector) {
  const element = mustElement(root, selector);
  if (!(element instanceof SVGSVGElement)) throw new Error(`Expected SVG: ${selector}`);
  return element;
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** @param {HTMLImageElement} image */
async function waitForDecodedImage(image) {
  try {
    await image.decode();
  } catch {
    if (!image.complete) {
      await new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", () => reject(new Error("The selected image could not be decoded.")), { once: true });
      });
    }
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("The selected image has invalid decoded dimensions.");
}

/** @param {Manga109PageAnnotation} page @param {Manga109AnnotationKind} kind */
function annotationsForKind(page, kind) {
  return page.byKind[kind];
}

/** @param {Manga109Annotation} annotation @param {Manga109LoadedBook} book */
function annotationLabel(annotation, book) {
  if (annotation.kind === "face" || annotation.kind === "body") {
    const character = book.charactersById.get(annotation.characterId);
    return `${LAYER_SINGULAR[annotation.kind]} · ${character?.name ?? annotation.characterId}`;
  }
  if (annotation.kind === "text") {
    const normalized = annotation.text.replace(/\s+/g, " ").trim();
    return normalized ? `Text · ${normalized.slice(0, 36)}${normalized.length > 36 ? "…" : ""}` : "Text";
  }
  if (annotation.kind === "onomatopoeia") {
    const normalized = annotation.text.replace(/\s+/g, " ").trim();
    return normalized ? `Onomatopoeia · ${normalized.slice(0, 36)}${normalized.length > 36 ? "…" : ""}` : "Onomatopoeia";
  }
  return "Frame";
}

class Manga109App {
  /** @param {HTMLElement} root */
  constructor(root) {
    root.innerHTML = APP_TEMPLATE;
    this.root = root;
    this.shell = mustHtmlElement(root, "#app-shell");
    this.datasetSubtitle = mustHtmlElement(root, "#dataset-subtitle");
    this.openDirectoryButton = mustButton(root, "#open-directory");
    this.emptyOpenDirectoryButton = mustButton(root, "#empty-open-directory");
    this.openFallbackButton = mustButton(root, "#open-fallback");
    this.folderInput = mustInput(root, "#folder-input");
    this.themeToggle = mustButton(root, "#theme-toggle");
    this.themeIcon = mustHtmlElement(root, "#theme-icon");
    this.annotationSetSelect = mustSelect(root, "#annotation-set");
    this.onomatopoeiaSetSelect = mustSelect(root, "#onomatopoeia-set");
    this.bookSelect = mustSelect(root, "#book-select");
    this.datasetSummary = mustHtmlElement(root, "#dataset-summary");
    this.sidebarDiagnostics = mustHtmlElement(root, "#sidebar-diagnostics");
    this.previousButton = mustButton(root, "#previous-page");
    this.nextButton = mustButton(root, "#next-page");
    this.pageNumberInput = mustInput(root, "#page-number");
    this.pagePositionLabel = mustHtmlElement(root, "#page-position");
    this.zoomOutButton = mustButton(root, "#zoom-out");
    this.zoomInButton = mustButton(root, "#zoom-in");
    this.zoomValueButton = mustButton(root, "#zoom-value");
    this.fitButton = mustButton(root, "#fit-page");
    this.emptyState = mustHtmlElement(root, "#empty-state");
    this.viewerScroll = mustHtmlElement(root, "#viewer-scroll");
    this.imageStage = mustHtmlElement(root, "#image-stage");
    this.pageImage = mustImage(root, "#page-image");
    this.overlay = mustSvg(root, "#annotation-overlay");
    this.loadingPill = mustHtmlElement(root, "#loading-pill");
    this.loadingText = mustHtmlElement(root, "#loading-text");
    this.pageInspector = mustHtmlElement(root, "#page-inspector");
    this.selectionInspector = mustHtmlElement(root, "#selection-inspector");
    this.diagnostics = mustHtmlElement(root, "#diagnostics");
    this.diagnosticCount = mustHtmlElement(root, "#diagnostic-count");
    this.showLabelsButton = mustButton(root, "#show-labels");
    this.toast = mustHtmlElement(root, "#toast");

    /** @type {Manga109Dataset | null} */
    this.dataset = null;
    /** @type {Manga109LoadedBook | null} */
    this.book = null;
    /** @type {Manga109PageAnnotation | null} */
    this.currentPage = null;
    /** @type {Manga109ImageAsset | null} */
    this.currentAsset = null;
    /** @type {Manga109ImageDimensions | null} */
    this.imageDimensions = null;
    /** @type {number[]} */
    this.visiblePageIndexes = [];
    this.pagePosition = -1;
    this.selectedAnnotationId = null;
    /** @type {Record<Manga109AnnotationKind, boolean>} */
    this.layers = { frame: true, body: true, face: true, text: true, onomatopoeia: true };
    this.showLabels = false;
    this.zoom = 1;
    this.fitMode = true;
    this.bookGeneration = 0;
    this.pageGeneration = 0;
    this.busyGeneration = 0;
    this.toastTimer = 0;
    this.imageCache = new ImageUrlCache(7);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitMode && this.imageDimensions) this.fitToViewport();
    });
  }

  async init() {
    this.bindEvents();
    this.initTheme();
    this.resizeObserver.observe(this.viewerScroll);
    this.renderControls();
    this.renderDiagnostics();
    this.registerServiceWorker();

    if (location.search.includes("test")) {
      const { createFixtureDataset } = await import("./core/fixture-dataset.js");
      await this.execute(async () => this.useDataset(await createFixtureDataset()), "Loading fixture…");
    }
  }

  bindEvents() {
    const openNativeOrFallback = () => {
      if (supportsFileSystemAccess()) void this.openNativeFolder();
      else this.folderInput.click();
    };
    this.openDirectoryButton.addEventListener("click", openNativeOrFallback);
    this.emptyOpenDirectoryButton.addEventListener("click", openNativeOrFallback);
    this.openFallbackButton.addEventListener("click", () => this.folderInput.click());
    this.themeToggle.addEventListener("click", () => this.toggleTheme());
    this.folderInput.addEventListener("change", () => {
      const files = this.folderInput.files;
      if (!files?.length) return;
      void this.execute(async () => this.useDataset(await openDirectoryInputDataset(files)), "Indexing selected folder…");
      this.folderInput.value = "";
    });

    this.annotationSetSelect.addEventListener("change", () => {
      void this.execute(() => this.changeAnnotationSet(this.annotationSetSelect.value), "Switching annotation set…");
    });
    this.onomatopoeiaSetSelect.addEventListener("change", () => {
      void this.execute(() => this.changeOnomatopoeiaSet(this.onomatopoeiaSetSelect.value), "Switching onomatopoeia set…");
    });
    this.bookSelect.addEventListener("change", () => {
      void this.execute(() => this.loadBook(this.bookSelect.value), `Loading ${this.bookSelect.value}…`);
    });

    for (const button of this.root.querySelectorAll("[data-layer]")) {
      button.addEventListener("click", () => {
        const kind = /** @type {Manga109AnnotationKind | undefined} */ (button.getAttribute("data-layer") ?? undefined);
        if (!kind || !LAYER_ORDER.includes(kind)) return;
        this.layers[kind] = !this.layers[kind];
        button.setAttribute("aria-checked", String(this.layers[kind]));
        this.renderOverlay();
      });
    }
    this.showLabelsButton.addEventListener("click", () => {
      this.showLabels = !this.showLabels;
      this.showLabelsButton.setAttribute("aria-checked", String(this.showLabels));
      this.renderOverlay();
    });

    this.previousButton.addEventListener("click", () => void this.movePage(-1));
    this.nextButton.addEventListener("click", () => void this.movePage(1));
    this.pageNumberInput.addEventListener("change", () => this.jumpToPageInput());
    this.pageNumberInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.jumpToPageInput();
      }
    });

    this.zoomOutButton.addEventListener("click", () => this.setZoom(this.zoom / 1.2, false));
    this.zoomInButton.addEventListener("click", () => this.setZoom(this.zoom * 1.2, false));
    this.zoomValueButton.addEventListener("click", () => this.setZoom(1, false));
    this.fitButton.addEventListener("click", () => this.fitToViewport());
    this.viewerScroll.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        this.setZoom(this.zoom * (event.deltaY > 0 ? 1 / 1.12 : 1.12), false);
      },
      { passive: false },
    );

    this.overlay.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-annotation-id]") : null;
      if (target) this.selectedAnnotationId = target.getAttribute("data-annotation-id");
      else this.selectedAnnotationId = null;
      this.renderOverlay();
      this.renderSelectionInspector();
    });

    window.addEventListener("keydown", (event) => this.handleKeyboard(event));
  }

  async openNativeFolder() {
    // Keep the picker call in the click activation stack.
    const pending = openFileSystemDataset();
    await this.execute(async () => this.useDataset(await pending), "Opening Manga109 folder…");
  }

  /** @param {() => Promise<void>} operation @param {string} message */
  async execute(operation, message) {
    const token = this.beginBusy(message);
    try {
      await operation();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.showToast(errorMessage(error), true);
        console.error(error);
      }
    } finally {
      this.endBusy(token);
    }
  }

  /** @param {string} message */
  beginBusy(message) {
    const token = ++this.busyGeneration;
    this.shell.setAttribute("aria-busy", "true");
    this.loadingText.textContent = message;
    this.loadingPill.hidden = false;
    return token;
  }

  /** @param {number} token */
  endBusy(token) {
    if (token !== this.busyGeneration) return;
    this.shell.setAttribute("aria-busy", "false");
    this.loadingPill.hidden = true;
  }

  /** @param {Manga109Dataset} dataset */
  async useDataset(dataset) {
    this.bookGeneration += 1;
    this.pageGeneration += 1;
    this.dataset?.clearCaches();
    this.imageCache.clear();
    this.dataset = dataset;
    this.book = null;
    this.currentPage = null;
    this.currentAsset = null;
    this.imageDimensions = null;
    this.selectedAnnotationId = null;
    this.visiblePageIndexes = [];
    this.pagePosition = -1;
    this.pageImage.removeAttribute("src");
    this.overlay.replaceChildren();
    document.documentElement.dataset.ready = "false";

    this.populateSelect(this.annotationSetSelect, dataset.annotationSetNames, dataset.selectedAnnotationSet);
    this.annotationSetSelect.disabled = dataset.annotationSetNames.length <= 1;
    this.populateSelect(this.onomatopoeiaSetSelect, dataset.onomatopoeiaSetNames, dataset.selectedOnomatopoeiaSet);
    const isCooPrimary = dataset.selectedAnnotationSet.toLowerCase() === "annotations_coo";
    this.onomatopoeiaSetSelect.value = isCooPrimary ? "" : dataset.selectedOnomatopoeiaSet;
    this.onomatopoeiaSetSelect.disabled = isCooPrimary || dataset.onomatopoeiaSetNames.length <= 1;
    const books = dataset.listBooks();
    if (!books.length) throw new Error(`No matching books were found between images/ and ${dataset.selectedAnnotationSet}/.`);
    this.populateSelect(this.bookSelect, books, books[0]);
    this.bookSelect.disabled = false;
    this.datasetSubtitle.textContent = dataset.rootName;
    this.renderDatasetSummary();
    this.renderDiagnostics();
    await this.loadBook(books[0]);
  }

  /** @param {string} name */
  async changeAnnotationSet(name) {
    const dataset = this.dataset;
    if (!dataset) return;
    const isCooPrimary = name.toLowerCase() === "annotations_coo";
    const onomatopoeiaSet = isCooPrimary ? "" : this.onomatopoeiaSetSelect.value;
    const previousBook = this.book?.name ?? this.bookSelect.value;
    await dataset.setAnnotationSet(name, onomatopoeiaSet);
    this.populateSelect(this.onomatopoeiaSetSelect, dataset.onomatopoeiaSetNames, onomatopoeiaSet);
    this.onomatopoeiaSetSelect.value = onomatopoeiaSet;
    this.onomatopoeiaSetSelect.disabled = isCooPrimary || dataset.onomatopoeiaSetNames.length <= 1;
    const books = dataset.listBooks();
    if (!books.length) throw new Error(`No matching books were found in ${name}.`);
    const selected = books.includes(previousBook) ? previousBook : books[0];
    this.populateSelect(this.bookSelect, books, selected);
    this.renderDatasetSummary();
    const previousIndex = this.currentPage?.index ?? null;
    await this.loadBook(selected, previousIndex);
  }

  /** @param {string} name */
  async changeOnomatopoeiaSet(name) {
    const dataset = this.dataset;
    if (!dataset) return;
    await dataset.setAnnotationSet(dataset.selectedAnnotationSet, name);
    const books = dataset.listBooks();
    const previousBook = this.book?.name ?? this.bookSelect.value;
    const selected = books.includes(previousBook) ? previousBook : books[0];
    this.populateSelect(this.bookSelect, books, selected);
    const previousIndex = this.currentPage?.index ?? null;
    await this.loadBook(selected, previousIndex);
  }

  /**
   * @param {string} name
   * @param {number | null} [preferredIndex]
   */
  async loadBook(name, preferredIndex = null) {
    const dataset = this.dataset;
    if (!dataset) return;
    const generation = ++this.bookGeneration;
    this.pageGeneration += 1;
    this.imageCache.clear();
    this.book = null;
    this.currentPage = null;
    this.currentAsset = null;
    this.imageDimensions = null;
    this.selectedAnnotationId = null;
    this.pageImage.removeAttribute("src");
    this.overlay.replaceChildren();
    this.renderControls();

    const book = await dataset.loadBook(name);
    if (generation !== this.bookGeneration || dataset !== this.dataset) return;
    this.book = book;
    this.bookSelect.value = name;
    this.rebuildVisiblePages(preferredIndex);
    if (!this.visiblePageIndexes.length) throw new Error(`Book "${name}" has no image/XML page pairs that can be displayed.`);
    this.renderDatasetSummary();
    this.renderDiagnostics();
    await this.loadPageAtPosition(this.pagePosition, true);
  }

  /** @param {number | null} preferredIndex */
  rebuildVisiblePages(preferredIndex) {
    if (!this.book) {
      this.visiblePageIndexes = [];
      this.pagePosition = -1;
      return;
    }
    this.visiblePageIndexes = [...this.book.images.pages.entries()]
      .map(([index]) => index)
      .filter((index) => this.book?.pagesByIndex.has(index))
      .sort((a, b) => a - b);
    const preferredPosition = preferredIndex === null ? -1 : this.visiblePageIndexes.indexOf(preferredIndex);
    this.pagePosition = preferredPosition >= 0 ? preferredPosition : this.visiblePageIndexes.length ? 0 : -1;
    this.renderControls();
  }

  /** @param {number} position @param {boolean} [fit] */
  async loadPageAtPosition(position, fit = false) {
    const book = this.book;
    if (!book || !this.visiblePageIndexes.length) return;
    const boundedPosition = clamp(position, 0, this.visiblePageIndexes.length - 1);
    const pageIndex = this.visiblePageIndexes[boundedPosition];
    const page = book.pagesByIndex.get(pageIndex);
    const asset = book.images.pages.get(pageIndex);
    if (!page || !asset) throw new Error(`Page ${pageIndex + 1} is missing either its XML record or image file.`);

    const generation = ++this.pageGeneration;
    this.pagePosition = boundedPosition;
    this.currentPage = page;
    this.currentAsset = asset;
    this.selectedAnnotationId = null;
    this.imageDimensions = null;
    this.emptyState.hidden = true;
    this.viewerScroll.hidden = false;
    this.pageImage.classList.add("is-loading");
    this.pageImage.alt = `${book.name}, Manga109 page ${pageIndex + 1}`;
    this.renderControls();
    this.renderPageInspector();
    this.renderSelectionInspector();

    const url = await this.imageCache.get(asset);
    if (generation !== this.pageGeneration || book !== this.book) return;
    this.pageImage.src = url;
    await waitForDecodedImage(this.pageImage);
    if (generation !== this.pageGeneration || book !== this.book) return;

    this.imageDimensions = {
      width: this.pageImage.naturalWidth,
      height: this.pageImage.naturalHeight,
    };
    this.pageImage.classList.remove("is-loading");
    if (fit || this.fitMode) this.fitToViewport();
    else this.applyStageScale();
    this.renderOverlay();
    this.renderPageInspector();
    this.renderSelectionInspector();
    this.renderDiagnostics();
    this.renderControls();
    this.prefetchNeighbors();

    document.documentElement.dataset.ready = "true";
    document.body.dataset.page = String(pageIndex);
    document.body.dataset.annotationCount = String(page.annotations.length);
  }

  /** @param {number} delta */
  async movePage(delta) {
    if (!this.visiblePageIndexes.length) return;
    const next = clamp(this.pagePosition + delta, 0, this.visiblePageIndexes.length - 1);
    if (next === this.pagePosition) return;
    await this.execute(() => this.loadPageAtPosition(next), "Loading page…");
  }

  jumpToPageInput() {
    const requested = Number(this.pageNumberInput.value);
    if (!Number.isInteger(requested) || requested < 1) {
      this.renderControls();
      return;
    }
    const requestedIndex = requested - 1;
    const position = this.visiblePageIndexes.indexOf(requestedIndex);
    if (position < 0) {
      this.showToast(`Page ${requested} is not available.`, true);
      this.renderControls();
      return;
    }
    void this.execute(() => this.loadPageAtPosition(position), "Loading page…");
  }

  prefetchNeighbors() {
    if (!this.book) return;
    for (const offset of [-2, -1, 1, 2]) {
      const index = this.visiblePageIndexes[this.pagePosition + offset];
      if (index === undefined) continue;
      this.imageCache.prefetch(this.book.images.pages.get(index));
    }
  }

  fitToViewport() {
    if (!this.imageDimensions || this.viewerScroll.hidden) return;
    this.fitMode = true;
    const scale = calculateFitScale(
      this.imageDimensions,
      { width: this.viewerScroll.clientWidth, height: this.viewerScroll.clientHeight },
      24,
    );
    this.setZoom(scale, true);
  }

  /** @param {number} value @param {boolean} preserveFitMode */
  setZoom(value, preserveFitMode) {
    if (!this.imageDimensions) return;
    const previousZoom = this.zoom;
    const previousWidth = this.imageDimensions.width * previousZoom;
    const previousHeight = this.imageDimensions.height * previousZoom;
    const centerX = previousWidth > 0 ? (this.viewerScroll.scrollLeft + this.viewerScroll.clientWidth / 2) / previousWidth : 0.5;
    const centerY = previousHeight > 0 ? (this.viewerScroll.scrollTop + this.viewerScroll.clientHeight / 2) / previousHeight : 0.5;

    this.zoom = clamp(value, 0.05, 5);
    if (!preserveFitMode) this.fitMode = false;
    this.applyStageScale();
    this.renderOverlay();
    this.renderControls();

    requestAnimationFrame(() => {
      if (!this.imageDimensions) return;
      this.viewerScroll.scrollLeft = centerX * this.imageDimensions.width * this.zoom - this.viewerScroll.clientWidth / 2;
      this.viewerScroll.scrollTop = centerY * this.imageDimensions.height * this.zoom - this.viewerScroll.clientHeight / 2;
    });
  }

  applyStageScale() {
    if (!this.imageDimensions) return;
    const width = Math.max(1, this.imageDimensions.width * this.zoom);
    const height = Math.max(1, this.imageDimensions.height * this.zoom);
    this.imageStage.style.width = `${width}px`;
    this.imageStage.style.height = `${height}px`;
    this.overlay.setAttribute("viewBox", `0 0 ${this.imageDimensions.width} ${this.imageDimensions.height}`);
  }

  renderOverlay() {
    const page = this.currentPage;
    const imageSize = this.imageDimensions;
    const book = this.book;
    this.overlay.replaceChildren();
    if (!page || !imageSize || !book) return;

    this.overlay.setAttribute("viewBox", `0 0 ${imageSize.width} ${imageSize.height}`);
    const fragment = document.createDocumentFragment();
    let renderedCount = 0;

    for (const kind of LAYER_ORDER) {
      if (!this.layers[kind]) continue;
      for (const annotation of annotationsForKind(page, kind)) {
        const box = scaleBoundingBox(annotation, { width: page.width, height: page.height }, imageSize);
        const group = document.createElementNS(SVG_NAMESPACE, "g");
        group.classList.add("annotation-group", `annotation-${kind}`);
        if (annotation.id === this.selectedAnnotationId) group.classList.add("is-selected");
        group.dataset.annotationId = annotation.id;
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", `${annotationLabel(annotation, book)}, id ${annotation.id}`);

        if (kind === "onomatopoeia" && "points" in annotation) {
          const scaleX = imageSize.width / page.width;
          const scaleY = imageSize.height / page.height;
          const polygon = document.createElementNS(SVG_NAMESPACE, "polygon");
          polygon.setAttribute(
            "points",
            annotation.points.map((p) => `${p.x * scaleX},${p.y * scaleY}`).join(" "),
          );
          polygon.setAttribute("vector-effect", "non-scaling-stroke");
          polygon.dataset.annotationId = annotation.id;
          const title = document.createElementNS(SVG_NAMESPACE, "title");
          title.textContent = annotationLabel(annotation, book);
          polygon.append(title);
          group.append(polygon);
        } else {
          const rectangle = document.createElementNS(SVG_NAMESPACE, "rect");
          rectangle.setAttribute("x", String(box.xmin));
          rectangle.setAttribute("y", String(box.ymin));
          rectangle.setAttribute("width", String(Math.max(0, box.xmax - box.xmin)));
          rectangle.setAttribute("height", String(Math.max(0, box.ymax - box.ymin)));
          rectangle.setAttribute("vector-effect", "non-scaling-stroke");
          rectangle.dataset.annotationId = annotation.id;
          const title = document.createElementNS(SVG_NAMESPACE, "title");
          title.textContent = annotationLabel(annotation, book);
          rectangle.append(title);
          group.append(rectangle);
        }

        if (this.showLabels) group.append(this.createSvgLabel(annotationLabel(annotation, book), box.xmin, box.ymin));
        fragment.append(group);
        renderedCount += 1;
      }
    }

    this.overlay.append(fragment);
    this.overlay.dataset.renderedCount = String(renderedCount);
  }

  /** @param {string} label @param {number} x @param {number} y */
  createSvgLabel(label, x, y) {
    const group = document.createElementNS(SVG_NAMESPACE, "g");
    group.classList.add("annotation-label");
    const fontSize = 12 / this.zoom;
    const horizontalPadding = 5 / this.zoom;
    const verticalPadding = 3 / this.zoom;
    const display = label.length > 46 ? `${label.slice(0, 45)}…` : label;
    const width = display.length * fontSize * 0.58 + horizontalPadding * 2;
    const height = fontSize + verticalPadding * 2;
    const labelY = Math.max(height, y);

    const background = document.createElementNS(SVG_NAMESPACE, "rect");
    background.setAttribute("x", String(Math.max(0, x)));
    background.setAttribute("y", String(labelY - height));
    background.setAttribute("width", String(width));
    background.setAttribute("height", String(height));
    background.setAttribute("rx", String(3 / this.zoom));

    const text = document.createElementNS(SVG_NAMESPACE, "text");
    text.setAttribute("x", String(Math.max(0, x) + horizontalPadding));
    text.setAttribute("y", String(labelY - verticalPadding));
    text.setAttribute("font-size", String(fontSize));
    text.textContent = display;
    group.append(background, text);
    return group;
  }

  renderControls() {
    const hasPage = Boolean(this.currentPage && this.imageDimensions);
    const hasPageSlot = Boolean(this.currentPage);
    const canNavigate = this.visiblePageIndexes.length > 0;
    this.previousButton.disabled = !canNavigate || this.pagePosition <= 0;
    this.nextButton.disabled = !canNavigate || this.pagePosition >= this.visiblePageIndexes.length - 1;
    this.pageNumberInput.disabled = !canNavigate;
    this.pageNumberInput.value = this.currentPage ? String(this.currentPage.index + 1) : "";
    if (canNavigate) {
      this.pageNumberInput.min = String(this.visiblePageIndexes[0] + 1);
      this.pageNumberInput.max = String(this.visiblePageIndexes[this.visiblePageIndexes.length - 1] + 1);
    }
    this.pagePositionLabel.textContent = canNavigate ? `${this.pagePosition + 1} / ${this.visiblePageIndexes.length}` : "0 / 0";
    this.zoomOutButton.disabled = !hasPage;
    this.zoomInButton.disabled = !hasPage;
    this.zoomValueButton.disabled = !hasPage;
    this.fitButton.disabled = !hasPage;
    this.zoomValueButton.textContent = `${Math.round(this.zoom * 100)}%`;
    this.viewerScroll.setAttribute("aria-busy", String(hasPageSlot && !hasPage));

    for (const kind of LAYER_ORDER) {
      const countElement = this.root.querySelector(`[data-layer-count="${kind}"]`);
      if (countElement) countElement.textContent = String(this.currentPage?.byKind[kind].length ?? 0);
    }
  }

  renderDatasetSummary() {
    const dataset = this.dataset;
    if (!dataset) {
      this.datasetSummary.innerHTML = "<p>Open the Manga109 root folder to begin.</p>";
      return;
    }
    const kind =
      dataset.kind === "file-system-access"
        ? "Lazy directory handle"
        : dataset.kind === "directory-input"
          ? "Compatibility folder input"
          : "Bundled synthetic fixture";
    const onomatopoeiaLabel = dataset.selectedOnomatopoeiaSet || "None";
    this.datasetSummary.innerHTML = `
      <dl class="summary-list">
        <div><dt>Root</dt><dd title="${escapeHtml(dataset.rootName)}">${escapeHtml(dataset.rootName)}</dd></div>
        <div><dt>Access</dt><dd>${kind}</dd></div>
        <div><dt>Annotation set</dt><dd>${escapeHtml(dataset.selectedAnnotationSet)}</dd></div>
        <div><dt>Onomatopoeia</dt><dd>${escapeHtml(onomatopoeiaLabel)}</dd></div>
        <div><dt>Books</dt><dd>${dataset.listBooks().length}</dd></div>
      </dl>`;
  }

  renderPageInspector() {
    const page = this.currentPage;
    const asset = this.currentAsset;
    const image = this.imageDimensions;
    const book = this.book;
    if (!page || !asset || !book) {
      this.pageInspector.className = "empty-inspector";
      this.pageInspector.textContent = "No page loaded.";
      return;
    }
    const scaleX = image ? image.width / page.width : null;
    const scaleY = image ? image.height / page.height : null;
    this.pageInspector.className = "";
    this.pageInspector.innerHTML = `
      <dl class="inspector-list">
        <div><dt>Book</dt><dd title="${escapeHtml(book.name)}">${escapeHtml(book.name)}</dd></div>
        <div><dt>XML page</dt><dd>${page.index + 1} <span class="muted-inline">(${padPageIndex(page.index)})</span></dd></div>
        <div><dt>Image file</dt><dd title="${escapeHtml(asset.relativePath)}">${escapeHtml(asset.relativePath)}</dd></div>
        <div><dt>XML size</dt><dd>${page.width} × ${page.height}</dd></div>
        <div><dt>Decoded size</dt><dd>${image ? `${image.width} × ${image.height}` : "Loading…"}</dd></div>
        <div><dt>Coordinate scale</dt><dd>${scaleX === null || scaleY === null ? "—" : `${scaleX.toFixed(4)} × ${scaleY.toFixed(4)}`}</dd></div>
        <div><dt>Mapping</dt><dd><span class="status-badge">${book.images.mode}</span></dd></div>
        <div><dt>Objects</dt><dd>${page.annotations.length}</dd></div>
      </dl>
      ${
        image && (image.width !== page.width || image.height !== page.height)
          ? `<div class="inline-notice">${ICONS.info}<span>Boxes are independently scaled on X and Y from the XML coordinate space to the decoded image.</span></div>`
          : ""
      }`;
  }

  renderSelectionInspector() {
    const page = this.currentPage;
    const image = this.imageDimensions;
    const book = this.book;
    const annotation = page?.annotations.find((item) => item.id === this.selectedAnnotationId) ?? null;
    if (!annotation || !page || !image || !book) {
      this.selectionInspector.className = "empty-inspector";
      this.selectionInspector.textContent = "Select an annotation box.";
      return;
    }
    const scaled = scaleBoundingBox(annotation, { width: page.width, height: page.height }, image);
    const extra =
      annotation.kind === "face" || annotation.kind === "body"
        ? `<div><dt>Character</dt><dd>${escapeHtml(book.charactersById.get(annotation.characterId)?.name ?? "Unknown")} <span class="muted-inline">${escapeHtml(annotation.characterId)}</span></dd></div>`
        : annotation.kind === "text"
          ? `<div class="inspector-text"><dt>Text</dt><dd>${escapeHtml(annotation.text)}</dd></div>`
          : annotation.kind === "onomatopoeia"
            ? `<div><dt>Vertices</dt><dd>${annotation.points.length}</dd></div><div class="inspector-text"><dt>Text</dt><dd>${escapeHtml(annotation.text)}</dd></div>`
            : "";
    this.selectionInspector.className = "";
    this.selectionInspector.innerHTML = `
      <div class="selection-title"><span class="layer-swatch layer-${annotation.kind}"></span><strong>${LAYER_SINGULAR[annotation.kind]}</strong></div>
      <dl class="inspector-list">
        <div><dt>ID</dt><dd><code>${escapeHtml(annotation.id)}</code></dd></div>
        ${extra}
        <div><dt>XML box</dt><dd>${annotation.xmin}, ${annotation.ymin} → ${annotation.xmax}, ${annotation.ymax}</dd></div>
        <div><dt>Image box</dt><dd>${scaled.xmin.toFixed(1)}, ${scaled.ymin.toFixed(1)} → ${scaled.xmax.toFixed(1)}, ${scaled.ymax.toFixed(1)}</dd></div>
        <div><dt>Source order</dt><dd>${annotation.sourceOrder}</dd></div>
      </dl>`;
  }

  renderDiagnostics() {
    const warnings = [
      ...(this.dataset?.discoveryWarnings ?? []),
      ...(this.book?.annotation.warnings ?? []),
      ...(this.book?.images.warnings ?? []),
    ];
    if (
      this.currentPage &&
      this.imageDimensions &&
      (this.currentPage.width !== this.imageDimensions.width || this.currentPage.height !== this.imageDimensions.height)
    ) {
      warnings.push(
        `Page ${this.currentPage.index + 1}: XML size ${this.currentPage.width}×${this.currentPage.height} differs from decoded image ${this.imageDimensions.width}×${this.imageDimensions.height}; independent coordinate scaling is active.`,
      );
    }
    const unique = [...new Set(warnings)];
    this.diagnosticCount.textContent = String(unique.length);
    this.sidebarDiagnostics.textContent = unique.length ? `${unique.length} diagnostic${unique.length === 1 ? "" : "s"}` : "No diagnostics";
    this.sidebarDiagnostics.classList.toggle("has-warnings", unique.length > 0);
    if (!unique.length) {
      this.diagnostics.innerHTML = `<div class="diagnostic-ok">No issues detected.</div>`;
      return;
    }
    this.diagnostics.innerHTML = unique
      .slice(0, 200)
      .map(
        (warning) => `<div class="diagnostic-item">${ICONS.warning}<p>${escapeHtml(warning)}</p></div>`,
      )
      .join("");
  }

  /** @param {HTMLSelectElement} select @param {readonly string[]} values @param {string} selected */
  populateSelect(select, values, selected) {
    select.replaceChildren();
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value || "None";
      select.append(option);
    }
    select.value = selected;
  }

  /** @param {KeyboardEvent} event */
  handleKeyboard(event) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      void this.movePage(-1);
    } else if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      void this.movePage(1);
    } else if (event.key === "Home" && this.visiblePageIndexes.length) {
      event.preventDefault();
      void this.execute(() => this.loadPageAtPosition(0), "Loading page…");
    } else if (event.key === "End" && this.visiblePageIndexes.length) {
      event.preventDefault();
      void this.execute(() => this.loadPageAtPosition(this.visiblePageIndexes.length - 1), "Loading page…");
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.setZoom(this.zoom * 1.2, false);
    } else if (event.key === "-") {
      event.preventDefault();
      this.setZoom(this.zoom / 1.2, false);
    } else if (event.key === "0") {
      event.preventDefault();
      this.fitToViewport();
    } else if (event.key === "1") {
      event.preventDefault();
      this.setZoom(1, false);
    }
  }

  /** @param {string} message @param {boolean} isError */
  showToast(message, isError) {
    window.clearTimeout(this.toastTimer);
    this.toast.hidden = false;
    this.toast.className = `toast${isError ? " toast-error" : ""}`;
    this.toast.textContent = message;
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, 5000);
  }

  initTheme() {
    const stored = window.localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = /** @type {"light" | "dark"} */ (stored ?? (prefersDark ? "dark" : "light"));
    this.applyTheme(theme);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
      if (!window.localStorage.getItem("theme")) this.applyTheme(event.matches ? "dark" : "light");
    });
  }

  toggleTheme() {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    window.localStorage.setItem("theme", next);
    this.applyTheme(next);
  }

  /** @param {"light" | "dark"} theme */
  applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta instanceof HTMLMetaElement) colorSchemeMeta.content = theme;
    const themeColorMeta = document.getElementById("theme-color-meta");
    if (themeColorMeta instanceof HTMLMetaElement) themeColorMeta.content = theme === "dark" ? "#09090b" : "#ffffff";
    if (this.themeIcon) this.themeIcon.innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
  }

  registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch((error) => {
        console.warn("Service worker registration failed", error);
      });
    });
  }
}

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Application root is missing.");
const application = new Manga109App(root);
void application.init();
