import {Effects, loop} from 'redux-loop';

export const ADD_TODO = Symbol('ADD_TODO');
export const DELETE_TODO = Symbol('DELETE_TODO');
export const EDIT_TODO = Symbol('EDIT_TODO');
export const MARK_TODO = Symbol('MARK_TODO');
export const MARK_ALL = Symbol('MARK_ALL');
export const CLEAR_MARKED = Symbol('CLEAR_MARKED');

export const provides = 'todos';

export const depends = [];

export const addTodo = (text) => ({
  type: ADD_TODO,
  text
});

export const deleteTodo = (id) => ({
  type: DELETE_TODO,
  id
});

export const editTodo = (id, text) => ({
  type: EDIT_TODO,
  id,
  text
});

export const markTodo = id => ({
  type: MARK_TODO,
  id
});

export const markAll = () => ({
  type: MARK_ALL
});

export const clearMarked = () => ({
  type: CLEAR_MARKED
});

export const actions = {
  addTodo,
  deleteTodo,
  editTodo,
  markTodo,
  markAll,
  clearMarked
};

const initialState = [{
  text: 'Use Redux',
  marked: false,
  id: 0
}];

export const reducer = (state = initialState, action, deps) => {
  switch (action.type) {
    case ADD_TODO:
      return [{
        id: (state.length === 0) ? 0 : state[0].id + 1,
        marked: false,
        text: action.text
      }, ...state];

    case DELETE_TODO:
      return state.filter(todo =>
        todo.id !== action.id
      );

    case EDIT_TODO:
      return state.map(todo =>
        todo.id === action.id ?
        {...todo, text: action.text} :
          todo
      );

    case MARK_TODO:
      return loop(
        state.map(todo =>
          todo.id === action.id ?
          {...todo, marked: !todo.marked} :
            todo
        ),
        Effects.call((...args) => {
          console.log('side-effect MARK_TODO', ...args);
          return {type: '!!NOOP!!'};
        })
      );

    case MARK_ALL:
      const areAllMarked = state.every(todo => todo.marked);
      return state.map(todo => ({
        ...todo,
        marked: !areAllMarked
      }));

    case CLEAR_MARKED:
      return state.filter(todo => todo.marked === false);

    default:
      return state;
  }
};
