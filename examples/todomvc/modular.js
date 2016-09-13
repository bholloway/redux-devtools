import {loop, isLoop, getEffect, getModel} from 'redux-loop/lib/loop';
import {batch, none} from 'redux-loop/lib/effects';

const imLoopDecoder = state =>
  state.toObject();

const imLoopEncoder = (state, value) => {
  const optimizeBatch = effects => {
    switch (effects.length) {
      case 0:
        return none();
      case 1:
        return effects[0];
      default:
        return batch(effects);
    }
  };

  const plainPrevState = state.toObject();
  const effects = Object.keys(plainPrevState)
    .map(key => plainPrevState[key])
    .reduce((reduced, prev) => reduced.concat(isLoop(prev) ? getEffect(prev) : []), []);

  return loop(
    state.merge(value),
    optimizeBatch(effects)
  );
};

const loopDecoder = state => state;

const loopEncoder = (state, value) => {
  const optimizeBatch = effects => {
    switch (effects.length) {
      case 0:
        return none();
      case 1:
        return effects[0];
      default:
        return batch(effects);
    }
  };

  const effects = Object.keys(state)
    .map(key => state[key])
    .reduce((reduced, prev) => reduced.concat(isLoop(prev) ? getEffect(prev) : []), []);

  return loop(
    value,
    optimizeBatch(effects)
  );
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

const invokeModuleFactory = fn => key => {
  let result;

  // expect function
  if (typeof fn !== 'function') {
    throw new Error(`Implementation of module ${key} must be a factory function`);
  }

  // invoke function
  try {
    result = fn(key);
  } catch (error) {
    error.message = `Error invoking factory function for key ${key}\n${error.message}`;
    throw error;
  }

  // validate the resultant
  if (typeof result !== 'object') {
    throw new Error(`Invalid Module: Factory for module ${key} must return object`);
  }
  if (!isStringOrSymbol(result.provides)) {
    throw new Error(`Invalid Module: Factory for module ${key} must yield 
      {provides:String|Symbol}`);
  }
  if (!isArrayOfStringOrSymbol(result.requires)) {
    throw new Error(`Invalid Module: Factory for module ${key} must yield 
      {requires:Array.<String|Symbol>}`);
  }
  if (typeof result.reducer !== 'function') {
    throw new Error(`Invalid Module: Factory for module ${key} must yield 
      {reducer:Function}`);
  }

  return result;
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
        return module.requires.every(notInArray(remainingProvides));
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
    .reduce((reduced, module) => reduced.concat(module.requires), [])
    .filter(firstOccurrence)
    .filter(requirement => !(requirement in modulesByProvides));

  return {sortedModules, unmetDependencies};
};

const censorState = (module, state) =>
  [].concat(module.requires).concat(module.provides)
    .reduce((reduced, key) => ({...reduced, [key]: state[key]}), {});

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
          const censoredState = ENV_PRODUCTION ?
            reduced :
            Object.freeze(censorState(module, reduced));
          return {
            ...reduced,
            [module.provides]: module.reducer(censoredState, action)
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
            ...(ENV_PRODUCTION ? definition : invokeModuleFactory(definition))(key),
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
console.log('~~~REDUCING~~~~');
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
