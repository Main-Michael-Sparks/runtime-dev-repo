import { Worker } from "worker_threads";

let worker = null;
let messageHandler = null;
let workerGeneration = 0;

const boundMessageHandlers = new WeakMap();

function createWorkerInstance() {
  return new Worker(new URL("./llama_worker/llama.mjs", import.meta.url));
}

function bindMessageHandler(targetWorker) {
  if (!targetWorker || !messageHandler) return;
  if (boundMessageHandlers.has(targetWorker)) return;

  const boundGeneration = workerGeneration;
  const guardedHandler = (message) => {
    if (targetWorker !== worker || boundGeneration !== workerGeneration) return;
    messageHandler(message);
  };

  boundMessageHandlers.set(targetWorker, guardedHandler);
  targetWorker.on("message", guardedHandler);
}

function unbindMessageHandler(targetWorker) {
  if (!targetWorker || !messageHandler) return;

  const guardedHandler = boundMessageHandlers.get(targetWorker);
  if (!guardedHandler) return;

  targetWorker.off("message", guardedHandler);
  boundMessageHandlers.delete(targetWorker);
}

export function initWorkerBridge() {
  if (worker) return worker;

  worker = createWorkerInstance();
  workerGeneration++;
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

export function sendToWorker(message, transferList = []) {
  if (!worker) {
    initWorkerBridge();
  }

  worker.postMessage(message, transferList);
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
  workerGeneration++;

  await currentWorker.terminate();
}

export function recreateWorker() {
  if (worker) {
    throw new Error(
      "Cannot recreate worker while an active worker still exists",
    );
  }

  worker = createWorkerInstance();
  workerGeneration++;
  bindMessageHandler(worker);
  return worker;
}
