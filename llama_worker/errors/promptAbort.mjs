export function createPromptAbortError(message, meta = {}) {
    const err = new Error(message);
    err.name = "PromptAbortError";
    err.isPromptAbort = true;

    for (const [key, value] of Object.entries(meta)) {
        err[key] = value;
    }

    return err;
}
