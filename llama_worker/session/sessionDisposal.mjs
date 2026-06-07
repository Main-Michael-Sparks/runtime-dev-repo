export async function disposeSessionEntry(entry) {
    if (!entry) return;

    const cleanupErrors = [];

    if (entry.session?.disposed !== true && typeof entry.session?.dispose === "function") {
        try {
            entry.session.dispose({
                disposeSequence: true
            });
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (entry.context?.disposed !== true && typeof entry.context?.dispose === "function") {
        try {
            await entry.context.dispose();
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (cleanupErrors.length > 0) {
        throw cleanupErrors[0];
    }
}

export async function disposeSessionById(sessions, sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry) return;

    await disposeSessionEntry(entry);
    sessions.delete(sessionId);
}

export async function disposeAllSessions(sessions) {
    const cleanupErrors = [];

    for (const [sessionId, entry] of sessions.entries()) {
        try {
            await disposeSessionEntry(entry);
        } catch (err) {
            cleanupErrors.push({ sessionId, err });
        }
    }

    sessions.clear();

    if (cleanupErrors.length > 0) {
        throw cleanupErrors[0].err;
    }
}

export async function disposePartialSessionArtifacts({ session, context }) {
    const cleanupErrors = [];

    if (session?.disposed !== true && typeof session?.dispose === "function") {
        try {
            session.dispose({
                disposeSequence: true
            });
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (context?.disposed !== true && typeof context?.dispose === "function") {
        try {
            await context.dispose();
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (cleanupErrors.length > 0) {
        throw cleanupErrors[0];
    }
}
