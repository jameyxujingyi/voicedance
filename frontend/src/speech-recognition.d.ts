/**
 * Web Speech API types (not in all TS DOM libs).
 * https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
 */
interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onend: (() => void) | null
  /** 检测到用户开始说话（用于记录指令对应的时间点，减轻识别延迟） */
  onspeechstart: (() => void) | null
  onsoundstart: (() => void) | null
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition
  new (): SpeechRecognition
}

declare var webkitSpeechRecognition: {
  prototype: SpeechRecognition
  new (): SpeechRecognition
}
