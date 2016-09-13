import React, {Component, PropTypes} from 'react';
import todos from '../reducers/todos';
import storeShape from 'react-redux/lib/utils/storeShape';
import TodoItem from './TodoItem';
import Footer from './Footer';
import {SHOW_ALL, SHOW_MARKED, SHOW_UNMARKED} from '../constants/TodoFilters';

const TODO_FILTERS = {
  [SHOW_ALL]: () => true,
  [SHOW_UNMARKED]: todo => !todo.marked,
  [SHOW_MARKED]: todo => todo.marked
};

export default class MainSection extends Component {
  static propTypes = {
    todos: PropTypes.array,
    actions: PropTypes.object.isRequired
  };

  static contextTypes = {
    store: storeShape
  };

  constructor(props, context) {
    super(props, context);
    const hasModule = context.store.getModule('todos');
    if (!hasModule) {
console.log('!!!!CREATE!!!!!')
      context.store.addModule('todos', () => ({
        provides: 'todos',
        requires: [],
        reducer: todos
      }));
    }
    this.state = {filter: SHOW_ALL};
  }

  handleClearMarked() {
    const atLeastOneMarked = (this.props.todos || []).some(todo => todo.marked);
    if (atLeastOneMarked) {
      this.props.actions.clearMarked();
    }
  }

  handleShow(filter) {
    this.setState({filter});
  }

  render() {
    const {todos, actions} = this.props;
    const {filter} = this.state;

    const filteredTodos = (todos || []).filter(TODO_FILTERS[filter]);
    const markedCount = (todos || []).reduce((count, todo) =>
        todo.marked ? count + 1 : count,
      0
    );

    return (
      <section className='main'>
        {this.renderToggleAll(markedCount)}
        <ul className='todo-list'>
          {filteredTodos.map(todo =>
            <TodoItem key={todo.id} todo={todo} {...actions} />
          )}
        </ul>
        {this.renderFooter(markedCount)}
      </section>
    );
  }

  renderToggleAll(markedCount) {
    const {todos, actions} = this.props;
    if (todos && todos.length > 0) {
      return (
        <input className='toggle-all'
          type='checkbox'
          checked={markedCount === todos.length}
          onChange={actions.markAll} />
      );
    }
  }

  renderFooter(markedCount) {
    const {todos} = this.props;
    const {filter} = this.state;
    const unmarkedCount = todos ? (todos.length - markedCount) : 0;

    if (todos && todos.length) {
      return (
        <Footer markedCount={markedCount}
          unmarkedCount={unmarkedCount}
          filter={filter}
          onClearMarked={::this.handleClearMarked}
          onShow={::this.handleShow} />
      );
    }
  }
}
