import defaultPrompts from '../utils/prompts.ts';
import * as __cjsImport21 from '../utils/prompt-integer-validation.ts';
const { integerPromptValidator } = __cjsImport21;

type BoardCard = {
  title: string;
};

type BoardPromptChoice = {
  name: string;
  value: number;
};

type BoardPromptQuestion = {
  type: string;
  name: string;
  message: string;
  choices?: BoardPromptChoice[];
  defaultValue?: number;
  min?: number;
  max?: number;
  validate?: (value: unknown) => boolean | string | void | Promise<boolean | string | void>;
};

type BoardPromptsModule = {
  prompt: (questions: BoardPromptQuestion[]) => Promise<Record<string, unknown>>;
};

type PromptBoardPriorityOptions = {
  columnTitle?: string;
  cards?: unknown;
  selectedPosition?: unknown;
  promptsModule?: BoardPromptsModule;
};

function normalizeCards(cards: unknown = []): BoardCard[] {
  return Array.isArray(cards) ? (cards as BoardCard[]) : [];
}

function createCardChoices(cards: unknown = []): BoardPromptChoice[] {
  return normalizeCards(cards).map((card, index) => ({
    name: `${index + 1}. ${card.title}`,
    value: index + 1
  }));
}

function assertPosition(value: unknown, count: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > count) {
    throw new Error(`Choose a valid ${label} position.`);
  }
}

async function promptBoardPriority({columnTitle, cards, selectedPosition = 1, promptsModule = defaultPrompts}: PromptBoardPriorityOptions = {}) {
  let normalizedCards = normalizeCards(cards);

  if (normalizedCards.length < 2) {
    throw new Error('Priority prompt requires at least two cards.');
  }

  let choices = createCardChoices(normalizedCards);
  let selectedDefault = Math.min(Math.max(Number(selectedPosition) || 1, 1), normalizedCards.length);
  let fromAnswer = await promptsModule.prompt([
    {
      type: 'search',
      name: 'fromPosition',
      message: `Select the card to move in ${columnTitle}`,
      choices,
      defaultValue: selectedDefault
    }
  ]);
  let fromPosition = fromAnswer.fromPosition;
  assertPosition(fromPosition, normalizedCards.length, 'source');

  let toAnswer = await promptsModule.prompt([
    {
      type: 'number',
      name: 'toPosition',
      message: `Move "${normalizedCards[fromPosition - 1].title}" to position`,
      defaultValue: fromPosition,
      min: 1,
      max: normalizedCards.length,
      validate: integerPromptValidator('Choose a whole number position.')
    }
  ]);
  let toPosition = toAnswer.toPosition;
  assertPosition(toPosition, normalizedCards.length, 'destination');

  if (fromPosition === toPosition) {
    return null;
  }

  return {fromPosition, toPosition};
}

const __defaultExport = Object.assign(promptBoardPriority, {
  createCardChoices,
  assertPosition
});
export { promptBoardPriority, createCardChoices, assertPosition };
export default __defaultExport;
