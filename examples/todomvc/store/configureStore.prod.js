import {createStore, compose} from 'redux';
import 'core-js';
import {install} from 'redux-loop';
import {modularEnhancer, loopCodec} from '../modular';

const enhancer = compose(
  modularEnhancer(loopCodec),
  install()
);

export default function configureStore(initialState) {
  return createStore((state = {}) => state, initialState, enhancer);
}
