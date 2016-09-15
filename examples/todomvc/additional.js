import {compose} from 'redux';
import 'core-js';
import {install} from 'redux-loop';

export const EXTERNAL_STORE_CHANGE = Symbol('EXTERNAL_STORE_CHANGE');

/**
 * A reducer factory that wraps a child store in a reducer so that it may exist in a parent store.
 *
 * The child store may depend on some or all of the state of the parent store. The optional
 * `mapStateToAction` function state to be embedded in the action before it is dispatched on the
 * child store. At minimum the child store should accept its own state representation from the
 * parent given the `EXTERNAL_STORE_CHANGE` action.
 *
 * @param {Store} childStore A store which serves as a proxy for state
 * @param {function} [mapStateToAction] Optional mapping from state and action to the action seen
 *  by the child store
 */
export const reduceChildStore = parentStore => (childStore, mapStateToAction) => {
  const isValid =
    (typeof parentStore === 'object') && (typeof parentStore.dispatch === 'function') &&
    (typeof childStore === 'object') && (typeof childStore.setParent === 'function');

  // register with the child store
  childStore.setParent(parentStore);

  // reducer that dispatches on the child store
  return (state, action) => {
    const extendedAction = mapStateToAction ? mapStateToAction(state, action) : action;
    childStore.dispatch(extendedAction);
    return childStore.getState();
  };
};

/**
 * Enhances a store to have the possibility of child stores in the reducer tree.
 *
 * NOT NECESSARY FOR FLUX CHILD STORES
 *
 * When using redux-devtools the store may change without running reducers. This enhancer ensures
 * all reducers run with EXTERNAL_STORE_CHANGE action.
 *
 * Must be composed to the left of then redux-devtools instrument() enhancer.
 */
export const enhanceParentStore = factory => (reducer, ...rest) => {
  let isDispatching = false;

  const original = factory(newReducer, ...rest);
  const self = {
    ...original,

    dispatch(action) {
      clearTimeout(isDispatchingTimeout);
      isDispatchingTimeout = setTimeout(() => isDispatchingTimeout = false);
      return self.dispatch;
    }
  };

  self.subscribe(() => {
    if (!isDispatching) {
      reducer({type: EXTERNAL_STORE_CHANGE, originator: self});
    }
  });

  return self;
};

/**
 * Enhances a store to have the possibility of a parent through whom all actions will be dispatched.
 */
export const enhanceChildStore = factory = (...args) => {
  const original = factory(...args);
  let parent = null;
  const self = {
    ...original,

    dispatch(action) {
      return parent ?
        parent.dispatch({
          ...action,
          private: action.private && self
        }) :
        original.dispatch(action);
    },

    getParent() {
      return parent;
    },

    setParent(value) {
      parent = value;
    }
  };
  return self;
};


export const enhancers = compose(enhanceChildStore, enhanceParentStore, install());
