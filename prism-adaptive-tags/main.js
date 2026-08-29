const { Plugin, MarkdownView, SuggestModal } = require("obsidian");
const { Decoration, ViewPlugin } = require("@codemirror/view");
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

const TAG_PATTERN = String.raw`\(\((?<arrow><)?(?<color>[a-zа-яё-]+)\|(?<label>[^)\n]+)\)\)`;

function tagRegex() {
  return new RegExp(TAG_PATTERN, "giu");
}

function resolveColor(token) {
  return COLOR_BY_TOKEN.get(token.toLocaleLowerCase("ru-RU"));
}

function tagClass(color, arrow) {
  return `apt-tag apt-${color.id}${arrow ? " apt-arrow" : ""}`;
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

      const selectionTouchesTag = selections.some(
        (selection) => selection.from <= end && selection.to >= start
      );
      if (
        selectionTouchesTag ||
        isInFencedCode(view.state, start) ||
        isInInlineCode(view.state, start)
      ) {
        continue;
      }

      const label = match.groups?.label || "";
      const labelIndex = match[0].indexOf(label);
      const labelStart = start + labelIndex;
      const labelEnd = labelStart + label.length;
      const arrow = Boolean(match.groups?.arrow);

      builder.add(start, labelStart, Decoration.mark({ class: "apt-hidden" }));
      builder.add(labelStart, labelEnd, Decoration.mark({ class: tagClass(color, arrow) }));
      builder.add(labelEnd, end, Decoration.mark({ class: "apt-hidden" }));
    }
  }

  return builder.finish();
}

function createTagElement(doc, color, label, arrow) {
  const span = doc.createElement("span");
  span.className = tagClass(color, arrow);
  span.textContent = label;
  return span;
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
          Boolean(match.groups?.arrow)
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

class AdaptiveTagModal extends SuggestModal {
  constructor(app, plugin, arrow = false) {
    super(app);
    this.plugin = plugin;
    this.arrow = arrow;
    this.setPlaceholder(arrow ? "Цвет тега-стрелки…" : "Цвет тега…");
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
    row.createSpan({ text: color.name, cls: tagClass(color, this.arrow) });
    row.createEl("small", { text: color.group });
  }

  onChooseSuggestion(color) {
    this.plugin.insertTag(color.id, this.arrow);
  }
}

module.exports = class PrismAdaptiveTagsPlugin extends Plugin {
  async onload() {
    const editorPlugin = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = buildDecorations(view);
        }

        update(update) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = buildDecorations(update.view);
          }
        }
      },
      { decorations: (value) => value.decorations }
    );

    this.registerEditorExtension(editorPlugin);
    this.registerMarkdownPostProcessor((el) => renderReadingMode(el));

    this.addCommand({
      id: "insert-adaptive-tag",
      name: "Вставить адаптивный тег",
      editorCallback: () => new AdaptiveTagModal(this.app, this).open(),
    });

    this.addCommand({
      id: "insert-adaptive-arrow-tag",
      name: "Вставить адаптивный тег-стрелку",
      editorCallback: () => new AdaptiveTagModal(this.app, this, true).open(),
    });

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

          submenu.addItem((subitem) =>
            subitem
              .setTitle("Цветной тег")
              .setIcon("tag")
              .onClick(() => new AdaptiveTagModal(this.app, this).open())
          );
          submenu.addItem((subitem) =>
            subitem
              .setTitle("Тег-стрелка")
              .setIcon("send")
              .onClick(() => new AdaptiveTagModal(this.app, this, true).open())
          );
        });
      })
    );
  }

  insertTag(colorId, arrow) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const editor = view.editor;
    const selected = editor.getSelection();
    const prefix = `((${arrow ? "<" : ""}${colorId}|`;

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
