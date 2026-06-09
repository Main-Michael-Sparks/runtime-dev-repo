export function createChunkFactory(model) {
    let lastTokens = [];

    return function toChunk(t) {
        if (Array.isArray(t)) {
            const chunk = model.detokenize(t, false, lastTokens);
            lastTokens = [...lastTokens, ...t].slice(-8);
            return chunk;
        }

        if (typeof t === "number") {
            const tokens = [t];
            const chunk = model.detokenize(tokens, false, lastTokens);
            lastTokens = [...lastTokens, ...tokens].slice(-8);
            return chunk;
        }

        return String(t);
    };
}
