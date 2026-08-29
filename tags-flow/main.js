const { Plugin } = require("obsidian");
const { ViewPlugin } = require("@codemirror/view");
const { EditorSelection, EditorState } = require("@codemirror/state");

const RENDERED_TAG_PATTERN =
  String.raw`\(\((?:<?tag[|/]|[<~]?[a-zа-яё-]+\|)(?<label>[^|/)\n]+)(?:[|/][^|/)\n]*){0,2}\)\)`;

function positionOnRenderedTag(line, column) {
  const desired = Math.min(column, line.length);
  const regex = new RegExp(RENDERED_TAG_PATTERN, "gi");
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

const pendingNavigation = new WeakMap();

const navigationProbe = ViewPlugin.fromClass(
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

        const line = view.state.doc.lineAt(view.state.selection.main.head);
        pendingNavigation.set(view.state, {
          direction: event.key === "ArrowDown" ? 1 : -1,
          extend: event.shiftKey,
          singleVisualRow: isSingleVisualRow(view, line),
        });

        setTimeout(() => pendingNavigation.delete(view.state), 0);
      };
      view.dom.addEventListener("keydown", this.onKeyDown, true);
    }

    destroy() {
      this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
    }
  }
);

const navigationFilter = EditorState.transactionFilter.of((transaction) => {
  const navigation = pendingNavigation.get(transaction.startState);
  if (!navigation || transaction.docChanged) return transaction;
  pendingNavigation.delete(transaction.startState);

  const { doc, selection } = transaction.startState;
  const ranges = selection.ranges.map((range, index) => {
    const native =
      transaction.newSelection.ranges[index] || transaction.newSelection.main;
    const currentLine = doc.lineAt(range.head);
    const targetNumber = currentLine.number + navigation.direction;
    if (targetNumber < 1 || targetNumber > doc.lines) return native;

    const adjacentLine = doc.line(targetNumber);
    if (!new RegExp(RENDERED_TAG_PATTERN, "i").test(adjacentLine.text)) {
      return native;
    }

    const nativeLine = doc.lineAt(native.head);
    if (
      nativeLine.number === currentLine.number &&
      !navigation.singleVisualRow
    ) {
      return native;
    }

    const column = range.head - currentLine.from;
    const head = positionOnRenderedTag(adjacentLine, column);
    return navigation.extend
      ? EditorSelection.range(range.anchor, head)
      : EditorSelection.cursor(head);
  });

  const corrected = EditorSelection.create(ranges, selection.mainIndex);
  if (corrected.eq(transaction.newSelection)) return transaction;

  return [
    transaction,
    {
      sequential: true,
      selection: corrected,
      scrollIntoView: true,
    },
  ];
});

module.exports = class TagsFlowPlugin extends Plugin {
  onload() {
    this.registerEditorExtension([navigationProbe, navigationFilter]);
  }
};
