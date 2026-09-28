# Spec: release-pipeline

## MUST
- Одновременно может выполняться только один ран релиза
  (`concurrency.group = release`, без cancel).
- `gh release create` не требует локального тега (тег минтится через API).
- Тег и версия всегда `v<tauri.conf.json.version>`, никогда имя ref.
- Веточный пуш без новой версии не строит релиз (`should_release=false`).

## MUST NOT
- Падать после полной сборки из-за отсутствия git-тега.
- Создавать релиз с именем ветки (`master`).
- Следовать за 30x с ключом (`maxRedirections: 0` через `gatedFetch`).
