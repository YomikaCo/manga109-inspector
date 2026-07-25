// @ts-check

import { mapImagesToPages } from "./mapping.js";
import { parseManga109Xml } from "./xml-parser.js";

/** @typedef {import('../types/manga109').Manga109Dataset} Manga109Dataset */
/** @typedef {import('../types/manga109').Manga109LoadedBook} Manga109LoadedBook */

/** @returns {Promise<Manga109Dataset>} */
export async function createFixtureDataset() {
  const base = new URL("../../fixtures/", import.meta.url);
  /** @type {Manga109LoadedBook | null} */
  let cached = null;
  const annotationSetNames = ["annotations"];

  return {
    kind: "fixture",
    rootName: "Synthetic fixture",
    annotationSetNames,
    selectedAnnotationSet: "annotations",
    onomatopoeiaSetNames: [""],
    selectedOnomatopoeiaSet: "",
    discoveryWarnings: ["This is generated test content; no Manga109 images are bundled with the client."],
    async setAnnotationSet(name, _onomatopoeiaSet) {
      if (name !== "annotations") throw new Error(`Unknown annotation set "${name}".`);
    },
    listBooks() {
      return ["DemoBook"];
    },
    async loadBook(name) {
      if (name !== "DemoBook") throw new Error(`Unknown fixture book "${name}".`);
      if (cached) return cached;
      const xml = await fetch(new URL("annotations/DemoBook.xml", base)).then((response) => {
        if (!response.ok) throw new Error("Could not load bundled fixture annotations.");
        return response.text();
      });
      const annotation = parseManga109Xml(xml, "fixtures/annotations/DemoBook.xml");
      const imageNames = ["000.png", "001.png", "002.png"];
      const assets = imageNames.map((filename, index) => ({
        key: `fixtures/DemoBook/${filename}`,
        name: filename,
        relativePath: filename,
        numericIndex: index,
        async getFile() {
          const response = await fetch(new URL(`images/DemoBook/${filename}`, base));
          if (!response.ok) throw new Error(`Could not load bundled fixture image ${filename}.`);
          const blob = await response.blob();
          return new File([blob], filename, { type: blob.type || "image/png" });
        },
      }));
      const images = mapImagesToPages(assets, annotation.pages);
      cached = {
        name,
        annotation,
        images,
        charactersById: new Map(annotation.characters.map((character) => [character.id, character])),
        pagesByIndex: new Map(annotation.pages.map((page) => [page.index, page])),
      };
      return cached;
    },
    clearCaches() {
      cached = null;
    },
  };
}
