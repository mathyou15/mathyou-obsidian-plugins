const { Plugin } = require("obsidian");
const { keymap } = require("@codemirror/view");
const { EditorSelection, Prec } = require("@codemirror/state");

function keepAdjacentDocumentLine(view, direction, extend) {
  const { doc, selection } = view.state;
  const forward = direction > 0;
  const nativeRanges = selection.ranges.map((range) =>
    view.moveVertically(range, forward)
  );

  const skipped = selection.ranges.map((range, index) => {
    const currentLine = doc.lineAt(range.head);
    const nativeLine = doc.lineAt(nativeRanges[index].head);
    return Math.abs(nativeLine.number - currentLine.number) > 1;
  });

  if (!skipped.some(Boolean)) return false;

  const ranges = selection.ranges.map((range, index) => {
    if (!skipped[index]) return nativeRanges[index];

    const currentLine = doc.lineAt(range.head);
    const targetNumber = currentLine.number + direction;
    if (targetNumber < 1 || targetNumber > doc.lines) return nativeRanges[index];
    const targetLine = doc.line(targetNumber);
    const column = range.head - currentLine.from;
    const head = Math.min(targetLine.from + column, targetLine.to);

    return extend
      ? EditorSelection.range(range.anchor, head)
      : EditorSelection.cursor(head);
  });

  view.dispatch({
    selection: EditorSelection.create(ranges, selection.mainIndex),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

const caretKeymap = Prec.highest(
  keymap.of([
    {
      key: "ArrowUp",
      run: (view) => keepAdjacentDocumentLine(view, -1, false),
      shift: (view) => keepAdjacentDocumentLine(view, -1, true),
    },
    {
      key: "ArrowDown",
      run: (view) => keepAdjacentDocumentLine(view, 1, false),
      shift: (view) => keepAdjacentDocumentLine(view, 1, true),
    },
  ])
);

module.exports = class TagsFlowPlugin extends Plugin {
  onload() {
    this.registerEditorExtension(caretKeymap);
  }
};
