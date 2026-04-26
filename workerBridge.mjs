import { Worker } from "worker_threads";

let worker = null;
let messageHandler = null;

function createWorkerInstance() {
  return new Worker(new URL("./llama_worker/llama.mjs", import.meta.url));
}

function bindMessageHandler(targetWorker) {
  if (!targetWorker || !messageHandler) return;
  targetWorker.on("message", messageHandler);
}

function unbindMessageHandler(targetWorker) {
  if (!targetWorker || !messageHandler) return;
  targetWorker.off("message", messageHandler);
}

export function initWorkerBridge() {
  if (worker) return worker;

  worker = createWorkerInstance();
  bindMessageHandler(worker);
  return worker;
}

export function onWorkerMessage(handler) {
  if (messageHandler && worker) {
    unbindMessageHandler(worker);
  }

  messageHandler = handler;

  if (!worker) {
    initWorkerBridge();
    return;
  }

  bindMessageHandler(worker);
}

export function sendToWorker(message) {
  if (!worker) {
    initWorkerBridge();
  }

  worker.postMessage(message);
}

export function getWorker() {
  if (!worker) {
    initWorkerBridge();
  }

  return worker;
}

export async function terminateWorker() {
  if (!worker) return;

  const currentWorker = worker;
  unbindMessageHandler(currentWorker);
  worker = null;

  await currentWorker.terminate();
}

export function recreateWorker() {
  if (worker) {
    throw new Error(
      "Cannot recreate worker while an active worker still exists",
    );
  }

  worker = createWorkerInstance();
  bindMessageHandler(worker);
  return worker;
}
