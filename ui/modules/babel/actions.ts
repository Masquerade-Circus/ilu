import type { BabelActionFactoryOptions, BabelActions } from "../../action-contracts";

const {createGoogleTranslateProvider} = require('../../../translate/google-translate-provider');

const MAX_TEXT_LENGTH = 5000;
const TRANSLATE_FAILED = 'Could not translate the text.';
const COPY_FAILED = 'Could not copy the translation.';

function cleanString(value: any, fallback: any = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeLanguage(value: any, fallback: any) {
  const trimmed = cleanString(value, fallback).trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeDictionaryEntries(response: any) {
  const groups = response && Array.isArray(response.dict) ? response.dict : [];
  const entries: any = [];

  for (const group of groups) {
    const groupEntries = group && Array.isArray(group.entry) ? group.entry : [];

    for (const entry of groupEntries) {
      const word = cleanString(entry && entry.word).trim();
      const reverse = entry && Array.isArray(entry.reverse_translation) ? entry.reverse_translation : [];
      const translations = reverse.map((item: any) => cleanString(item).trim()).filter(Boolean);

      if (word.length === 0) {
        continue;
      }

      entries.push(translations.length > 0 ? `${word} — ${translations.join(', ')}` : word);
    }
  }

  return entries;
}

function createSafeDefaultProvider({fetchImpl, log}: any = {}) {
  return createGoogleTranslateProvider({
    fetchImpl,
    log,
    exit() {
      throw new Error('Translation provider failed');
    }
  });
}

function createBabelActions({provider = null, fetchImpl, log}: BabelActionFactoryOptions = {}): BabelActions {
  const translateProvider = provider || createSafeDefaultProvider({fetchImpl, log});

  return {
    async translate(values: any = {}) {
      const text = cleanString(values.text).trim();
      const source = normalizeLanguage(values.source, 'auto');
      const target = normalizeLanguage(values.target, 'en');

      if (text.length === 0) {
        return {ok: false, error: 'Text to translate is required.'};
      }

      if (text.length > MAX_TEXT_LENGTH) {
        return {ok: false, error: 'Text must be 5000 characters or fewer.'};
      }

      try {
        const response = await translateProvider({text, source, target});
        const sentence = response && Array.isArray(response.sentences) ? response.sentences[0] : null;
        const translation = cleanString(sentence && sentence.trans).trim();

        if (translation.length === 0) {
          return {ok: false, error: 'No translation was returned.'};
        }

        return {
          ok: true,
          translation,
          source: normalizeLanguage(response && response.src, source),
          target,
          dictionaryEntries: normalizeDictionaryEntries(response)
        };
      } catch (_: any) {
        return {ok: false, error: TRANSLATE_FAILED};
      }
    },
    async copyResult(values: any = {}) {
      const translation = cleanString(values.translation).trim();

      if (translation.length === 0) {
        return {ok: false, error: COPY_FAILED};
      }

      return {ok: false, error: COPY_FAILED};
    }
  };
}

module.exports = {
  createBabelActions
};
