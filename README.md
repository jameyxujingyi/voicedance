# 怎么跳都对（VoiceDance）作品说明

GitHub: `https://github.com/jameyxujingyi/voicedance`  
Vercel: `https://voicedance.vercel.app`

一个给自学舞蹈使用的网页应用：上传舞蹈视频后自动切分八拍，并用中文语音指令控制播放与循环，练舞时尽量不用手动拖进度条。

## 项目做了什么

- 自动分析视频音轨并切分八拍区间
- 支持中文语音指令（播放、暂停、快进、快退、倍速、循环等）
- 支持手动循环拖拽、八拍跳转、镜像与全屏
- 前后端分离部署：前端 Vite + React，后端 FastAPI + librosa + ffmpeg

## 技术栈

- 前端：React + TypeScript + Vite
- 后端：FastAPI + Python
- 音频分析：librosa、numpy、ffmpeg
- 语音识别：Web Speech API

## 作品集提交建议（重点）

建议提交 **`.zip`**，不要用 `.rar`（跨平台兼容更差）。

推荐压缩包结构：

1. `README.md`（本文件，评审先看）
2. `demo-url.txt`（只写线上地址，如 `https://voicedance.vercel.app`）
3. 源码目录（`frontend/`、`backend/`）

不建议作为主提交格式：`.doc`、`.docx`、`.pdf`、`.jpg`（这些只能解释，不能运行项目）。

## 本地运行（评审可复现）

环境要求：

- Node.js 18+
- Python 3.10+
- ffmpeg

启动后端：

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

启动前端（新开终端）：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

## 线上地址（若已部署）

前端：`https://voicedance.vercel.app`  
后端健康检查：`https://voicedance-production.up.railway.app/health`

## 已知说明

- 八拍分析首次请求可能较慢（云端冷启动 + 音频处理耗时）
- 若后端不可达，前端会回退为固定时长分段，保证可继续练习
