export function resolvePromptResult(req, msg) {
    return req.streamEnabled
        ? (req.finalText !== "" ? req.finalText : (msg.res ?? req.finalText))
        : (msg.res ?? req.finalText);
}

export function closeRequestCancelChannel(req) {
    req?.closeCancelChannel?.();
}

export function settleCompletedRequest(req, msg, {
    closeStream,
    traceDone,
    traceDelete
}) {
    const resultText = resolvePromptResult(req, msg);

    closeStream(req);
    closeRequestCancelChannel(req);
    traceDone(req);
    req.resolveDone(resultText);
    traceDelete(req.id);
}

export function settleFailedRequest(req, err, {
    errorStream,
    traceError,
    traceDelete
}) {
    closeRequestCancelChannel(req);
    traceError(req, err);
    errorStream(req, err);
    req.rejectDone(err);
    traceDelete(req.id);
}
