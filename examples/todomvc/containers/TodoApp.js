import React, {Component} from 'react';
import {connect} from 'react-redux';
import {bindActionCreators} from 'redux';
import Header from '../components/Header';
import MainSection from '../components/MainSection';

import * as todoModule from '../modules/todo';
import {Module} from '../modular';

class TodoApp extends Component {
  render() {
    const {todos, actions} = this.props;

    return (
      <div>
        <Header addTodo={actions.addTodo} />
        <MainSection todos={todos} actions={actions} />
      </div>
    );
  }
}

function mapState(state) {
  return {
    todos: state.todos
  };
}

function mapDispatch(dispatch) {
  return {
    actions: bindActionCreators(todoModule.actions, dispatch)
  };
}

export default Module(
  connect(mapState, mapDispatch)(TodoApp),
  todoModule
);
