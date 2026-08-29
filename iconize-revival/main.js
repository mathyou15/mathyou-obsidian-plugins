const { Notice, Plugin } = require("obsidian");
const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
const { EditorSelection } = require("@codemirror/state");

const ICONIZE_ID = "obsidian-icon-folder";
const SUPPORTED_ICONIZE_VERSION = "2.14.7";

function selectionTouchesRange(selection, from, to) {
  return selection.ranges.some((range) => {
    if (range.empty) return range.head >= from && range.head <= to;
    return range.from < to && range.to > from;
  });
}

function lineHasIcon(state, plugin, line) {
  const iconize = plugin.getIconize();
  const positionField = iconize?.positionField;
  const iconInfo = positionField && state.field(positionField, false);
  let found = false;
  iconInfo?.between(line.from, line.to, () => {
    found = true;
  });
  if (found) return true;

  const identifier = iconize?.getSettings?.().iconIdentifier || ":";
  const text = line.text;
  let from = text.indexOf(identifier);
  while (from !== -1) {
    const to = text.indexOf(identifier, from + identifier.length);
    if (to === -1) break;
    const iconId = text.slice(from + identifier.length, to);
    if (iconize?.api?.getIconByName?.(iconId)) return true;
    from = text.indexOf(identifier, to + identifier.length);
  }
  return false;
}

function isSingleVisualRow(view, line) {
  const start = view.coordsAtPos(line.from);
  const end = view.coordsAtPos(line.to);
  if (!start || !end) return true;
  return Math.abs(start.top - end.top) < 2;
}

function createVerticalNavigationExtensions(plugin) {
  const probe = ViewPlugin.fromClass(
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

          const { doc, selection } = view.state;
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const ranges = [];
          for (const range of selection.ranges) {
            const currentLine = doc.lineAt(range.head);
            const targetNumber = currentLine.number + direction;
            if (
              targetNumber < 1 ||
              targetNumber > doc.lines ||
              !isSingleVisualRow(view, currentLine)
            ) {
              return;
            }

            const targetLine = doc.line(targetNumber);
            if (!lineHasIcon(view.state, plugin, targetLine)) return;

            const column = range.head - currentLine.from;
            const head =
              targetLine.from + Math.min(column, targetLine.length);
            ranges.push(
              event.shiftKey
                ? EditorSelection.range(range.anchor, head)
                : EditorSelection.cursor(head)
            );
          }

          event.preventDefault();
          event.stopPropagation();
          view.dispatch({
            selection: EditorSelection.create(ranges, selection.mainIndex),
            scrollIntoView: true,
            userEvent: "select",
          });
        };
        view.dom.addEventListener("keydown", this.onKeyDown, true);
      }

      destroy() {
        this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
      }
    }
  );
  return [probe];
}

class EditableIconWidget extends WidgetType {
  constructor(plugin, iconId) {
    super();
    this.plugin = plugin;
    this.iconId = iconId;
  }

  eq(other) {
    return (
      other instanceof EditableIconWidget &&
      other.iconId === this.iconId
    );
  }

  findCurrentRange(view, wrap) {
    const positionField = this.plugin.getIconize()?.positionField;
    const iconInfo = positionField && view.state.field(positionField, false);

    let position = view.state.selection.main.head;
    try {
      position = view.posAtDOM(wrap, 0);
    } catch {
      // Fall back to the current selection and a textual shortcode lookup.
    }

    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const searchFrom = Math.max(0, position - 128);
    const searchTo = Math.min(view.state.doc.length, position + 128);
    iconInfo?.between(searchFrom, searchTo, (from, to, value) => {
      if (value.iconId !== this.iconId) return;
      const distance =
        position < from ? from - position : position > to ? position - to : 0;
      if (distance < nearestDistance) {
        nearest = { from, to };
        nearestDistance = distance;
      }
    });
    if (nearest) return nearest;

    const identifier =
      this.plugin.getIconize()?.getSettings?.().iconIdentifier || ":";
    const shortcode = `${identifier}${this.iconId}${identifier}`;
    const documentText = view.state.doc.toString();
    let index = documentText.indexOf(shortcode);
    while (index !== -1) {
      const to = index + shortcode.length;
      const distance =
        position < index ? index - position : position > to ? position - to : 0;
      if (distance < nearestDistance) {
        nearest = { from: index, to };
        nearestDistance = distance;
      }
      index = documentText.indexOf(shortcode, index + shortcode.length);
    }
    return nearest;
  }

