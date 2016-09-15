import { createStore, compose } from 'redux';
import 'core-js';
import { install } from 'redux-loop';

import { modularEnhancer, loopCodec } from '../modular';

const enhancer = compose(
  ...[
    modularEnhancer(loopCodec),
    install(),
    window.devToolsExtension && window.devToolsExtension()
  ].filter(Boolean)
);

export default function configureStore(initialState) {
  const store = createStore((state = {}) => state, initialState, enhancer);

//  if (module.hot) {
//    module.hot.accept('../modules', () => {
//      console.log('!!!HOT MODULE REPLACEMENT!!!');
//      // TODO hot module replacement
//    });
//  }

  return store;
}
