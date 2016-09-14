import React from 'react';
import {loop, isLoop, getEffect, getModel} from 'redux-loop/lib/loop';
import {batch, none} from 'redux-loop/lib/effects';
import storeShape from 'react-redux/lib/utils/storeShape';

export const optimizeBatch = effects => {
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
        return reduced.concat(isLoop(v) ? getEffect(v) : [])
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
        return reduced.concat(isLoop(v) ? getEffect(v) : [])
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

const validateModule = module => {

  // validate the resultant
  if (typeof module !== 'object') {
    throw new Error(`Invalid Module: Expected object`);
  }
  if (!isStringOrSymbol(module.provides)) {
    throw new Error(`Invalid Module: Expected {provides:String|Symbol}`);
  }
  if (('depends' in module) && !isArrayOfStringOrSymbol(module.depends)) {
    throw new Error(`Invalid Module: Expected {depends:Array.<String|Symbol>}`);
  }
  if (typeof module.reducer !== 'function') {
    throw new Error(`Invalid Module: Expected {reducer:Function}`);
  }

  return module;
};

const sortModules = modules => {

  // hash modules by the field they provide
  const modulesByProvides = modules
    .reduce((reduced, module) => ({
      ...reduced,
      [module.provides]: module
    }), {});

  // sort modules such that earlier modules satisfy the dependencies of later modules
  const remainingProvides = Object.keys(modulesByProvides);
  const sortedProvides = [];
  let pendingProvides;
  do {
    // find a list of modules that don't depend on any others in the remaining list
    pendingProvides = remainingProvides
      .filter(provide => {
        const module = modulesByProvides[provide];
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
    throw new Error(`Invalid Circular Dependency: ${remainingProvides.join(', ')}`)
  }

  // final sorted list of modules
  const sortedModules = sortedProvides
    .map(provide => modulesByProvides[provide]);

  // determine any required dependency not met by the provided dependencies
  const unmetDependencies = sortedModules
    .reduce((reduced, module) => reduced.concat(module.depends || []), [])
    .filter(firstOccurrence)
    .filter(requirement => !(requirement in modulesByProvides));

  return {sortedModules, unmetDependencies};
};

const censorState = (fieldList, state) =>
  Object.freeze(fieldList.reduce((reduced, k) => ({...reduced, [k]: state[k]}), {}));

const createGraphReducer = (sortedModules, stateCodec) => {
  if (!sortedModules.length) {
    return passThrough;
  }
  else {
    const decodeState = ensureFunction(stateCodec, 'decode', passThrough);
    const encodeState = ensureFunction(stateCodec, 'encode', passThrough);

    return (state, action) => {
      const plainPrevState = decodeState(state);
      const plainNextState = sortedModules
        .reduce((reduced, module) => {
          const censoredState =
            !module.depends ? undefined :
              ENV_PRODUCTION ? reduced :
                censorState(module.depends, reduced);
          return {
            ...reduced,
            [module.provides]: module.reducer(reduced[module.provides], action, censoredState)
          };
        }, plainPrevState);
      return encodeState(state, plainNextState);
    };
  }
};

// define modules privately
const modularReducerFactory = (modules = []) => {
  const {sortedModules, unmetDependencies} = sortModules(modules);

  // define state codecs publicly
  return (stateCodec) => {
    const graphReducer = createGraphReducer(sortedModules, stateCodec);

    // define base reducer publicly
    const withBaseReducer = baseReducer => {

      // redefine private modules with the same codecs and baseReducer
      const withModules = newModules =>
        modularReducerFactory(newModules)(stateCodec)(baseReducer);

      // we will give the existing instance for any degenerate operation
      const self = {
        replaceReducer(value) {
          const validated = (typeof value === 'function') ? value : undefined;
          const isDegenerate = (baseReducer === validated) || (!baseReducer && !validated);
          return isDegenerate ? self : withBaseReducer(validated);
        },

        getModule(key) {
          return (modules.find(module => (module.key === key)) || {}).definition;
        },

        addModule(key, definition) {
          const isDegenerate = !!self.getModule(key);
          return isDegenerate ? self : withModules(modules.concat({
            ...(ENV_PRODUCTION ? definition : validateModule(definition)),
            key,
            definition
          }));
        },

        removeModule(key) {
          const remainingModules = modules.filter(module => (module.key !== key));
          const isDegenerate = (remainingModules.length === modules.length);
          return isDegenerate ? self : withModules(remainingModules);
        },

        reducer(state, action) {

          // run the base reducer where present
          const baseState = baseReducer ? baseReducer(state, action) : state;

          // check for missing externs unless in production
          if (!ENV_PRODUCTION) {
            const missingExterns = unmetDependencies
              .filter(field => !(field in baseState));

            if (missingExterns.length) {
              throw new Error(`Missing dependencies: The initial state or baseReducer 
                must provide ${missingExterns.join(', ')}`);
            }
          }

          // run the modules
          return graphReducer(baseState, action);
        }
      };

      return self;
    };

    return withBaseReducer;
  };
};

export const modularReducer = modularReducerFactory();

export const modularEnhancer = stateCodec => {
  const wrapReducer = modularReducer(stateCodec);

  return factory => (reducer, ...rest) => {
    let modularInterface = wrapReducer(reducer);
    const original = factory(modularInterface.reducer, ...rest);

    return {
      ...original,

      ...['getModule']
        .reduce((reduced, methodName) => ({
          ...reduced,
          [methodName]: (...args) => modularInterface[methodName](...args)
        }), {}),

      ...['replaceReducer', 'addModule', 'removeModule']
        .reduce((reduced, methodName) => ({
          ...reduced,
          [methodName]: (...args) => {
            modularInterface = modularInterface[methodName](...args);
            original.replaceReducer(modularInterface.reducer);
          }
        }), {})
    };
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
      }
    },

    componentWillMount() {
      const {store} = this.context;
      const hasModule = store.getModule(module.provides);
      if (!hasModule) {
        console.log('!!!!CREATE!!!!');
        store.addModule(module.provides, module);
        this.module = store;
      } else {
        console.log('!!!!CREATE (unnecessary)!!!!')
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