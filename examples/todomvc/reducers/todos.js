import { Effects, loop } from 'redux-loop';

import { ADD_TODO, DELETE_TODO, EDIT_TODO, MARK_TODO, MARK_ALL, CLEAR_MARKED } from '../constants/ActionTypes';

const initialState = [{
  text: 'Use Redux',
  marked: false,
  id: 0
}];

export default function todos(deps = {}, action) {
  const state = deps.todos || initialState;
console.log('REDUCER', state, action.type);
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
        { ...todo, text: action.text } :
        todo
    );

  case MARK_TODO:
    return loop(
      state.map(todo =>
        todo.id === action.id ?
          { ...todo, marked: !todo.marked } :
          todo
      ),
      Effects.call((...args) => {
        console.log('side-effect MARK_TODO', ...args);
        return { type: '@@NOOP' };
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
}
