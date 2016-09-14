import {createStore, compose} from 'redux';
import {install} from 'redux-loop';
import {modularEnhancer, loopCodec} from '../modular';

const enhancer = compose(
  modularEnhancer(loopCodec),
  install()
);

export default function configureStore(initialState) {
  return createStore(rootReducer, initialState, enhancer);
}
