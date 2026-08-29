# Тесты Iconize Revival

Тесты работают с настоящим Obsidian через Chrome DevTools Protocol.

1. Запустите Obsidian с параметром `--remote-debugging-port=9222`.
2. Включите Iconize 2.14.7 и Iconize Revival.
3. Из корня репозитория выполните:

```powershell
node iconize-revival/tests/stability.mjs
node iconize-revival/tests/lifecycle.mjs
```

`stability.mjs` проверяет отсутствие пересоздания SVG при редактировании строки, клик и стрелки. `lifecycle.mjs` проверяет выделение, невалидный shortcode, undo/redo, Reading View и восстановление штатного Iconize.

Оба теста создают временную заметку и удаляют её в `finally`.
