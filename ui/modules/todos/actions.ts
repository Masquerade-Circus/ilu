import type { ActionFactoryOptions, TodoActions } from "../../action-contracts";
import TodosModel from '../../../todos/model';

import * as __cjsImport136 from '../../action-results';

const { createUiErrorResult, createUiSuccessResult } = __cjsImport136;
import * as __cjsImport137 from '../../list-action-model';
const { asArray, currentList, entityId, findList, positiveInteger, safeString, useFallbackListIfNeeded } = __cjsImport137;
function loadTodoModel(): any {
  return TodosModel;
}

function safeDescription(value: any): any {
  return typeof value === 'string' ? value.trim() : '';
}

function createTodoActions(options: ActionFactoryOptions = {}): TodoActions {
  const injectedModel = options.model;
  const modelFor = () => injectedModel || loadTodoModel();

  function currentTasks(model: any, missingMessage: any): any {
    const result = currentList(model, missingMessage);

    if (!result.ok) {
      return result;
    }

    return {ok: true, tasks: asArray(result.list.tasks)};
  }

  function checkedIndexesWith(model: any, position: any, done: any): any {
    const result = currentTasks(model, 'Choose a todo list before changing a task.');

    if (!result.ok) {
      return result;
    }

    const targetIndex = position - 1;
    const checked = result.tasks
      .map((task: any, index: any) => (task && task.done === true ? index : null))
      .filter((index: any) => Number.isInteger(index));
    const next = done === true
      ? Array.from(new Set([...checked, targetIndex])).sort((left: any, right: any) => left - right)
      : checked.filter((index: any) => index !== targetIndex);

    return {ok: true, checked: next};
  }

  function taskMoveTarget(model: any, values: any): any {
    const position = values.position;

    if (!positiveInteger(position)) {
      return {ok: false, error: 'Choose a task first.'};
    }

    const result = currentTasks(model, 'Choose a todo list before moving a task.');

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

    if (toPosition < 1 || position > result.tasks.length || toPosition > result.tasks.length || position === toPosition) {
      return {ok: true, noop: true};
    }

    return {ok: true, fromIndex: position, toIndex: toPosition};
  }

  return {
    addTask(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Task could not be saved. Try again.');
      }
    },

    editTask(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Task could not be updated. Try again.');
      }
    },

    markTaskDone(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Task could not be updated. Try again.');
      }
    },

    markTaskOpen(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Task could not be updated. Try again.');
      }
    },

    removeTask(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Task could not be removed. Try again.');
      }
    },

    moveTask(values: any = {}) {
      try {
        const model = modelFor();
        const target = taskMoveTarget(model, values);

        if (!target.ok) {
          return target;
        }

        if (target.noop) {
          return createUiSuccessResult();
        }

        return createUiSuccessResult({list: model.tasks.reorder({fromIndex: target.fromIndex, toIndex: target.toIndex})});
      } catch (error: any) {
        return createUiErrorResult(error, 'Task could not be moved. Try again.');
      }
    },

    useList(values: any = {}) {
      try {
        const model = modelFor();
        const list = findList(model, values.listId);

        if (!list) {
          return {ok: false, error: 'Choose a list first.'};
        }

        return createUiSuccessResult({list: model.use(entityId(list))});
      } catch (error: any) {
        return createUiErrorResult(error, 'List could not be opened. Try again.');
      }
    },

    addList(values: any = {}) {
      const title = safeString(values.title);
      const description = safeDescription(values.description);

      if (!title) {
        return {ok: false, error: 'List title is required.'};
      }

      try {
        return createUiSuccessResult({list: modelFor().add({title, description})});
      } catch (error: any) {
        return createUiErrorResult(error, 'List could not be saved. Try again.');
      }
    },

    renameList(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'List could not be renamed. Try again.');
      }
    },

    removeList(values: any = {}) {
      try {
        const model = modelFor();
        const list = findList(model, values.listId);

        if (!list) {
          return {ok: false, error: 'Choose a list first.'};
        }

        model.remove(list);
        useFallbackListIfNeeded(model);
        return createUiSuccessResult();
      } catch (error: any) {
        return createUiErrorResult(error, 'List could not be removed. Try again.');
      }
    }
  };
}

export { createTodoActions };
export default {
  createTodoActions
};
