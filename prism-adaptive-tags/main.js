const { Plugin, MarkdownView, SuggestModal, setIcon } = require("obsidian");
const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");

const COLORS = [
  { id: "white", name: "Белый", group: "Нейтральные", aliases: ["белый"] },
  { id: "gray", name: "Серый", group: "Нейтральные", aliases: ["grey", "серый"] },
  { id: "graphite", name: "Графитовый", group: "Нейтральные", aliases: ["графитовый", "black", "чёрный", "черный"] },

  { id: "brown", name: "Коричневый", group: "Тёплые", aliases: ["коричневый"] },
  { id: "red", name: "Красный", group: "Тёплые", aliases: ["красный"] },
  { id: "coral", name: "Коралловый", group: "Тёплые", aliases: ["коралловый"] },
  { id: "orange", name: "Оранжевый", group: "Тёплые", aliases: ["оранжевый"] },
  { id: "peach", name: "Персиковый", group: "Тёплые", aliases: ["персиковый"] },
  { id: "gold", name: "Золотой", group: "Тёплые", aliases: ["золотой"] },
  { id: "yellow", name: "Жёлтый", group: "Тёплые", aliases: ["желтый", "жёлтый"] },

  { id: "lime", name: "Лаймовый", group: "Зелёные и бирюзовые", aliases: ["лаймовый"] },
  { id: "green", name: "Зелёный", group: "Зелёные и бирюзовые", aliases: ["зеленый", "зелёный"] },
  { id: "mint", name: "Мятный", group: "Зелёные и бирюзовые", aliases: ["мятный"] },
  { id: "teal", name: "Бирюзовый", group: "Зелёные и бирюзовые", aliases: ["бирюзовый"] },
  { id: "cyan", name: "Голубой", group: "Зелёные и бирюзовые", aliases: ["голубой"] },

  { id: "blue", name: "Синий", group: "Холодные и фиолетовые", aliases: ["синий"] },
  { id: "indigo", name: "Индиго", group: "Холодные и фиолетовые", aliases: ["индиго"] },
  { id: "purple", name: "Фиолетовый", group: "Холодные и фиолетовые", aliases: ["фиолетовый"] },
  { id: "lavender", name: "Лавандовый", group: "Холодные и фиолетовые", aliases: ["лавандовый"] },
  { id: "pink", name: "Розовый", group: "Холодные и фиолетовые", aliases: ["розовый"] },
];

const COLOR_BY_TOKEN = new Map();
for (const color of COLORS) {
  COLOR_BY_TOKEN.set(color.id, color);
  for (const alias of color.aliases) COLOR_BY_TOKEN.set(alias, color);
}

const SHAPES = [
  {
    id: "pill",
    symbol: "",
    name: "Капсула",
    icon: "circle",
    menuTitle: "Цветной тег",
    glyph: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg>',
  },
  {
    id: "soft",
    symbol: "~",
    name: "Плашка",
    icon: "square",
    menuTitle: "Тег-плашка",
    glyph: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="10" rx="2.5"/></svg>',
  },
  {
    id: "arrow",
    symbol: "<",
    name: "Стрелка",
    icon: "triangle",
    menuTitle: "Тег-стрелка",
    glyph: '<svg viewBox="0 0 24 24"><path d="M9 7l8 5-8 5z"/></svg>',
  },
];

const TAG_PATTERN = String.raw`\(\((?<shape>[<~])?(?<color>[a-zа-яё-]+)\|(?<label>[^)\n]+)\)\)`;

function tagRegex() {
  return new RegExp(TAG_PATTERN, "giu");
}

function resolveColor(token) {
  return COLOR_BY_TOKEN.get(token.toLocaleLowerCase("ru-RU"));
}

function resolveShape(symbol = "") {
  return SHAPES.find((shape) => shape.symbol === symbol) || SHAPES[0];
}

function tagClass(color, shape = SHAPES[0]) {
  const shapeClass =
    shape.id === "arrow" ? " apt-arrow" : shape.id === "soft" ? " apt-soft" : "";
  return `apt-tag apt-${color.id}${shapeClass}`;
}

function appendShapeGlyph(el, shape) {
  const doc = el.ownerDocument;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("aria-hidden", "true");

  if (shape.id === "pill") {
    const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "7");
    svg.append(circle);
  } else if (shape.id === "soft") {
    const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "5");
    rect.setAttribute("y", "7");
    rect.setAttribute("width", "14");
    rect.setAttribute("height", "10");
    rect.setAttribute("rx", "2.5");
    svg.append(rect);
  } else {
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 6l10 6-10 6z");
    svg.append(path);
  }

  el.append(svg);
}

