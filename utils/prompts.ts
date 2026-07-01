import { createPromptRunner } from '@valyrianjs/terminal';

type PromptChoice = {
    name?: string;
    label?: string;
    value: unknown;
    description?: string;
    checked?: boolean;
};

type PromptAnswerMap = Record<string, unknown>;
type PromptAnswerValue = string | number | boolean | null | unknown[] | Record<string, unknown>;
type PromptAnswerReturnMap = Record<string, PromptAnswerValue> & {
    columnIndex: number;
    columns: string;
    cardKey: string;
    cardKeys: string[];
    checked: number[];
    content: string;
    defaultColumnId: string;
    description: string;
    fromPosition: number;
    index: number;
    indexes: number[];
    labels: unknown[];
    title: string;
    toPosition: number;
    wipLimit: number;
};
type PromptRunnerPrompt = ReturnType<typeof createPromptRunner>['prompt'];
type PromptValidationResult = boolean | string | void | Promise<boolean | string | void>;
type PromptValidator<T = never> = (value: T) => PromptValidationResult;

type NumberPromptOptions = {
    message: string;
    validate?: PromptValidator<number>;
    defaultValue?: number;
    min?: number;
    max?: number;
};

type PromptQuestion = {
    type: string;
    name: string;
    message: string;
    choices?: PromptChoice[];
    source?: (search?: unknown) => PromptChoice[] | Promise<PromptChoice[]>;
    validate?: PromptValidator;
    default?: unknown;
    defaultValue?: unknown;
    min?: number;
    max?: number;
    mask?: string | boolean;
    suffix?: string;
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

function toValyrianChoices(choices: PromptChoice[] = [], preferredValue?: unknown) {
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

function defaultValuesFromChecked(choices: PromptChoice[] = []) {
    return choices
        .filter((choice) => choice.checked === true)
        .map((choice) => choice.value);
}

function assertChoiceDefaults(choices: PromptChoice[] = [], defaultValues: unknown[] = []) {
    for (let defaultValue of defaultValues) {
        if (!choices.some((choice) => Object.is(choice.value, defaultValue))) {
            throw new TypeError('SelectionList defaultValue does not match any choice');
        }
    }
}

function normalizeOptionalInteger(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        return null;
    }

    return value;
}

async function withRunner<T>(run: (prompt: PromptRunnerPrompt) => Promise<T>) {
    assertInteractiveTerminal();

    let runner = createPromptRunner();

    try {
        return await run(runner.prompt);
    } catch (error: unknown) {
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
        validate: question.validate as PromptValidator<string> | undefined
    }));
}

async function password(question: PromptQuestion) {
    return withRunner((prompt) => prompt.password({
        message: question.message,
        mask: typeof question.mask === 'undefined' ? true : question.mask,
        validate: question.validate as PromptValidator<string> | undefined
    }));
}

async function number(question: PromptQuestion) {
    return withRunner((prompt) => {
        let options: NumberPromptOptions = {
            message: question.message,
            validate: question.validate as PromptValidator<number> | undefined
        };
        let defaultValue = normalizeOptionalInteger(promptDefault(question));

        if (defaultValue !== null) {
            options.defaultValue = defaultValue;
        }

        if (typeof question.min === 'number') {
            options.min = question.min;
        }

        if (typeof question.max === 'number') {
            options.max = question.max;
        }

        return prompt.number(options);
    });
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
        validate: question.validate as PromptValidator<unknown> | undefined
    }));
}

async function selectionList(question: PromptQuestion) {
    let choices = question.choices || [];
    let defaultValue = defaultValuesFromChecked(choices);
    assertChoiceDefaults(choices, defaultValue);

    return withRunner((prompt) => prompt.selectionList({
        message: question.message,
        choices: toValyrianChoices(choices),
        defaultValue,
        validate: question.validate as PromptValidator<unknown[]> | undefined
    }));
}

async function search(question: PromptQuestion) {
    let choices = question.choices || [];

    if (choices.length === 0 && typeof question.source === 'function') {
        choices = await question.source('');
    }

    return withRunner((prompt) => prompt.search({
        message: question.message,
        choices: toValyrianChoices(choices, promptDefault(question)),
        validate: question.validate as PromptValidator<unknown> | undefined,
        emptyMessage: 'No matching options'
    }));
}

async function prompt(questions: PromptQuestion[]) {
    let answers: PromptAnswerMap = {};

    for (let question of questions) {
        switch (question.type) {
            case 'input':
                answers[question.name] = await input(question);
                break;
            case 'password':
                answers[question.name] = await password(question);
                break;
            case 'number':
                answers[question.name] = await number(question);
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

    return answers as PromptAnswerReturnMap;
}

export { prompt, input, password, number, confirm, select, selectionList, search, toValyrianChoices, initialSelectionFromChecked, defaultValuesFromChecked, assertChoiceDefaults, normalizeOptionalInteger };
export default {
    prompt,
    input,
    password,
    number,
    confirm,
    select,
    selectionList,
    search,
    toValyrianChoices,
    initialSelectionFromChecked,
    defaultValuesFromChecked,
    assertChoiceDefaults,
    normalizeOptionalInteger
};
