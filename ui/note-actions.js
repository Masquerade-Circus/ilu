const {createUiErrorResult, createUiSuccessResult} = require('./action-results');

function loadNoteModel() {
  return require('../notes/model');
}

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeContent(value) {
  return typeof value === 'string' ? value : '';
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function safeEntityId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

function entityId(item, fallback = null) {
  if (!item || typeof item !== 'object') {
    return fallback;
  }

  if (typeof item.$id === 'number' || typeof item.$id === 'string') {
    return item.$id;
  }

  if (typeof item.id === 'number' || typeof item.id === 'string') {
    return item.id;
  }

  if (positiveInteger(item.index)) {
    return item.index;
  }

  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function createNoteActions(options = {}) {
  const injectedModel = options.model;
  const modelFor = () => injectedModel || loadNoteModel();

  function currentList(model, missingMessage) {
    const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

    if (current) {
      return {ok: true, list: current};
    }

    const first = typeof model.getFirst === 'function' ? model.getFirst() : null;

    if (first) {
      return {ok: true, list: first};
    }

    return {ok: false, error: missingMessage};
  }

  function findList(model, listId) {
    const id = safeEntityId(listId);

    if (id === null) {
      return null;
    }

    const lists = typeof model.find === 'function' ? asArray(model.find()) : [];
    const match = lists.find((item, index) => entityId(item, index + 1) === id || item.index === id);

    if (match) {
      return match;
    }

    if (typeof model.get === 'function') {
      return model.get(id) || null;
    }

    return null;
  }

  function useFallbackListIfNeeded(model) {
    const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

    if (current) {
      return;
    }

    const first = typeof model.getFirst === 'function' ? model.getFirst() : null;

    if (first && typeof model.use === 'function') {
      model.use(entityId(first));
    }
  }

  function currentNotes(model, missingMessage) {
    const result = currentList(model, missingMessage);

    if (!result.ok) {
      return result;
    }

    return {ok: true, notes: asArray(result.list.notes)};
  }

  function noteMoveTarget(model, values) {
    const position = values.position;

    if (!positiveInteger(position)) {
      return {ok: false, error: 'Choose a note first.'};
    }

    const result = currentNotes(model, 'Choose a note list before moving a note.');

    if (!result.ok) {
      return result;
    }

    const explicitTarget = values.toPosition;
    const toPosition = positiveInteger(explicitTarget)
      ? explicitTarget
      : values.direction === 'up'
        ? position - 1
        : values.direction === 'down'
          ? position + 1
          : null;

    if (toPosition === null) {
      return {ok: false, error: 'Choose a move direction.'};
    }

    if (toPosition < 1 || position > result.notes.length || toPosition > result.notes.length || position === toPosition) {
      return {ok: true, noop: true};
    }

    return {ok: true, fromIndex: position, toIndex: toPosition};
  }

  return {
    addNote(values = {}) {
      const title = safeString(values.title);
      const content = safeContent(values.content);

      if (!title) {
        return {ok: false, error: 'Note title is required.'};
      }

      try {
        const model = modelFor();
        const list = currentList(model, 'Choose a note list before adding a note.');

        if (!list.ok) {
          return list;
        }

        return createUiSuccessResult({note: model.notes.add({title, content})});
      } catch (error) {
        return createUiErrorResult(error, 'Note could not be saved. Try again.');
      }
    },

    editNote(values = {}) {
      const position = values.position;
      const title = safeString(values.title);
      const content = safeContent(values.content);

      if (!positiveInteger(position)) {
        return {ok: false, error: 'Choose a note first.'};
      }

      if (!title) {
        return {ok: false, error: 'Note title is required.'};
      }

      try {
        const model = modelFor();
        const list = currentList(model, 'Choose a note list before editing a note.');

        if (!list.ok) {
          return list;
        }

        return createUiSuccessResult({note: model.notes.edit(position, {title, content})});
      } catch (error) {
        return createUiErrorResult(error, 'Note could not be updated. Try again.');
      }
    },

    removeNote(values = {}) {
      const position = values.position;

      if (!positiveInteger(position)) {
        return {ok: false, error: 'Choose a note first.'};
      }

      try {
        const model = modelFor();
        const list = currentList(model, 'Choose a note list before removing a note.');

        if (!list.ok) {
          return list;
        }

        return createUiSuccessResult({list: model.notes.remove(position)});
      } catch (error) {
        return createUiErrorResult(error, 'Note could not be removed. Try again.');
      }
    },

    moveNote(values = {}) {
      try {
        const model = modelFor();
        const target = noteMoveTarget(model, values);

        if (!target.ok) {
          return target;
        }

        if (target.noop) {
          return createUiSuccessResult();
        }

        return createUiSuccessResult({list: model.notes.reorder({fromIndex: target.fromIndex, toIndex: target.toIndex})});
      } catch (error) {
        return createUiErrorResult(error, 'Note could not be moved. Try again.');
      }
    },

    useList(values = {}) {
      try {
        const model = modelFor();
        const list = findList(model, values.listId);

        if (!list) {
          return {ok: false, error: 'Choose a list first.'};
        }

        return createUiSuccessResult({list: model.use(entityId(list))});
      } catch (error) {
        return createUiErrorResult(error, 'List could not be opened. Try again.');
      }
    },

    addList(values = {}) {
      const title = safeString(values.title);
      const description = safeString(values.description);

      if (!title) {
        return {ok: false, error: 'List title is required.'};
      }

      try {
        return createUiSuccessResult({list: modelFor().add({title, description})});
      } catch (error) {
        return createUiErrorResult(error, 'List could not be saved. Try again.');
      }
    },

    renameList(values = {}) {
      const title = safeString(values.title);
      const description = safeString(values.description);

      if (!title) {
        return {ok: false, error: 'List title is required.'};
      }

      try {
        const model = modelFor();
        const list = findList(model, values.listId);

        if (!list) {
          return {ok: false, error: 'Choose a list first.'};
        }

        list.title = title;
        list.description = description;
        return createUiSuccessResult({list: model.save(list)});
      } catch (error) {
        return createUiErrorResult(error, 'List could not be renamed. Try again.');
      }
    },

    removeList(values = {}) {
      try {
        const model = modelFor();
        const list = findList(model, values.listId);

        if (!list) {
          return {ok: false, error: 'Choose a list first.'};
        }

        model.remove(list);
        useFallbackListIfNeeded(model);
        return createUiSuccessResult();
      } catch (error) {
        return createUiErrorResult(error, 'List could not be removed. Try again.');
      }
    }
  };
}

module.exports = {
  createNoteActions
};
