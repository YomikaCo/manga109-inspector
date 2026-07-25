import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDirectory = path.join(projectDirectory, "artifacts");
const sitePort = Number(process.env.TEST_PORT || 4173);
const baseUrl = `http://127.0.0.1:${sitePort}`;
const chromium = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

/** @returns {Promise<number>} */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a local port."));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** @param {string} url @param {number} [attempts] */
async function waitForHttp(url, attempts = 100) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Endpoint did not become ready: ${url}. ${String(lastError ?? "")}`);
}

class CdpClient {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void}>} */
    this.pending = new Map();
    /** @type {Map<string, Set<(params: any) => void>>} */
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
        else pending.resolve(message.result);
        return;
      }
      if (typeof message.method === "string") {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      }
    });
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("Chrome DevTools connection closed."));
      this.pending.clear();
    });
  }

  /** @param {string} url */
  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Could not connect to Chrome DevTools at ${url}`)), {
        once: true,
      });
    });
  }

  /** @param {string} method @param {Record<string, unknown>} [params] */
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** @param {string} method @param {(params: any) => void} listener */
  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  /** @param {string} method @param {number} [timeoutMs] */
  waitFor(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.get(method)?.delete(listener);
        reject(new Error(`Timed out waiting for CDP event ${method}.`));
      }, timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        this.listeners.get(method)?.delete(listener);
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  close() {
    this.socket.close();
  }
}

/**
 * @param {CdpClient} client
 * @param {string} expression
 * @param {(value: any) => boolean} predicate
 * @param {number} [timeoutMs]
 */
