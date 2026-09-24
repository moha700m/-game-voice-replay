import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Circle,
  Download,
  Headphones,
  Mic2,
  Music2,
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
};

type SoundPad = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  start: number;
  end: number;
  enhanced: boolean;
};

type CaptureState = 'idle' | 'ready' | 'error';

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

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const editorAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);

  const cleanupStream = useCallback(() => {
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
  }, []);

  const setupMeter = useCallback((stream: MediaStream) => {
    if (audioContextRef.current) void audioContextRef.current.close();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextCtor();
    audioContextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
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
        };
        setClips(current => [clip, ...current].slice(0, 30));
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
  }, []);

  const toggleRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

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
  }, []);

  const selectedClip = clips.find(clip => clip.id === selectedClipId) ?? clips[0] ?? null;

  const openEditor = useCallback((clip: Clip) => {
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
    if (!selectedClip) return;

    const decode = async () => {
      try {
        const ctx = new AudioContext();
        const arrayBuffer = await selectedClip.blob.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        await ctx.close();
        if (cancelled) return;

        const channel = buffer.getChannelData(0);
        const bars = 140;
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
      } catch {
        if (!cancelled) setError('تعذر تحليل شكل الموجة لهذا التسجيل.');
      }
    };

    void decode();
    return () => {
      cancelled = true;
    };
  }, [selectedClip]);

  const playBufferRange = useCallback((buffer: AudioBuffer, start: number, end: number, enhanced: boolean) => {
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
      gain.gain.value = peak > 0 ? Math.min(3, 0.9 / peak) : 1;
    } else {
      gain.gain.value = 1;
    }

    source.connect(gain).connect(limiter).connect(ctx.destination);
    source.onended = () => {
      if (playbackContextRef.current === ctx) playbackContextRef.current = null;
      void ctx.close();
    };
    source.start(0, Math.max(0, start), Math.max(0.05, end - start));
  }, []);

  const autoCleanSelection = useCallback(() => {
    if (!decodedBuffer) return;
    const channel = decodedBuffer.getChannelData(0);
    const sampleRate = decodedBuffer.sampleRate;
    const windowSize = Math.max(1, Math.floor(sampleRate * 0.012));
    const threshold = 0.025;
    let first = 0;
    let last = channel.length - 1;
    let found = false;

    for (let i = 0; i < channel.length; i += windowSize) {
      let peak = 0;
      const end = Math.min(channel.length, i + windowSize);
      for (let j = i; j < end; j += 1) peak = Math.max(peak, Math.abs(channel[j]));
      if (peak >= threshold) {
        first = i;
        found = true;
        break;
      }
    }

    if (found) {
      for (let i = channel.length - windowSize; i >= 0; i -= windowSize) {
        let peak = 0;
        const end = Math.min(channel.length, i + windowSize);
        for (let j = Math.max(0, i); j < end; j += 1) peak = Math.max(peak, Math.abs(channel[j]));
        if (peak >= threshold) {
          last = end;
          break;
        }
      }
      const padding = 0.05;
      setTrimStart(Math.max(0, first / sampleRate - padding));
      setTrimEnd(Math.min(decodedBuffer.duration, last / sampleRate + padding));
    }
    setCleanMode(true);
  }, [decodedBuffer]);

  const addToSoundboard = useCallback(() => {
    if (!decodedBuffer || !selectedClip) return;
    const padNumber = soundPads.length + 1;
    setSoundPads(current => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: 'لقطة ' + padNumber,
        buffer: decodedBuffer,
        start: trimStart,
        end: trimEnd,
        enhanced: cleanMode,
      },
    ]);
  }, [cleanMode, decodedBuffer, selectedClip, soundPads.length, trimEnd, trimStart]);

  const playSelection = useCallback(() => {
    if (!decodedBuffer) return;
    playBufferRange(decodedBuffer, trimStart, trimEnd, cleanMode);
  }, [cleanMode, decodedBuffer, playBufferRange, trimEnd, trimStart]);

  const playFullRecording = useCallback(() => {
    const audio = editorAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch(() => setError('المتصفح منع التشغيل. اضغط تشغيل مرة ثانية.'));
  }, []);

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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [downloadLast, replayLast, toggleRecording]);

  const clearAll = () => {
    clips.forEach(clip => URL.revokeObjectURL(clip.url));
    setClips([]);
    setSelectedClipId(null);
    setTrimStart(0);
    setTrimEnd(0);
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
            Ctrl + Shift + 1 للتسجيل، Ctrl + Shift + 2 لإعادة آخر صوت، وCtrl + Shift + 3 للحفظ. تعمل عندما تكون صفحة الموقع نشطة.
          </p>
        </div>
      </section>

      <section className="panel clips-panel">
        <div className="clips-head">
          <div>
            <h2>المقاطع الأخيرة</h2>
            <p>تبقى محليًا في هذه الجلسة ولا تُرفع إلى سيرفر.</p>
          </div>
          {clips.length > 0 && (
            <button className="ghost danger" onClick={clearAll}>
              <Trash2 size={16} /> مسح الكل
            </button>
          )}
        </div>

        {clips.length === 0 ? (
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
                      ? 'آخر مقطع'
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
              <div className="editor-kicker"><Scissors size={16} /> محرر اللقطة</div>
              <h2>حدد الجزء اللي تبيه من التسجيل</h2>
              <p>التسجيل كامل طوله {selectedClip.duration.toFixed(1)} ثانية. حرّك البداية والنهاية ثم شغّل الجزء المحدد فقط.</p>
            </div>
            <div className="selection-time">{trimStart.toFixed(1)}s — {trimEnd.toFixed(1)}s</div>
          </div>

          <audio
            ref={editorAudioRef}
            src={selectedClip.url}
            onTimeUpdate={event => {
              const audio = event.currentTarget;
              if (audio.currentTime >= trimEnd && trimEnd > trimStart) {
                audio.pause();
                audio.currentTime = trimStart;
              }
            }}
          />

          <div className="timeline-card">
            <div className="timeline-scale">
              <span>0.0</span>
              <span>{(selectedClip.duration / 2).toFixed(1)}</span>
              <span>{selectedClip.duration.toFixed(1)} ثانية</span>
            </div>
            <div className="waveform" aria-label="شكل موجة الصوت">
              {waveform.length === 0 ? (
                <div className="waveform-loading">جاري تحليل الصوت...</div>
              ) : (
                waveform.map((height, index) => {
                  const time = (index / waveform.length) * selectedClip.duration;
                  const active = time >= trimStart && time <= trimEnd;
                  return (
                    <span
                      key={index}
                      className={active ? 'wave-bar active' : 'wave-bar'}
                      style={{ height: Math.max(8, height * 92) + '%' }}
                    />
                  );
                })
              )}
              <div
                className="selection-outline"
                style={{
                  right: (trimStart / selectedClip.duration) * 100 + '%',
                  left: 100 - (trimEnd / selectedClip.duration) * 100 + '%',
                }}
              />
            </div>

            <div className="range-block">
              <label>
                <span>بداية اللقطة</span>
                <strong>{trimStart.toFixed(1)} ث</strong>
              </label>
              <input
                aria-label="بداية اللقطة"
                type="range"
                min="0"
                max={Math.max(0, selectedClip.duration - 0.1)}
                step="0.1"
                value={Math.min(trimStart, Math.max(0, selectedClip.duration - 0.1))}
                onChange={event => {
                  const next = Number(event.target.value);
                  setTrimStart(Math.min(next, Math.max(0, trimEnd - 0.1)));
                }}
              />
            </div>

            <div className="range-block">
              <label>
                <span>نهاية اللقطة</span>
                <strong>{trimEnd.toFixed(1)} ث</strong>
              </label>
              <input
                aria-label="نهاية اللقطة"
                type="range"
                min="0.1"
                max={selectedClip.duration}
                step="0.1"
                value={trimEnd}
                onChange={event => {
                  const next = Number(event.target.value);
                  setTrimEnd(Math.max(next, trimStart + 0.1));
                }}
              />
            </div>
          </div>

          <div className="clean-row">
            <button className={cleanMode ? 'clean-button active' : 'clean-button'} onClick={autoCleanSelection}>
              <Sparkles size={17} />
              {cleanMode ? 'التنظيف مفعّل' : 'نظّف اللقطة تلقائيًا'}
            </button>
            <span>يقص الصمت من الأطراف ويطبّق Normalize + Limiter وقت التشغيل.</span>
          </div>

          <div className="editor-actions">
            <button className="editor-primary" onClick={playSelection}>
              <Play size={18} fill="currentColor" />
              تشغيل الجزء المحدد فقط
            </button>
            <button className="ghost" onClick={playFullRecording}>
              <RotateCcw size={17} />
              تشغيل التسجيل كامل
            </button>
            <button
              className="ghost"
              onClick={() => {
                setTrimStart(0);
                setTrimEnd(selectedClip.duration);
                setCleanMode(false);
              }}
            >
              إعادة التحديد كامل
            </button>
            <button className="soundboard-add" onClick={addToSoundboard} disabled={!decodedBuffer}>
              <Plus size={17} />
              أضف الجزء إلى Soundboard
            </button>
          </div>
        </section>
      )}

      {soundPads.length > 0 && (
        <section className="panel soundboard-panel">
          <div className="soundboard-head">
            <div>
              <div className="editor-kicker"><Music2 size={16} /> SOUNDBOARD</div>
              <h2>لوحة الأصوات</h2>
              <p>كل زر هنا يشغّل الجزء اللي قصّيته فقط.</p>
            </div>
            <span>{soundPads.length} أصوات</span>
          </div>
          <div className="soundboard-grid">
            {soundPads.map((pad, index) => (
              <div className="sound-pad" key={pad.id}>
                <button onClick={() => playBufferRange(pad.buffer, pad.start, pad.end, pad.enhanced)}>
                  <Play size={20} fill="currentColor" />
                  <strong>{pad.name}</strong>
                  <small>{(pad.end - pad.start).toFixed(1)} ث {pad.enhanced ? '· منظّف' : ''}</small>
                </button>
                <div className="pad-footer">
                  <input
                    aria-label={'اسم زر الصوت ' + (index + 1)}
                    value={pad.name}
                    onChange={event => setSoundPads(current => current.map(item => item.id === pad.id ? { ...item, name: event.target.value } : item))}
                  />
                  <button
                    className="pad-delete"
                    aria-label="حذف زر الصوت"
                    onClick={() => setSoundPads(current => current.filter(item => item.id !== pad.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer>
        <span>Local-first · لا يوجد رفع تلقائي للصوت</span>
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
