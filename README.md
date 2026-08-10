# Angelina Note

以年份为书架、以每一天为页面的 Electron 桌面记事本。

## 功能

- 年份书架与可自定义年度标题、副标题
- 月历视图与每日富文本记录
- 加粗、斜体、下划线、列表、引用和艺术字体
- 自定义标签及按标签过滤
- 使用 Angelina 原始素材的贴纸库
- 贴纸拖拽、旋转、缩放、随机摆放与持久化
- 自动保存与 SQLite 本地数据库

## 运行

```powershell
npm install
npm start
```

数据库文件保存在 Electron 的 `userData` 目录中，文件名为 `angelina-note.sqlite`。

## 项目结构

- `src/main.js`：Electron 主进程、SQLite 表结构和 IPC
- `src/preload.js`：受限的渲染进程数据接口
- `src/index.html`：应用界面
- `src/styles.css`：响应式视觉样式
- `src/app.js`：日历、编辑器、过滤和贴纸交互
- `Angelina/`：原始 PNG、GIF 与 UI 素材
