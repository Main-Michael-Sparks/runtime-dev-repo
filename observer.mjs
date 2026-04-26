const trace = new Map();

export function traceQueued(req) {
  trace.set(req.id, {
    state: "queued",
    queuedAt: Date.now(),
    sessionId: req.sessionId,
  });
}

export function traceRunning(req) {
  const t = trace.get(req.id);
  if (!t) return;

  t.state = "running";
  t.startedAt = Date.now();
}

export function traceDone(req) {
  const t = trace.get(req.id);
  if (!t) return;

  t.state = "done";
  t.finishedAt = Date.now();
}

export function traceError(req, err) {
  const t = trace.get(req.id);
  if (!t) return;

  t.state = "error";
  t.finishedAt = Date.now();
  t.error = {
    message: err?.message ?? String(err),
  };
}

export function traceCanceled(req) {
  const t = trace.get(req.id);
  if (!t) return;

  t.state = "canceled";
  t.finishedAt = Date.now();
}

export function traceDelete(id) {
  trace.delete(id);
}

export function getTrace(id) {
  return trace.get(id);
}

export function getAllTraces() {
  return new Map(trace);
}
