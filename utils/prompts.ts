type PromptChoice = {
    name?: string;
    label?: string;
    value: any;
    description?: string;
    checked?: boolean;
};

type PromptQuestion = {
    type: string;
    name: string;
    message: string;
    choices?: PromptChoice[];
    source?: (search?: any) => PromptChoice[] | Promise<PromptChoice[]>;
    validate?: (value: any) => boolean | string | void | Promise<boolean | string | void>;
    default?: any;
    defaultValue?: any;
    mask?: string | boolean;
};

function failInteractivePrompt(message: string) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

function assertInteractiveTerminal() {
    if (!process.stdin || !process.stdin.isTTY) {
        failInteractivePrompt('This command requires an interactive terminal (TTY). Piped or non-interactive stdin is not supported.');
    }
}

function promptDefault(question: PromptQuestion) {
    if ('defaultValue' in question) {
        return question.defaultValue;
    }

    if ('default' in question) {
        return question.default;
    }

    return '';
}

function toValyrianChoice(choice: PromptChoice, index: number) {
    let label = typeof choice.label === 'string' ? choice.label : choice.name;

    return {
        label: typeof label === 'string' ? label : String(choice.value),
        value: choice.value,
        key: String(index),
        description: choice.description
    };
}

function toValyrianChoices(choices: PromptChoice[] = [], preferredValue?: any) {
    let normalized = choices.map(toValyrianChoice);

    if (typeof preferredValue === 'undefined') {
        return normalized;
    }

    let preferredIndex = normalized.findIndex((choice) => Object.is(choice.value, preferredValue));

    if (preferredIndex <= 0) {
        return normalized;
    }

    return [normalized[preferredIndex], ...normalized.slice(0, preferredIndex), ...normalized.slice(preferredIndex + 1)];
}

function initialSelectionFromChecked(choices: PromptChoice[] = []) {
    return choices
        .map(toValyrianChoice)
        .filter((_choice, index) => choices[index].checked === true);
}

async function loadCreatePromptRunner() {
    let terminal = await import('@valyrianjs/terminal');
    return terminal.createPromptRunner;
}

async function loadSelectionListRuntime() {
    let terminal = await import('@valyrianjs/terminal');
    let valyrian = await import('valyrian.js');

    return {
        Button: terminal.Button,
        Screen: terminal.Screen,
        SelectionList: terminal.SelectionList,
        Text: terminal.Text,
        mountTerminal: terminal.mountTerminal,
        v: valyrian.v
    };
}

async function withRunner<T>(run: (prompt: any) => Promise<T>) {
    assertInteractiveTerminal();

    let createPromptRunner = await loadCreatePromptRunner();
    let runner = createPromptRunner();

    try {
        return await run(runner.prompt);
    } catch (error: any) {
        if (error instanceof Error && (error.name === 'PromptAbortError' || error.name === 'PromptRunnerDestroyedError')) {
            failInteractivePrompt('Interactive prompt cancelled or closed before completion.');
        }

        throw error;
    } finally {
        runner.destroy();
    }
}

async function input(question: PromptQuestion) {
    return withRunner((prompt) => prompt.input({
        message: question.message,
        defaultValue: String(promptDefault(question) || ''),
        validate: question.validate
    }));
}

async function password(question: PromptQuestion) {
    return withRunner((prompt) => prompt.password({
        message: question.message,
        mask: typeof question.mask === 'undefined' ? true : question.mask,
        validate: question.validate
    }));
}

async function confirm(question: PromptQuestion) {
    return withRunner((prompt) => prompt.confirm({
        message: question.message,
        defaultValue: Boolean(promptDefault(question))
    }));
}

async function select(question: PromptQuestion) {
    return withRunner((prompt) => prompt.select({
        message: question.message,
        choices: toValyrianChoices(question.choices || [], promptDefault(question)),
        validate: question.validate
    }));
}

async function selectionList(question: PromptQuestion) {
    let initialSelection = initialSelectionFromChecked(question.choices || []);

    if (initialSelection.length > 0) {
        return selectionListWithInitialSelection(question);
    }

    return withRunner((prompt) => prompt.selectionList({
        message: question.message,
        choices: toValyrianChoices(question.choices || []),
        validate: question.validate
    }));
}

async function validateSelection(question: PromptQuestion, value: any[]) {
    if (typeof question.validate !== 'function') {
        return true;
    }

    let result = await question.validate(value);

    if (result === false) {
        return 'Selection failed validation.';
    }

    if (typeof result === 'string') {
        return result;
    }

    return true;
}

async function selectionListWithInitialSelection(question: PromptQuestion) {
    assertInteractiveTerminal();

    let runtime = await loadSelectionListRuntime();
    let choices = toValyrianChoices(question.choices || []);
    let selected = choices.filter((_choice, index) => (question.choices || [])[index].checked === true);
    let errorMessage = '';
    let session: any = null;

    try {
        return await new Promise<any[]>((resolve, reject) => {
            let finishSelection = () => {
                let values = selected.map((choice) => choice.value);

                void validateSelection(question, values).then((result) => {
                    if (result !== true) {
                        errorMessage = result;

                        if (session !== null) {
                            session.update();
                        }

                        return;
                    }

                    resolve(values);
                }).catch(reject);
            };

            session = runtime.mountTerminal(() => runtime.v(runtime.Screen, {__onInterrupt: () => reject(new Error('PromptAbortError'))},
                runtime.v(runtime.Text, {}, question.message),
                runtime.v(runtime.SelectionList as any, {
                    id: 'ilu-prompt-selection-list',
                    __enterPressId: 'ilu-prompt-done',
                    items: choices,
                    selected,
                    showActive: true,
                    renderItem: (choice: any) => choice.label,
                    onselect: (event: any) => {
                        selected = event.selected;
                        errorMessage = '';
                    }
                }),
                runtime.v(runtime.Button, {id: 'ilu-prompt-done', label: 'Done', onpress: finishSelection}),
                errorMessage ? runtime.v(runtime.Text, {style: {color: 'red'}}, errorMessage) : null
            ));

            session.focus('ilu-prompt-selection-list');
        });
    } catch (error: any) {
        if (error instanceof Error && error.message === 'PromptAbortError') {
            failInteractivePrompt('Interactive prompt cancelled or closed before completion.');
        }

        throw error;
    } finally {
        if (session !== null) {
            session.destroy();
        }
    }
}

async function search(question: PromptQuestion) {
    let choices = question.choices || [];

    if (choices.length === 0 && typeof question.source === 'function') {
        choices = await question.source('');
    }

    return withRunner((prompt) => prompt.search({
        message: question.message,
        choices: toValyrianChoices(choices, promptDefault(question)),
        validate: question.validate,
        emptyMessage: 'No matching options'
    }));
}

async function prompt(questions: PromptQuestion[]) {
    let answers: any = {};

    for (let question of questions) {
        switch (question.type) {
            case 'input':
                answers[question.name] = await input(question);
                break;
            case 'password':
                answers[question.name] = await password(question);
                break;
            case 'confirm':
                answers[question.name] = await confirm(question);
                break;
            case 'select':
            case 'list':
                answers[question.name] = await select(question);
                break;
            case 'checkbox':
                answers[question.name] = await selectionList(question);
                break;
            case 'search':
                answers[question.name] = await search(question);
                break;
            default:
                throw new Error(`Unsupported prompt type: ${question.type}`);
        }
    }

    return answers;
}

module.exports = {
    prompt,
    input,
    password,
    confirm,
    select,
    selectionList,
    search,
    toValyrianChoices,
    initialSelectionFromChecked
};
