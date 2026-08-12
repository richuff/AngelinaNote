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

## 构建

```powershell
npm run build         # 生成未安装的应用目录
npm run dist          # 生成 Windows 安装包
npm run dist:win      # 仅生成 NSIS 安装包
npm run dist:portable # 生成 Windows 便携版
```

开发环境的数据库保存在项目 `.data/angelina-note.sqlite`。打包后默认使用 Electron 的
`userData` 目录，也可以通过 `ANGELINA_DATA_DIR` 环境变量指定其他数据目录。

## 项目结构

- `src/main.js`：Electron 主进程、SQLite 表结构和 IPC
- `src/preload.js`：受限的渲染进程数据接口
- `src/index.html`：应用界面
- `src/styles.css`：响应式视觉样式
- `src/app.js`：日历、编辑器、过滤和贴纸交互
- `Angelina/`：原始 PNG、GIF 与 UI 素材
- `Angelina/Fonts/`：可随应用打包的自定义字体资源
