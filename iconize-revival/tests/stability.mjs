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
  const path = "__iconize-stability-test__.md";
  const previous = app.workspace.getActiveFile()?.path;
  const old = app.vault.getAbstractFileByPath(path);
  if (old) await app.vault.delete(old, true);
  const file = await app.vault.create(
    path,
    "aaa :LiActivity: zzz\\nbbb :LiHeart: qqq"
  );
  const leaf = app.workspace.getLeaf(false);

  try {
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source", source: false },
      active: true,
    });
    await wait(600);

    const editor = leaf.view.editor;
    const root = leaf.view.containerEl;
    editor.setCursor({ line: 0, ch: editor.getLine(0).length });
    await wait(200);
    const initial = root.querySelector(".iconize-revival-icon");
    const initialSvg = initial?.querySelector("svg");
    const initialRect = initial?.getBoundingClientRect();
    const hiddenSource = root.querySelector(
      ".iconize-revival-source-hidden"
    );
    const hiddenSourceFontSize = getComputedStyle(hiddenSource).fontSize;

    editor.replaceRange("X", { line: 0, ch: 0 });
    await wait(250);
    const afterInsertBefore = root.querySelector(".iconize-revival-icon");

    editor.replaceRange("", { line: 0, ch: 0 }, { line: 0, ch: 1 });
    await wait(250);
    const afterDeleteBefore = root.querySelector(".iconize-revival-icon");

    editor.replaceRange("Y", {
      line: 0,
      ch: editor.getLine(0).length,
    });
    await wait(250);
    const afterInsertAfter = root.querySelector(".iconize-revival-icon");

    editor.replaceRange("X", { line: 0, ch: 0 });
    await wait(250);
    const shifted = root.querySelector(".iconize-revival-icon");
    shifted?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
    );
    await wait(200);
    const cursorAfterShiftedClick = editor.getCursor();
    const widgetRemovedWhileEditing = !shifted?.isConnected;
    const sourceShownWhileEditing =
      editor.cm.contentDOM.textContent.includes(":LiActivity:");

    editor.cm.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        bubbles: true,
        cancelable: true,
      })
    );
    await wait(150);
    const cursorAfterArrowDown = editor.getCursor();

    editor.setCursor({ line: 0, ch: 3 });
    editor.focus();
    editor.cm.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        bubbles: true,
        cancelable: true,
      })
    );
    await wait(150);
    const cursorAfterArrowRight = editor.getCursor();

    return {
      ready: Boolean(app.plugins.plugins["iconize-revival"]?.ready),
      widgetExists: Boolean(initial),
      sameNodeAfterInsertBefore: initial === afterInsertBefore,
      sameNodeAfterDeleteBefore: initial === afterDeleteBefore,
      sameNodeAfterInsertAfter: initial === afterInsertAfter,
      sameSvgAfterEdits:
        initialSvg === afterInsertAfter?.querySelector("svg"),
      iconHasVisibleGeometry:
        initialRect?.width > 0 && initialRect?.height > 0,
      sourceHiddenOutside: hiddenSourceFontSize === "0px",
      clickAfterShiftUsesCurrentRange:
        cursorAfterShiftedClick.line === 0 &&
        cursorAfterShiftedClick.ch === 6,
      widgetRemovedWhileEditing,
      sourceShownWhileEditing,
      arrowDownKeepsColumn:
        cursorAfterArrowDown.line === 1 &&
        cursorAfterArrowDown.ch === 6,
      arrowRightEntersSource:
        cursorAfterArrowRight.line === 0 &&
        cursorAfterArrowRight.ch === 4,
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