async function waitForValue(client, expression, predicate, timeoutMs = 12000) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    const evaluation = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluation.exceptionDetails) {
      throw new Error(`Browser evaluation failed: ${evaluation.exceptionDetails.text ?? "unknown exception"}`);
    }
    lastValue = evaluation.result?.value;
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out waiting for browser state. Last value: ${JSON.stringify(lastValue)}`);
}

/** @param {CdpClient} client @param {string} expression */
async function evaluate(client, expression) {
  const evaluation = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(`Browser evaluation failed: ${evaluation.exceptionDetails.text ?? "unknown exception"}`);
  }
  return evaluation.result?.value;
}

/**
 * @param {string} debugBase
 * @param {string} url
 * @param {number} width
 * @param {number} height
 */
async function openPage(debugBase, url, width, height) {
  const targetResponse = await fetch(`${debugBase}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!targetResponse.ok) throw new Error(`Could not create Chrome target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  /** @type {string[]} */
  const browserErrors = [];
  client.on("Runtime.exceptionThrown", (params) => {
    browserErrors.push(params?.exceptionDetails?.text ?? "Uncaught browser exception");
  });
  client.on("Log.entryAdded", (params) => {
    if (params?.entry?.level === "error") browserErrors.push(params.entry.text);
  });
  await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Log.enable")]);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const navigation = await client.send("Page.navigate", { url });
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await waitForValue(
    client,
    `({ href: location.href, ready: document.readyState })`,
    (value) => value?.href === url && value?.ready === "complete",
  );
  return { client, target, browserErrors };
}

/** @param {import('node:child_process').ChildProcess} child */
async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

await mkdir(artifactsDirectory, { recursive: true });
const chromePort = await findFreePort();
const chromeProfile = await mkdtemp(path.join(os.tmpdir(), "manga109-chrome-"));
const debugBase = `http://127.0.0.1:${chromePort}`;

const server = spawn(process.execPath, ["scripts/serve.mjs", String(sitePort)], {
  cwd: projectDirectory,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

const browser = spawn(
  chromium,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-component-update",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${chromeProfile}`,
    `--remote-debugging-port=${chromePort}`,
    "about:blank",
  ],
  { cwd: projectDirectory, stdio: ["ignore", "ignore", "pipe"] },
);
let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => (browserStderr += chunk));

try {
  await Promise.all([waitForHttp(`${baseUrl}/index.html`), waitForHttp(`${debugBase}/json/version`)]);

  const unitPage = await openPage(debugBase, `${baseUrl}/src/tests/browser-tests.html`, 1000, 800);
  const unitStatus = await waitForValue(
    unitPage.client,
    "document.body.dataset.status",
    (value) => value === "pass" || value === "fail",
  );
  const unitOutput = await evaluate(unitPage.client, "document.querySelector('#result')?.textContent ?? ''");
  if (unitStatus !== "pass") {
    throw new Error(`Browser unit tests failed.\n${unitOutput}\n${unitPage.browserErrors.join("\n")}`);
  }
  if (unitPage.browserErrors.length) {
    throw new Error(`Browser unit tests emitted errors.\n${unitPage.browserErrors.join("\n")}`);
  }
  console.log("PASS browser parser, geometry, mapping, cache, and lazy asset tests");
  unitPage.client.close();

  const appPage = await openPage(debugBase, `${baseUrl}/index.html?test`, 1440, 900);
  await waitForValue(appPage.client, "document.documentElement.dataset.ready", (value) => value === "true");
  const initialState = await evaluate(
    appPage.client,
    `({
      page: document.body.dataset.page,
      annotations: document.body.dataset.annotationCount,
      rendered: document.querySelector('#annotation-overlay')?.dataset.renderedCount,
      naturalWidth: document.querySelector('#page-image')?.naturalWidth,
      naturalHeight: document.querySelector('#page-image')?.naturalHeight,
      title: document.querySelector('#book-select')?.value
    })`,
  );
  if (
    initialState.page !== "0" ||
    initialState.annotations !== "13" ||
    initialState.rendered !== "13" ||
    initialState.naturalWidth !== 1654 ||
    initialState.naturalHeight !== 1170 ||
    initialState.title !== "DemoBook"
  ) {
    throw new Error(`Demo SPA initial state is incorrect: ${JSON.stringify(initialState)}`);
  }

  await evaluate(appPage.client, `document.querySelector('[data-layer="frame"]')?.click()`);
  const hiddenFrameCount = await evaluate(
    appPage.client,
    "document.querySelector('#annotation-overlay')?.dataset.renderedCount",
  );
  if (hiddenFrameCount !== "10") throw new Error(`Layer toggle rendered ${hiddenFrameCount} objects instead of 10.`);
  await evaluate(appPage.client, `document.querySelector('[data-layer="frame"]')?.click()`);

  const screenshot = await appPage.client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  const screenshotPath = path.join(artifactsDirectory, "fixture-viewer.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log("PASS fixture SPA loads page 0 and renders all 13 SVG annotations");

  await evaluate(
    appPage.client,
    `(() => {
      const input = document.querySelector('#page-number');
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing page input');
      input.value = '3';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
  await waitForValue(appPage.client, "document.body.dataset.page", (value) => value === "2");
  const scaledState = await evaluate(
    appPage.client,
    `(() => {
      const rect = document.querySelector('.annotation-frame > rect');
      const image = document.querySelector('#page-image');
      return {
        page: document.body.dataset.page,
        rendered: document.querySelector('#annotation-overlay')?.dataset.renderedCount,
        naturalWidth: image?.naturalWidth,
        naturalHeight: image?.naturalHeight,
        x: Number(rect?.getAttribute('x')),
        y: Number(rect?.getAttribute('y')),
        width: Number(rect?.getAttribute('width')),
        height: Number(rect?.getAttribute('height'))
      };
    })()`,
  );
  const closeTo = (actual, expected) => Math.abs(actual - expected) < 0.0001;
  if (
    scaledState.page !== "2" ||
    scaledState.rendered !== "8" ||
    scaledState.naturalWidth !== 827 ||
    scaledState.naturalHeight !== 585 ||
    !closeTo(scaledState.x, 22.5) ||
    !closeTo(scaledState.y, 27.5) ||
    !closeTo(scaledState.width, 372.5) ||
    !closeTo(scaledState.height, 527.5)
  ) {
    throw new Error(`Dimension-scaled overlay is incorrect: ${JSON.stringify(scaledState)}`);
  }
  if (appPage.browserErrors.length) {
    throw new Error(`Fixture SPA emitted browser errors.\n${appPage.browserErrors.join("\n")}`);
  }
  console.log("PASS half-size image receives exact 0.5× SVG coordinate scaling");
  console.log(`PASS screenshot written to ${screenshotPath}`);
  appPage.client.close();
} catch (error) {
  if (browserStderr) console.error(browserStderr);
  throw error;
} finally {
  await Promise.all([stopProcess(server), stopProcess(browser)]);
  await rm(chromeProfile, { recursive: true, force: true });
}
