export function createScheduler({ maxInFlight, sendToWorker, onDispatch }) {
  let ready = false;
  let inFlight = 0;

  const queue = [];
  const pending = new Map();

  function drain() {
    queueMicrotask(() => {
      while (ready && inFlight < maxInFlight && queue.length > 0) {
        const req = queue.shift();

        if (!req || req.status === "canceled") continue;

        req.status = "running";
        req.timeline.startedAt = Date.now();

        pending.set(req.id, req);
        inFlight++;

        onDispatch?.(req);

        sendToWorker({
          type: "prompt",
          id: req.id,
          text: req.text,
          sessionId: req.sessionId,
          stream: req.streamEnabled,
        });
      }
    });
  }

  function setReady(value = true) {
    ready = value;
    if (ready) drain();
  }

  function enqueue(req) {
    queue.push(req);
    drain();
  }

  function queuedCount() {
    return queue.length;
  }

  function getRequest(id) {
    const pendingReq = pending.get(id);
    if (pendingReq) return pendingReq;
    return queue.find((req) => req.id === id) ?? null;
  }

  function complete(id) {
    const req = pending.get(id);
    if (!req) return null;

    pending.delete(id);
    inFlight = Math.max(0, inFlight - 1);

    req.status = "done";
    req.timeline.finishedAt = Date.now();

    drain();
    return req;
  }

  function fail(id) {
    const req = pending.get(id);
    if (!req) return null;

    pending.delete(id);
    inFlight = Math.max(0, inFlight - 1);

    req.status = "error";
    req.timeline.finishedAt = Date.now();

    drain();
    return req;
  }

  function cancel(id) {
    const queuedIndex = queue.findIndex((req) => req.id === id);
    if (queuedIndex >= 0) {
      const [req] = queue.splice(queuedIndex, 1);
      req.status = "canceled";
      req.timeline.finishedAt = Date.now();
      return req;
    }

    const req = pending.get(id);
    if (req) {
      pending.delete(id);
      inFlight = Math.max(0, inFlight - 1);
      req.status = "canceled";
      req.timeline.finishedAt = Date.now();
      drain();
      return req;
    }

    return null;
  }

  function cancelAll() {
    const all = [...queue, ...pending.values()];

    queue.length = 0;
    pending.clear();
    inFlight = 0;

    for (const req of all) {
      req.status = "canceled";
      req.timeline.finishedAt = Date.now();
    }

    return all;
  }

  function cancelBySession(sessionId) {
    const canceled = [];

    for (let i = queue.length - 1; i >= 0; i--) {
      const req = queue[i];
      if (req.sessionId !== sessionId) continue;

      queue.splice(i, 1);
      req.status = "canceled";
      req.timeline.finishedAt = Date.now();
      canceled.push(req);
    }

    for (const [id, req] of pending.entries()) {
      if (req.sessionId !== sessionId) continue;

      pending.delete(id);
      inFlight = Math.max(0, inFlight - 1);
      req.status = "canceled";
      req.timeline.finishedAt = Date.now();
      canceled.push(req);
    }

    drain();
    return canceled;
  }

  function snapshot() {
    return {
      ready,
      inFlight,
      queued: queue.length,
      pending: pending.size,
    };
  }

  return {
    setReady,
    enqueue,
    queuedCount,
    getRequest,
    complete,
    fail,
    cancel,
    cancelAll,
    cancelBySession,
    snapshot,
    isReady: () => ready,
  };
}
