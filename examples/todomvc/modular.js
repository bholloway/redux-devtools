import React from 'react';
import PropTypes from 'prop-types';
import { loop, isLoop, getEffect, getModel } from 'redux-loop/lib/loop';
import { batch, none } from 'redux-loop/lib/effects';
import storeShape from 'react-redux/lib/utils/storeShape';

PropTypes.symbol = (props, propName) => {
  const value = props[propName];
  const isValid = (typeof value === 'symbol') || /^Symbol\(.*\)$/.test(String(value));
  return isValid ? null : new Error(`Invalid ${propName} of type ${typeof value}, expected symbol`);
};

const keys = object => []
  .concat(Object.getOwnPropertyNames(object))
  .concat(Object.getOwnPropertySymbols(object));

export const optimizeBatch = (effects) => {
  switch (effects.length) {
    case 0:
      return none();
    case 1:
      return effects[0];
    default:
      return batch(effects);
  }
};

export const imLoopCodec = {
  decode: state => state,
  encode: (state, value) => {
    const effects = keys(value)
      .reduce((reduced, k) => {
        const v = value[k];
        return reduced.concat(isLoop(v) ? getEffect(v) : []);
      }, []);

    const plain = keys(value)
      .reduce((reduced, k) => {
        const v = value[k];
        return {
          ...reduced,
          [k]: isLoop(v) ? getModel(v) : v
        };
      }, {});

    return loop(
      state.merge(plain),
      optimizeBatch(effects)
    );
  }
};

export const loopCodec = {
  decode: state => state,
  encode: (state, value) => {
    const effects = keys(value)
      .reduce((reduced, k) => {
        const v = value[k];
        return reduced.concat(isLoop(v) ? getEffect(v) : []);
      }, []);

    const plain = keys(value)
      .reduce((reduced, k) => {
        const v = value[k];
        return {
          ...reduced,
          [k]: isLoop(v) ? getModel(v) : v
        };
      }, {});

    return loop(
      plain,
      optimizeBatch(effects)
    );
  }
};

// --------------------

const ENV_PRODUCTION = (process.env.NODE_ENV === 'production');

const getFnInObject = (object) => {
  const isObject = !!object && (typeof object === 'object');
  return (field, defaultValue) => {
    const isValid = isObject && (typeof object[field] === 'function');
    return isValid ? object[field] : defaultValue;
  };
};

const passThrough = x => x;

const noop = () => {};

const notInArray = (array, ignored) => value =>
  (([].concat(array).indexOf(value) < 0) || ([].concat(ignored).indexOf(value) >= 0));

const firstOccurrence = (value, i, array) =>
  (array.indexOf(value) === i);

const matchModule = candidate => module =>
  ([module.key, module.definition].indexOf(candidate) >= 0);

/**
 * Throw errors for candidate not matching the given specification.
 *
 * @param {string} [prefix] Optional prefix for errors
 * @param {object} specification A hash of fields and their PropTypes
 * @returns {function} A test method that throws where the candidate does meet specification
 */
const getShapeAssert = (prefix, specification) =>
  /**
   * Asserts that the given candidate is a valid module.
   * @throws {Error} On invalid module
   * @param {*} candidate A possible module
   */
  ((candidate) => {
    try {
      if (!candidate || (typeof candidate !== 'object')) {
        throw new Error('expected object');
      } else {
        PropTypes.validateWithErrors(specification, candidate);
      }
    } catch (error) {
      const message = error.message.replace(' supplied to `<<anonymous>>`', '');
      throw new Error(`${prefix || ''}${message}`);
    }
  });

/**
 * Sort modules such that earlier modules satisfy the dependencies of later modules.
 *
 * Dependencies that are not provided by the given modules are considered to be external.
 *
 * @param {Map} modulesByKey A map of modules keyed by their 'provide' field
 * @returns {{sortedModules: Array, externalDependencies: Array.<string>}}
 */
const sortModules = (modulesByKey) => {
  const remainingKeys = keys(modulesByKey);
  const sortedKeys = [];
  let pendingKeys;
  do {
    // find a list of modules that don't depend on any others in the remaining list
    pendingKeys = remainingKeys
      .filter(key => modulesByKey[key].depends.every(notInArray(remainingKeys, key)));

    // remove from remaining list
    pendingKeys
      .forEach(key => remainingKeys.splice(remainingKeys.indexOf(key), 1));

    // add to the sorted list
    sortedKeys.push(...pendingKeys);

  } while (pendingKeys.length);

  // circular dependencies
  if (remainingKeys.length) {
    throw new Error(`Invalid Circular Dependency: ${remainingKeys.join(', ')}`);
  }

  // final sorted list of modules
  const sortedModules = sortedKeys
    .map(key => modulesByKey[key]);

  // determine any dependency not met by the modules themselves
  const externalDependencies = sortedModules
    .reduce((reduced, module) => reduced.concat(module.depends), [])
    .filter(firstOccurrence)
    .filter(dependency => !(dependency in modulesByKey));

  return { sortedModules, externalDependencies };
};


