const { Notice, Plugin } = require("obsidian");
const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
const { EditorSelection, EditorState } = require("@codemirror/state");

const ICONIZE_ID = "obsidian-icon-folder";
const SUPPORTED_ICONIZE_VERSION = "2.14.7";

function selectionTouchesRange(selection, from, to) {
  return selection.ranges.some((range) => {
    if (range.empty) return range.head >= from && range.head <= to;
    return range.from < to && range.to > from;
  });
}

function lineHasIcon(state, plugin, line) {
  const positionField = plugin.getIconize()?.positionField;
  const iconInfo = positionField && state.field(positionField, false);
  if (!iconInfo) return false;

  let found = false;
  iconInfo.between(line.from, line.to, () => {
    found = true;
  });
  return found;
}

function isSingleVisualRow(view, line) {
  const start = view.coordsAtPos(line.from);
  const end = view.coordsAtPos(line.to);
  if (!start || !end) return true;
  return Math.abs(start.top - end.top) < 2;
}

function createVerticalNavigationExtensions(plugin) {
  const pendingNavigation = new WeakMap();
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

          const line = view.state.doc.lineAt(view.state.selection.main.head);
          pendingNavigation.set(view.state, {
            direction: event.key === "ArrowDown" ? 1 : -1,
            extend: event.shiftKey,
            singleVisualRow: isSingleVisualRow(view, line),
          });
          window.setTimeout(() => pendingNavigation.delete(view.state), 0);
        };
        view.dom.addEventListener("keydown", this.onKeyDown, true);
      }

      destroy() {
        this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
      }
    }
  );

  const filter = EditorState.transactionFilter.of((transaction) => {
    const navigation = pendingNavigation.get(transaction.startState);
    if (!navigation || transaction.docChanged) return transaction;
    pendingNavigation.delete(transaction.startState);

    const { doc, selection } = transaction.startState;
    const ranges = selection.ranges.map((range, index) => {
      const native =
        transaction.newSelection.ranges[index] ||
        transaction.newSelection.main;
      const currentLine = doc.lineAt(range.head);
      const targetNumber = currentLine.number + navigation.direction;
      if (targetNumber < 1 || targetNumber > doc.lines) return native;

      const targetLine = doc.line(targetNumber);
      if (!lineHasIcon(transaction.startState, plugin, targetLine)) {
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
      const head = targetLine.from + Math.min(column, targetLine.length);
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

  return [probe, filter];
}

class EditableIconWidget extends WidgetType {
  constructor(plugin, iconId, from, to) {
    super();
    this.plugin = plugin;
    this.iconId = iconId;
    this.from = from;
    this.to = to;
  }

  eq(other) {
    return (
      other instanceof EditableIconWidget &&
      other.iconId === this.iconId &&
      other.from === this.from &&
      other.to === this.to
    );
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
      const anchor = Math.min(this.to - 1, this.from + 1);
      view.dispatch({
        selection: { anchor: Math.max(this.from, anchor) },
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

function buildDecorations(view, plugin) {
  const iconize = plugin.getIconize();
  const positionField = iconize?.positionField;
  if (!positionField) return Decoration.none;

  const iconInfo = view.state.field(positionField, false);
  if (!iconInfo) return Decoration.none;

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
  const decorations = [];
  for (const range of ranges) {
    if (
      selectionTouchesRange(view.state.selection, range.from, range.to)
    ) {
      continue;
    }
    decorations.push(
      Decoration.replace({
        widget: new EditableIconWidget(
          plugin,
          range.iconId,
          range.from,
          range.to
        ),
        side: -1,
      }).range(range.from, range.to)
    );
  }

  return Decoration.set(decorations, true);
}

function createEditableIconExtension(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view, plugin);
      }

      update(update) {
        this.decorations = buildDecorations(update.view, plugin);
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
