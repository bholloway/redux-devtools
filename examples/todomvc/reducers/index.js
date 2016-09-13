import {combineReducers} from 'redux-loop';
import todos from './todos';

const rootReducer = combineReducers({
  todos
});

export default rootReducer;
