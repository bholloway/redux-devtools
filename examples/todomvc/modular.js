import React from 'react';
import { loop, isLoop, getEffect, getModel } from 'redux-loop/lib/loop';
import { batch, none } from 'redux-loop/lib/effects';
import storeShape from 'react-redux/lib/utils/storeShape';

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
    const effects = Object.keys(value)
      .reduce((reduced, k) => {
        const v = value[k];
        return reduced.concat(isLoop(v) ? getEffect(v) : []);
      }, []);

    const plain = Object.keys(value)
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
    const effects = Object.keys(value)
      .reduce((reduced, k) => {
        const v = value[k];
        return reduced.concat(isLoop(v) ? getEffect(v) : []);
      }, []);

    const plain = Object.keys(value)
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

const ensureFunction = (object, field, defaultValue) => {
  const isValid = !!object && (typeof object === 'object') && (typeof object[field] === 'function');
  return isValid ? object[field] : defaultValue;
};

const passThrough = x => x;

const notInArray = array => value =>
  (array.indexOf(value) < 0);

const firstOccurrence = (value, i, array) =>
  (array.indexOf(value) === i);

const isStringOrSymbol = value =>
  ((typeof value === 'string') || (typeof value === 'symbol'));

const isArrayOfStringOrSymbol = value =>
  (Array.isArray(value) && value.every(isStringOrSymbol));

const isObject = value =>
  (!!value && (typeof value === 'object'));

const isFunction = value =>
  (typeof value === 'function');

const matchModule = definitionOrKey => module =>
  ((module.key === definitionOrKey) || (module.definition === definitionOrKey));

const assertModule = (candidate) => {
  const prefix = `Invalid Module: ${candidate}:`;

  // validate the resultant
  if (!isObject(candidate)) {
    throw new Error(`${prefix} Expected object saw ${typeof candidate}`);
  }

  // mandatory
  if (!isFunction(candidate.reducer)) {
    throw new Error(`${prefix} Expected {reducer:Function}`);
  }

  // optional
  if (('provides' in candidate) && !isStringOrSymbol(candidate.provides)) {
    throw new Error(`${prefix} Expected optional {provides:String|Symbol}`);
  }
  if (('depends' in candidate) && !isArrayOfStringOrSymbol(candidate.depends)) {
    throw new Error(`${prefix} Expected optional {depends:Array.<String|Symbol>}`);
  }
  if (('api' in candidate) && !isObject(candidate.api)) {
    throw new Error(`${prefix} Expected optional {api:Object}`);
  }
};

const sortModules = (modulesByKey) => {

  // sort modules such that earlier modules satisfy the dependencies of later modules
  const remainingProvides = Object.keys(modulesByKey);
  const sortedProvides = [];
  let pendingProvides;
  do {
    // find a list of modules that don't depend on any others in the remaining list
    pendingProvides = remainingProvides
      .filter((provide) => {
        const module = modulesByKey[provide];
        return !module.depends || module.depends.every(notInArray(remainingProvides));
      });

    // remove from remaining list
    pendingProvides
      .forEach(provide => remainingProvides.splice(remainingProvides.indexOf(provide), 1));

    // add to the sorted list
    sortedProvides.push(...pendingProvides);

  } while (pendingProvides.length);

  // circular dependencies
  if (remainingProvides.length) {
    throw new Error(`Invalid Circular Dependency: ${remainingProvides.join(', ')}`);
  }

  // final sorted list of modules
  const sortedModules = sortedProvides
    .map(provide => modulesByKey[provide]);

  // determine any dependency not met by the modules themselves
  const externalDependencies = sortedModules
    .reduce((reduced, module) => reduced.concat(module.depends), [])
    .filter(firstOccurrence)
    .filter(requirement => !(requirement in modulesByKey));

  return { sortedModules, externalDependencies };
};

