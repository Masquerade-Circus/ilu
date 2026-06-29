import type { BabelActionFactoryOptions, BabelActions } from "../../action-contracts";

const {createGoogleTranslateProvider} = require('../../../translate/google-translate-provider');

const MAX_TEXT_LENGTH = 5000;
const TRANSLATE_FAILED = 'Could not translate the text.';
const COPY_FAILED = 'Could not copy the translation.';

type BabelValues = {text?: unknown; source?: unknown; target?: unknown; translation?: unknown};
type TranslationGroup = {entry?: unknown};
type TranslationResponse = {dict?: unknown; sentences?: unknown; src?: unknown};

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeLanguage(value: unknown, fallback: string) {
  const trimmed = cleanString(value, fallback).trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeDictionaryEntries(response: TranslationResponse) {
  const groups = Array.isArray(response.dict) ? response.dict as TranslationGroup[] : [];
  const entries: string[] = [];

  for (const group of groups) {
    const groupEntries = group && Array.isArray(group.entry) ? group.entry : [];

    for (const entry of groupEntries) {
      const word = cleanString(entry && entry.word).trim();
      const reverse = entry && Array.isArray(entry.reverse_translation) ? entry.reverse_translation : [];
      const translations = reverse.map((item: unknown) => cleanString(item).trim()).filter(Boolean);

      if (word.length === 0) {
        continue;
      }

      entries.push(translations.length > 0 ? `${word} — ${translations.join(', ')}` : word);
    }
  }

  return entries;
}

function createSafeDefaultProvider({fetchImpl, log}: {fetchImpl?: unknown; log?: unknown} = {}) {
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
    async translate(values: BabelValues = {}) {
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
        const response = await translateProvider({text, source, target}) as TranslationResponse;
        const sentence = response && Array.isArray(response.sentences) ? response.sentences[0] as {trans?: unknown} : null;
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
      } catch (_error: unknown) {
        void _error;
        return {ok: false, error: TRANSLATE_FAILED};
      }
    },
    async copyResult(values: BabelValues = {}) {
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