  toDOM(view) {
    const wrap = document.createElement("span");
    wrap.className = "cm-iconize-icon iconize-revival-icon";
    wrap.dataset.icon = this.iconId;
    wrap.setAttribute("aria-label", this.iconId);
    wrap.setAttribute("aria-hidden", "true");

    const iconize = this.plugin.getIconize();
    const foundIcon = iconize?.api?.getIconByName?.(this.iconId);
    if (foundIcon?.svgElement) {
      wrap.innerHTML = foundIcon.svgElement;
    } else {
      wrap.textContent = this.iconId;
    }

    const iconColor = iconize?.getSettings?.().iconColor;
    if (iconColor) wrap.style.color = iconColor;

    wrap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const range = this.findCurrentRange(view, wrap);
      if (!range) return;
      const anchor = Math.min(range.to - 1, range.from + 1);
      view.dispatch({
        selection: { anchor: Math.max(range.from, anchor) },
        scrollIntoView: true,
      });
      view.focus();
    });

    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

function collectVisibleIcons(view, plugin) {
  const iconize = plugin.getIconize();
  const positionField = iconize?.positionField;
  if (!positionField) return [];

  const iconInfo = view.state.field(positionField, false);
  if (!iconInfo) return [];

  const ranges = [];
  const seen = new Set();
  for (const visible of view.visibleRanges) {
    const from = Math.max(0, visible.from - 1);
    const to = Math.min(view.state.doc.length, visible.to + 1);
    iconInfo.between(from, to, (start, end, value) => {
      const key = `${start}:${end}`;
      if (seen.has(key)) return;
      seen.add(key);
      ranges.push({
        from: start,
        to: end,
        iconId: value.iconId,
      });
    });
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  return ranges.filter(
    (range) =>
      !selectionTouchesRange(view.state.selection, range.from, range.to)
  );
}

function decorationKey(from, to, decoration) {
  const widget = decoration.spec?.widget;
  if (widget instanceof EditableIconWidget) {
    return `widget:${from}:${widget.iconId}`;
  }
  const iconId =
    decoration.spec?.attributes?.["data-iconize-revival-source"];
  return iconId ? `source:${from}:${to}:${iconId}` : null;
}

function makeIconDecorations(plugin, range) {
  return [
    Decoration.widget({
      widget: new EditableIconWidget(plugin, range.iconId),
      side: -1,
    }).range(range.from),
    Decoration.mark({
      class: "iconize-revival-source-hidden",
      attributes: {
        "data-iconize-revival-source": range.iconId,
      },
    }).range(range.from, range.to),
  ];
}

function buildDecorations(view, plugin) {
  const ranges = collectVisibleIcons(view, plugin);
  const decorations = ranges.flatMap((range) =>
    makeIconDecorations(plugin, range)
  );

  return Decoration.set(decorations, true);
}

function reconcileDecorations(view, plugin, previous, changes) {
  const mapped = changes ? previous.map(changes) : previous;
  const desired = new Map();
  for (const iconRange of collectVisibleIcons(view, plugin)) {
    for (const range of makeIconDecorations(plugin, iconRange)) {
      desired.set(
        decorationKey(range.from, range.to, range.value),
        range
      );
    }
  }
  const retained = new Set();
  const fallback = new Set();

  mapped.between(0, view.state.doc.length, (from, to, decoration) => {
    const iconId =
      decoration.spec?.attributes?.["data-iconize-revival-source"];
    if (!iconId) return;
    if (selectionTouchesRange(view.state.selection, from, to)) return;
    const stillVisible = view.visibleRanges.some(
      (visible) => from <= visible.to + 1 && to >= visible.from - 1
    );
    if (!stillVisible) return;

    const identifier =
      plugin.getIconize()?.getSettings?.().iconIdentifier || ":";
    const currentText = view.state.doc.sliceString(from, to);
    if (currentText !== `${identifier}${iconId}${identifier}`) return;
    fallback.add(decorationKey(from, to, decoration));
    fallback.add(`widget:${from}:${iconId}`);
  });

  mapped.between(0, view.state.doc.length, (from, to, decoration) => {
    const key = decorationKey(from, to, decoration);
    if (!key || (!desired.has(key) && !fallback.has(key))) return;
    retained.add(key);
    desired.delete(key);
  });

  return mapped.update({
    filter: (from, to, decoration) => {
      const key = decorationKey(from, to, decoration);
      return Boolean(key && retained.has(key));
    },
    add: Array.from(desired.values()),
    sort: true,
  });
}

function createEditableIconExtension(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view, plugin);
      }

      update(update) {
        this.decorations = reconcileDecorations(
          update.view,
          plugin,
          this.decorations,
          update.docChanged ? update.changes : null
        );
      }
    },
    {
      decorations: (instance) => instance.decorations,
    }
  );
}

