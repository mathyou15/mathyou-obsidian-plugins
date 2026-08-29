const {
  Component,
  MarkdownRenderer,
  Notice,
  Plugin,
} = require("obsidian");
const {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} = require("@codemirror/view");
const { StateField } = require("@codemirror/state");

const CALLOUT_MARKER =
  /^(\s*(?:>\s*)+)\[!([^\]\s]+)[^\]]*\][+-]?(?:\s+.*)?$/i;

function quoteDepth(text) {
  const prefix = text.match(/^\s*(?:>\s*)+/)?.[0] || "";
  return (prefix.match(/>/g) || []).length;
}

function findActiveCallout(state) {
  const selection = state.selection.main;
  const candidates = [];

  for (let number = 1; number <= state.doc.lines; number += 1) {
    const markerLine = state.doc.line(number);
    if (!CALLOUT_MARKER.test(markerLine.text)) continue;

    const depth = quoteDepth(markerLine.text);
    let end = number;
    while (
      end < state.doc.lines &&
      quoteDepth(state.doc.line(end + 1).text) >= depth
    ) {
      end += 1;
    }

    const endLine = state.doc.line(end);
    const intersects =
      selection.to >= markerLine.from && selection.from <= endLine.to;
    if (!intersects) continue;

    const hasFollowingLine = end < state.doc.lines;
    candidates.push({
      depth,
      size: endLine.to - markerLine.from,
      startLine: number,
      markdown: state.doc.sliceString(markerLine.from, endLine.to),
      insertAt: hasFollowingLine ? endLine.to + 1 : endLine.to,
      side: hasFollowingLine ? -1 : 1,
    });
  }

  candidates.sort((left, right) => {
    return right.depth - left.depth || left.size - right.size;
  });
  return candidates[0] || null;
}

function livePreviewSuffix(lineElement) {
  if (!lineElement) return "";

  const formatting = Array.from(
    lineElement.querySelectorAll(".cm-formatting")
  );
  const formattingClasses = [
    "cm-formatting-strong",
    "cm-formatting-em",
    "cm-formatting-highlight",
    "cm-formatting-strikethrough",
    "cm-formatting-code",
  ];
  const openMarkers = [];

  for (const element of formatting) {
    const classes = formattingClasses.filter((className) =>
      element.classList.contains(className)
    );
    if (!classes.length) continue;

    const key = classes.join("|");
    const last = openMarkers.at(-1);
    if (last?.key === key) {
      openMarkers.pop();
    } else {
      openMarkers.push({ key, marker: element.textContent });
    }
  }

  return openMarkers
    .reverse()
    .map(({ marker }) => marker)
    .join("");
}

function applyLivePreviewFlags(markdown, view, startLine) {
  if (!view?.contentDOM) return markdown;

  const elementsByLine = new Map();
  for (const element of view.contentDOM.querySelectorAll(".cm-line")) {
    try {
      const position = view.posAtDOM(element, 0);
      const lineNumber = view.state.doc.lineAt(position).number;
      elementsByLine.set(lineNumber, element);
    } catch {
      // Ignore non-document line elements owned by other editor widgets.
    }
  }

  return markdown
    .split("\n")
    .map((line, index) => {
      const element = elementsByLine.get(startLine + index);
      return line + livePreviewSuffix(element);
    })
    .join("\n");
}

class MirrorWidget extends WidgetType {
  constructor(plugin) {
    super();
    this.plugin = plugin;
    this.markdown = "";
    this.renderedMarkdown = "";
    this.sourcePath = "";
    this.startLine = 1;
    this.component = null;
    this.timer = 0;
    this.renderVersion = 0;
    this.host = null;
    this.content = null;
    this.view = null;
  }

  eq(other) {
    return other === this;
  }

  setContent(markdown, renderedMarkdown, sourcePath, startLine) {
    if (
      markdown === this.markdown &&
      renderedMarkdown === this.renderedMarkdown &&
      sourcePath === this.sourcePath &&
      startLine === this.startLine
    ) {
      return;
    }
    this.markdown = markdown;
    this.renderedMarkdown = renderedMarkdown;
    this.sourcePath = sourcePath;
    this.startLine = startLine;
    this.scheduleRender();
  }

  toDOM(view) {
    const host = document.createElement("section");
    host.className = "callout-mirror-preview";

    host
      .createDiv({ cls: "callout-mirror-preview__label" })
      .setText("Зеркальный предпросмотр callout");
    const content = host.createDiv({
      cls: "callout-mirror-preview__content markdown-rendered",
    });

    this.host = host;
    this.content = content;
    this.view = view;
    this.scheduleRender();
    return host;
  }

