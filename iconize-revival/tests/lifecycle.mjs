async function evaluateInObsidian(expression) {
  const targets = await fetch("http://127.0.0.1:9222/json").then((response) =>
    response.json()
  );
  const target = targets.find(
    (item) => item.type === "page" && item.url.startsWith("app://obsidian.md/")
  );
  if (!target) throw new Error("Obsidian CDP target was not found");

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
            awaitPromise: true,
          },
        })
      )
    );
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      socket.close();
      if (message.result?.exceptionDetails) {
        reject(
          new Error(
            message.result.exceptionDetails.exception?.description ||
              message.result.exceptionDetails.text
          )
        );
      } else {
        resolve(message.result.result.value);
      }
    });
  });
}

const result = await evaluateInObsidian(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const path = "__iconize-lifecycle-test__.md";
  const previous = app.workspace.getActiveFile()?.path;
  const old = app.vault.getAbstractFileByPath(path);
  if (old) await app.vault.delete(old, true);
  const source = [
    "first :LiActivity: end",
    "second :LiHeart: end",
    "# Header :LiAsterisk:",
    "> [!note]",
    "> callout :LiNavigation:",
  ].join("\\n");
  const file = await app.vault.create(path, source);
  const leaf = app.workspace.getLeaf(false);
  const manager = app.plugins;

  try {
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source", source: false },
      active: true,
    });
    await wait(650);
    let editor = leaf.view.editor;
    const countLineWidgets = (lineNumber) => {
      const cm = leaf.view.editor.cm;
      const line = Array.from(cm.contentDOM.querySelectorAll(".cm-line")).find(
        (element) => {
          try {
            return (
              cm.state.doc.lineAt(cm.posAtDOM(element, 0)).number ===
              lineNumber + 1
            );
          } catch {
            return false;
          }
        }
      );
      return line?.querySelectorAll(".iconize-revival-icon").length || 0;
    };

    editor.setCursor({ line: 0, ch: 0 });
    await wait(200);
    const initiallyRendered =
      countLineWidgets(0) === 1 &&
      countLineWidgets(1) === 1 &&
      countLineWidgets(2) === 1;

    editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 12 });
    await wait(180);
    const partialSelection =
      countLineWidgets(0) === 0 && countLineWidgets(1) === 1;

    editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 13 });
    await wait(180);
    const crossSelection =
      countLineWidgets(0) === 0 && countLineWidgets(1) === 0;

    editor.setCursor({ line: 0, ch: 10 });
    editor.replaceRange("X", { line: 0, ch: 10 }, { line: 0, ch: 11 });
    editor.setCursor({ line: 1, ch: 0 });
    await wait(250);
    const invalidShortcodeStaysSource = countLineWidgets(0) === 0;
    editor.undo();
    editor.setCursor({ line: 1, ch: 0 });
    await wait(250);
    const undoRestoresIcon =
      editor.getLine(0) === source.split("\\n")[0] &&
      countLineWidgets(0) === 1;
    editor.redo();
    await wait(120);
    editor.undo();
    await wait(180);
    const redoUndoStable = editor.getLine(0) === source.split("\\n")[0];

    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "preview", source: false },
      active: true,
    });
    await wait(650);
    const preview = leaf.view.containerEl.querySelector(
      ".markdown-preview-view"
    );
    const readingViewUsesOriginal =
      (preview?.querySelectorAll(".cm-iconize-icon").length || 0) >= 1 &&
      (preview?.querySelectorAll(".iconize-revival-icon").length || 0) === 0;

    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source", source: false },
      active: true,
    });
    await wait(500);
    editor = leaf.view.editor;
    editor.setCursor({ line: 0, ch: 0 });
    await wait(150);

    await manager.disablePlugin("iconize-revival");
    await wait(650);
    const originalRestored =
      Boolean(manager.plugins["obsidian-icon-folder"]) &&
      leaf.view.containerEl.querySelectorAll(".iconize-revival-icon").length ===
        0 &&
      leaf.view.containerEl.querySelectorAll(".cm-iconize-icon").length >= 1;

    await manager.enablePlugin("iconize-revival");
    await wait(750);
    const revivalRestored =
      Boolean(manager.plugins["iconize-revival"]?.ready) &&
      leaf.view.containerEl.querySelectorAll(".iconize-revival-icon").length >=
        1;

    return {
      initiallyRendered,
      partialSelection,
      crossSelection,
      invalidShortcodeStaysSource,
      undoRestoresIcon,
      redoUndoStable,
      readingViewUsesOriginal,
      originalRestored,
      revivalRestored,
    };
  } finally {
    const previousFile = previous && app.vault.getAbstractFileByPath(previous);
    if (previousFile) await leaf.openFile(previousFile);
    await wait(100);
    const testFile = app.vault.getAbstractFileByPath(path);
    if (testFile) await app.vault.delete(testFile, true);
  }
})()`);

console.log(JSON.stringify(result, null, 2));
if (Object.values(result).some((value) => value !== true)) {
  process.exitCode = 1;
}
