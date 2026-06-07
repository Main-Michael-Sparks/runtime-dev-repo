export const TERMINAL_SHUTDOWN_MODEL_DISPOSE_TIMEOUT_MS = 5000;

function isPositiveInteger(value) {
    return Number.isInteger(value) && value >= 1;
}

export function resolveModelDisposalPolicy({
    operation,
    terminalShutdownModelDisposeTimeoutMs = TERMINAL_SHUTDOWN_MODEL_DISPOSE_TIMEOUT_MS
} = {}) {
    if (operation === "shutdown") {
        if (!isPositiveInteger(terminalShutdownModelDisposeTimeoutMs)) {
            throw new Error("terminalShutdownModelDisposeTimeoutMs must be a positive integer");
        }

        return {
            operation,
            timeoutMs: terminalShutdownModelDisposeTimeoutMs,
            abandonOnTimeout: true
        };
    }

    return {
        operation: operation ?? "unknown",
        timeoutMs: null,
        abandonOnTimeout: false
    };
}

function createOutcome(overrides = {}) {
    return {
        attempted: false,
        completed: true,
        timedOut: false,
        abandoned: false,
        timeoutMs: null,
        reason: "model-already-disposed-or-missing",
        ...overrides
    };
}

function createTimeoutPromise(timeoutMs) {
    let timer;

    const promise = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve(createOutcome({
                attempted: true,
                completed: false,
                timedOut: true,
                abandoned: true,
                timeoutMs,
                reason: "terminal-shutdown-model-dispose-timeout"
            }));
        }, timeoutMs);
    });

    return {
        promise,
        clear() {
            clearTimeout(timer);
        }
    };
}

export async function disposeModelWithPolicy({ model, policy } = {}) {
    if (!model || model.disposed === true || typeof model.dispose !== "function") {
        return createOutcome();
    }

    const disposePromise = Promise.resolve().then(() => model.dispose());

    if (policy?.abandonOnTimeout !== true) {
        await disposePromise;
        return createOutcome({
            attempted: true,
            reason: "model-dispose-completed"
        });
    }

    const timeoutMs = policy.timeoutMs;
    if (!isPositiveInteger(timeoutMs)) {
        throw new Error("terminal model disposal timeout must be a positive integer");
    }

    const timeout = createTimeoutPromise(timeoutMs);

    try {
        const outcome = await Promise.race([
            disposePromise.then(() => createOutcome({
                attempted: true,
                reason: "model-dispose-completed"
            })),
            timeout.promise
        ]);

        if (outcome.timedOut) {
            disposePromise.catch(() => {});
        }

        return outcome;
    } finally {
        timeout.clear();
    }
}
