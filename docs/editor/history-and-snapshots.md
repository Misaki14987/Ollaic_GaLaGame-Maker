# 撤销与快照

两层「时光机」:轻量的**撤销/重做**(编辑期)与重量的**整项目快照**(版本管理)。

## 撤销 / 重做

- 按场景维护撤销/重做历史,最多 50 条,变更记录有防抖(约 800ms)。
- 实现:`StoryEditor.tsx`(`pushHistory` / `undo` / `redo`)。

## 整项目快照

- **手动快照**:用户打标签,对整项目打包备份。
- **快照种类**:`manual`(手动)、`beforeRestore`(恢复前自动)、`exportCandidate`(导出候选)、`auto`(自动)。
- **管理对话框** `SnapshotManagerDialog`:创建、重命名、删除、恢复、搜索(按标签/描述/ID/种类过滤)。
- **恢复**:从快照恢复整个项目,恢复前自动创建一个 `beforeRestore` 快照。
- **持久化**:快照存于磁盘,带元数据(创建时间、种类、描述、文件数)。

## 相关源码
- `apps/desktop/src/app/components/StoryEditor.tsx`(撤销/重做)
- `apps/desktop/src/app/components/SnapshotManagerDialog.tsx`
- `apps/desktop/src/app/lib/webgal-ipc.ts`(快照创建/列表/重命名/恢复;`SnapshotInfo`)
