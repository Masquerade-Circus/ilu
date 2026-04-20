let inquirer = require('inquirer');

if (typeof inquirer.prompt !== 'function' && inquirer.default && typeof inquirer.default.prompt === 'function') {
    inquirer = inquirer.default;
}

function failInteractivePrompt(message) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

async function prompt(questions) {
    if (!process.stdin || !process.stdin.isTTY) {
        failInteractivePrompt('This command requires an interactive terminal (TTY). Piped or non-interactive stdin is not supported.');
    }

    try {
        return await inquirer.prompt(questions);
    } catch (error) {
        if (error && error.name === 'ExitPromptError') {
            failInteractivePrompt('Interactive prompt cancelled or closed before completion.');
        }

        throw error;
    }
}

module.exports = Object.assign({}, inquirer, {prompt});