const pickStateAndApiFromModules = modulesByKey => (inheritedDeps, state, keyList) =>
  keyList.reduce((reduced, key) => ({
    ...reduced,
    [key]: (key in state) ? { ...modulesByKey[key].api, ...state[key] } : inheritedDeps[key]
  }), {});

const createModuleReducer = (modules, stateCodec) => {
  const decodeState = ensureFunction(stateCodec, 'decode', passThrough);
  const encodeState = ensureFunction(stateCodec, 'encode', passThrough);

  // hash modules by their key
  const modulesByKey = modules
    .reduce((reduced, module) => ({
      ...reduced,
      [module.key]: module
    }), {});

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
    return {
      externalDependencies,
      moduleReducer: (state, action, inheritedDeps = {}) => {

        // convert native state to plain state
        const plainPrevState = decodeState(state);

        // run the reducer over all modules
        const plainNextState = sortedModules
          .reduce((reduced, module) => {
            const { key, depends, reducer } = module;
            const partialNewState = reducer(
              reduced[key],
              action,
              pickStateAndApi(inheritedDeps, reduced, depends)
            );
            return {
              ...reduced,
              [key]: partialNewState
            };
          }, plainPrevState);

        // convert plain state to native state
        return encodeState(state, plainNextState);
      }
    };
  }
};

const modularFactory = (store, stateCodec) => {
  const decodeState = ensureFunction(stateCodec, 'decode', passThrough);

  const getPseudoStore = (initialReducer = passThrough, parent = store, path = []) => {
    let baseReducer = initialReducer;
    const modules = [];
    let cache;

    const validate = () => {
      cache = cache || createModuleReducer(modules, stateCodec);
      return cache;
    };

    const reducer = (state, action, inheritedDeps = {}) => {
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
      parent.replaceReducer(reducer);
    };

    const invalidateModules = () => {
      cache = null;
      invalidateReducer();
    };

    const self = {
      replaceReducer: (candidate) => {
        const validated = (typeof candidate === 'function') ? candidate : undefined;
        if (baseReducer !== validated) {
          baseReducer = validated;
          invalidateReducer();
        }
      },

      subscribe(handler) {
        return store.subscribe(handler);
      },

      dispatch(event) {
        // TODO routing
        return store.dispatch(event);
      },

      getState() {
        // TODO support deep paths
        const object = decodeState(store.getState());
        return path.length ? object[path[0]] : object;
      },

      getModule: definitionOrKey =>
        modules.find(matchModule(definitionOrKey)),

      addModule: (definition) => {
        const existing = self.getModule(definition);

        // return any existing module
        if (existing) {
          return existing;
        }
        // otherwise create a module
        else {
          // check the module in development
          if (!ENV_PRODUCTION) {
            assertModule(definition);
          }

          // key needs to be specified now to tie the pseudoStore to the module
          const key = definition.provides || Symbol('private-module');

          // the module api is like a sub-store
          const { reducer: childReducer, pseudoStore } = getPseudoStore(
            definition.reducer,
            self,
            path.concat(key)
          );

          // the modules list contains private information in addition to the definition
          modules.push({
            key,
            definition,
            depends: definition.depends || [],
            api: definition.api || {},
            reducer: childReducer
          });
          invalidateModules();

          return pseudoStore;
        }
      },

      removeModule: (definitionOrKey) => {
        const index = modules.findIndex(matchModule(definitionOrKey));
        if (index >= 0) {
          modules.splice(index, 1);
          invalidateModules();
        }
      }
    };

    return { reducer, pseudoStore: self };
  };

  return getPseudoStore;
};

export const modularEnhancer = stateCodec => factory => (reducer, ...rest) => {
  const store = factory(passThrough, ...rest);
  const { pseudoStore } = modularFactory(store, stateCodec)(reducer);
  return {
    ...store,
    ...pseudoStore
  };
};

export const Module = (WrappedComponent, module) => {
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
      const hasModule = store.getModule(module.provides);
      if (!hasModule) {
        this.module = store.addModule(module);
      }
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
