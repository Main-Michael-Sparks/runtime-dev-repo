import { ReadableStream } from "stream/web";

let nextRequestId = 0;

export function createRequest(text, options = {}) {
  const requestId = nextRequestId++;

  let controller = null;
  const streamEnabled = options.stream ?? true;

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
