function validateInteger(value: any, message: string) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return message;
    }

    return true;
}

function integerPromptValidator(message: string) {
    return (value: any) => validateInteger(value, message);
}

module.exports = {
    integerPromptValidator,
    validateInteger
};
