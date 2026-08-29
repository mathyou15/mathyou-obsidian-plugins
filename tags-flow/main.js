const { Plugin } = require("obsidian");
const { keymap } = require("@codemirror/view");
const { EditorSelection, Prec } = require("@codemirror/state");

function moveByDocumentLine(view, direction, extend) {
  const { doc, selection } = view.state;
  let moved = false;

  const ranges = selection.ranges.map((range) => {
    const currentLine = doc.lineAt(range.head);
    const targetNumber = currentLine.number + direction;
    if (targetNumber < 1 || targetNumber > doc.lines) return range;

    const targetLine = doc.line(targetNumber);
    const column = range.head - currentLine.from;
    const head = Math.min(targetLine.from + column, targetLine.to);
    moved = true;

    return extend
      ? EditorSelection.range(range.anchor, head)
      : EditorSelection.cursor(head);
  });

  if (!moved) return false;

  view.dispatch({
    selection: EditorSelection.create(ranges, selection.mainIndex),
    scrollIntoView: true,
    userEvent: extend ? "select" : "select.pointer",
  });
  return true;
}

const caretKeymap = Prec.high(
  keymap.of([
    {
      key: "ArrowUp",
      run: (view) => moveByDocumentLine(view, -1, false),
      shift: (view) => moveByDocumentLine(view, -1, true),
    },
    {
      key: "ArrowDown",
      run: (view) => moveByDocumentLine(view, 1, false),
      shift: (view) => moveByDocumentLine(view, 1, true),
    },
  ])
);

module.exports = class TagsFlowPlugin extends Plugin {
  onload() {
    this.registerEditorExtension(caretKeymap);
  }
};
