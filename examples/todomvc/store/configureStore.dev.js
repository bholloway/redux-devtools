import { createStore, compose } from 'redux';
import { install } from 'redux-loop';

import { persistState } from 'redux-devtools';
import DevTools from '../containers/DevTools';
import { modularEnhancer, loopCodec } from '../modular';

const enhancer = compose(
  modularEnhancer(loopCodec),
  install(),
  DevTools.instrument(),
  persistState(
    window.location.href.match(
      /[?&]debug_session=([^&#]+)\b/
    )
  )
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
