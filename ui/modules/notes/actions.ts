import type { ActionFactoryOptions, NoteActions } from "../../action-contracts";
import NotesModel from '../../../notes/model';

import * as __cjsImport132 from '../../action-results';

const { createUiErrorResult, createUiSuccessResult } = __cjsImport132;
import * as __cjsImport133 from '../../list-action-model';
const { asArray, currentList, entityId, findList, positiveInteger, safeContent, safeString, useFallbackListIfNeeded } = __cjsImport133;
function loadNoteModel(): any {
  return NotesModel;
}


function createNoteActions(options: ActionFactoryOptions = {}): NoteActions {
  const injectedModel = options.model;
  const modelFor = () => injectedModel || loadNoteModel();

  function currentNotes(model: any, missingMessage: any): any {
    const result = currentList(model, missingMessage);

    if (!result.ok) {
      return result;
    }

    return {ok: true, notes: asArray(result.list.notes)};
  }

  function noteMoveTarget(model: any, values: any): any {
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
    addNote(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Note could not be saved. Try again.');
      }
    },

    editNote(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Note could not be updated. Try again.');
      }
    },

    removeNote(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Note could not be removed. Try again.');
      }
    },

    moveNote(values: any = {}) {
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
      } catch (error: any) {
        return createUiErrorResult(error, 'Note could not be moved. Try again.');
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
      const description = safeString(values.description);

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

export { createNoteActions };
export default {
  createNoteActions
};
