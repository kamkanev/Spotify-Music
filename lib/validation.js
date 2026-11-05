const ValidationError = require('./errors/ValidationError');

function text(value, field, max = 255, required = false) {
    if (value == null && !required) return null;
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new ValidationError(`Invalid ${field}.`);
    }
    return value.trim();
}

function ids(value, field) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) {
        throw new ValidationError(`${field} must be an array of positive integer database IDs.`);
    }
    return [...new Set(value)];
}

function recordId(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) {
        throw new ValidationError('Use a valid library record ID.');
    }
    return Number(value);
}

function isTrackUri(value) {
    return typeof value === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(value);
}

module.exports = {text, ids, recordId, isTrackUri};
