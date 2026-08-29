const { Plugin } = require("obsidian");
const { Prec, keymap } = require("@codemirror/view");
const {
  cursorLineUp,
  cursorLineDown,
  selectLineUp,
  selectLineDown,
} = require("@codemirror/commands");

function withSkipGuard(command, dir) {
  return (view) => {
    const sel = view.state.selection.main;
    const fromLine = view.state.doc.lineAt(sel.head);
    const col = sel.head - fromLine.from;
    command(view);

    const toLine = view.state.doc.lineAt(view.state.selection.main.head);
    const jumped = toLine.number - fromLine.number;
    const skipped = dir > 0 ? jumped > 1 : jumped < -1;
    if (!skipped) return true;

    const targetNo = fromLine.number + dir;
    if (targetNo < 1 || targetNo > view.state.doc.lines) return true;

    const target = view.state.doc.line(targetNo);
    const pos = Math.min(target.from + col, target.to);
    view.dispatch({
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
    });
    return true;
  };
}

function withSkipGuardSelect(command, dir) {
  return (view) => {
    const sel = view.state.selection.main;
    const fromLine = view.state.doc.lineAt(sel.head);
    const col = sel.head - fromLine.from;
    const anchor = sel.anchor;
    command(view);

    const toLine = view.state.doc.lineAt(view.state.selection.main.head);
    const jumped = toLine.number - fromLine.number;
    const skipped = dir > 0 ? jumped > 1 : jumped < -1;
    if (!skipped) return true;

    const targetNo = fromLine.number + dir;
    if (targetNo < 1 || targetNo > view.state.doc.lines) return true;

    const target = view.state.doc.line(targetNo);
    const head = Math.min(target.from + col, target.to);
    view.dispatch({
      selection: { anchor, head },
      scrollIntoView: true,
    });
    return true;
  };
}

const caretKeymap = Prec.high(
  keymap.of([
    { key: "ArrowUp", run: withSkipGuard(cursorLineUp, -1), shift: withSkipGuardSelect(selectLineUp, -1) },
    { key: "ArrowDown", run: withSkipGuard(cursorLineDown, 1), shift: withSkipGuardSelect(selectLineDown, 1) },
  ])
);

module.exports = class TagsFlowPlugin extends Plugin {
  async onload() {
    this.registerEditorExtension(caretKeymap);
  }
};
