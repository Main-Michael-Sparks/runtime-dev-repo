const streamBuffers = new Map();

function safeClose(controller) {
  if (!controller) return;

  try {
    controller.close();
  } catch {
    // no-op: already closed/errored
  }
}

function safeError(controller, err) {
  if (!controller) return;

  try {
    controller.error(err);
  } catch {
    // no-op: already closed/errored
  }
}

function shouldFlushOnBoundary(text, config) {
  if (!config.runtime.flushOnBoundary) return false;
  if (text.length < config.runtime.minBoundaryFlushChars) return false;

  return /[\s.,!?;:\n]$/.test(text);
}

export function pushStream(req, token, config) {
  if (!req.streamEnabled || !req.controller) return;

  if (!config.runtime.enableMicroBatching) {
    req.controller.enqueue(token);
    return;
  }

  let buf = streamBuffers.get(req.id);

  if (!buf) {
    buf = {
      data: [],
      timer: null,
    };
    streamBuffers.set(req.id, buf);
  }

  buf.data.push(token);

  const joined = buf.data.join("");

  if (
    joined.length >= config.runtime.maxBufferedChars ||
    shouldFlushOnBoundary(joined, config)
  ) {
    if (buf.timer) {
      clearTimeout(buf.timer);
    }

    streamBuffers.delete(req.id);
    req.controller.enqueue(joined);
    return;
  }

  if (!buf.timer) {
    buf.timer = setTimeout(() => {
      const out = buf.data.join("");
      streamBuffers.delete(req.id);
      req.controller.enqueue(out);
    }, config.runtime.microBatchMs);
  }
}

export function flushStream(req) {
  const buf = streamBuffers.get(req.id);
  if (!buf) return;

  clearTimeout(buf.timer);

  if (req.streamEnabled && req.controller && buf.data.length > 0) {
    req.controller.enqueue(buf.data.join(""));
  }

  streamBuffers.delete(req.id);
}

export function closeStream(req) {
  flushStream(req);
  safeClose(req.controller);
}

export function errorStream(req, err) {
  const buf = streamBuffers.get(req.id);
  if (buf?.timer) {
    clearTimeout(buf.timer);
  }

  streamBuffers.delete(req.id);
  safeError(req.controller, err);
}

export function cancelStream(req) {
  const buf = streamBuffers.get(req.id);
  if (buf?.timer) {
    clearTimeout(buf.timer);
  }

  streamBuffers.delete(req.id);
  safeClose(req.controller);
}
