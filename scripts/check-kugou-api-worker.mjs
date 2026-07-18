import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const workerPath = path.join(projectDir, "src", "electron", "kugouApiWorker.js");
const require = createRequire(import.meta.url);
const {
  API_HEALTH_PATH,
  API_HEALTH_TOKEN,
  waitForWorkerReady,
} = require("../src/electron/services.js");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function probe(url) {
  return fetch(url).then(async (response) => ({
    status: response.status,
    text: await response.text(),
  }));
}

async function waitForExit(worker) {
  const code = await new Promise((resolve) => worker.once("exit", resolve));
  assert.equal(code, 0);
}

const tempDir = await mkdtemp(path.join(tmpdir(), "kugou-worker-check-"));

try {
  const port = await findFreePort();
  const entry = path.join(tempDir, "fake-kugou-api.cjs");
  await writeFile(
    entry,
    `
const http = require("node:http");

exports.startService = async () => {
  await new Promise((resolve) => setTimeout(resolve, 80));
  const routes = new Map();
  const app = {
    get(route, handler) {
      routes.set(route, handler);
    },
  };
  app.service = http
    .createServer((req, res) => {
      const handler = routes.get(req.url);
      if (handler) {
        handler(req, {
          status(code) {
            res.statusCode = code;
            return this;
          },
          json(value) {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(value));
          },
        });
        return;
      }
      res.statusCode = 200;
      res.end("ok");
    })
    .listen(Number(process.env.PORT), process.env.HOST);
  return app;
};
`,
    "utf8",
  );

  const worker = new Worker(workerPath, {
    workerData: {
      entry,
      port,
      host: "127.0.0.1",
      platform: "lite",
      healthPath: API_HEALTH_PATH,
      healthToken: API_HEALTH_TOKEN,
    },
  });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await waitForWorkerReady(worker, 10);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "slow startup should warn without terminating the worker");
  const response = await probe(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.equal(response.text, "ok");
  const health = await probe(`http://127.0.0.1:${port}${API_HEALTH_PATH}`);
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.text), { service: API_HEALTH_TOKEN });

  worker.postMessage({ type: "stop" });
  await waitForExit(worker);
  console.log("kugou-api-worker check passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