  scheduleRender() {
    if (!this.content) return;
    window.clearTimeout(this.timer);
    const version = ++this.renderVersion;
    this.timer = window.setTimeout(async () => {
      if (!this.content || !this.host?.isConnected) return;

      this.component?.unload();
      this.component = null;
      this.content.empty();
      const component = new Component();
      component.load();
      this.component = component;

      try {
        await MarkdownRenderer.render(
          this.plugin.app,
          this.renderedMarkdown,
          this.content,
          this.sourcePath,
          component
        );
        if (version !== this.renderVersion) return;
        this.view?.requestMeasure();
      } catch (error) {
        console.error("Callout Mirror: preview rendering failed", error);
        this.content.empty();
        this.content.createDiv({
          cls: "callout-mirror-preview__error",
          text: "Не удалось отобразить предпросмотр",
        });
      }
    }, 24);
  }

  destroy() {
    window.clearTimeout(this.timer);
    this.renderVersion += 1;
    this.component?.unload();
    this.component = null;
    this.host = null;
    this.content = null;
    this.view = null;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(state, plugin) {
  const callout = findActiveCallout(state);
  if (!callout) return Decoration.none;

  const sourcePath = plugin.app.workspace.getActiveFile()?.path || "";
  const renderedMarkdown = applyLivePreviewFlags(
    callout.markdown,
    plugin.mirrorWidget.view,
    callout.startLine
  );
  plugin.mirrorWidget.setContent(
    callout.markdown,
    renderedMarkdown,
    sourcePath,
    callout.startLine
  );
  return Decoration.set([
    Decoration.widget({
      widget: plugin.mirrorWidget,
      block: true,
      side: callout.side,
    }).range(callout.insertAt),
  ]);
}

function scheduleInteractionRefresh(view) {
  for (const delay of [0, 48, 140]) {
    window.setTimeout(() => {
      if (view.dom.isConnected) view.dispatch({});
    }, delay);
  }
}

function createInteractionRefresh() {
  return EditorView.domEventHandlers({
    mousedown(_event, view) {
      scheduleInteractionRefresh(view);
      return false;
    },
    mouseup(_event, view) {
      scheduleInteractionRefresh(view);
      return false;
    },
    click(_event, view) {
      scheduleInteractionRefresh(view);
      return false;
    },
    focus(_event, view) {
      scheduleInteractionRefresh(view);
      return false;
    },
  });
}

function createSelectionRefresh() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.timer = 0;
        this.onSelectionChange = () => {
          window.clearTimeout(this.timer);
          this.timer = window.setTimeout(() => {
            if (this.view.hasFocus && this.view.dom.isConnected) {
              this.view.dispatch({});
            }
          }, 0);
        };
        view.dom.ownerDocument.addEventListener(
          "selectionchange",
          this.onSelectionChange
        );
      }

      destroy() {
        window.clearTimeout(this.timer);
        this.view.dom.ownerDocument.removeEventListener(
          "selectionchange",
          this.onSelectionChange
        );
      }
    }
  );
}

function createMirrorField(plugin) {
  return StateField.define({
    create(state) {
      return buildDecorations(state, plugin);
    },
    update(_decorations, transaction) {
      return buildDecorations(transaction.state, plugin);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

function blockConflictingMode(plugin, otherId, otherName) {
  const manager = plugin.app.plugins;
  if (!manager?.enabledPlugins?.has(otherId)) return false;

  new Notice(
    `${plugin.manifest.name} нельзя включить вместе с ${otherName}. ` +
      `${plugin.manifest.name} будет выключен.`
  );
  window.setTimeout(async () => {
    try {
      await manager.disablePluginAndSave(plugin.manifest.id);
    } catch (error) {
      console.error("Callout mode conflict: disable failed", error);
    }
  }, 0);
  return true;
}

module.exports = class CalloutMirrorPlugin extends Plugin {
  async onload() {
    if (blockConflictingMode(this, "callout-inline", "Callout Inline")) return;
    this.mirrorWidget = new MirrorWidget(this);
    this.register(() => this.mirrorWidget.destroy());
    this.registerEditorExtension([
      createMirrorField(this),
      createInteractionRefresh(),
      createSelectionRefresh(),
    ]);
  }
};