async function reloadIconizeWithRevival(app) {
  const manager = app.plugins;
  const originalRegister = Plugin.prototype.registerEditorExtension;
  let intercepted = false;

  await manager.disablePlugin(ICONIZE_ID);
  Plugin.prototype.registerEditorExtension = function (extension) {
    const isIconizeTextRegistration =
      !intercepted &&
      this.manifest?.id === ICONIZE_ID &&
      Array.isArray(extension) &&
      extension.length === 2 &&
      extension[0] === this.positionField &&
      this.getSettings?.().iconsInNotesEnabled;

    if (isIconizeTextRegistration) {
      intercepted = true;
      return originalRegister.call(this, [this.positionField]);
    }
    return originalRegister.call(this, extension);
  };

  let loadError = null;
  try {
    await manager.enablePlugin(ICONIZE_ID);
  } catch (error) {
    loadError = error;
  } finally {
    Plugin.prototype.registerEditorExtension = originalRegister;
  }

  if (loadError) {
    try {
      await manager.enablePlugin(ICONIZE_ID);
    } catch (restoreError) {
      console.error(
        "Iconize Revival: normal Iconize recovery failed",
        restoreError
      );
    }
    throw loadError;
  }

  const iconize = manager.plugins[ICONIZE_ID];
  if (!intercepted || !iconize?.positionField || !iconize?.api?.getIconByName) {
    await manager.disablePlugin(ICONIZE_ID);
    await manager.enablePlugin(ICONIZE_ID);
    throw new Error("Iconize inline editor extension was not intercepted");
  }
  return iconize;
}

async function restoreIconize(app) {
  const manager = app.plugins;
  if (!manager?.enabledPlugins?.has(ICONIZE_ID)) return;
  try {
    await manager.disablePlugin(ICONIZE_ID);
    await manager.enablePlugin(ICONIZE_ID);
  } catch (error) {
    console.error("Iconize Revival: failed to restore Iconize", error);
    new Notice(
      "Iconize Revival не смог восстановить Iconize. Перезапустите Obsidian."
    );
  }
}

module.exports = class IconizeRevivalPlugin extends Plugin {
  async onload() {
    this.ready = false;
    this.shouldRestore = false;

    const manager = this.app.plugins;
    const manifest = manager?.manifests?.[ICONIZE_ID];
    if (!manifest || !manager.enabledPlugins.has(ICONIZE_ID)) {
      this.fail(
        "Сначала установите и включите Iconize, затем включите Iconize Revival."
      );
      return;
    }
    if (manifest.version !== SUPPORTED_ICONIZE_VERSION) {
      this.fail(
        `Поддерживается Iconize ${SUPPORTED_ICONIZE_VERSION}, установлена ${manifest.version}.`
      );
      return;
    }
    const currentIconize = manager.plugins[ICONIZE_ID];
    if (!currentIconize?.getSettings?.().iconsInNotesEnabled) {
      this.fail(
        "Включите «Toggle icons while editing notes» в настройках Iconize."
      );
      return;
    }

    try {
      this.iconize = await reloadIconizeWithRevival(this.app);
      this.shouldRestore = true;
      this.registerEditorExtension([
        ...createVerticalNavigationExtensions(this),
        createEditableIconExtension(this),
      ]);
      this.ready = true;
    } catch (error) {
      console.error("Iconize Revival: startup failed", error);
      this.fail(
        "Не удалось подключиться к редактору Iconize. Его штатный режим восстановлен."
      );
    }
  }

  getIconize() {
    return this.app.plugins?.plugins?.[ICONIZE_ID] || this.iconize;
  }

  fail(message) {
    new Notice(`Iconize Revival: ${message}`);
    window.setTimeout(() => {
      this.app.plugins
        ?.disablePluginAndSave?.(this.manifest.id)
        .catch((error) =>
          console.error("Iconize Revival: self-disable failed", error)
        );
    }, 0);
  }

  onunload() {
    if (!this.shouldRestore) return;
    this.shouldRestore = false;
    window.setTimeout(() => restoreIconize(this.app), 0);
  }
};
