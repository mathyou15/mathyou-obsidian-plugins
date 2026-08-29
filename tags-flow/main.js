const { Plugin } = require("obsidian");
const { Prec, keymap } = require("@codemirror/view");

function moveByLine(view, dir, keepAnchor) {
  const sel = view.state.selection.main;
  const fromLine = view.state.doc.lineAt(sel.head);
  const col = sel.head - fromLine.from;

  const coords = view.coordsAtPos(sel.head);
  let next = null;

  if (coords) {
    const height = Math.max(coords.bottom - coords.top, 8);
    next = view.posAtCoords({
      x: coords.left,
      y: dir > 0 ? coords.bottom + height / 2 : coords.top - height / 2,
    });
  }

  if (next != null) {
    const jumped = view.state.doc.lineAt(next).number - fromLine.number;
    const skipped = dir > 0 ? jumped > 1 : jumped < -1;
    if (!skipped) {
      view.dispatch({
        selection: keepAnchor
          ? { anchor: sel.anchor, head: next }
          : { anchor: next },
        scrollIntoView: true,
      });
      return true;
    }
  }

  const targetNo = fromLine.number + dir;
  if (targetNo < 1 || targetNo > view.state.doc.lines) return false;

  const target = view.state.doc.line(targetNo);
  const pos = Math.min(target.from + col, target.to);
  view.dispatch({
    selection: keepAnchor
      ? { anchor: sel.anchor, head: pos }
      : { anchor: pos },
    scrollIntoView: true,
  });
  return true;
}

const caretKeymap = Prec.high(
  keymap.of([
    { key: "ArrowUp", run: (view) => moveByLine(view, -1, false), shift: (view) => moveByLine(view, -1, true) },
    { key: "ArrowDown", run: (view) => moveByLine(view, 1, false), shift: (view) => moveByLine(view, 1, true) },
  ])
);

module.exports = class TagsFlowPlugin extends Plugin {
  onload() {
    this.registerEditorExtension(caretKeymap);
  }
};
