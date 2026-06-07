export function createRequestBoundaries({ requests }) {
    async function waitForActiveRequestBoundaries(records) {
        const pending = records
            .map((record) => record?.promise)
            .filter(Boolean);

        if (pending.length === 0) return [];

        return Promise.allSettled(pending);
    }

    async function waitForPriorSessionRequestBoundaries(sessionId, currentRequestId) {
        const current = requests.getActiveRequest(currentRequestId);
        if (!current) return;

        const priorRecords = requests.getActiveRequestRecords((record) => (
            record.sessionId === sessionId &&
            record.id !== currentRequestId &&
            record.sequence < current.sequence
        ));

        await waitForActiveRequestBoundaries(priorRecords);
    }

    function hasActiveRequestForSession(sessionId) {
        return requests.getActiveRequestRecords((record) => record.sessionId === sessionId).length > 0;
    }

    return {
        waitForActiveRequestBoundaries,
        waitForPriorSessionRequestBoundaries,
        hasActiveRequestForSession
    };
}
