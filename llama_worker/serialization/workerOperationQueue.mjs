export function createWorkerOperationQueue(state) {
    function enqueueWorkerOperation(label, fn) {
        const run = state.workerOperationChain.then(fn, fn);
        state.workerOperationChain = run.catch(() => {});
        return run;
    }

    return {
        enqueueWorkerOperation
    };
}
