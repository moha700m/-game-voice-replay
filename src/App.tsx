import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Circle,
  Download,
  Headphones,
  Mic2,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';

type Clip = {
  id: string;
  url: string;
  blob: Blob;
  duration: number;
  createdAt: Date;
  origin: 'recording' | 'instant' | 'trimmed';
};

type SoundPad = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  blob: Blob;
  start: number;
  end: number;
  enhanced: boolean;
  boostDb: number;
};

type Highlight = {
  id: string;
  label: string;
  detail: string;
  start: number;
  end: number;
  score: number;
};

type CaptureState = 'idle' | 'ready' | 'error';

type StoredClip = {
  id: string;
  blob: Blob;
  duration: number;
  createdAt: number;
  origin: Clip['origin'];
};

type StoredSoundPad = {
  id: string;
  name: string;
  blob: Blob;
  duration: number;
  enhanced: boolean;
  boostDb: number;
  createdAt: number;
};

const CLIP_DB_NAME = 'game-voice-replay';
const CLIP_STORE_NAME = 'clips';
const SOUND_PAD_STORE_NAME = 'soundPads';
const MAX_SAVED_CLIPS = 100;

function openClipDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CLIP_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIP_STORE_NAME)) {
        db.createObjectStore(CLIP_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SOUND_PAD_STORE_NAME)) {
        db.createObjectStore(SOUND_PAD_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadStoredClips(): Promise<Clip[]> {
  const db = await openClipDb();
  try {
    const records = await new Promise<StoredClip[]>((resolve, reject) => {
      const transaction = db.transaction(CLIP_STORE_NAME, 'readonly');
      const request = transaction.objectStore(CLIP_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as StoredClip[]);
      request.onerror = () => reject(request.error);
    });
    return records
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_SAVED_CLIPS)
      .map(record => ({
        id: record.id,
        blob: record.blob,
        url: URL.createObjectURL(record.blob),
        duration: record.duration,
        createdAt: new Date(record.createdAt),
        origin: record.origin,
      }));
  } finally {
    db.close();
  }
}

async function persistClip(clip: Clip) {
  const db = await openClipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CLIP_STORE_NAME, 'readwrite');
      transaction.objectStore(CLIP_STORE_NAME).put({
        id: clip.id,
        blob: clip.blob,
        duration: clip.duration,
        createdAt: clip.createdAt.getTime(),
        origin: clip.origin,
      } satisfies StoredClip);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function deleteStoredClip(id: string) {
  const db = await openClipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CLIP_STORE_NAME, 'readwrite');
      transaction.objectStore(CLIP_STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function clearStoredClips() {
  const db = await openClipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CLIP_STORE_NAME, 'readwrite');
      transaction.objectStore(CLIP_STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function loadStoredSoundPads(): Promise<SoundPad[]> {
  const db = await openClipDb();
  let records: StoredSoundPad[] = [];
  try {
    records = await new Promise<StoredSoundPad[]>((resolve, reject) => {
      const transaction = db.transaction(SOUND_PAD_STORE_NAME, 'readonly');
      const request = transaction.objectStore(SOUND_PAD_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as StoredSoundPad[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }

  if (records.length === 0) return [];

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    const pads = await Promise.all(
      records
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(async record => {
          const arrayBuffer = await record.blob.arrayBuffer();
          const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
          return {
            id: record.id,
            name: record.name,
            buffer,
            blob: record.blob,
            start: 0,
            end: Math.min(record.duration, buffer.duration),
            enhanced: record.enhanced,
            boostDb: record.boostDb ?? 0,
          } satisfies SoundPad;
        })
    );
    return pads;
  } finally {
    await ctx.close();
  }
}

async function persistSoundPad(pad: SoundPad) {
  const db = await openClipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SOUND_PAD_STORE_NAME, 'readwrite');
      transaction.objectStore(SOUND_PAD_STORE_NAME).put({
        id: pad.id,
        name: pad.name,
        blob: pad.blob,
        duration: Math.max(0.05, pad.end - pad.start),
        enhanced: pad.enhanced,
        boostDb: pad.boostDb,
        createdAt: Date.now(),
      } satisfies StoredSoundPad);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function gainFromDb(db: number) {
  return Math.pow(10, db / 20);
}

function applyBoost(samples: Float32Array, gainDb: number) {
  if (gainDb <= 0) return samples.slice();
  const gain = gainFromDb(gainDb);
  const output = new Float32Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const scaled = samples[index] * gain;
    const magnitude = Math.abs(scaled);
    if (magnitude <= 0.92) {
      output[index] = scaled;
      continue;
    }

    const compressed =
      0.92 + (1 - Math.exp(-(magnitude - 0.92) * 3.2)) * 0.08;
    output[index] = Math.sign(scaled) * Math.min(0.999, compressed);
  }

  return output;
}

function detectHighlights(buffer: AudioBuffer): Highlight[] {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const frameSeconds = 0.1;
  const frameSize = Math.max(1, Math.floor(sampleRate * frameSeconds));
  const frames: { rms: number; peak: number }[] = [];

  for (let start = 0; start < channel.length; start += frameSize) {
    const end = Math.min(channel.length, start + frameSize);
    let sum = 0;
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const value = channel[i];
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    frames.push({
      rms: Math.sqrt(sum / Math.max(1, end - start)),
      peak,
    });
  }

  const maxRms = Math.max(...frames.map(frame => frame.rms), 0);
  const maxPeak = Math.max(...frames.map(frame => frame.peak), 0);
  if (maxRms < 0.006 || buffer.duration < 0.4) return [];

  const groupFrames = Math.max(8, Math.round(1.8 / frameSeconds));
  const stepFrames = Math.max(1, Math.round(0.25 / frameSeconds));
  const activeThreshold = Math.max(0.008, maxRms * 0.14);
  const candidates: Highlight[] = [];

  for (let index = 0; index < frames.length; index += stepFrames) {
    const group = frames.slice(
      index,
      Math.min(frames.length, index + groupFrames)
    );
    if (group.length < 3) continue;

    const avgRms =
      group.reduce((sum, frame) => sum + frame.rms, 0) / group.length;
    const peak = Math.max(...group.map(frame => frame.peak));
    let onset = 0;
    let variation = 0;

    for (let i = 1; i < group.length; i += 1) {
      onset = Math.max(onset, group[i].rms - group[i - 1].rms);
      variation += Math.abs(group[i].rms - group[i - 1].rms);
    }
    variation /= Math.max(1, group.length - 1);

    const activeIndexes = group
      .map((frame, groupIndex) =>
        frame.rms >= activeThreshold || frame.peak >= maxPeak * 0.32
          ? groupIndex
          : -1
      )
      .filter(groupIndex => groupIndex >= 0);

    const activeRatio = activeIndexes.length / group.length;
    if (activeRatio < 0.1 || activeIndexes.length === 0) continue;

    const rmsScore = avgRms / Math.max(maxRms, 0.0001);
    const peakScore = peak / Math.max(maxPeak, 0.0001);
    const onsetScore = Math.min(
      1,
      onset / Math.max(maxRms * 0.42, 0.0001)
    );
    const variationScore = Math.min(
      1,
      variation / Math.max(maxRms * 0.28, 0.0001)
    );

    const rawScore =
      rmsScore * 0.34 +
      peakScore * 0.25 +
      onsetScore * 0.27 +
      variationScore * 0.14;

    const firstActive = activeIndexes[0];
    const lastActive = activeIndexes[activeIndexes.length - 1];
    const preciseStart =
      (index + firstActive) * frameSeconds;
    const preciseEnd =
      (index + lastActive + 1) * frameSeconds;

    const start = Math.max(0, preciseStart - 0.12);
    const end = Math.min(buffer.duration, preciseEnd + 0.22);
    if (end - start < 0.25) continue;

    let label = 'مقطع نشط';
    let detail = 'نشاط صوتي واضح ومناسب للحفظ أو المراجعة.';

    if (onsetScore > 0.68) {
      label = 'ارتفاع مفاجئ';
      detail = 'الصوت ارتفع بسرعة؛ غالبًا هنا صار رد أو انفعال.';
    } else if (peakScore > 0.84) {
      label = 'ذروة صوت';
      detail = 'فيه Peak واضح داخل هذا الجزء.';
    } else if (variationScore > 0.5) {
      label = 'تغيّر قوي';
      detail = 'تغيّر سريع في شدة الكلام قد يدل على لحظة ملفتة.';
    }

    candidates.push({
      id:
        start.toFixed(2) +
        '-' +
        end.toFixed(2) +
        '-' +
        index,
      label,
      detail,
      start,
      end,
      score: Math.round(
        Math.min(99, Math.max(1, rawScore * 100))
      ),
    });
  }

  const chosen: Highlight[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const duplicate = chosen.some(item => {
      const overlap =
        Math.max(
          0,
          Math.min(candidate.end, item.end) -
            Math.max(candidate.start, item.start)
        );
      const shorter = Math.max(
        0.001,
        Math.min(
          candidate.end - candidate.start,
          item.end - item.start
        )
      );
      const overlapRatio = overlap / shorter;
      const centerDistance = Math.abs(
        (candidate.start + candidate.end) / 2 -
          (item.start + item.end) / 2
      );

      return overlapRatio > 0.62 && centerDistance < 0.65;
    });

    if (!duplicate) chosen.push(candidate);
    if (chosen.length === 20) break;
  }

  return chosen.sort((a, b) => a.start - b.start);
}

function App() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [decodedBuffer, setDecodedBuffer] = useState<AudioBuffer | null>(null);
  const [cleanMode, setCleanMode] = useState(false);
  const [soundPads, setSoundPads] = useState<SoundPad[]>([]);
  const [soundPadsLoaded, setSoundPadsLoaded] = useState(false);
  const [instantEnabled, setInstantEnabled] = useState(false);
  const [instantDuration, setInstantDuration] = useState<30 | 60 | 120>(30);
  const [instantBufferedSeconds, setInstantBufferedSeconds] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [editorPlaying, setEditorPlaying] = useState(false);
  const [editorCurrentTime, setEditorCurrentTime] = useState(0);
  const [clipsLoaded, setClipsLoaded] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [editorBoostDb, setEditorBoostDb] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const editorAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const instantEnabledRef = useRef(false);
  const instantChunksRef = useRef<Float32Array[]>([]);
  const instantTotalSamplesRef = useRef(0);
  const instantSampleRateRef = useRef(48000);
  const instantUiUpdateRef = useRef(0);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const editorPlaybackContextRef = useRef<AudioContext | null>(null);
  const editorMediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const editorMediaElementRef = useRef<HTMLAudioElement | null>(null);
  const editorGainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    const restoreClips = async () => {
      try {
        const stored = await loadStoredClips();
        if (!cancelled) {
          setClips(stored);
          if (stored[0]) {
            setSelectedClipId(stored[0].id);
            setTrimStart(0);
            setTrimEnd(stored[0].duration);
          }
        }
      } catch {
        if (!cancelled) {
          setError('تعذر تحميل اللقطات المحفوظة من هذا المتصفح.');
        }
      } finally {
        if (!cancelled) setClipsLoaded(true);
      }
    };
    void restoreClips();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreSoundPads = async () => {
      try {
        const storedPads = await loadStoredSoundPads();
        if (!cancelled) setSoundPads(storedPads);
      } catch {
        if (!cancelled) {
          setError('تعذر تحميل أصوات Soundboard المحفوظة.');
        }
      } finally {
        if (!cancelled) setSoundPadsLoaded(true);
      }
    };
    void restoreSoundPads();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveClipLocally = useCallback(async (clip: Clip, notice?: string) => {
    try {
      await persistClip(clip);
      if (notice) {
        setSaveNotice(notice);
        window.setTimeout(() => setSaveNotice(''), 2400);
      }
    } catch {
      setError('تعذر حفظ اللقطة بشكل دائم على هذا الجهاز.');
    }
  }, []);

  const resetInstantBuffer = useCallback(() => {
    instantChunksRef.current = [];
    instantTotalSamplesRef.current = 0;
    setInstantBufferedSeconds(0);
  }, []);

  const cleanupStream = useCallback(() => {
    resetInstantBuffer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (analyserFrameRef.current) {
      cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
  }, [resetInstantBuffer]);

  const setupMeter = useCallback((stream: MediaStream) => {
    if (audioContextRef.current) void audioContextRef.current.close();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextCtor();
    audioContextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain).connect(ctx.destination);
    instantSampleRateRef.current = ctx.sampleRate;
    processor.onaudioprocess = event => {
      if (!instantEnabledRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      instantChunksRef.current.push(copy);
      instantTotalSamplesRef.current += copy.length;

      const maxSamples = Math.floor(ctx.sampleRate * 120);
      while (
        instantTotalSamplesRef.current > maxSamples &&
        instantChunksRef.current.length > 1
      ) {
        const removed = instantChunksRef.current.shift();
        if (removed) instantTotalSamplesRef.current -= removed.length;
      }

      const now = performance.now();
      if (now - instantUiUpdateRef.current > 250) {
        instantUiUpdateRef.current = now;
        setInstantBufferedSeconds(
          Math.min(120, instantTotalSamplesRef.current / ctx.sampleRate)
        );
      }
    };

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg =
        data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);
      setLevel(Math.min(100, Math.round((avg / 160) * 100)));
      analyserFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter(device => device.kind === 'audioinput');
    setDevices(inputs);
    setSelectedDeviceId(current => {
      if (current && inputs.some(device => device.deviceId === current))
        return current;
      const cable = inputs.find(device =>
        /cable output|vb-audio|virtual cable/i.test(device.label)
      );
      return cable?.deviceId || inputs[0]?.deviceId || '';
    });
  }, []);

  const activateCapture = useCallback(
    async (deviceId?: string) => {
      setError('');
      try {
        cleanupStream();
        const constraints: MediaStreamConstraints = {
          audio: deviceId
            ? {
                deviceId: { exact: deviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              }
            : true,
          video: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        setCaptureState('ready');
        setupMeter(stream);
        await refreshDevices();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'تعذر الوصول إلى جهاز الصوت.';
        setError(
          'تعذر تشغيل الالتقاط. اسمح للمتصفح بالمايكروفون ثم اختر CABLE Output أو مصدر صوت اللاعبين. ' +
            message
        );
        setCaptureState('error');
      }
    },
    [cleanupStream, refreshDevices, setupMeter]
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      setError('شغّل التقاط الصوت أولًا، ثم استخدم اختصار التسجيل.');
      return;
    }
    if (recorderRef.current?.state === 'recording') return;

    chunksRef.current = [];
    const mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    const mimeType = mimeCandidates.find(candidate =>
      MediaRecorder.isTypeSupported(candidate)
    );
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const duration = Math.max(
        0.1,
        (Date.now() - startedAtRef.current) / 1000
      );
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      if (blob.size > 0) {
        const clip: Clip = {
          id: crypto.randomUUID(),
          blob,
          url: URL.createObjectURL(blob),
          duration,
          createdAt: new Date(),
          origin: 'recording',
        };
        setClips(current => [clip, ...current].slice(0, MAX_SAVED_CLIPS));
        void saveClipLocally(clip);
        setSelectedClipId(clip.id);
        setTrimStart(0);
        setTrimEnd(duration);
      }
      setRecording(false);
      setElapsed(0);
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };

    recorder.start(250);
    setRecording(true);
    setElapsed(0);
    timerRef.current = window.setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 100);
  }, [saveClipLocally]);

  const toggleRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

  const toggleInstantReplay = useCallback(() => {
    if (!streamRef.current) {
      setError('شغّل التقاط الصوت أولًا، وبعدها فعّل Instant Replay.');
      return;
    }
    setError('');
    const next = !instantEnabledRef.current;
    instantEnabledRef.current = next;
    setInstantEnabled(next);
    resetInstantBuffer();
  }, [resetInstantBuffer]);

  const saveInstantReplay = useCallback(() => {
    const sampleRate = instantSampleRateRef.current;
    const totalSamples = instantTotalSamplesRef.current;
    if (!instantEnabledRef.current || totalSamples < Math.floor(sampleRate * 0.25)) {
      setError('البفر ما جمع صوت كفاية للحين. فعّل Instant Replay وانتظر شوي.');
      return;
    }

    const wantedSamples = Math.min(
      totalSamples,
      Math.floor(sampleRate * instantDuration)
    );
    const output = new Float32Array(wantedSamples);
    let writeOffset = wantedSamples;

    for (let i = instantChunksRef.current.length - 1; i >= 0 && writeOffset > 0; i -= 1) {
      const chunk = instantChunksRef.current[i];
      const take = Math.min(writeOffset, chunk.length);
      writeOffset -= take;
      output.set(chunk.subarray(chunk.length - take), writeOffset);
    }

    const usable = writeOffset === 0 ? output : output.slice(writeOffset);
    const duration = usable.length / sampleRate;
    const blob = encodeWav(usable, sampleRate);
    const clip: Clip = {
      id: crypto.randomUUID(),
      blob,
      url: URL.createObjectURL(blob),
      duration,
      createdAt: new Date(),
      origin: 'instant',
    };

    setClips(current => [clip, ...current].slice(0, MAX_SAVED_CLIPS));
    void saveClipLocally(clip);
    setSelectedClipId(clip.id);
    setTrimStart(0);
    setTrimEnd(duration);
    setCleanMode(false);
    setError('');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById('clip-editor')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    });
  }, [instantDuration, saveClipLocally]);

  const replayLast = useCallback(() => {
    const clip = clips[0];
    if (!clip) {
      setError('ما فيه مقطع مسجل للحين.');
      return;
    }
    const audio = new Audio(clip.url);
    void audio
      .play()
      .catch(() =>
        setError(
          'المتصفح منع التشغيل التلقائي. اضغط تشغيل مرة واحدة من الصفحة.'
        )
      );
  }, [clips]);

  const downloadClip = useCallback((clip: Clip) => {
    const anchor = document.createElement('a');
    anchor.href = clip.url;
    anchor.download =
      'game-voice-' +
      clip.createdAt.toISOString().replace(/[:.]/g, '-') +
      '.webm';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const downloadLast = useCallback(() => {
    if (clips[0]) downloadClip(clips[0]);
    else setError('ما فيه مقطع لحفظه.');
  }, [clips, downloadClip]);

  const deleteClip = useCallback((id: string) => {
    setClips(current => {
      const target = current.find(clip => clip.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter(clip => clip.id !== id);
    });
    setSelectedClipId(current => (current === id ? null : current));
    void deleteStoredClip(id).catch(() =>
      setError('تعذر حذف اللقطة من التخزين الدائم.')
    );
  }, []);

  const selectedClip = clips.find(clip => clip.id === selectedClipId) ?? clips[0] ?? null;

  const openEditor = useCallback((clip: Clip) => {
    editorAudioRef.current?.pause();
    setEditorPlaying(false);
    setEditorCurrentTime(0);
    setEditorBoostDb(0);
    setSelectedClipId(clip.id);
    setTrimStart(0);
    setTrimEnd(clip.duration);
    setCleanMode(false);
    window.requestAnimationFrame(() => {
      document.getElementById('clip-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWaveform([]);
    setDecodedBuffer(null);
    setHighlights([]);
    setEditorPlaying(false);
    setEditorCurrentTime(0);
    setEditorBoostDb(0);
    if (!selectedClip) return;

    const decode = async () => {
      try {
        const ctx = new AudioContext();
        const arrayBuffer = await selectedClip.blob.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        await ctx.close();
        if (cancelled) return;

        const channel = buffer.getChannelData(0);
        const bars = 180;
        const block = Math.max(1, Math.floor(channel.length / bars));
        const peaks = Array.from({ length: bars }, (_, barIndex) => {
          const start = barIndex * block;
          const end = Math.min(channel.length, start + block);
          let peak = 0;
          for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
          return peak;
        });
        const maxPeak = Math.max(...peaks, 0.0001);
        setWaveform(peaks.map(peak => Math.max(0.04, peak / maxPeak)));
        setDecodedBuffer(buffer);
        setHighlights(detectHighlights(buffer));
      } catch {
        if (!cancelled) setError('تعذر تحليل شكل الموجة لهذا التسجيل.');
      }
    };

    void decode();
    return () => {
      cancelled = true;
    };
  }, [selectedClip]);

  const playBufferRange = useCallback(
    (
      buffer: AudioBuffer,
      start: number,
      end: number,
      enhanced: boolean,
      boostDb = 0
    ) => {
    if (playbackContextRef.current) void playbackContextRef.current.close();
    const ctx = new AudioContext();
    playbackContextRef.current = ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    if (enhanced) {
      const channel = buffer.getChannelData(0);
      const from = Math.max(0, Math.floor(start * buffer.sampleRate));
      const to = Math.min(channel.length, Math.ceil(end * buffer.sampleRate));
      let peak = 0;
      for (let i = from; i < to; i += 32) peak = Math.max(peak, Math.abs(channel[i]));
      const normalizeGain = peak > 0 ? Math.min(3, 0.9 / peak) : 1;
      gain.gain.value = normalizeGain * gainFromDb(boostDb);
    } else {
      gain.gain.value = gainFromDb(boostDb);
    }

    source.connect(gain).connect(limiter).connect(ctx.destination);
    source.onended = () => {
      if (playbackContextRef.current === ctx) playbackContextRef.current = null;
      void ctx.close();
    };
    source.start(0, Math.max(0, start), Math.max(0.05, end - start));
  }, []);

  const addToSoundboard = useCallback(() => {
    if (!decodedBuffer || !selectedClip || trimEnd <= trimStart) return;
    const channel = decodedBuffer.getChannelData(0);
    const from = Math.max(0, Math.floor(trimStart * decodedBuffer.sampleRate));
    const to = Math.min(
      channel.length,
      Math.ceil(trimEnd * decodedBuffer.sampleRate)
    );
    const blob = encodeWav(channel.slice(from, to), decodedBuffer.sampleRate);

    setSoundPads(current => {
      const pad: SoundPad = {
        id: crypto.randomUUID(),
        name: 'لقطة ' + (current.length + 1),
        buffer: decodedBuffer,
        blob,
        start: trimStart,
        end: trimEnd,
        enhanced: cleanMode,
        boostDb: editorBoostDb,
      };
      void persistSoundPad(pad).catch(() =>
        setError('تعذر حفظ صوت Soundboard بشكل دائم.')
      );
      return [...current, pad];
    });
  }, [
    cleanMode,
    decodedBuffer,
    editorBoostDb,
    selectedClip,
    trimEnd,
    trimStart,
  ]);

  const addHighlightToSoundboard = useCallback(
    (highlight: Highlight) => {
      if (!decodedBuffer) return;
      const channel = decodedBuffer.getChannelData(0);
      const from = Math.max(
        0,
        Math.floor(highlight.start * decodedBuffer.sampleRate)
      );
      const to = Math.min(
        channel.length,
        Math.ceil(highlight.end * decodedBuffer.sampleRate)
      );
      const blob = encodeWav(channel.slice(from, to), decodedBuffer.sampleRate);

      setSoundPads(current => {
        const pad: SoundPad = {
          id: crypto.randomUUID(),
          name: 'هايلايت ' + (current.length + 1),
          buffer: decodedBuffer,
          blob,
          start: highlight.start,
          end: highlight.end,
          enhanced: true,
          boostDb: 0,
        };
        void persistSoundPad(pad).catch(() =>
          setError('تعذر حفظ صوت Soundboard بشكل دائم.')
        );
        return [...current, pad];
      });
    },
    [decodedBuffer]
  );

  const ensureEditorAudioGraph = useCallback(() => {
    const audio = editorAudioRef.current;
    if (!audio) return null;

    if (
      editorMediaElementRef.current === audio &&
      editorPlaybackContextRef.current &&
      editorGainNodeRef.current
    ) {
      editorGainNodeRef.current.gain.value = gainFromDb(editorBoostDb);
      return editorPlaybackContextRef.current;
    }

    if (editorPlaybackContextRef.current) {
      void editorPlaybackContextRef.current.close();
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    gain.gain.value = gainFromDb(editorBoostDb);
    limiter.threshold.value = -4;
    limiter.knee.value = 8;
    limiter.ratio.value = 18;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    source.connect(gain).connect(limiter).connect(ctx.destination);
    editorPlaybackContextRef.current = ctx;
    editorMediaSourceRef.current = source;
    editorMediaElementRef.current = audio;
    editorGainNodeRef.current = gain;
    return ctx;
  }, [editorBoostDb]);

  useEffect(() => {
    if (editorGainNodeRef.current) {
      editorGainNodeRef.current.gain.value = gainFromDb(editorBoostDb);
    }
  }, [editorBoostDb]);

  const toggleEditorPlayback = useCallback(async () => {
    const audio = editorAudioRef.current;
    if (!audio || !selectedClip) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    const context = ensureEditorAudioGraph();
    if (context?.state === 'suspended') {
      await context.resume();
    }

    if (
      audio.currentTime < trimStart ||
      audio.currentTime >= trimEnd - 0.03
    ) {
      audio.currentTime = trimStart;
      setEditorCurrentTime(trimStart);
    }

    try {
      await audio.play();
    } catch {
      setError('المتصفح منع التشغيل. اضغط تشغيل مرة ثانية.');
    }
  }, [ensureEditorAudioGraph, selectedClip, trimEnd, trimStart]);

  const waveformTimeFromClientX = useCallback(
    (clientX: number) => {
      const element = waveformRef.current;
      if (!element || !selectedClip) return 0;
      const rect = element.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))
      );
      return ratio * selectedClip.duration;
    },
    [selectedClip]
  );

  const saveTrimmedClip = useCallback(() => {
    if (!decodedBuffer || !selectedClip || trimEnd <= trimStart) return;
    const channel = decodedBuffer.getChannelData(0);
    const from = Math.max(0, Math.floor(trimStart * decodedBuffer.sampleRate));
    const to = Math.min(
      channel.length,
      Math.ceil(trimEnd * decodedBuffer.sampleRate)
    );
    const samples = channel.slice(from, to);
    if (samples.length === 0) return;

    const processedSamples = applyBoost(samples, editorBoostDb);
    const blob = encodeWav(processedSamples, decodedBuffer.sampleRate);
    const duration = processedSamples.length / decodedBuffer.sampleRate;
    const clip: Clip = {
      id: crypto.randomUUID(),
      blob,
      url: URL.createObjectURL(blob),
      duration,
      createdAt: new Date(),
      origin: 'trimmed',
    };

    editorAudioRef.current?.pause();
    setEditorPlaying(false);
    setClips(current => [clip, ...current].slice(0, MAX_SAVED_CLIPS));
    void saveClipLocally(clip, 'تم حفظ التعديل في لقطاتك.');
    setSelectedClipId(clip.id);
    setTrimStart(0);
    setTrimEnd(duration);
    setEditorCurrentTime(0);
    setCleanMode(false);
  }, [
    decodedBuffer,
    editorBoostDb,
    saveClipLocally,
    selectedClip,
    trimEnd,
    trimStart,
  ]);

  useEffect(() => {
    void refreshDevices();
    const handleDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener(
      'devicechange',
      handleDeviceChange
    );
    return () => {
      navigator.mediaDevices?.removeEventListener(
        'devicechange',
        handleDeviceChange
      );
      cleanupStream();
    };
  }, [cleanupStream, refreshDevices]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      if (event.code === 'Digit1') {
        event.preventDefault();
        toggleRecording();
      }
      if (event.code === 'Digit2') {
        event.preventDefault();
        replayLast();
      }
      if (event.code === 'Digit3') {
        event.preventDefault();
        downloadLast();
      }
      if (event.code === 'Digit4') {
        event.preventDefault();
        saveInstantReplay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [downloadLast, replayLast, saveInstantReplay, toggleRecording]);

  const clearAll = () => {
    clips.forEach(clip => URL.revokeObjectURL(clip.url));
    setClips([]);
    setSelectedClipId(null);
    setTrimStart(0);
    setTrimEnd(0);
    void clearStoredClips().catch(() =>
      setError('تعذر مسح اللقطات من التخزين الدائم.')
    );
  };

  const statusLabel =
    captureState === 'ready'
      ? 'متصل'
      : captureState === 'error'
        ? 'يحتاج ضبط'
        : 'غير متصل';

  return (
    <main dir="rtl" className="shell">
      <section className="hero">
        <div>
          <div className="eyebrow">
            <Radio size={16} /> GAME VOICE REPLAY
          </div>
          <h1>
            سجّل صوت اللاعب.
            <br />
            وأعده بضغطة.
          </h1>
          <p>
            صفحة محلية وسريعة لالتقاط Voice Chat من VB-CABLE أو أي مدخل صوت، مع
            تسجيل فوري وإعادة آخر مقطع.
          </p>
        </div>
        <div className={'status-pill ' + captureState}>
          <span className="status-dot" />
          {statusLabel}
        </div>
      </section>

      <section className="panel device-panel">
        <div className="panel-title">
          <div className="icon-box">
            <Headphones size={22} />
          </div>
          <div>
            <h2>مصدر صوت اللاعبين</h2>
            <p>اختر CABLE Output إذا كنت ممرر Voice Chat عبر VB-CABLE.</p>
          </div>
        </div>

        <div className="device-row">
          <select
            aria-label="مصدر الصوت"
            value={selectedDeviceId}
            onChange={event => setSelectedDeviceId(event.target.value)}
          >
            <option value="">اختيار تلقائي</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || 'مدخل صوت ' + (index + 1)}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            onClick={() => void activateCapture(selectedDeviceId)}
          >
            <Mic2 size={18} />
            تشغيل الالتقاط
          </button>
        </div>

        <div className="meter-wrap" aria-label="مستوى الصوت">
          <div className="meter-label">
            <span>مستوى الصوت</span>
            <strong>{level}%</strong>
          </div>
          <div className="meter">
            <span style={{ width: level + '%' }} />
          </div>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      <section className="panel instant-panel">
        <div className="instant-head">
          <div>
            <div className="editor-kicker"><RotateCcw size={16} /> INSTANT REPLAY</div>
            <h2>خذ اللي صار قبل ما تضغط</h2>
            <p>يحفظ آخر 120 ثانية داخل ذاكرة المتصفح فقط. اختر المدة ثم خذ آخر جزء فورًا.</p>
          </div>
          <div className={instantEnabled ? 'instant-live on' : 'instant-live'}>
            <span />
            {instantEnabled ? 'البفر شغال' : 'البفر متوقف'}
          </div>
        </div>

        <div className="instant-controls">
          <button
            className={instantEnabled ? 'instant-toggle active' : 'instant-toggle'}
            onClick={toggleInstantReplay}
          >
            <Circle size={16} fill="currentColor" />
            {instantEnabled ? 'إيقاف البفر' : 'تشغيل البفر'}
          </button>

          <div className="duration-switch" aria-label="مدة Instant Replay">
            {([30, 60, 120] as const).map(seconds => (
              <button
                key={seconds}
                className={instantDuration === seconds ? 'active' : ''}
                onClick={() => setInstantDuration(seconds)}
              >
                {seconds}ث
              </button>
            ))}
          </div>

          <button
            className="instant-save"
            disabled={!instantEnabled || instantBufferedSeconds < 0.25}
            onClick={saveInstantReplay}
          >
            <Scissors size={18} />
            خذ آخر {instantDuration} ثانية
            <small>Ctrl + Shift + 4</small>
          </button>
        </div>

        <div className="instant-buffer">
          <div>
            <span>المتوفر الآن</span>
            <strong>{instantBufferedSeconds.toFixed(1)} ث</strong>
          </div>
          <div className="instant-progress">
            <span
              style={{
                width:
                  Math.min(100, (instantBufferedSeconds / instantDuration) * 100) +
                  '%',
              }}
            />
          </div>
          <small>
            {instantBufferedSeconds >= instantDuration
              ? 'جاهز لحفظ المدة كاملة.'
              : 'البفر يتعبّى تلقائيًا وأنت تلعب.'}
          </small>
        </div>
      </section>

      <section className="control-grid">
        <button
          className={'record-card ' + (recording ? 'recording' : '')}
          onClick={toggleRecording}
        >
          <span className="record-icon">
            <Circle size={30} fill="currentColor" />
          </span>
          <span>
            <small>Ctrl + Shift + 1</small>
            <strong>{recording ? 'إيقاف وحفظ المقطع' : 'ابدأ التسجيل'}</strong>
            <em>
              {recording
                ? elapsed.toFixed(1) + ' ثانية'
                : 'اضغط مرة للتسجيل ومرة للإيقاف'}
            </em>
          </span>
        </button>

        <button className="action-card" onClick={replayLast}>
          <span className="action-icon">
            <RotateCcw size={24} />
          </span>
          <span>
            <small>Ctrl + Shift + 2</small>
            <strong>أعد آخر صوت</strong>
            <em>تشغيل آخر مقطع مباشرة</em>
          </span>
        </button>

        <button className="action-card" onClick={downloadLast}>
          <span className="action-icon">
            <Download size={24} />
          </span>
          <span>
            <small>Ctrl + Shift + 3</small>
            <strong>احفظ آخر مقطع</strong>
            <em>تنزيله على جهازك</em>
          </span>
        </button>
      </section>

      <section className="hotkey-note">
        <Volume2 size={20} />
        <div>
          <strong>اختصارات سريعة</strong>
          <p>
            Ctrl + Shift + 1 للتسجيل، Ctrl + Shift + 2 لإعادة آخر صوت، Ctrl + Shift + 3 للحفظ، وCtrl + Shift + 4 لأخذ Instant Replay. تعمل عندما تكون صفحة الموقع نشطة.
          </p>
        </div>
      </section>

      <section className="panel clips-panel">
        <div className="clips-head">
          <div>
            <h2>لقطاتي المحفوظة</h2>
            <p>
              تُحفظ تلقائيًا على هذا الجهاز وتعود بعد إغلاق الموقع وفتحه مرة ثانية.
            </p>
          </div>
          {clips.length > 0 && (
            <button className="ghost danger" onClick={clearAll}>
              <Trash2 size={16} /> مسح الكل
            </button>
          )}
        </div>

        {!clipsLoaded ? (
          <div className="empty">
            <div className="empty-icon">
              <Volume2 size={30} />
            </div>
            <strong>جاري تحميل لقطاتك...</strong>
          </div>
        ) : clips.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <Volume2 size={30} />
            </div>
            <strong>ما سجلنا شيء للحين</strong>
            <span>شغّل الالتقاط ثم ابدأ أول تسجيل.</span>
          </div>
        ) : (
          <div className="clip-list">
            {clips.map((clip, index) => (
              <article className="clip" key={clip.id}>
                <div className="clip-index">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div className="clip-meta">
                  <strong>
                    {index === 0
                      ? clip.origin === 'instant'
                        ? 'آخر Instant Replay'
                        : clip.origin === 'trimmed'
                          ? 'آخر قص'
                          : 'آخر مقطع'
                      : clip.origin === 'instant'
                        ? 'Instant Replay'
                        : clip.origin === 'trimmed'
                          ? 'قص محفوظ'
                          : 'مقطع ' + (clips.length - index)}
                  </strong>
                  <span>
                    {clip.createdAt.toLocaleTimeString('ar-SA')} ·{' '}
                    {clip.duration.toFixed(1)} ث
                  </span>
                </div>
                <button
                  className="icon-button"
                  aria-label="تشغيل المقطع"
                  onClick={() => void new Audio(clip.url).play()}
                >
                  <Play size={18} fill="currentColor" />
                </button>
                <button
                  className="icon-button edit"
                  aria-label="فتح المقطع في المحرر"
                  onClick={() => openEditor(clip)}
                >
                  <Scissors size={18} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label="حذف المقطع"
                  onClick={() => deleteClip(clip.id)}
                >
                  <Trash2 size={18} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedClip && (
        <section id="clip-editor" className="panel editor-panel">
          <div className="editor-head">
            <div>
              <div className="editor-kicker">
                <Scissors size={16} /> محرر القص
              </div>
              <h2>اسحب على الموجة وحدد الصوت اللي تبيه</h2>
              <p>
                الموجة توضح قوة الصوت: الأعمدة الطويلة صوت أعلى، والقصيرة صوت
                أهدأ. اسحب من البداية للنهاية ثم شغّل أو أوقف الجزء المحدد.
              </p>
            </div>
            <div className="selection-time">
              {trimStart.toFixed(1)}s — {trimEnd.toFixed(1)}s
            </div>
          </div>

          <audio
            ref={editorAudioRef}
            src={selectedClip.url}
            preload="metadata"
            onPlay={() => setEditorPlaying(true)}
            onPause={() => setEditorPlaying(false)}
            onEnded={() => setEditorPlaying(false)}
            onTimeUpdate={event => {
              const audio = event.currentTarget;
              setEditorCurrentTime(audio.currentTime);
              if (audio.currentTime >= trimEnd && trimEnd > trimStart) {
                audio.pause();
                audio.currentTime = trimStart;
                setEditorCurrentTime(trimStart);
              }
            }}
          />

          <div className="boost-panel">
            <div className="boost-head">
              <div className="boost-title">
                <span className="boost-icon">
                  <Volume2 size={19} />
                </span>
                <div>
                  <strong>Boost الصوت</strong>
                  <small>ارفع قوة الصوت مع Limiter لتقليل التشويه.</small>
                </div>
              </div>
              <b>{editorBoostDb === 0 ? 'عادي' : '+' + editorBoostDb + ' dB'}</b>
            </div>

            <input
              aria-label="قوة Boost الصوت"
              type="range"
              min="0"
              max="12"
              step="1"
              value={editorBoostDb}
              onChange={event => setEditorBoostDb(Number(event.target.value))}
            />

            <div className="boost-presets" aria-label="اختيارات Boost سريعة">
              {[0, 3, 6, 9, 12].map(db => (
                <button
                  key={db}
                  className={editorBoostDb === db ? 'active' : ''}
                  onClick={() => setEditorBoostDb(db)}
                >
                  {db === 0 ? 'عادي' : '+' + db + ' dB'}
                </button>
              ))}
            </div>
          </div>

          <div className="timeline-card trim-timeline">
            <div className="waveform-guide">
              <span>صوت هادئ</span>
              <strong>اسحب على الموجة لتحديد القص</strong>
              <span>صوت مرتفع</span>
            </div>
            <div className="timeline-scale">
              <span>0.0</span>
              <span>{(selectedClip.duration / 2).toFixed(1)}</span>
              <span>{selectedClip.duration.toFixed(1)} ثانية</span>
            </div>

            <div
              ref={waveformRef}
              className="waveform waveform-editor"
              aria-label="موجة الصوت وتحديد القص"
              onPointerDown={event => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const time = waveformTimeFromClientX(event.clientX);
                selectionAnchorRef.current = time;
                editorAudioRef.current?.pause();
                if (editorAudioRef.current) editorAudioRef.current.currentTime = time;
                setEditorCurrentTime(time);
                setTrimStart(time);
                setTrimEnd(Math.min(selectedClip.duration, time + 0.08));
              }}
              onPointerMove={event => {
                const anchor = selectionAnchorRef.current;
                if (anchor === null) return;
                const time = waveformTimeFromClientX(event.clientX);
                const start = Math.min(anchor, time);
                const end = Math.max(anchor, time);
                setTrimStart(start);
                setTrimEnd(
                  Math.min(selectedClip.duration, Math.max(start + 0.08, end))
                );
              }}
              onPointerUp={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                selectionAnchorRef.current = null;
              }}
              onPointerCancel={() => {
                selectionAnchorRef.current = null;
              }}
            >
              <div className="wave-center-line" />
              {waveform.length === 0 ? (
                <div className="waveform-loading">جاري تحليل موجة الصوت...</div>
              ) : (
                waveform.map((height, index) => {
                  const time = (index / waveform.length) * selectedClip.duration;
                  const active = time >= trimStart && time <= trimEnd;
                  return (
                    <span
                      key={index}
                      className={active ? 'wave-bar active' : 'wave-bar'}
                      style={{ height: Math.max(5, height * 94) + '%' }}
                    />
                  );
                })
              )}

              <div
                className="selection-region"
                style={{
                  left: (trimStart / selectedClip.duration) * 100 + '%',
                  width:
                    ((trimEnd - trimStart) / selectedClip.duration) * 100 + '%',
                }}
              >
                <span className="trim-handle trim-handle-start">
                  {trimStart.toFixed(1)}
                </span>
                <span className="trim-handle trim-handle-end">
                  {trimEnd.toFixed(1)}
                </span>
              </div>

              <div
                className="playhead"
                style={{
                  left:
                    (Math.min(editorCurrentTime, selectedClip.duration) /
                      selectedClip.duration) *
                      100 +
                    '%',
                }}
              />
            </div>

            <div className="precision-grid">
              <label>
                <span>بداية القص</span>
                <strong>{trimStart.toFixed(1)} ث</strong>
                <input
                  aria-label="بداية القص"
                  type="range"
                  min="0"
                  max={Math.max(0, selectedClip.duration - 0.1)}
                  step="0.05"
                  value={Math.min(
                    trimStart,
                    Math.max(0, selectedClip.duration - 0.1)
                  )}
                  onChange={event => {
                    const next = Number(event.target.value);
                    const value = Math.min(next, Math.max(0, trimEnd - 0.08));
                    setTrimStart(value);
                    if (editorAudioRef.current) {
                      editorAudioRef.current.currentTime = value;
                    }
                    setEditorCurrentTime(value);
                  }}
                />
              </label>

              <label>
                <span>نهاية القص</span>
                <strong>{trimEnd.toFixed(1)} ث</strong>
                <input
                  aria-label="نهاية القص"
                  type="range"
                  min="0.08"
                  max={selectedClip.duration}
                  step="0.05"
                  value={trimEnd}
                  onChange={event => {
                    const next = Number(event.target.value);
                    setTrimEnd(Math.max(next, trimStart + 0.08));
                  }}
                />
              </label>
            </div>
          </div>

          <div className="editor-transport editor-transport-near-save">
            <button
              className={editorPlaying ? 'transport-play playing' : 'transport-play'}
              onClick={toggleEditorPlayback}
            >
              {editorPlaying ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" />
              )}
              <span>{editorPlaying ? 'إيقاف' : 'تشغيل المحدد'}</span>
            </button>
            <div className="transport-readout">
              <span>المؤشر</span>
              <strong>{editorCurrentTime.toFixed(1)} ث</strong>
            </div>
            <div className="transport-readout">
              <span>مدة القص</span>
              <strong>{Math.max(0, trimEnd - trimStart).toFixed(1)} ث</strong>
            </div>
          </div>

          {saveNotice && <div className="save-notice">{saveNotice}</div>}

          <div className="editor-actions editor-cut-actions">
            <button
              className="editor-primary cut-save"
              onClick={saveTrimmedClip}
              disabled={!decodedBuffer || trimEnd <= trimStart}
            >
              <Scissors size={18} />
              حفظ التعديل في لقطاتي
            </button>
            <button
              className="ghost"
              onClick={() => {
                if (!decodedBuffer || trimEnd <= trimStart) return;
                const channel = decodedBuffer.getChannelData(0);
                const from = Math.max(
                  0,
                  Math.floor(trimStart * decodedBuffer.sampleRate)
                );
                const to = Math.min(
                  channel.length,
                  Math.ceil(trimEnd * decodedBuffer.sampleRate)
                );
                const samples = applyBoost(
                  channel.slice(from, to),
                  editorBoostDb
                );
                const blob = encodeWav(samples, decodedBuffer.sampleRate);
                const anchor = document.createElement('a');
                anchor.href = URL.createObjectURL(blob);
                anchor.download =
                  'game-voice-edit-' +
                  new Date().toISOString().replace(/[:.]/g, '-') +
                  '.wav';
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                window.setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
              }}
              disabled={!decodedBuffer || trimEnd <= trimStart}
            >
              <Download size={17} />
              تنزيل التعديل
            </button>
            <button
              className="ghost"
              onClick={() => {
                editorAudioRef.current?.pause();
                if (editorAudioRef.current) editorAudioRef.current.currentTime = 0;
                setEditorCurrentTime(0);
                setTrimStart(0);
                setTrimEnd(selectedClip.duration);
                setCleanMode(false);
                setEditorBoostDb(0);
              }}
            >
              <RotateCcw size={17} />
              تحديد التسجيل كامل
            </button>
            <button
              className="soundboard-add"
              onClick={addToSoundboard}
              disabled={!decodedBuffer}
            >
              <Plus size={17} />
              أضف المحدد إلى Soundboard
            </button>
          </div>
        </section>
      )}

      {selectedClip && (
        <section className="panel highlights-panel">
          <div className="soundboard-head">
            <div>
              <div className="editor-kicker"><Sparkles size={16} /> SMART HIGHLIGHTS</div>
              <h2>اللحظات المقترحة</h2>
              <p>تحليل أدق كل 0.1 ثانية تقريبًا ويطلع حتى 20 لحظة. الصوت ما يطلع من جهازك.</p>
            </div>
            <span>{highlights.length} اقتراحات</span>
          </div>

          {!decodedBuffer ? (
            <div className="highlights-empty">جاري تحليل المقطع...</div>
          ) : highlights.length === 0 ? (
            <div className="highlights-empty">
              ما لقيت ذروة واضحة في هذا المقطع. جرّب تسجيل أطول أو فيه كلام أكثر.
            </div>
          ) : (
            <div className="highlights-grid">
              {highlights.map(highlight => (
                <article className="highlight-card" key={highlight.id}>
                  <div className="highlight-top">
                    <div>
                      <strong>{highlight.label}</strong>
                      <span>{highlight.detail}</span>
                    </div>
                    <b>{highlight.score}%</b>
                  </div>
                  <div className="highlight-time">
                    {highlight.start.toFixed(1)}s — {highlight.end.toFixed(1)}s
                  </div>
                  <div className="highlight-actions">
                    <button
                      onClick={() =>
                        decodedBuffer &&
                        playBufferRange(
                          decodedBuffer,
                          highlight.start,
                          highlight.end,
                          true
                        )
                      }
                    >
                      <Play size={15} fill="currentColor" /> تشغيل
                    </button>
                    <button
                      onClick={() => {
                        setTrimStart(highlight.start);
                        setTrimEnd(highlight.end);
                        setCleanMode(true);
                        document.getElementById('clip-editor')?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'center',
                        });
                      }}
                    >
                      <Scissors size={15} /> افتح بالمحرر
                    </button>
                    <button onClick={() => addHighlightToSoundboard(highlight)}>
                      <Plus size={15} /> Soundboard
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {(soundPadsLoaded || soundPads.length > 0) && (
        <section className="panel soundboard-panel">
          <div className="soundboard-head">
            <div>
              <div className="editor-kicker"><Music2 size={16} /> SOUNDBOARD</div>
              <h2>لوحة الأصوات</h2>
              <p>
                كل زر محفوظ تلقائيًا ومحمي من الحذف، ويرجع بعد إغلاق Chrome.
              </p>
            </div>
            <span>{soundPads.length} أصوات</span>
          </div>
          {!soundPadsLoaded ? (
            <div className="highlights-empty">جاري تحميل Soundboard المحفوظ...</div>
          ) : soundPads.length === 0 ? (
            <div className="highlights-empty">
              ما أضفت أصوات للـSoundboard للحين.
            </div>
          ) : (
          <div className="soundboard-grid">
            {soundPads.map((pad, index) => (
              <div className="sound-pad" key={pad.id}>
                <button
                  onClick={() =>
                    playBufferRange(
                      pad.buffer,
                      pad.start,
                      pad.end,
                      pad.enhanced,
                      pad.boostDb
                    )
                  }
                >
                  <Play size={20} fill="currentColor" />
                  <strong>{pad.name}</strong>
                  <small>
                    {(pad.end - pad.start).toFixed(1)} ث
                    {pad.enhanced ? ' · منظّف' : ''}
                    {pad.boostDb > 0 ? ' · +' + pad.boostDb + ' dB' : ''}
                  </small>
                </button>
                <div className="pad-footer">
                  <input
                    aria-label={'اسم زر الصوت ' + (index + 1)}
                    value={pad.name}
                    onChange={event => {
                      const name = event.target.value;
                      setSoundPads(current =>
                        current.map(item => {
                          if (item.id !== pad.id) return item;
                          const updated = { ...item, name };
                          void persistSoundPad(updated).catch(() =>
                            setError('تعذر حفظ اسم صوت Soundboard.')
                          );
                          return updated;
                        })
                      );
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          )}
        </section>
      )}

      <footer>
        <span>
          Local-first · لقطاتك وSoundboard محفوظة على هذا الجهاز ولا تُرفع تلقائيًا
        </span>
        <span>أفضل نتيجة: Chrome/Edge + VB-CABLE</span>
      </footer>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

export default App;
