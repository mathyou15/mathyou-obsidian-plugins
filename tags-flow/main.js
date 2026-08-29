const { Plugin } = require("obsidian");
const { ViewPlugin } = require("@codemirror/view");
const { EditorSelection } = require("@codemirror/state");

const MARKDOWN_TAG_PATTERN =
  String.raw`\(\(<?tag(?:[|/])(?<label>[^|/)\n]+)(?:[|/][^|/)\n]*)?(?:[|/][^|/)\n]*)?\)\)`;

function positionOnRenderedTag(line, column) {
  const desired = Math.min(column, line.length);
  const regex = new RegExp(MARKDOWN_TAG_PATTERN, "gi");
  let match;

  while ((match = regex.exec(line.text)) !== null) {
    const label = match.groups?.label || "";
    const tagStart = match.index;
    const tagEnd = tagStart + match[0].length;
    const labelStart = tagStart + match[0].indexOf(label);
    const labelEnd = labelStart + label.length;

    if (desired >= tagStart && desired < labelStart) {
      return line.from + labelStart;
    }
    if (desired > labelEnd && desired <= tagEnd) {
      return line.from + labelEnd;
    }
  }

  return line.from + desired;
}

function isSingleVisualRow(view, line) {
  const start = view.coordsAtPos(line.from);
  const end = view.coordsAtPos(line.to);
  if (!start || !end) return true;
  return Math.abs(start.top - end.top) < 2;
}

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
      const adjacentHasTag = new RegExp(MARKDOWN_TAG_PATTERN, "i").test(
        adjacentLine.text
      );
      const singleVisualRow = isSingleVisualRow(view, currentLine);
      const enteringAdjacentTag =
        adjacentHasTag &&
        (nativeLine.number !== currentLine.number || singleVisualRow);

      if (enteringAdjacentTag) {
        const column = range.head - currentLine.from;
        head = positionOnRenderedTag(adjacentLine, column);
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
