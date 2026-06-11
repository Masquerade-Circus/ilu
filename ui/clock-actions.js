const {createUiErrorResult, createUiSuccessResult} = require('./action-results');

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
  return require('../clocks/model');
}

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeSearch(search) {
  return safeString(search).toLowerCase();
}

function getAvailableTimezones() {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');

      if (Array.isArray(timezones) && timezones.length > 0) {
        return timezones;
      }
    } catch (error) {
      // Keep UI usable on runtimes without supportedValuesOf('timeZone').
    }
  }

  return [...FALLBACK_TIMEZONES];
}

function searchTimezones(search) {
  const normalizedSearch = normalizeSearch(search);

  return getAvailableTimezones()
    .filter(timezone => normalizedSearch.length === 0 || timezone.toLowerCase().includes(normalizedSearch))
    .slice(0, 20);
}

function searchTimezoneChoices(search) {
  const normalizedSearch = normalizeSearch(search);
  const choices = [];
  const seen = new Set();

  TIMEZONE_ALIASES
    .filter(alias => normalizedSearch.length > 0 && alias.terms.some(term => term.includes(normalizedSearch) || normalizedSearch.includes(term)))
    .forEach(alias => {
      if (seen.has(alias.value)) {
        return;
      }

      seen.add(alias.value);
      choices.push({name: alias.label, value: alias.value});
    });

  searchTimezones(search).forEach(timezone => {
    if (seen.has(timezone)) {
      return;
    }

    seen.add(timezone);
    choices.push({name: timezone, value: timezone});
  });

  return choices.slice(0, 20);
}

function validTimezone(timezone) {
  const normalized = safeString(timezone);

  if (normalized.length === 0) {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, {timeZone: normalized}).format(new Date());
    return true;
  } catch (error) {
    return false;
  }
}

function uniquePositivePositions(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source)]
    .map(item => Number(item))
    .filter(item => positiveInteger(item))
    .sort((left, right) => left - right);
}

function clockCount(model) {
  return typeof model.find === 'function' ? (Array.isArray(model.find()) ? model.find().length : 0) : 0;
}

function createClockActions(options = {}) {
  const injectedModel = options.model;
  const modelFor = () => injectedModel || loadClockModel();

  return {
    addClock(values = {}) {
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
      } catch (error) {
        return createUiErrorResult(error, 'Clock could not be saved. Try again.');
      }
    },

    removeClocks(values = {}) {
      const positions = uniquePositivePositions(values.positions || values.position);

      if (positions.length === 0) {
        return {ok: false, error: 'Choose a clock first.'};
      }

      try {
        const model = modelFor();
        const count = clockCount(model);

        if (count < 1 || positions.some(position => position > count)) {
          return {ok: false, error: 'Choose a valid clock.'};
        }

        return createUiSuccessResult({clocks: model.remove(positions)});
      } catch (error) {
        return createUiErrorResult(error, 'Clock could not be removed. Try again.');
      }
    },

    moveClock(values = {}) {
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
      } catch (error) {
        return createUiErrorResult(error, 'Clock order could not be updated. Try again.');
      }
    },

    searchTimezoneChoices(values = {}) {
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
