// @ts-check

import { LruCache } from "./lru-cache.js";

/** @typedef {import('../types/manga109').Manga109ImageAsset} Manga109ImageAsset */

export class ImageUrlCache {
  /** @param {number} [maxEntries] */
  constructor(maxEntries = 7) {
    /** @type {LruCache<string, {promise: Promise<string>}>} */
    this.cache = new LruCache(maxEntries, (entry) => {
      entry.promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    });
  }

  /** @param {Manga109ImageAsset} asset */
  get(asset) {
    const existing = this.cache.get(asset.key);
    if (existing) return existing.promise;
    const promise = asset.getFile().then((file) => URL.createObjectURL(file));
    this.cache.set(asset.key, { promise });
    void promise.catch(() => {
      this.cache.delete(asset.key);
    });
    return promise;
  }

  /** @param {Manga109ImageAsset | null | undefined} asset */
  prefetch(asset) {
    if (!asset) return;
    void this.get(asset)
      .then((url) => {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        return image.decode();
      })
      .catch(() => {});
  }

  clear() {
    this.cache.clear();
  }
}