function isInFencedCode(state, pos) {
  const targetLine = state.doc.lineAt(pos).number;
  let fenced = false;
  for (let lineNumber = 1; lineNumber <= targetLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber).text.trimStart();
    if (line.startsWith("```") || line.startsWith("~~~")) fenced = !fenced;
  }
  return fenced;
}

function isInInlineCode(state, pos) {
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  return (before.match(/(?<!\\)`/g) || []).length % 2 === 1;
}

function buildDecorations(view) {
  const builder = new RangeSetBuilder();
  const selections = view.state.selection.ranges;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const regex = tagRegex();
    let match;

    while ((match = regex.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;
      const color = resolveColor(match.groups?.color || "");
      if (!color) continue;

      if (isInFencedCode(view.state, start) || isInInlineCode(view.state, start)) {
        continue;
      }

      const label = match.groups?.label || "";
      const shape = resolveShape(match.groups?.shape);
      const selectionTouchesTag = selections.some(
        (selection) => selection.from <= end && selection.to >= start
      );

      if (selectionTouchesTag) {
        builder.add(
          end,
          end,
          Decoration.widget({
            widget: new TagPreviewWidget(color, label, shape),
            side: 1,
          })
        );
        continue;
      }

      const labelIndex = match[0].indexOf(label);
      const labelStart = start + labelIndex;
      const labelEnd = labelStart + label.length;

      builder.add(start, labelStart, Decoration.mark({ class: "apt-hidden" }));
      builder.add(labelStart, labelEnd, Decoration.mark({ class: tagClass(color, shape) }));
      builder.add(labelEnd, end, Decoration.mark({ class: "apt-hidden" }));
    }
  }

  return builder.finish();
}

function createTagElement(doc, color, label, shape) {
  const span = doc.createElement("span");
  span.className = tagClass(color, shape);
  span.textContent = label;
  return span;
}

class TagPreviewWidget extends WidgetType {
  constructor(color, label, shape) {
    super();
    this.color = color;
    this.label = label;
    this.shape = shape;
  }

  eq(other) {
    return (
      other instanceof TagPreviewWidget &&
      this.color.id === other.color.id &&
      this.label === other.label &&
      this.shape.id === other.shape.id
    );
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "apt-preview";
    wrap.setAttribute("aria-hidden", "true");
    wrap.append(createTagElement(document, this.color, this.label, this.shape));
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function renderReadingMode(root) {
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = root.ownerDocument.createTreeWalker(root, showText);
  const nodes = [];
  let node;

  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest("code, pre, style, script, .apt-tag")) continue;
    if (node.nodeValue?.includes("((")) nodes.push(node);
  }

  for (const textNode of nodes) {
    const text = textNode.nodeValue || "";
    const regex = tagRegex();
    let match;
    let cursor = 0;
    let changed = false;
    const fragment = root.ownerDocument.createDocumentFragment();

    while ((match = regex.exec(text)) !== null) {
      const color = resolveColor(match.groups?.color || "");
      if (!color) continue;

      changed = true;
      fragment.append(text.slice(cursor, match.index));
      fragment.append(
        createTagElement(
          root.ownerDocument,
          color,
          match.groups?.label || "",
          resolveShape(match.groups?.shape)
        )
      );
      cursor = match.index + match[0].length;
    }

    if (changed) {
      fragment.append(text.slice(cursor));
      textNode.replaceWith(fragment);
    }
  }
}

function findTagAtCursor(view) {
  const selection = view.state.selection.main;
  if (!selection.empty) return null;

  const position = selection.head;
  const line = view.state.doc.lineAt(position);
  const regex = tagRegex();
  let match;

  while ((match = regex.exec(line.text)) !== null) {
    const start = line.from + match.index;
    const end = start + match[0].length;
    if (position < start || position > end) continue;
    if (isInFencedCode(view.state, start) || isInInlineCode(view.state, start)) {
      return null;
    }

    const colorToken = match.groups?.color || "";
    const color = resolveColor(colorToken);
    if (!color) return null;

    return {
      start,
      end,
      color,
      colorStart: start + match[0].indexOf(colorToken),
      colorEnd: start + match[0].indexOf(colorToken) + colorToken.length,
      shape: resolveShape(match.groups?.shape),
      shapeStart: start + 2,
      hasShapeSymbol: Boolean(match.groups?.shape),
    };
  }

  return null;
}

class InlineTagPicker {
  constructor(view) {
    this.view = view;
    this.activeTag = null;
    this.menuOpen = false;
    this.frame = 0;
    this.build();
    this.refresh();
  }

  build() {
    const doc = this.view.dom.ownerDocument;

    this.chip = doc.createElement("button");
    this.chip.type = "button";
    this.chip.className = "apt-color-chip";
    this.chip.title = "Цвет тега";
    this.chip.setAttribute("aria-label", "Открыть палитру тега");

    this.dom = doc.createElement("div");
    this.dom.className = "apt-inline-picker";
    this.dom.setAttribute("role", "toolbar");
    this.dom.setAttribute("aria-label", "Оформление цветного тега");

    const shapeRow = doc.createElement("div");
    shapeRow.className = "apt-inline-picker__shapes";

    for (const shape of SHAPES) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "apt-inline-picker__shape";
      button.dataset.shape = shape.id;
      button.title = shape.name;
      button.setAttribute("aria-label", shape.name);
      appendShapeGlyph(button, shape);
      shapeRow.append(button);
    }

    const divider = doc.createElement("div");
    divider.className = "apt-inline-picker__divider";

    const colorGrid = doc.createElement("div");
    colorGrid.className = "apt-inline-picker__colors";

    for (const color of COLORS) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = `apt-inline-picker__swatch apt-${color.id}`;
      button.dataset.color = color.id;
      button.title = color.name;
      button.setAttribute("aria-label", color.name);
      colorGrid.append(button);
    }

    this.dom.append(shapeRow, divider, colorGrid);
    doc.body.append(this.chip, this.dom);

    this.chip.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.menuOpen = !this.menuOpen;
      this.dom.classList.toggle("is-visible", this.menuOpen);
      this.schedulePosition();
    });

    this.dom.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });

    this.dom.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button");
      if (!button) return;

      if (button.dataset.color) this.applyColor(button.dataset.color);
      if (button.dataset.shape) this.applyShape(button.dataset.shape);
    });

    this.onOutsidePointerDown = (event) => {
      const target = event.target;
      if (this.dom.contains(target) || this.chip.contains(target)) return;
      this.menuOpen = false;
      this.dom.classList.remove("is-visible");
    };
    doc.addEventListener("pointerdown", this.onOutsidePointerDown, true);
  }

  update(update) {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.refresh();
    }
  }

  refresh() {
    this.activeTag = findTagAtCursor(this.view);
    if (!this.activeTag) {
      this.hide();
      return;
    }

    this.chip.className = `apt-color-chip apt-${this.activeTag.color.id} is-visible`;
    this.chip.title = this.activeTag.color.name;
    this.dom.classList.toggle("is-visible", this.menuOpen);
    this.updateSelection();
    this.schedulePosition();
  }

  updateSelection() {
    for (const button of this.dom.querySelectorAll("[data-color]")) {
      const selected = button.dataset.color === this.activeTag?.color.id;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }

    for (const button of this.dom.querySelectorAll("[data-shape]")) {
      const selected = button.dataset.shape === this.activeTag?.shape.id;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }

  schedulePosition() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.activeTag || !this.chip.classList.contains("is-visible")) return;

      const coordinates = this.view.coordsAtPos(this.activeTag.start);
      if (!coordinates) return;

      const chip = this.chip.getBoundingClientRect();
      const gap = 8;
      const chipLeft = Math.max(gap, coordinates.left - chip.width - 6);
      const chipTop = coordinates.top + (coordinates.bottom - coordinates.top - chip.height) / 2;
      this.chip.style.left = `${chipLeft}px`;
      this.chip.style.top = `${chipTop}px`;

      if (!this.menuOpen) return;

      const bounds = this.dom.getBoundingClientRect();
      const viewportWidth =
        this.view.dom.ownerDocument.defaultView?.innerWidth || window.innerWidth;
      const viewportHeight =
        this.view.dom.ownerDocument.defaultView?.innerHeight || window.innerHeight;

      let top = chipTop + chip.height + 6;
      if (top + bounds.height > viewportHeight - gap) {
        top = Math.max(gap, chipTop - bounds.height - 6);
      }

      const left = Math.min(
        Math.max(gap, chipLeft),
        viewportWidth - bounds.width - gap
      );

      this.dom.style.left = `${left}px`;
      this.dom.style.top = `${top}px`;
    });
  }

  applyColor(colorId) {
    const tag = findTagAtCursor(this.view);
    if (!tag || tag.color.id === colorId) return;

    this.view.dispatch({
      changes: { from: tag.colorStart, to: tag.colorEnd, insert: colorId },
    });
    this.view.focus();
  }

  applyShape(shapeId) {
    const tag = findTagAtCursor(this.view);
    const shape = SHAPES.find((item) => item.id === shapeId);
    if (!tag || !shape || tag.shape.id === shape.id) return;

    this.view.dispatch({
      changes: {
        from: tag.shapeStart,
        to: tag.shapeStart + (tag.hasShapeSymbol ? 1 : 0),
        insert: shape.symbol,
      },
    });
    this.view.focus();
  }

  hide() {
    this.menuOpen = false;
    this.chip.classList.remove("is-visible");
    this.dom.classList.remove("is-visible");
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.view.dom.ownerDocument.removeEventListener(
      "pointerdown",
      this.onOutsidePointerDown,
      true
    );
    this.chip.remove();
    this.dom.remove();
  }
}

class AdaptiveTagModal extends SuggestModal {
  constructor(app, plugin, shape = SHAPES[0]) {
    super(app);
    this.plugin = plugin;
    this.shape = shape;
    this.setPlaceholder(`Цвет: ${shape.name.toLowerCase()}…`);
  }

  getSuggestions(query) {
    const normalized = query.toLocaleLowerCase("ru-RU").trim();
    if (!normalized) return COLORS;
    return COLORS.filter((color) =>
      [color.name, color.id, color.group, ...color.aliases]
        .join(" ")
        .toLocaleLowerCase("ru-RU")
        .includes(normalized)
    );
  }

  renderSuggestion(color, el) {
    const row = el.createDiv({ cls: "apt-picker-row" });
    row.createSpan({ text: color.name, cls: tagClass(color, this.shape) });
    row.createEl("small", { text: color.group });
  }

  onChooseSuggestion(color) {
    this.plugin.insertTag(color.id, this.shape);
  }
}

module.exports = class PrismAdaptiveTagsPlugin extends Plugin {
  async onload() {
    const editorPlugin = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = buildDecorations(view);
          this.picker = new InlineTagPicker(view);
        }

        update(update) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = buildDecorations(update.view);
          }
          this.picker.update(update);
        }

        destroy() {
          this.picker.destroy();
        }
      },
      { decorations: (value) => value.decorations }
    );

    this.registerEditorExtension(editorPlugin);
    this.registerMarkdownPostProcessor((el) => renderReadingMode(el));

    for (const shape of SHAPES) {
      this.addCommand({
        id: `insert-adaptive-${shape.id}-tag`,
        name: `Вставить адаптивный тег: ${shape.name.toLowerCase()}`,
        editorCallback: () => new AdaptiveTagModal(this.app, this, shape).open(),
      });
    }

    this.addRibbonIcon("palette", "Prism Adaptive Tags", () => {
      new AdaptiveTagModal(this.app, this).open();
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu) => {
        menu.addSeparator();
        menu.addItem((item) => {
          const submenu = item
            .setTitle("Палитра")
            .setIcon("palette")
            .setSubmenu();

          submenu.addItem((subitem) =>
            subitem
              .setTitle("Академический блок")
              .setIcon("book-open")
              .onClick(() =>
                this.app.commands.executeCommandById(
                  "math-pages-palette:insert-callout"
                )
              )
          );

          submenu.addSeparator();

          for (const shape of SHAPES) {
            submenu.addItem((subitem) =>
              subitem
                .setTitle(shape.menuTitle)
                .setIcon(shape.icon)
                .onClick(() => new AdaptiveTagModal(this.app, this, shape).open())
            );
          }
        });
      })
    );
  }

  insertTag(colorId, shape = SHAPES[0]) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const editor = view.editor;
    const selected = editor.getSelection();
    const prefix = `((${shape.symbol}${colorId}|`;

    if (selected) {
      editor.replaceSelection(`${prefix}${selected}))`);
      return;
    }

    const placeholder = "текст";
    const startOffset = editor.posToOffset(editor.getCursor("from"));
    editor.replaceSelection(`${prefix}${placeholder}))`);
    editor.setSelection(
      editor.offsetToPos(startOffset + prefix.length),
      editor.offsetToPos(startOffset + prefix.length + placeholder.length)
    );
  }
};
