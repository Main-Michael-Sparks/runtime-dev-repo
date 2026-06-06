export function createOutboundMessages(parentPort) {
    function postReady({ initAttemptId, profileName }) {
        parentPort.postMessage({
            type: "ready",
            initAttemptId,
            profileName
        });
    }

    function postStream({ id, token }) {
        parentPort.postMessage({
            type: "stream",
            id,
            token
        });
    }

    function postDone({ id, res }) {
        parentPort.postMessage({
            type: "done",
            id,
            res
        });
    }

    function postResetDone({ sessionId }) {
        parentPort.postMessage({
            type: "reset_done",
            sessionId
        });
    }

    function postModelResetDone() {
        parentPort.postMessage({ type: "model_reset_done" });
    }

    function postShutdownDone() {
        parentPort.postMessage({ type: "shutdown_done" });
    }

    function postWorkerError({ id, initErrorMeta = {}, err, sessionId = null }) {
        parentPort.postMessage({
            type: "error",
            id,
            ...initErrorMeta,
            error: {
                message: err.message,
                stack: err.stack,
                phase: "worker",
                sessionId
            }
        });
    }

    return {
        postReady,
        postStream,
        postDone,
        postResetDone,
        postModelResetDone,
        postShutdownDone,
        postWorkerError
    };
}
