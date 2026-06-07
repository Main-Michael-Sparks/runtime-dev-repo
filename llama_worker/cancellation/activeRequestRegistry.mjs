export function createActiveRequestRegistry({
    state,
    receiveMessageOnPort,
    createPromptAbortError
}) {
    function createActiveRequestRecord({ id, sessionId, cancelPort }) {
        cancelPort?.unref?.();

        return {
            id,
            sessionId,
            sequence: ++state.nextActiveRequestSequence,
            controller: new AbortController(),
            contextController: null,
            cancelPort: cancelPort ?? null,
            state: "running",
            abortReason: null,
            error: null,
            promise: null
        };
    }

    function getActiveRequest(id) {
        return state.activeRequests.get(id) ?? null;
    }

    function isActiveRequestAborting(record) {
        return record?.state === "aborting" ||
            record?.controller?.signal?.aborted === true ||
            record?.contextController?.signal?.aborted === true;
    }

    function readCancelPortMessage(record) {
        if (!record?.cancelPort) return null;

        let latestCancel = null;

        while (true) {
            const packet = receiveMessageOnPort(record.cancelPort);
            if (!packet) break;

            if (packet.message?.type === "cancel") {
                latestCancel = packet.message;
            }
        }

        return latestCancel;
    }

    function synchronizeExternalCancellation(record, message = "Prompt canceled") {
        const packet = readCancelPortMessage(record);
        if (!packet) return false;

        return abortActiveRequest(record, record.abortReason ?? createPromptAbortError(packet.reason ?? message, {
            requestId: record.id,
            sessionId: record.sessionId
        }));
    }

    function isPromptAbortError(record, err) {
        if (!record) return false;
        if (err === record.abortReason) return true;
        if (err?.isPromptAbort === true) return true;
        if (err?.name === "AbortError" && isActiveRequestAborting(record)) return true;

        return false;
    }

    function buildRequestObsoleteError(requestId) {
        if (requestId === null || requestId === undefined) return null;

        const record = getActiveRequest(requestId);

        if (!record) {
            return createPromptAbortError("Prompt canceled", { requestId });
        }

        synchronizeExternalCancellation(record);

        if (isActiveRequestAborting(record)) {
            return record.abortReason ?? createPromptAbortError("Prompt canceled", {
                requestId,
                sessionId: record.sessionId
            });
        }

        return null;
    }

    function isRequestObsolete(requestId) {
        return buildRequestObsoleteError(requestId) !== null;
    }

    function abortActiveRequest(record, reason) {
        if (!record || record.state === "done") return false;

        if (!record.abortReason) {
            record.abortReason = reason ?? createPromptAbortError("Prompt canceled", {
                requestId: record.id,
                sessionId: record.sessionId
            });
        }

        record.state = "aborting";

        if (!record.controller.signal.aborted) {
            record.controller.abort(record.abortReason);
        }

        if (record.contextController && !record.contextController.signal.aborted) {
            record.contextController.abort(record.abortReason);
        }

        return true;
    }

    function abortActiveRequestById(id, reason) {
        const record = getActiveRequest(id);
        if (!record) return false;

        return abortActiveRequest(record, reason ?? createPromptAbortError("Prompt canceled", {
            requestId: id,
            sessionId: record.sessionId
        }));
    }

    function getActiveRequestRecords(filterFn = null) {
        const records = [];

        for (const record of state.activeRequests.values()) {
            if (record.state === "done") continue;
            if (filterFn && !filterFn(record)) continue;

            records.push(record);
        }

        return records;
    }

    function abortActiveRequests(filterFn, reasonFactory) {
        const records = getActiveRequestRecords(filterFn);

        for (const record of records) {
            const reason = typeof reasonFactory === "function"
                ? reasonFactory(record)
                : reasonFactory;

            abortActiveRequest(record, reason ?? createPromptAbortError("Prompt canceled", {
                requestId: record.id,
                sessionId: record.sessionId
            }));
        }

        return records;
    }

    return {
        createActiveRequestRecord,
        getActiveRequest,
        isActiveRequestAborting,
        readCancelPortMessage,
        synchronizeExternalCancellation,
        isPromptAbortError,
        buildRequestObsoleteError,
        isRequestObsolete,
        abortActiveRequest,
        abortActiveRequestById,
        getActiveRequestRecords,
        abortActiveRequests
    };
}