/**
 * For a given hash of modules, create a method that will pick state and api for a set of keys.
 *
 * @param {Map} modulesByKey A map of modules keyed by their 'provide' field
 * @returns {function} A pick function
 */
const pickStateAndApiFromModules = modulesByKey =>
  /**
   * A pick function
   * @param {string} inherits A single key which should favor inherited dependencies only
   * @param {Array.<string>} keyList A whitelist of keys which will be included
   * @param {object} inheritedDeps A hash of inherited dependencies that may be reused
   * @param {object} currentState The current state, without any API mixed in
   */
  ((inherits, keyList, inheritedDeps, currentState) =>
    keyList.reduce((reduced, key) => {
      const current = { ...modulesByKey[key].api, state: currentState[key] };
      const inherited = inheritedDeps[key];
      const useCurrent = (key !== inherits) && ((key in currentState) || !(key in inheritedDeps));
      const final = useCurrent ? current : inherited;
      return { ...reduced, [key]: final };
    }, {}));


/**
 * Create a pseudo-store that allows 'ducks' modules to be added to and removed from the reducer.
 *
 * @param {{replaceReducer:function, subscribe:function, dispatch:function, getState:function}}
 *  store A redux store
 * @param {{decode:function, encode:function, [get:function]}} [stateCodec] Optional methods that
 *  decode state to plain objects and encode a plain object to state
 * @returns {reducer:function, pseudoStore:{replaceReducer:function, subscribe:function,
 *  dispatch:function, getState:function, getModule:function, addModule:function,
 *  removeModule:function}}
 */
