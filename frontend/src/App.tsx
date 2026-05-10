import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type DanceAction, DanceCommandProcessor } from './commandProcessor'

type Segment = {
  index: number
  start: number
  end: number
}

type LoopRange = {
  start: number
  end: number
}

type VideoItem = {
  id: string
  name: string
  file: File
  url: string
  createdAt: Date
  durationSec?: number | null
}

type UploadModal = {
  title: string
  message: string
}

type SegmentationMode = 'eight-beat' | 'fallback-10s' | null
type DragTarget = 'left' | 'right' | null
type OnceFlags = { autoGuideShown: boolean; manualGuideShown: boolean }

const MAX_VIDEO_UPLOAD_MB = 50
const MAX_VIDEO_UPLOAD_BYTES = MAX_VIDEO_UPLOAD_MB * 1024 * 1024
const DEVICE_ID_KEY = 'voicedance_device_id'
const ONCE_FLAGS_KEY_PREFIX = 'voicedance_once_flags_'
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim()
const API_BASE_URL = (RAW_API_BASE_URL
  ? /^https?:\/\//i.test(RAW_API_BASE_URL)
    ? RAW_API_BASE_URL
    : `https://${RAW_API_BASE_URL}`
  : ''
).replace(/\/+$/, '')
const ANALYZE_VIDEO_URL = API_BASE_URL ? `${API_BASE_URL}/analyze-video` : '/api/analyze-video'
/** 云端八拍可能数分钟；过短会 Abort，过长则易被边缘断开，见 postAnalyzeWithRetry */
const ANALYZE_FETCH_TIMEOUT_MS = 600_000

/** Safari 等浏览器在跨域/HTTPS 混合内容/连接被断开时常报「Load failed」，与八拍算法无关 */
function formatAnalyzeFetchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (e instanceof DOMException && e.name === 'AbortError') {
    return '请求超时（已超过 10 分钟），可压缩/缩短视频后重试。'
  }
  if (
    /load failed|failed to fetch|networkerror|network request failed|aborted|the user aborted a request/.test(
      lower,
    )
  ) {
    if (import.meta.env.PROD && !API_BASE_URL) {
      return '线上未配置后端地址：请在 Vercel 设置环境变量 VITE_API_BASE_URL=https://你的Railway域名（勿省略 https），并重新部署。'
    }
    return (
      `网络未到达分析服务（${msg}）。请在新标签打开后端「域名/health」确认在线；` +
      `线上必须用 https；云端分析较慢时请多等片刻（已自动重试一次）；Safari 仍失败可换 Chrome；上传文件尽量小于 50MB。`
    )
  }
  return msg
}

/** 跨域长连接偶发被断开时 Safari 报 Load failed，自动重试一次 */
function isRetryableAnalyzeNetworkError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return false
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return /load failed|failed to fetch|networkerror|network request failed/.test(msg)
}

async function postAnalyzeWithRetry(url: string, formData: FormData): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), ANALYZE_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      })
      window.clearTimeout(timeoutId)
      return res
    } catch (e) {
      window.clearTimeout(timeoutId)
      lastErr = e
      if (attempt === 0 && isRetryableAnalyzeNetworkError(e)) {
        await new Promise<void>((r) => {
          window.setTimeout(r, 2000)
        })
        continue
      }
      throw e
    }
  }
  throw lastErr
}

/** 解析八拍分析接口失败时的响应体（兼容 FastAPI detail / 其它 message 字段与纯文本） */
function parseAnalyzeErrorResponse(res: Response, raw: string): string {
  const statusLine = `${res.status} ${res.statusText || ''}`.trim()
  const text = raw.trim()
  let extracted = ''
  if (text) {
    try {
      const body = JSON.parse(text) as {
        detail?: unknown
        message?: unknown
        error?: unknown
      }
      const d = body?.detail ?? body?.message ?? body?.error
      if (typeof d === 'string') extracted = d
      else if (Array.isArray(d))
        extracted = d
          .map((x: unknown) =>
            typeof x === 'object' && x !== null && 'msg' in x && typeof (x as { msg: string }).msg === 'string'
              ? (x as { msg: string }).msg
              : JSON.stringify(x),
          )
          .join('；')
      else if (d != null) extracted = String(d)
    } catch {
      extracted = text.slice(0, 800)
    }
  }
  extracted = extracted.trim()
  if (extracted) return extracted
  return [
    `HTTP ${statusLine}，响应中无具体说明。`,
    '请确认后端已启动：在 backend 目录执行 `uvicorn main:app --reload --host 127.0.0.1 --port 8000`，',
    '浏览器打开 http://127.0.0.1:8000/health 应看到 {"status":"ok"}。',
    '若仍失败，请看运行 uvicorn 的终端里的报错栈。',
  ].join('')
}

const getOrCreateDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

const getFlags = (deviceId: string): OnceFlags => {
  const raw = localStorage.getItem(`${ONCE_FLAGS_KEY_PREFIX}${deviceId}`)
  if (!raw) return { autoGuideShown: false, manualGuideShown: false }
  try {
    const parsed = JSON.parse(raw)
    return {
      autoGuideShown: !!parsed.autoGuideShown,
      manualGuideShown: !!parsed.manualGuideShown,
    }
  } catch {
    return { autoGuideShown: false, manualGuideShown: false }
  }
}

const makeFallbackSegments = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) return [] as Segment[]
  const result: Segment[] = []
  const step = 10
  let cursor = 0
  let i = 1
  while (cursor < duration) {
    const end = Math.min(cursor + step, duration)
    result.push({ index: i, start: cursor, end })
    cursor += step
    i += 1
  }
  return result
}

function App() {
  const [currentPage, setCurrentPage] = useState<'library' | 'practice'>('library')
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [uploadModal, setUploadModal] = useState<UploadModal | null>(null)

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [segments, setSegments] = useState<Segment[]>([])
  const [segmentationMode, setSegmentationMode] = useState<SegmentationMode>(null)
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null)
  const [loadingSegments, setLoadingSegments] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [loopRange, setLoopRange] = useState<LoopRange>({ start: 0, end: 0 })
  const [currentTime, setCurrentTime] = useState(0)
  const [dragging, setDragging] = useState<DragTarget>(null)
  const [subtitleText, setSubtitleText] = useState<string | null>(null)
  const [autoGuideVisible, setAutoGuideVisible] = useState(false)
  const [manualGuideVisible, setManualGuideVisible] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const [onceFlags, setOnceFlags] = useState<OnceFlags>({ autoGuideShown: false, manualGuideShown: false })
  const [mediaPaused, setMediaPaused] = useState(true)
  const [isMirrored, setIsMirrored] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const practiceHeroRef = useRef<HTMLElement | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const processorRef = useRef(new DanceCommandProcessor())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videosRef = useRef<VideoItem[]>([])
  const subtitleTimeoutRef = useRef<number | null>(null)
  const suspendLoopClampUntilRef = useRef(0)
  const loopRangeRef = useRef<LoopRange>({ start: 0, end: 0 })
  /** 已对当前练习页 blob URL 完成过一次分析（成功或已走回退），避免重复请求 */
  const analyzedForUrlRef = useRef<string | null>(null)
  /** 每次发起新的分析递增，用于丢弃过期的异步结果 */
  const analysisGenRef = useRef(0)
  /** 语音识别捕获到「开始说话」时的播放时间，用于循环八拍等指令对齐口令起点 */
  const voiceAnchorTimeRef = useRef<number | null>(null)

  useEffect(() => {
    const id = getOrCreateDeviceId()
    setDeviceId(id)
    setOnceFlags(getFlags(id))
  }, [])

  const setOnceFlag = (flag: keyof OnceFlags) => {
    if (!deviceId || onceFlags[flag]) return
    const next = { ...onceFlags, [flag]: true }
    setOnceFlags(next)
    localStorage.setItem(`${ONCE_FLAGS_KEY_PREFIX}${deviceId}`, JSON.stringify(next))
  }

  const showSubtitle = (text: string) => {
    setSubtitleText(text)
    if (subtitleTimeoutRef.current) {
      window.clearTimeout(subtitleTimeoutRef.current)
    }
    subtitleTimeoutRef.current = window.setTimeout(() => {
      setSubtitleText(null)
    }, 1600)
  }

  const getActionSubtitle = (action: DanceAction) => {
    switch (action.action) {
      case 'play':
        return '播放'
      case 'pause':
        return '暂停'
      case 'seek_to_start':
        return '回到开头'
      case 'fast_forward':
        return `快进 ${action.seconds}s`
      case 'fast_backward':
        return `快退 ${action.seconds}s`
      case 'set_speed':
        return `${action.speed.toFixed(1)} 倍速`
      case 'speed_up':
      case 'speed_down':
        return '调整速度'
      case 'exit_loop':
        return '退出循环'
      case 'loop_eight_beat':
        return '循环这一段'
      case 'loop_next_eight_beat':
        return '循环下一段'
    }
  }

  const resolveVideoDuration = (video: HTMLVideoElement) => {
    const d = Number.isFinite(video.duration) ? video.duration : videoDuration
    return Number.isFinite(d) && d > 0 ? d : 0
  }

  const isLoopActive = (duration: number, range: LoopRange = loopRangeRef.current) => {
    if (duration > 0) {
      return range.start > 0.05 || range.end < duration - 0.05
    }
    // 时长未就绪时，仅当区间明显大于最小拖拽宽度才认为是循环态
    return range.end - range.start > 0.12
  }

  const clearLoop = (duration: number) => {
    if (duration > 0) {
      applyLoopRange(0, duration)
      return
    }
    loopRangeRef.current = { start: 0, end: 0 }
    setLoopRange({ start: 0, end: 0 })
  }

  const seekVideoSafely = (video: HTMLVideoElement, time: number, suspendMs = 220) => {
    const duration = resolveVideoDuration(video)
    const upper = duration > 0 ? duration : Math.max(0, time)
    const bounded = Math.max(0, Math.min(upper, time))
    suspendLoopClampUntilRef.current = Date.now() + suspendMs
    video.currentTime = bounded
    setCurrentTime(bounded)
  }

  const seekWithLoopPolicy = (video: HTMLVideoElement, targetTime: number) => {
    const duration = resolveVideoDuration(video)
    const upper = duration > 0 ? duration : targetTime
    const bounded = Math.max(0, Math.min(upper, targetTime))
    const activeRange = loopRangeRef.current
    const looping = isLoopActive(duration, activeRange)

    // 不在循环态：直接跳转
    if (!looping) {
      seekVideoSafely(video, bounded)
      return
    }

    // 仍在循环区间：保留循环并执行
    if (bounded >= activeRange.start && bounded <= activeRange.end) {
      seekVideoSafely(video, bounded)
      return
    }

    // 跳出循环区间：先退出循环，再执行跳转
    clearLoop(duration)
    seekVideoSafely(video, bounded)
  }

  const nextSpeedByStep = (direction: 'up' | 'down') => {
    const current = playbackRate
    if (direction === 'down') {
      if (Math.abs(current - 1) < 0.01) return 0.5
      const idx = SPEED_PRESETS.findIndex((r) => Math.abs(r - current) < 0.01)
      if (idx <= 0) return SPEED_PRESETS[0]
      return SPEED_PRESETS[idx - 1]
    }
    if (Math.abs(current - 1) < 0.01) return 1.5
    const idx = SPEED_PRESETS.findIndex((r) => Math.abs(r - current) < 0.01)
    if (idx < 0) return 1.5
    return SPEED_PRESETS[Math.min(SPEED_PRESETS.length - 1, idx + 1)]
  }

  const applyLoopRange = (start: number, end: number) => {
    const v = videoDuration || videoRef.current?.duration || 0
    if (!Number.isFinite(v) || v <= 0) return
    const nextStart = Math.max(0, Math.min(start, v - 0.1))
    const nextEnd = Math.min(v, Math.max(end, nextStart + 0.1))
    loopRangeRef.current = { start: nextStart, end: nextEnd }
    setLoopRange({ start: nextStart, end: nextEnd })
  }

  const applyAction = (action: DanceAction) => {
    const video = videoRef.current
    if (!video) return
    if (action.action !== 'speed_up' && action.action !== 'speed_down') {
      showSubtitle(getActionSubtitle(action))
    }
    const duration = resolveVideoDuration(video)
    const looping = isLoopActive(duration)

    switch (action.action) {
      case 'play':
        video.play()
        break
      case 'pause':
        video.pause()
        break
      case 'seek_to_start':
        if (looping) clearLoop(duration)
        seekVideoSafely(video, 0)
        break
      case 'fast_forward': {
        const end = duration || video.currentTime + action.seconds
        const nextTime = Math.min(end, video.currentTime + action.seconds)
        seekWithLoopPolicy(video, nextTime)
        break
      }
      case 'fast_backward': {
        const nextTime = Math.max(0, video.currentTime - action.seconds)
        seekWithLoopPolicy(video, nextTime)
        break
      }
      case 'set_speed':
        setPlaybackRate(action.speed)
        break
      case 'speed_down': {
        const nextRate = nextSpeedByStep('down')
        setPlaybackRate(nextRate)
        showSubtitle(`${nextRate.toFixed(2)} 倍速`)
        break
      }
      case 'speed_up': {
        const nextRate = nextSpeedByStep('up')
        setPlaybackRate(nextRate)
        showSubtitle(`${nextRate.toFixed(2)} 倍速`)
        break
      }
      case 'exit_loop':
        clearLoop(duration)
        break
      case 'loop_eight_beat': {
        let anchor = voiceAnchorTimeRef.current
        voiceAnchorTimeRef.current = null
        if (anchor == null || !Number.isFinite(anchor)) anchor = video.currentTime
        const dur = duration || video.duration || anchor
        anchor = Math.max(0, Math.min(anchor, Number.isFinite(dur) && dur > 0 ? dur : anchor))
        const target =
          segments.find((seg) => anchor >= seg.start && anchor <= seg.end) ?? segments[0]
        if (target) {
          applyLoopRange(target.start, target.end)
          seekVideoSafely(video, target.start)
          video.play()
        }
        break
      }
      case 'loop_next_eight_beat': {
        if (segments.length === 0) break
        let anchor = voiceAnchorTimeRef.current
        voiceAnchorTimeRef.current = null
        if (anchor == null || !Number.isFinite(anchor)) anchor = video.currentTime
        const dur = duration || video.duration || anchor
        anchor = Math.max(0, Math.min(anchor, Number.isFinite(dur) && dur > 0 ? dur : anchor))
        const current = anchor
        let target: Segment | undefined
        for (let i = 0; i < segments.length; i += 1) {
          const seg = segments[i]
          if (current >= seg.start && current <= seg.end) {
            target = segments[i + 1] ?? seg
            break
          }
        }
        if (!target) {
          target = segments.find((seg) => seg.start >= current) ?? segments[segments.length - 1]
        }
        if (target) {
          applyLoopRange(target.start, target.end)
          seekVideoSafely(video, target.start)
          video.play()
        }
        break
      }
    }
  }

  useEffect(() => {
    videosRef.current = videos
  }, [videos])

  useEffect(() => {
    return () => {
      for (const video of videosRef.current) {
        URL.revokeObjectURL(video.url)
      }
      if (subtitleTimeoutRef.current) {
        window.clearTimeout(subtitleTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (currentPage === 'library' && listening) {
      recognitionRef.current?.stop()
      setListening(false)
    }
  }, [currentPage, listening])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.playbackRate = playbackRate
    }
  }, [playbackRate])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === practiceHeroRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    loopRangeRef.current = loopRange
  }, [loopRange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleTimeUpdate = () => {
      if (Date.now() < suspendLoopClampUntilRef.current) {
        setCurrentTime(video.currentTime)
        return
      }
      const duration = resolveVideoDuration(video)
      if (!isLoopActive(duration)) {
        setCurrentTime(video.currentTime)
        return
      }
      const activeRange = loopRangeRef.current
      if (video.currentTime < activeRange.start || video.currentTime > activeRange.end) {
        seekVideoSafely(video, activeRange.start, 80)
        return
      }
      setCurrentTime(video.currentTime)
    }
    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [videoUrl, videoDuration])

  useEffect(() => {
    if (!videoFile || !videoUrl || currentPage !== 'practice') {
      setLoadingSegments(false)
      return
    }
    if (analyzedForUrlRef.current === videoUrl) {
      setLoadingSegments(false)
      return
    }

    const myGen = (analysisGenRef.current += 1)

    const resolveDurationSec = () => {
      const el = videoRef.current
      const fromVideo = el && Number.isFinite(el.duration) ? el.duration : 0
      if (fromVideo > 0) return fromVideo
      return videoDuration > 0 ? videoDuration : 0
    }

    const analyzeVideo = async () => {
      setLoadingSegments(true)
      setError(null)
      setAnalysisNotice(null)
      let markAnalyzed = false
      try {
        const formData = new FormData()
        formData.append('file', videoFile)
        const res = await postAnalyzeWithRetry(ANALYZE_VIDEO_URL, formData)
        if (myGen !== analysisGenRef.current) return

        if (!res.ok) {
          const raw = await res.text()
          throw new Error(parseAnalyzeErrorResponse(res, raw))
        }
        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('application/json')) {
          throw new Error(
            `分析接口返回了非 JSON（${ct || '无 Content-Type'}）。请确认已启动后端 uvicorn（8000）且 Vite 将 /api 代理到该端口。`,
          )
        }
        const data = await res.json()
        const parsed: Segment[] = Array.isArray(data.segments) ? data.segments : []
        if (myGen !== analysisGenRef.current) return
        if (parsed.length > 0) {
          setSegments(parsed)
          setSegmentationMode('eight-beat')
          markAnalyzed = true
          return
        }
        const d0 = resolveDurationSec()
        const fallbackEmpty = makeFallbackSegments(d0)
        if (fallbackEmpty.length > 0) {
          setSegments(fallbackEmpty)
          setSegmentationMode('fallback-10s')
          setAnalysisNotice('无法稳定辨识八拍，已按每 10 秒自动分段。')
          markAnalyzed = true
          return
        }
        if (d0 <= 0) {
          // 等 `<video>` 元数据或 videoDuration 就绪后再跑本 effect 重试
          return
        }
        setError('分析失败，请稍后重试')
        markAnalyzed = true
      } catch (e) {
        if (myGen !== analysisGenRef.current) return
        const d1 = resolveDurationSec()
        const fallback = makeFallbackSegments(d1)
        if (fallback.length > 0) {
          setSegments(fallback)
          setSegmentationMode('fallback-10s')
          const msg = formatAnalyzeFetchError(e)
          setAnalysisNotice(
            msg
              ? `无法完成八拍分析（${msg}），已按每 10 秒自动分段。`
              : '无法稳定辨识八拍，已按每 10 秒自动分段。',
          )
          markAnalyzed = true
        } else if (d1 <= 0) {
          // 时长未知时暂不标记完成，依赖 videoDuration 更新后再次分析
        } else {
          setError('分析失败，请稍后重试')
          markAnalyzed = true
        }
      } finally {
        // 无论代际是否匹配，都要收敛 loading 状态，避免“正在自动识别八拍”悬挂
        setLoadingSegments(false)
        if (myGen === analysisGenRef.current && markAnalyzed) {
          analyzedForUrlRef.current = videoUrl
        }
      }
    }
    void analyzeVideo()
  }, [videoFile, videoUrl, currentPage, videoDuration])

  useEffect(() => {
    if (!segmentationMode || onceFlags.autoGuideShown) return
    setAutoGuideVisible(true)
    setOnceFlag('autoGuideShown')
  }, [segmentationMode, onceFlags.autoGuideShown])

  const getNameFromFile = (file: File) => {
    const raw = file.name.replace(/\.[^/.]+$/, '').trim()
    return raw || '未命名视频'
  }

  const openUploadModal = (title: string, message: string) => {
    setUploadModal({ title, message })
  }

  const handleAddVideoClick = () => {
    fileInputRef.current?.click()
  }

  const handleUploadVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (videos.length >= 3) {
      openUploadModal('上传失败', '最多只能上传 3 个视频，请先删除一个视频再上传。')
      return
    }
    const isMp4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4')
    if (!isMp4) {
      openUploadModal('上传失败', '上传失败，请重新上传 MP4 格式的文件。')
      return
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      openUploadModal('上传失败', `上传失败，视频过大，请上传 ${MAX_VIDEO_UPLOAD_MB}MB 以下的视频。`)
      return
    }
    const url = URL.createObjectURL(file)
    const newVideo: VideoItem = {
      id: crypto.randomUUID(),
      name: getNameFromFile(file),
      file,
      url,
      createdAt: new Date(),
    }
    setVideos((prev) => [...prev, newVideo])
  }

  const handleDeleteVideo = (id: string) => {
    setVideos((prev) => {
      const target = prev.find((v) => v.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((v) => v.id !== id)
    })
    if (videoFile && videos.find((v) => v.id === id)?.file === videoFile) {
      setVideoFile(null)
      setVideoUrl(null)
    }
  }

  const openPractice = (item: VideoItem) => {
    analyzedForUrlRef.current = null
    analysisGenRef.current += 1
    setLoadingSegments(false)
    setVideoFile(item.file)
    setVideoUrl(item.url)
    setSegments([])
    setSegmentationMode(null)
    setAnalysisNotice(null)
    setError(null)
    setPlaybackRate(1)
    setIsMirrored(false)
    setVideoDuration(0)
    setLoopRange({ start: 0, end: 0 })
    setCurrentTime(0)
    setCurrentPage('practice')
  }

  const startEditingVideoName = (item: VideoItem) => {
    setEditingVideoId(item.id)
    setEditingName(item.name)
  }

  const commitEditingVideoName = () => {
    if (!editingVideoId) return
    const trimmed = editingName.trim()
    if (!trimmed) {
      setEditingVideoId(null)
      setEditingName('')
      return
    }
    setVideos((prev) => prev.map((v) => (v.id === editingVideoId ? { ...v, name: trimmed } : v)))
    setEditingVideoId(null)
    setEditingName('')
  }

  const handleBackToLibrary = () => {
    setCurrentPage('library')
    setListening(false)
    recognitionRef.current?.stop()
  }

  const formatCreatedAt = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}年${m}月${day}日`
  }

  const formatDurationMmSs = (totalSeconds: number | null | undefined) => {
    if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--'
    const m = Math.floor(totalSeconds / 60)
    const s = Math.floor(totalSeconds % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const ensureRecognition = () => {
    if (recognitionRef.current) return recognitionRef.current
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('当前浏览器不支持语音识别（需要 Chrome 等支持 Web Speech API 的浏览器）')
      return null
    }
    const recognition: SpeechRecognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onspeechstart = () => {
      const v = videoRef.current
      if (!v) return
      voiceAnchorTimeRef.current = v.currentTime
    }
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1]
      const transcript = last[0].transcript.trim()
      const action = processorRef.current.processCommand(transcript)
      if (action) {
        applyAction(action)
      }
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    return recognition
  }

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop()
      voiceAnchorTimeRef.current = null
      setListening(false)
      return
    }
    const rec = ensureRecognition()
    if (!rec) return
    try {
      rec.start()
      setListening(true)
    } catch {
      setError('无法启动麦克风，请检查权限或重试')
      setListening(false)
    }
  }

  const cyclePlaybackRate = () => {
    const currentIndex = SPEED_PRESETS.findIndex((rate) => Math.abs(rate - playbackRate) < 0.01)
    const nextRate = SPEED_PRESETS[(currentIndex + 1 + SPEED_PRESETS.length) % SPEED_PRESETS.length]
    setPlaybackRate(nextRate)
    showSubtitle(`速度：${nextRate.toFixed(2)}x`)
  }

  const toggleFullscreen = async () => {
    const hero = practiceHeroRef.current
    if (!hero) return
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        setError('无法退出全屏，请重试')
      }
      return
    }
    try {
      await hero.requestFullscreen()
    } catch {
      setError('无法进入全屏，请检查浏览器权限')
    }
  }

  const leftPct = useMemo(
    () => (videoDuration > 0 ? (loopRange.start / videoDuration) * 100 : 0),
    [loopRange.start, videoDuration],
  )
  const rightPct = useMemo(
    () => (videoDuration > 0 ? (loopRange.end / videoDuration) * 100 : 100),
    [loopRange.end, videoDuration],
  )
  const playheadPct = useMemo(
    () => (videoDuration > 0 ? Math.min(100, (currentTime / videoDuration) * 100) : 0),
    [currentTime, videoDuration],
  )

  const beginDrag = (target: DragTarget) => {
    setDragging(target)
    if (target === 'left' && !onceFlags.manualGuideShown) {
      setManualGuideVisible(true)
      setOnceFlag('manualGuideShown')
    }
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect || videoDuration <= 0) return
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const time = ratio * videoDuration
      if (dragging === 'left') {
        applyLoopRange(time, loopRange.end)
      } else if (dragging === 'right') {
        applyLoopRange(loopRange.start, time)
      }
    }
    const onUp = () => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, videoDuration, loopRange])

  const seekByTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!video || !rect || videoDuration <= 0) return
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seekVideoSafely(video, ratio * videoDuration)
  }

  const renderLibraryPage = () => {
    const isLibraryEmpty = videos.length === 0
    return (
      <div className={`library-page${isLibraryEmpty ? ' library-page-empty' : ''}`}>
        <main className={`library-main${isLibraryEmpty ? ' library-main-empty' : ''}`}>
          <header className="library-header">
            <p>最多支持上传 3 个视频</p>
          </header>
          <input ref={fileInputRef} type="file" accept=".mp4,video/mp4" hidden onChange={handleUploadVideo} />
          <div className={`library-grid${isLibraryEmpty ? ' library-grid-empty' : ''}`}>
            {videos.map((video) => (
              <article key={video.id} className="video-card">
                <div className="video-thumb-wrap">
                  <div className="video-container library-card-preview">
                    <video
                      src={video.url}
                      className="video-player"
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration
                        if (!Number.isFinite(d)) return
                        setVideos((prev) =>
                          prev.map((v) =>
                            v.id === video.id && (v.durationSec == null || !Number.isFinite(v.durationSec))
                              ? { ...v, durationSec: d }
                              : v,
                          ),
                        )
                      }}
                    />
                  </div>
                  <div className="video-thumb-overlay" />
                  <span className="duration-chip">{formatDurationMmSs(video.durationSec)}</span>
                </div>
                <div className="video-card-body">
                  <div>
                    {editingVideoId === video.id ? (
                      <input
                        className="video-name-input"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={commitEditingVideoName}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEditingVideoName()
                          if (e.key === 'Escape') {
                            setEditingVideoId(null)
                            setEditingName('')
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <h3 className="video-name" onDoubleClick={() => startEditingVideoName(video)} title="双击重命名">
                        {video.name}
                      </h3>
                    )}
                    <p className="video-meta">上传于 {formatCreatedAt(video.createdAt)}</p>
                  </div>
                  <div className="video-actions">
                    <button className="practice-btn" onClick={() => openPractice(video)}>
                      练习此视频
                    </button>
                    <button className="delete-btn icon-only" onClick={() => handleDeleteVideo(video.id)} title="删除">
                      <svg viewBox="0 0 96 96" aria-hidden="true" className="trash-icon">
                        <path d="M8 24h80" />
                        <path d="M24 24l6 60h36l6-60" />
                        <path d="M35 24V13h26v11" />
                        <path d="M40 40v34" />
                        <path d="M56 40v34" />
                      </svg>
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {videos.length < 3 && (
              <button className="upload-slot" onClick={handleAddVideoClick}>
                <span className="upload-icon">+</span>
                <h3>上传视频</h3>
                <p>
                  仅支持 MP4 格式
                  <br />
                  文件大小不超过 {MAX_VIDEO_UPLOAD_MB}M
                </p>
              </button>
            )}
          </div>
        </main>
      </div>
    )
  }

  const renderPracticePage = () => {
    const practiceTitle =
      videoUrl && videoFile
        ? videos.find((v) => v.url === videoUrl)?.name ?? getNameFromFile(videoFile)
        : '视频标题'

    return (
      <div className="practice-page">
        <main className="practice-main practice-main-stitch">
          <div className="practice-shell">
            <h2 className="practice-hero-title">{practiceTitle}</h2>

            {videoUrl && (
              <section ref={practiceHeroRef} className="practice-hero">
                <div className="practice-hero-inner">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className={`practice-hero-video${isMirrored ? ' is-mirrored' : ''}`}
                    playsInline
                    onPlay={() => setMediaPaused(false)}
                    onPause={() => setMediaPaused(true)}
                    onLoadedMetadata={(e) => {
                      const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0
                      setVideoDuration(d)
                      setMediaPaused(e.currentTarget.paused)
                      if (d > 0) {
                        setLoopRange({ start: 0, end: d })
                      }
                    }}
                  />
                  <div className="practice-hero-scrim" aria-hidden="true" />
                  {subtitleText && <div className="practice-hero-toast">{subtitleText}</div>}
                  <div className="practice-hero-controls">
                    <div className="practice-time-top">
                      <span>{formatDurationMmSs(currentTime)}</span>
                      <span>{formatDurationMmSs(videoDuration)}</span>
                    </div>
                    <div className="practice-timeline-row">
                      <button
                        type="button"
                        className="practice-play-btn"
                        onClick={() => {
                          const v = videoRef.current
                          if (!v) return
                          if (v.paused) void v.play()
                          else v.pause()
                        }}
                        aria-label={mediaPaused ? '播放' : '暂停'}
                      >
                        {mediaPaused ? (
                          <svg className="practice-play-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="currentColor" d="M8 5v14l11-7z" />
                          </svg>
                        ) : (
                          <svg className="practice-play-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                          </svg>
                        )}
                      </button>
                      <div className="loop-timeline-wrap loop-timeline-wrap--hero">
                        <div ref={timelineRef} className="loop-timeline loop-timeline--hero" onClick={seekByTimeline}>
                          <div
                            className="loop-played"
                            style={{ width: `${Math.min(100, playheadPct)}%` }}
                          />
                          <div
                            className={`loop-selection${
                              videoDuration > 0 && loopRange.start <= 0.15 && loopRange.end >= videoDuration - 0.15
                                ? ' is-full-range'
                                : ''
                            }`}
                            style={{ left: `${leftPct}%`, width: `${Math.max(1, rightPct - leftPct)}%` }}
                          />
                          {segments.map((seg) => (
                            <span
                              key={seg.index}
                              className="segment-dot"
                              style={{ left: `${videoDuration > 0 ? (seg.start / videoDuration) * 100 : 0}%` }}
                              title={`第 ${seg.index} 段`}
                            />
                          ))}
                          <span className="playhead-dot" style={{ left: `${playheadPct}%` }} />
                          <button
                            type="button"
                            className="loop-handle left"
                            style={{ left: `${leftPct}%` }}
                            onMouseDown={() => beginDrag('left')}
                            aria-label="拖动左侧循环边界"
                          />
                          <button
                            type="button"
                            className="loop-handle right"
                            style={{ left: `${rightPct}%` }}
                            onMouseDown={() => beginDrag('right')}
                            aria-label="拖动右侧循环边界"
                          />
                          {manualGuideVisible && (
                            <div className="guide-bubble manual-guide" style={{ left: `${leftPct}%` }}>
                              <span>可拖动两端，手动确定循环范围</span>
                              <button type="button" onClick={() => setManualGuideVisible(false)}>
                                知道了
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="practice-quick-controls">
                        <button
                          type="button"
                          className="practice-pill-btn"
                          onClick={cyclePlaybackRate}
                          title="切换播放速度"
                          aria-label="切换播放速度"
                        >
                          <span>{playbackRate.toFixed(2)}x</span>
                        </button>
                        <button
                          type="button"
                          className={`practice-pill-btn${isMirrored ? ' is-active' : ''}`}
                          onClick={() => setIsMirrored((v) => !v)}
                          title="镜像画面"
                          aria-label="镜像画面"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M4 5h8c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1zm12 0h4c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1h-4c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1zM5 7v10h6V7H5zm10 0v10h4V7h-4z"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={`practice-pill-btn${isFullscreen ? ' is-active' : ''}`}
                          onClick={toggleFullscreen}
                          title={isFullscreen ? '退出全屏' : '全屏'}
                          aria-label={isFullscreen ? '退出全屏' : '全屏'}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            {isFullscreen ? (
                              <path
                                fill="currentColor"
                                d="M7 14H5v5h5v-2H7v-3zm12 5h-5v-2h3v-3h2v5zM7 7h3V5H5v5h2V7zm10 0v3h2V5h-5v2h3z"
                              />
                            ) : (
                              <path
                                fill="currentColor"
                                d="M7 14H5v5h5v-2H7v-3zm0-4h3V8H7V5H5v5h2zm10 7h-3v2h5v-5h-2v3zm0-12v3h-3v2h5V5h-2z"
                              />
                            )}
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  {autoGuideVisible && (
                    <div className="guide-bubble auto-guide">
                      <span>
                        {segmentationMode === 'fallback-10s'
                          ? '已自动分段，\n试着说“循环这一段”'
                          : '已自动切分八拍，\n试着说“循环这一段”'}
                      </span>
                      <button type="button" onClick={() => setAutoGuideVisible(false)}>
                        知道了
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {!videoUrl && (
              <div className="practice-video-empty practice-video-empty--hero">
                <div className="practice-hero practice-hero--empty" aria-hidden="true">
                  <div className="practice-video-placeholder">
                    <span className="practice-video-placeholder-label">视频将显示于此</span>
                  </div>
                </div>
                <p className="practice-empty-lead">尚未选择练习视频</p>
                <p className="hint-text practice-empty-hint">
                  请先在视频库上传视频并点击「练习此视频」进入本页。
                </p>
                <button type="button" className="practice-empty-cta" onClick={handleBackToLibrary}>
                  前往视频库
                </button>
              </div>
            )}

            {loadingSegments && <p className="hint-text practice-hint-below">正在自动识别八拍…</p>}
            {analysisNotice && <p className="hint-text practice-hint-below">{analysisNotice}</p>}
            {error && <p className="error-text practice-hint-below">{error}</p>}

            <div className="practice-voice-block">
              <div className="practice-voice-glow-wrap">
                <div className="practice-voice-glow" aria-hidden="true" />
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`voice-listen-btn${listening ? ' is-listening' : ''}`}
                >
                  {listening ? (
                    <>
                      <span className="sound-bars" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>正在聆听……</span>
                    </>
                  ) : (
                    <>
                      <svg className="practice-mic-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"
                        />
                      </svg>
                      <span>开启语音控制</span>
                    </>
                  )}
                </button>
              </div>
              <p className="practice-voice-hints">
                <span className="practice-voice-hint-label">语音指令：</span>
                <span className="practice-voice-hint-muted">播放</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-accent">暂停</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-muted">回到开头</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-accent">快进</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-muted">快进5秒</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-accent">快退</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-muted">快退5秒</span>
                <br />
                <span className="practice-voice-hint-accent">慢速</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-muted">正常速度</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-accent">1.5倍速</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-muted">2倍速</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-accent">循环这个八拍</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-muted">循环下一个八拍</span>
                <span className="practice-voice-sep">·</span>
                <span className="practice-voice-hint-accent">退出循环</span>
              </p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <>
      {currentPage === 'library' ? (
        <div className="top-nav">
          <span>VOICEDANCE</span>
        </div>
      ) : (
        <header className="top-nav top-nav--practice">
          <button type="button" className="practice-nav-back" onClick={handleBackToLibrary}>
            <span className="practice-nav-back-icon" aria-hidden="true">
              ‹
            </span>
            返回
          </button>
          <h1 className="practice-nav-brand">VOICEDANCE</h1>
          <div className="practice-nav-rail" aria-hidden="true" />
        </header>
      )}
      {currentPage === 'library' ? renderLibraryPage() : renderPracticePage()}
      {uploadModal && (
        <div className="modal-overlay" onClick={() => setUploadModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{uploadModal.title}</h3>
            <p>{uploadModal.message}</p>
            <div className="modal-actions">
              <button
                className="modal-primary"
                onClick={() => {
                  setUploadModal(null)
                  handleAddVideoClick()
                }}
              >
                重新选择文件
              </button>
              <button className="modal-secondary" onClick={() => setUploadModal(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
