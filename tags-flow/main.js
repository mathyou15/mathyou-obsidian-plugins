const { Plugin } = require("obsidian");
const { ViewPlugin } = require("@codemirror/view");
const { EditorSelection } = require("@codemirror/state");

const MARKDOWN_TAG = /\(\(<?tag(?:[|/])/i;

function moveVertically(view, direction, extend) {
  const { doc, selection } = view.state;
  const forward = direction > 0;
  const ranges = selection.ranges.map((range) => {
    if (!extend && !range.empty) {
      return EditorSelection.cursor(forward ? range.to : range.from);
    }

    const native = view.moveVertically(range, forward);
    const currentLine = doc.lineAt(range.head);
    const targetNumber = currentLine.number + direction;
    let head = native.head;

    if (targetNumber >= 1 && targetNumber <= doc.lines) {
      const nativeLine = doc.lineAt(native.head);
      const adjacentLine = doc.line(targetNumber);
      const skippedAdjacent =
        Math.abs(nativeLine.number - currentLine.number) > 1 &&
        MARKDOWN_TAG.test(adjacentLine.text);

      if (skippedAdjacent) {
        const column = range.head - currentLine.from;
        head = Math.min(adjacentLine.from + column, adjacentLine.to);
      }
    }

    return extend
      ? EditorSelection.range(range.anchor, head)
      : EditorSelection.cursor(head);
  });

  view.dispatch({
    selection: EditorSelection.create(ranges, selection.mainIndex),
    scrollIntoView: true,
    userEvent: "select",
  });
}

const cursorGuard = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.onKeyDown = (event) => {
        if (
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          (event.key !== "ArrowUp" && event.key !== "ArrowDown")
        ) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        moveVertically(
          this.view,
          event.key === "ArrowDown" ? 1 : -1,
          event.shiftKey
        );
      };
      view.dom.addEventListener("keydown", this.onKeyDown, true);
    }

    destroy() {
      this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
    }
  }
);

module.exports = class TagsFlowPlugin extends Plugin {
  onload() {
    this.registerEditorExtension(cursorGuard);
  }
};