const modularFactory = (store, stateCodec) => {

  // determine codecs
  const getCodecFn = getFnInObject(stateCodec);
  const decodeState = getCodecFn('decode', passThrough);
  const encodeState = getCodecFn('encode', passThrough);
  const pickState = getCodecFn('get', (state, k) => decodeState(state)[k]);

  // get a validator for module shape but short circuit validation for production
  const assertModule = (ENV_PRODUCTION) ? noop : getShapeAssert('Invalid Module: ', {
    reducer: PropTypes.func.isRequired,
    provides: PropTypes.oneOfType([PropTypes.string, PropTypes.symbol]),
    depends: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.symbol])),
    api: PropTypes.objectOf(PropTypes.func)
  });

  // curry the reducer factory
  const getModuleReducer = (modules) => {

    // hash modules by their key
    const modulesByKey = modules
      .reduce((reduced, module) => ({ ...reduced, [module.key]: module }), {});

    // mix state and api for dependencies
    const pickStateAndApi = pickStateAndApiFromModules(modulesByKey);

    // sort modules such that earlier modules satisfy the dependencies of later modules
    const { sortedModules, externalDependencies } = sortModules(modulesByKey);

    // optimise the degenerate case
    if (!sortedModules.length) {
      return {
        externalDependencies,
        moduleReducer: passThrough
      };
    }
    // with any modules we need to transcode state before and after
    else {
      const moduleReducer = (state, action, inheritedDeps = {}) => {

        // optimisations require us to track whether any reducers were actually called
        let hasReduced = false;

        // routing is supported
        const [routeTip, ...routeRest] =
          Array.isArray(action.routing) ? action.routing.slice() : [];

        // convert native state to plain state
        const plainPrevState = decodeState(state);

        // run the reducer over all modules
        const plainNextState = sortedModules
          .reduce((reduced, module) => {
            const { key, depends, reducer } = module;

            // reduce only where something to the left has reduced or where routing dictates
            const doReduce = hasReduced || !routeTip || (key === routeTip);
            if (doReduce) {
              hasReduced = true;

              // run the reducer
              const partialNewState = reducer(
                reduced[key],
                { ...action, routing: routeRest },
                pickStateAndApi(key, depends, inheritedDeps, reduced)
              );

              // merge the result
              return {
                ...reduced,
                [key]: partialNewState
              };
            }
            // skipped
            else {
              return reduced;
            }
          }, plainPrevState);

        // convert plain state to native state
        return hasReduced ? encodeState(state, plainNextState) : state;
      };

      return { externalDependencies, moduleReducer };
    }
  };

  const getPseudoStore = (initialReducer = passThrough, recursive) => {

    // internal state
    const modules = [];
    let baseReducer = initialReducer;
    let cache;
    let isDestroying;

    const validate = () => {
      cache = cache || getModuleReducer(modules);
      return cache;
    };

    const combinedReducer = (state, action, inheritedDeps = {}) => {
      const { moduleReducer, externalDependencies } = validate();

      // run the base reducer (where present)
      const baseState = baseReducer ? baseReducer(state, action, inheritedDeps) : state;

      // check for missing externs unless in production
      if (!ENV_PRODUCTION) {
        const missingDependencies = externalDependencies
          .filter(field => !(field in inheritedDeps) && !(field in baseState));

        if (missingDependencies.length) {
          throw new Error(`Missing dependencies: The initial state or baseReducer 
                  must provide external dependencies ${missingDependencies.join(', ')}`);
        }
      }

      // now run the module reducer
      return moduleReducer(baseState, action, inheritedDeps);
    };

    const invalidateReducer = () => {
      if (!isDestroying) {
        if (recursive) {
          recursive.invalidate();
        } else {
          store.replaceReducer(combinedReducer);
        }
      }
    };

    const invalidateModules = () => {
      cache = null;
      invalidateReducer();
    };

    const replaceReducer = (candidate) => {
      const validated = (typeof candidate === 'function') ? candidate : undefined;
      if (baseReducer !== validated) {
        baseReducer = validated;
        invalidateReducer();
      }
    };

    const subscribe = store.subscribe;

    const dispatch = (action) => {
      if (recursive) {
        const deeperPath = Array.isArray(action.routing) ? action.routing : [];
        const routing = !!action.routing && [recursive.key, ...deeperPath];
        return recursive.dispatch({ ...action, routing });
      } else {
        return store.dispatch(action);
      }
    };

    const getState = () =>
      (recursive ? pickState(recursive.getState(), recursive.key) : store.getState());

    const createModule = (definition) => {

      // check module
      assertModule(definition);
      const { reducer, provides, depends, api } = definition;

      // key needs to be specified now to tie the pseudoStore to the module
      const key = provides || Symbol('private-module');

      // wrap the reducer in the same modular api
      const child = getPseudoStore(reducer, {
        key,
        invalidate: invalidateReducer,
        dispatch,
        getState
      });

      // the modules list contains private information in addition to the definition
      return {
        key,
        definition,
        ...child,
        depends: depends || [],
        api: api || {}
      };
    };

    const destroyModule = (module) => {
      isDestroying = true;
      module.pseudoStore.removeAllModules();
      isDestroying = false;
    };

    const getModule = definitionOrKey =>
      modules.find(matchModule(definitionOrKey));

    const addModule = (definition) => {
      const existing = getModule(definition);

      // return any existing module
      if (existing) {
        return existing;
      }
      // otherwise create a module
      else {
        const module = createModule(definition);
        modules.push(module);
        invalidateModules();
        return module.pseudoStore;
      }
    };

    const removeModule = (definitionOrKey) => {
      const index = modules.findIndex(matchModule(definitionOrKey));
      if (index >= 0) {
        destroyModule(modules.splice(index, 1).pop());
        invalidateModules();
      }
    };

    const removeAllModules = () => {
      while (modules.length) {
        destroyModule(modules.pop());
      }
      invalidateModules();
    };

    // ensure the reducer is installed in the store
    invalidateReducer();

    return {
      reducer: combinedReducer,
      pseudoStore: {
        replaceReducer,
        subscribe,
        dispatch,
        getState,
        getModule,
        addModule,
        removeModule,
        removeAllModules
      }
    };
  };

  return getPseudoStore;
};


/**
 * Create a store enhancer for modular reducers.
 *
 * @param {{decode:function, encode:function, [get:function]}} [stateCodec] Optional methods that
 *  decode state to plain objects and encode a plain object to state
 * @returns {function} Redux store enhancer
 */
export const modularEnhancer = stateCodec => factory => (reducer, ...rest) => {
  const store = factory(passThrough, ...rest);
  const modular = modularFactory(store, stateCodec)(reducer);
  return {
    ...store,
    ...modular.pseudoStore
  };
};


export const Module = module => (WrappedComponent) => {
  const GetModuleWrappedComponent = React.createClass({
    propTypes: {
      ...WrappedComponent.propTypes,
    },

    contextTypes: {
      store: storeShape
    },

    childContextTypes: {
      store: storeShape
    },

    getChildContext() {
      return {
        store: this.module
      };
    },

    componentWillMount() {
      const { store } = this.context;
      this.module = store.getModule(module) || store.addModule(module);
    },

    toString() {
      return `Module(${WrappedComponent})`;
    },

    render() {
      return React.createElement(WrappedComponent, this.props);
    }
  });

  GetModuleWrappedComponent.toString = () =>
    `Module(${WrappedComponent})`;

  return GetModuleWrappedComponent;
};
