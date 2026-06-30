import defaultPrompts from '../utils/prompts.ts';
import * as __cjsImport14 from '../utils/prompt-integer-validation.ts';
const { integerPromptValidator } = __cjsImport14;
function normalizeClocks(clocks: any = []) {
  return Array.isArray(clocks) ? clocks : [];
}

function createClockChoices(clocks: any = []) {
  return normalizeClocks(clocks).map((clock: any, index: any) => ({
    name: `${index + 1}. ${clock.name} (${clock.timezone})`,
    value: index + 1
  }));
}

function assertPosition(value: any, count: any, label: any) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > count) {
    throw new Error(`Choose a valid ${label} position.`);
  }
}

async function promptClockPriority({clocks, selectedPosition = 1, promptsModule = defaultPrompts}: any = {}) {
  let normalizedClocks = normalizeClocks(clocks);

  if (normalizedClocks.length < 2) {
    throw new Error('Priority prompt requires at least two clocks.');
  }

  let choices = createClockChoices(normalizedClocks);
  let selectedDefault = Math.min(Math.max(Number(selectedPosition) || 1, 1), normalizedClocks.length);
  let fromAnswer = await promptsModule.prompt([
    {
      type: 'search',
      name: 'fromPosition',
      message: 'Select the clock to move',
      choices,
      defaultValue: selectedDefault
    }
  ]);
  let fromPosition = fromAnswer.fromPosition;
  assertPosition(fromPosition, normalizedClocks.length, 'source');

  let toAnswer = await promptsModule.prompt([
    {
      type: 'number',
      name: 'toPosition',
      message: `Move "${normalizedClocks[fromPosition - 1].name}" to position`,
      defaultValue: fromPosition,
      min: 1,
      max: normalizedClocks.length,
      validate: integerPromptValidator('Choose a whole number position.')
    }
  ]);
  let toPosition = toAnswer.toPosition;
  assertPosition(toPosition, normalizedClocks.length, 'destination');

  if (fromPosition === toPosition) {
    return null;
  }

  return {fromPosition, toPosition};
}

const __defaultExport = Object.assign(promptClockPriority, {
  createClockChoices,
  assertPosition
});
export { promptClockPriority, createClockChoices, assertPosition };
export default __defaultExport;
