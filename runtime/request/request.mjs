import { ReadableStream } from "stream/web";
import { MessageChannel } from "worker_threads";

let nextRequestId = 0;

export function createRequest(text, options = {}) {
  const requestId = nextRequestId++;

  let controller = null;
  const streamEnabled = options.stream ?? true;

  const { port1: parentCancelPort, port2: workerCancelPort } = new MessageChannel();
  parentCancelPort.unref?.();
  workerCancelPort.unref?.();

  function closeCancelChannel() {
    try {
      parentCancelPort.close();
    } catch {
      // no-op: already closed/transferred
    }

    try {
      workerCancelPort.close();
    } catch {
      // no-op: already closed/transferred
    }
  }

  const readable = streamEnabled
    ? new ReadableStream({
        start(c) {
          controller = c;
        },
      })
    : null;

  let resolveDone;
  let rejectDone;

  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  // Prevent early rejections from surfacing as unhandled promise rejections
  // before the caller attaches its own await/try-catch. This does not change
  // the external behavior of `await req.done`.
  done.catch(() => {});

  return {
    id: requestId,
    text,
    sessionId: options.sessionId || "default",

    streamEnabled,
    stream: readable,
    controller,
    parentCancelPort,
    workerCancelPort,
    closeCancelChannel,

    done,
    resolveDone,
    rejectDone,

    finalText: "",
    status: "queued",

    timeline: {
      queuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    },
  };
}
