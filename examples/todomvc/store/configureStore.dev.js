import {createStore, compose} from 'redux';
import {persistState} from 'redux-devtools';
import rootReducer from '../reducers';
import DevTools from '../containers/DevTools';
import {install} from 'redux-loop';
import {modularEnhancer} from '../modular';

const enhancer = compose(
  modularEnhancer(),
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

  if (module.hot) {
    module.hot.accept('../reducers', () =>
      store.replaceReducer(require('../reducers').default)
    );
  }

  return store;
}
