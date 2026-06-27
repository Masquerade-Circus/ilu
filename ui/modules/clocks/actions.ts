import type { ActionFactoryOptions, ClockActions } from "../../action-contracts";

const {createUiErrorResult, createUiSuccessResult} = require('../../action-results');

const FALLBACK_TIMEZONES = Object.freeze([
  'America/Mexico_City',
  'America/Monterrey',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Madrid',
  'Etc/UTC',
  'Asia/Tokyo'
]);

const TIMEZONE_ALIASES = Object.freeze([
  {label: 'UTC (Etc/UTC)', value: 'Etc/UTC', terms: ['utc']}
]);

function loadClockModel() {
  return require('../../../clocks/model');
}

function safeString(value: any) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: any) {
  return Number.isInteger(value) && value > 0;
}

function normalizeSearch(search: any) {
  return safeString(search).toLowerCase();
}

function getAvailableTimezones() {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');

      if (Array.isArray(timezones) && timezones.length > 0) {
        return timezones;
      }
    } catch (error: any) {
      // Keep UI usable on runtimes without supportedValuesOf('timeZone').
    }
  }

  return [...FALLBACK_TIMEZONES];
}

function searchTimezones(search: any) {
  const normalizedSearch = normalizeSearch(search);

  return getAvailableTimezones()
    .filter((timezone: any) => normalizedSearch.length === 0 || timezone.toLowerCase().includes(normalizedSearch));
}

function searchTimezoneChoices(search: any) {
  const normalizedSearch = normalizeSearch(search);
  const choices: any = [];
  const seen = new Set();

  TIMEZONE_ALIASES
    .filter((alias: any) => normalizedSearch.length === 0 || alias.terms.some((term: any) => term.includes(normalizedSearch) || normalizedSearch.includes(term)))
    .forEach((alias: any) => {
      if (seen.has(alias.value)) {
        return;
      }

      seen.add(alias.value);
      choices.push({name: alias.label, value: alias.value});
    });

  searchTimezones(search).forEach((timezone: any) => {
    if (seen.has(timezone)) {
      return;
    }

    seen.add(timezone);
    choices.push({name: timezone, value: timezone});
  });

  return choices;
}

function validTimezone(timezone: any) {
  const normalized = safeString(timezone);

  if (normalized.length === 0) {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, {timeZone: normalized}).format(new Date());
    return true;
  } catch (error: any) {
    return false;
  }
}

function uniquePositivePositions(value: any) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source)]
    .map((item: any) => Number(item))
    .filter((item: any) => positiveInteger(item))
    .sort((left: any, right: any) => left - right);
}

function clockCount(model: any) {
  return typeof model.find === 'function' ? (Array.isArray(model.find()) ? model.find().length : 0) : 0;
}

function createClockActions(options: ActionFactoryOptions = {}): ClockActions {
  const injectedModel = options.model;
  const modelFor = () => injectedModel || loadClockModel();

  return {
    addClock(values: any = {}) {
      const name = safeString(values.name);
      const timezone = safeString(values.timezone);

      if (name.length === 0) {
        return {ok: false, error: 'Clock name is required.'};
      }

      if (!validTimezone(timezone)) {
        return {ok: false, error: 'Choose a valid timezone.'};
      }

      try {
        return createUiSuccessResult({clocks: modelFor().add({name, timezone})});
      } catch (error: any) {
        return createUiErrorResult(error, 'Clock could not be saved. Try again.');
      }
    },

    removeClocks(values: any = {}) {
      const positions = uniquePositivePositions(values.positions || values.position);

      if (positions.length === 0) {
        return {ok: false, error: 'Choose a clock first.'};
      }

      try {
        const model = modelFor();
        const count = clockCount(model);

        if (count < 1 || positions.some((position: any) => position > count)) {
          return {ok: false, error: 'Choose a valid clock.'};
        }

        return createUiSuccessResult({clocks: model.remove(positions)});
      } catch (error: any) {
        return createUiErrorResult(error, 'Clock could not be removed. Try again.');
      }
    },

    moveClock(values: any = {}) {
      const fromPosition = Number(values.fromPosition);
      const toPosition = Number(values.toPosition);

      if (!positiveInteger(fromPosition) || !positiveInteger(toPosition)) {
        return {ok: false, error: 'Choose a valid clock position.'};
      }

      if (fromPosition === toPosition) {
        return {ok: false, error: 'Choose a different clock position.'};
      }

      try {
        const model = modelFor();
        const count = clockCount(model);

        if (count < 2 || fromPosition > count || toPosition > count) {
          return {ok: false, error: 'Choose a valid clock position.'};
        }

        return createUiSuccessResult({clocks: model.move({fromPosition, toPosition})});
      } catch (error: any) {
        return createUiErrorResult(error, 'Clock order could not be updated. Try again.');
      }
    },

    searchTimezoneChoices(values: any = {}) {
      return searchTimezoneChoices(values.search);
    }
  };
}

module.exports = {
  createClockActions,
  getAvailableTimezones,
  searchTimezoneChoices,
  validTimezone
};
