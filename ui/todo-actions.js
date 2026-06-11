const {createUiErrorResult, createUiSuccessResult} = require('./action-results');

function loadTodoModel() {
  return require('../todos/model');
}

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeDescription(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function createTodoActions(options = {}) {
  const injectedModel = options.model;
  const modelFor = () => injectedModel || loadTodoModel();

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

  function currentTasks(model, missingMessage) {
    const result = currentList(model, missingMessage);

    if (!result.ok) {
      return result;
    }

    return {ok: true, tasks: asArray(result.list.tasks)};
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

  function checkedIndexesWith(model, position, done) {
    const result = currentTasks(model, 'Choose a todo list before changing a task.');

    if (!result.ok) {
      return result;
    }

    const targetIndex = position - 1;
    const checked = result.tasks
      .map((task, index) => (task && task.done === true ? index : null))
      .filter(index => Number.isInteger(index));
    const next = done === true
      ? Array.from(new Set([...checked, targetIndex])).sort((left, right) => left - right)
      : checked.filter(index => index !== targetIndex);

    return {ok: true, checked: next};
  }

  return {
    addTask(values = {}) {
      const title = safeString(values.title);
      const description = safeDescription(values.description);

      if (!title) {
        return {ok: false, error: 'Task title is required.'};
      }

      try {
        const model = modelFor();
        const list = currentList(model, 'Choose a todo list before adding a task.');

        if (!list.ok) {
          return list;
        }

        return createUiSuccessResult({task: model.tasks.add({title, description})});
      } catch (error) {
        return createUiErrorResult(error, 'Task could not be saved. Try again.');
      }
    },

    editTask(values = {}) {
      const position = values.position;
      const title = safeString(values.title);
      const description = safeDescription(values.description);

      if (!positiveInteger(position)) {
        return {ok: false, error: 'Choose a task first.'};
      }

      if (!title) {
        return {ok: false, error: 'Task title is required.'};
      }

      try {
        const model = modelFor();
        const list = currentList(model, 'Choose a todo list before editing a task.');

        if (!list.ok) {
          return list;
        }

        return createUiSuccessResult({task: model.tasks.edit(position, {title, description})});
      } catch (error) {
        return createUiErrorResult(error, 'Task could not be updated. Try again.');
      }
    },

    markTaskDone(values = {}) {
      const position = values.position;

      if (!positiveInteger(position)) {
        return {ok: false, error: 'Choose a task first.'};
      }

      try {
        const model = modelFor();
        const result = checkedIndexesWith(model, position, true);

        if (!result.ok) {
          return result;
        }

        return createUiSuccessResult({list: model.tasks.check(result.checked)});
      } catch (error) {
        return createUiErrorResult(error, 'Task could not be updated. Try again.');
      }
    },

    markTaskOpen(values = {}) {
      const position = values.position;

      if (!positiveInteger(position)) {
        return {ok: false, error: 'Choose a task first.'};
      }

      try {
        const model = modelFor();
        const result = checkedIndexesWith(model, position, false);

        if (!result.ok) {
          return result;
        }

        return createUiSuccessResult({list: model.tasks.check(result.checked)});
      } catch (error) {
        return createUiErrorResult(error, 'Task could not be updated. Try again.');
      }
    },

    removeTask(values = {}) {
      const position = values.position;

      if (!positiveInteger(position)) {
        return {ok: false, error: 'Choose a task first.'};
      }

      try {
        const model = modelFor();
        const list = currentList(model, 'Choose a todo list before removing a task.');

        if (!list.ok) {
          return list;
        }

        return createUiSuccessResult({list: model.tasks.remove(position)});
      } catch (error) {
        return createUiErrorResult(error, 'Task could not be removed. Try again.');
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
      const description = safeDescription(values.description);

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
      const description = safeDescription(values.description);

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
  createTodoActions
};
