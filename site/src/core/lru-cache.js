// @ts-check

/** @template K,V */
export class LruCache {
  /**
   * @param {number} maxEntries
   * @param {(value: V, key: K) => void} [onEvict]
   */
  constructor(maxEntries, onEvict) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    this.maxEntries = maxEntries;
    this.onEvict = onEvict ?? (() => {});
    /** @type {Map<K,V>} */
    this.map = new Map();
  }

  /** @param {K} key */
  has(key) {
    return this.map.has(key);
  }

  /** @param {K} key */
  get(key) {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** @param {K} key @param {V} value */
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.entries().next().value;
      if (!oldest) break;
      const [oldestKey, oldestValue] = oldest;
      this.map.delete(oldestKey);
      this.onEvict(oldestValue, oldestKey);
    }
    return value;
  }

  /** @param {K} key */
  delete(key) {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.map.delete(key);
    this.onEvict(value, key);
    return true;
  }

  clear() {
    for (const [key, value] of this.map) this.onEvict(value, key);
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
