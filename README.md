# 怎么跳都对 · 练舞助手

上传舞蹈视频，自动识别八拍，用中文语音控制播放（不用手拖进度条）。

## 环境要求

- **Node.js** 18+（前端）  
- **Python** 3.10+（后端，用于八拍分析）  
- **ffmpeg**（后端分析视频用，macOS: `brew install ffmpeg`）

## 发给朋友时发什么

把整个项目文件夹打包（zip 等）发给他们即可。**不要**把下面这些打进去（太大且没必要）：

- `frontend/node_modules/`
- `backend` 里若有 `.venv`、`__pycache__`、`*.pyc`

对方拿到后按下面步骤安装依赖并运行即可。

---

## 运行步骤

需要**开两个终端**，一个跑后端，一个跑前端。

### 1. 启动后端（Python）

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

看到 `Uvicorn running on http://127.0.0.1:8000` 即表示后端已启动。**不要关这个终端。**

### 2. 启动前端（网页）

**新开一个终端**，执行：

```bash
cd frontend
npm install
npm run dev
```

终端里会给出本地地址，一般是 `http://localhost:5173`。用浏览器打开这个地址即可使用。

### 3. 使用方式

1. 在网页里上传一段舞蹈视频。  
2. 点击「自动识别八拍」，等待约 1–2 分钟。  
3. 右侧会列出每个八拍的时间段，可点击「跳这个八拍」循环某一段。  
4. 点击「开始语音指令」，用中文说：播放、暂停、快进、快退、慢一点、原速、两倍速、循环这个八拍 等。

---

## 常见问题

- **分析失败 / 无法连接后端**  
  确保先在后端目录执行了 `pip install -r requirements.txt` 和 `uvicorn main:app --reload --port 8000`，且终端里没有报错。  
- **分析很慢**  
  八拍分析需要几十秒到一两分钟，属于正常，请耐心等待。  
- **语音指令没反应**  
  需使用支持 Web 语音识别的浏览器（如 Chrome），并允许麦克风权限。

---

## 可选：打包成静态网页部署

若只想在一台电脑上长期使用，可把前端打成静态文件，用浏览器直接打开（需同时在本机运行后端）：

```bash
cd frontend
npm run build
```

生成在 `frontend/dist/`。用浏览器打开 `dist/index.html` 时，需保证后端在 `http://localhost:8000` 运行，且前端请求需能访问到该地址（本地用可把请求改为 `http://localhost:8000` 或通过简单静态服务器代理）。

日常开发使用推荐直接 `npm run dev` + 后端 `uvicorn` 即可。
