function createReadyBarrier() {
    let resolveReady;
    let rejectReady;

    const readyPromise = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });

    return {
        readyPromise,
        resolveReady,
        rejectReady
    };
}

export function createRuntimeLifecycleState() {
    const state = {
        initStarted: false,
        initResolved: false,
        initInProgress: false,
        initCyclePromise: null,
        readyPromise: null,
        resolveReady: null,
        rejectReady: null,

        activeInitAttemptId: null,
        activeInitPlan: null,
        lastSuccessfulInitPlan: null,
        lastSuccessfulEffectiveConfig: null,
        lastSuccessfulProbe: null,
        lastFailedExplicitInit: null,
        nextInitAttemptId: 0,

        sessionsResetting: new Set(),
        sessionResetWaiters: new Map(),
        runtimeResetting: false,
        runtimeShuttingDown: false,
        runtimeUnhealthy: null,
        modelResetWaiter: null,
        shutdownWaiter: null,

        resetReadyBarrier() {
            const barrier = createReadyBarrier();
            this.readyPromise = barrier.readyPromise;
            this.resolveReady = barrier.resolveReady;
            this.rejectReady = barrier.rejectReady;
        },

        resetInitBarrier() {
            this.initStarted = false;
            this.initResolved = false;
            this.activeInitAttemptId = null;
            this.resetReadyBarrier();
        },

        nextAttemptId() {
            this.nextInitAttemptId += 1;
            return this.nextInitAttemptId;
        }
    };

    state.resetReadyBarrier();

    return state;
}
