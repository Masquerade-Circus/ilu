function validateInteger(value: unknown, message: string) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return message;
    }

    return true;
}

function integerPromptValidator(message: string) {
    return (value: unknown) => validateInteger(value, message);
}

export { integerPromptValidator, validateInteger };
export default {
    integerPromptValidator,
    validateInteger
};
