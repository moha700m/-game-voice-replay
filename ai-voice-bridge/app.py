import json
import os
import platform
import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import ttk, messagebox

APP_NAME = "AI Voice Bridge"
APP_VERSION = "0.1.0"
CONFIG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "AIVoiceBridge"
CONFIG_FILE = CONFIG_DIR / "config.json"

try:
    import numpy as np
    import sounddevice as sd
except Exception as exc:
    np = None
    sd = None
    IMPORT_ERROR = str(exc)
else:
    IMPORT_ERROR = None


def _device_label(index, info, hostapis):
    host_name = ""
    try:
        host_name = hostapis[info["hostapi"]]["name"]
    except Exception:
        pass
    return f"{index}: {info['name']} [{host_name}]"


def enumerate_audio_devices():
    if sd is None:
        return [], [], []
    devices = sd.query_devices()
    hostapis = sd.query_hostapis()
    inputs, outputs, all_devices = [], [], []
    for i, d in enumerate(devices):
        item = {
            "index": i,
            "name": d["name"],
            "hostapi": hostapis[d["hostapi"]]["name"],
            "max_input_channels": int(d["max_input_channels"]),
            "max_output_channels": int(d["max_output_channels"]),
            "default_samplerate": int(d["default_samplerate"]),
            "label": _device_label(i, d, hostapis),
        }
        all_devices.append(item)
        if item["max_input_channels"] > 0:
            inputs.append(item)
        if item["max_output_channels"] > 0:
            outputs.append(item)
    return inputs, outputs, all_devices


def find_best(items, keywords):
    keywords = [k.lower() for k in keywords]
    for item in items:
        n = item["name"].lower()
        if all(k in n for k in keywords):
            return item
    return None


class MonitorMixer:
    def __init__(self, phone_input, ai_input, monitor_output, samplerate=48000, blocksize=960):
        self.phone_input = int(phone_input)
        self.ai_input = int(ai_input)
        self.monitor_output = int(monitor_output)
        self.samplerate = int(samplerate)
        self.blocksize = int(blocksize)
        self.phone_q = queue.Queue(maxsize=8)
        self.ai_q = queue.Queue(maxsize=8)
        self.streams = []
        self.running = False
        self.level_phone = 0.0
        self.level_ai = 0.0

    @staticmethod
    def _mono(data):
        if data.ndim == 1:
            return data.astype(np.float32, copy=False)
        if data.shape[1] == 1:
            return data[:, 0].astype(np.float32, copy=False)
        return np.mean(data, axis=1, dtype=np.float32)

    @staticmethod
    def _push(q, arr):
        try:
            q.put_nowait(arr.copy())
        except queue.Full:
            try:
                q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(arr.copy())
            except queue.Full:
                pass

    def _phone_cb(self, indata, frames, time_info, status):
        mono = self._mono(indata)
        self.level_phone = float(np.sqrt(np.mean(np.square(mono)))) if len(mono) else 0.0
        self._push(self.phone_q, mono)

    def _ai_cb(self, indata, frames, time_info, status):
        mono = self._mono(indata)
        self.level_ai = float(np.sqrt(np.mean(np.square(mono)))) if len(mono) else 0.0
        self._push(self.ai_q, mono)

    @staticmethod
    def _get_chunk(q, frames):
        try:
            x = q.get_nowait()
        except queue.Empty:
            return np.zeros(frames, dtype=np.float32)
        if len(x) == frames:
            return x
        if len(x) > frames:
            return x[:frames]
        out = np.zeros(frames, dtype=np.float32)
        out[:len(x)] = x
        return out

    def _out_cb(self, outdata, frames, time_info, status):
        a = self._get_chunk(self.phone_q, frames)
        b = self._get_chunk(self.ai_q, frames)
        mixed = np.clip(a + b, -0.95, 0.95)
        if outdata.shape[1] == 1:
            outdata[:, 0] = mixed
        else:
            outdata[:] = np.repeat(mixed[:, None], outdata.shape[1], axis=1)

    def start(self):
        if sd is None or np is None:
            raise RuntimeError(f"Audio engine unavailable: {IMPORT_ERROR or 'missing dependency'}")
        if self.running:
            return
        pinfo = sd.query_devices(self.phone_input)
        ainfo = sd.query_devices(self.ai_input)
        oinfo = sd.query_devices(self.monitor_output)
        pc = 2 if pinfo["max_input_channels"] >= 2 else 1
        ac = 2 if ainfo["max_input_channels"] >= 2 else 1
        oc = 2 if oinfo["max_output_channels"] >= 2 else 1
        self.streams = [
            sd.InputStream(device=self.phone_input, channels=pc, samplerate=self.samplerate,
                           blocksize=self.blocksize, dtype="float32", callback=self._phone_cb, latency="low"),
            sd.InputStream(device=self.ai_input, channels=ac, samplerate=self.samplerate,
                           blocksize=self.blocksize, dtype="float32", callback=self._ai_cb, latency="low"),
            sd.OutputStream(device=self.monitor_output, channels=oc, samplerate=self.samplerate,
                            blocksize=self.blocksize, dtype="float32", callback=self._out_cb, latency="low"),
        ]
        try:
            for stream in self.streams:
                stream.start()
        except Exception:
            for stream in self.streams:
                try:
                    stream.close()
                except Exception:
                    pass
            self.streams = []
            raise
        self.running = True

    def stop(self):
        for stream in self.streams:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass
        self.streams = []
        self.running = False


class App(tk.Tk):
    BG = "#0b0f17"
    PANEL = "#111827"
    PANEL2 = "#182235"
    TEXT = "#f8fafc"
    MUTED = "#9ca3af"
    ACCENT = "#38bdf8"
    GREEN = "#22c55e"
    RED = "#ef4444"

    def __init__(self):
        super().__init__()
        self.title(f"{APP_NAME} {APP_VERSION}")
        self.geometry("880x720")
        self.minsize(820, 650)
        self.configure(bg=self.BG)
        self.monitor_engine = None
        self.inputs = []
        self.outputs = []
        self.all_devices = []
        self.config_data = self.load_config()
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self._setup_style()
        self._build_ui()
        self.after(250, self.refresh_devices)
        self.after(120, self._tick_levels)

    def _setup_style(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure("TCombobox", fieldbackground=self.PANEL2, background=self.PANEL2,
                        foreground=self.TEXT, arrowcolor=self.TEXT, padding=8)
        style.map("TCombobox", fieldbackground=[("readonly", self.PANEL2)],
                  foreground=[("readonly", self.TEXT)])

    def load_config(self):
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def save_config(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            "phone_capture": self.phone_combo.get(),
            "ai_capture": self.ai_combo.get(),
            "monitor_output": self.monitor_combo.get(),
            "sample_rate": self.rate_var.get(),
        }
        CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _card(self, parent, **kwargs):
        return tk.Frame(parent, bg=self.PANEL, highlightbackground="#253044", highlightthickness=1, **kwargs)

    def _build_ui(self):
        root = tk.Frame(self, bg=self.BG)
        root.pack(fill="both", expand=True, padx=26, pady=22)

        tk.Label(root, text="AI VOICE BRIDGE", font=("Segoe UI", 24, "bold"),
                 fg=self.TEXT, bg=self.BG).pack(anchor="e")
        tk.Label(root, text="جسر صوتي للكمبيوتر والجوال — بدون ميكسر وبدون Voicemeeter",
                 font=("Segoe UI", 12), fg=self.MUTED, bg=self.BG).pack(anchor="e", pady=(2, 18))

        intro = self._card(root)
        intro.pack(fill="x", pady=(0, 14))
        tk.Label(intro, text="المسار الصحيح", font=("Segoe UI", 13, "bold"),
                 fg=self.TEXT, bg=self.PANEL).pack(anchor="e", padx=18, pady=(14, 4))
        tk.Label(intro,
                 text="المكالمة → Cable A → ChatGPT    |    ChatGPT → Cable B → المكالمة\n"
                      "القناتان منفصلتان، لذلك صوت الشخص لا يرجع له مرة ثانية.",
                 justify="right", font=("Segoe UI", 11), fg=self.MUTED,
                 bg=self.PANEL).pack(anchor="e", padx=18, pady=(0, 14))

        checks = self._card(root)
        checks.pack(fill="x", pady=(0, 14))
        row = tk.Frame(checks, bg=self.PANEL)
        row.pack(fill="x", padx=16, pady=13)
        self.driver_status = tk.Label(row, text="جاري فحص أجهزة الصوت…", font=("Segoe UI", 11, "bold"),
                                      fg=self.MUTED, bg=self.PANEL)
        self.driver_status.pack(side="right")
        tk.Button(row, text="تحديث", command=self.refresh_devices, bd=0, padx=16, pady=7,
                  bg=self.PANEL2, fg=self.TEXT, activebackground="#243047",
                  activeforeground=self.TEXT, cursor="hand2").pack(side="left")

        routing = self._card(root)
        routing.pack(fill="x", pady=(0, 14))
        tk.Label(routing, text="المراقبة المحلية", font=("Segoe UI", 13, "bold"),
                 fg=self.TEXT, bg=self.PANEL).grid(row=0, column=1, sticky="e", padx=18, pady=(14, 8))
        routing.grid_columnconfigure(0, weight=1)

        def add_selector(r, label, attr):
            tk.Label(routing, text=label, font=("Segoe UI", 10), fg=self.MUTED,
                     bg=self.PANEL).grid(row=r, column=1, sticky="e", padx=(12, 18), pady=7)
            combo = ttk.Combobox(routing, state="readonly", width=74)
            combo.grid(row=r, column=0, sticky="ew", padx=(18, 8), pady=7)
            setattr(self, attr, combo)

        add_selector(1, "صوت المكالمة / Cable A Output", "phone_combo")
        add_selector(2, "صوت ChatGPT / Cable B Output", "ai_combo")
        add_selector(3, "سماعتك أو سبيكر الكمبيوتر", "monitor_combo")

        tk.Label(routing, text="Sample rate", font=("Segoe UI", 10), fg=self.MUTED,
                 bg=self.PANEL).grid(row=4, column=1, sticky="e", padx=(12, 18), pady=7)
        self.rate_var = tk.StringVar(value="48000")
        ttk.Combobox(routing, state="readonly", values=["48000", "44100"],
                     textvariable=self.rate_var, width=12).grid(row=4, column=0, sticky="w", padx=(18, 8), pady=7)

        meters = tk.Frame(routing, bg=self.PANEL)
        meters.grid(row=5, column=0, columnspan=2, sticky="ew", padx=18, pady=(8, 15))
        meters.grid_columnconfigure(0, weight=1)
        self.phone_meter = ttk.Progressbar(meters, orient="horizontal", mode="determinate", maximum=100)
        self.phone_meter.grid(row=0, column=0, sticky="ew", padx=(0, 10), pady=4)
        tk.Label(meters, text="المكالمة", fg=self.MUTED, bg=self.PANEL).grid(row=0, column=1, sticky="e")
        self.ai_meter = ttk.Progressbar(meters, orient="horizontal", mode="determinate", maximum=100)
        self.ai_meter.grid(row=1, column=0, sticky="ew", padx=(0, 10), pady=4)
        tk.Label(meters, text="ChatGPT", fg=self.MUTED, bg=self.PANEL).grid(row=1, column=1, sticky="e")

        buttons = tk.Frame(root, bg=self.BG)
        buttons.pack(fill="x", pady=(0, 12))
        self.start_btn = tk.Button(buttons, text="ابدأ الجسر", command=self.start_monitor, bd=0,
                                   font=("Segoe UI", 12, "bold"), padx=26, pady=12,
                                   bg=self.ACCENT, fg="#00131d", activebackground="#7dd3fc", cursor="hand2")
        self.start_btn.pack(side="right", padx=(8, 0))
        self.stop_btn = tk.Button(buttons, text="إيقاف", command=self.stop_monitor, bd=0,
                                  font=("Segoe UI", 11, "bold"), padx=20, pady=12,
                                  bg=self.PANEL2, fg=self.TEXT, activebackground="#243047",
                                  activeforeground=self.TEXT, cursor="hand2", state="disabled")
        self.stop_btn.pack(side="right", padx=8)
        tk.Button(buttons, text="الإعداد السريع", command=self.show_wizard, bd=0,
                  font=("Segoe UI", 11), padx=20, pady=12, bg=self.PANEL2, fg=self.TEXT,
                  activebackground="#243047", activeforeground=self.TEXT,
                  cursor="hand2").pack(side="left")
        tk.Button(buttons, text="إعدادات صوت Windows", command=self.open_sound_settings, bd=0,
                  font=("Segoe UI", 11), padx=20, pady=12, bg=self.PANEL2, fg=self.TEXT,
                  activebackground="#243047", activeforeground=self.TEXT,
                  cursor="hand2").pack(side="left", padx=8)

        self.status = tk.Label(root, text="جاهز", anchor="e", font=("Segoe UI", 10),
                               fg=self.MUTED, bg=self.BG)
        self.status.pack(fill="x")
        tk.Label(root, text="MVP 0.1 — Windows 10/11", font=("Segoe UI", 9),
                 fg="#64748b", bg=self.BG).pack(anchor="w", pady=(8, 0))

    def open_sound_settings(self):
        if platform.system() == "Windows":
            try:
                os.startfile("ms-settings:apps-volume")
                return
            except Exception:
                pass
        messagebox.showinfo("Windows", "افتح: Settings → System → Sound → Volume mixer")

    def show_wizard(self):
        win = tk.Toplevel(self)
        win.title("الإعداد السريع")
        win.geometry("720x560")
        win.configure(bg=self.BG)
        win.transient(self)
        win.grab_set()
        tk.Label(win, text="أربع خطوات فقط", font=("Segoe UI", 20, "bold"),
                 fg=self.TEXT, bg=self.BG).pack(anchor="e", padx=24, pady=(22, 12))
        text = (
            "1) Phone Link — المخرج (Speaker) = CABLE-A Input\n\n"
            "2) ChatGPT — الميكروفون (Microphone) = CABLE-A Output\n\n"
            "3) ChatGPT — المخرج (Speaker) = CABLE-B Input\n\n"
            "4) Phone Link — الميكروفون (Microphone) = CABLE-B Output\n\n"
            "بعدها ارجع هنا واختر Cable A Output وCable B Output وسماعتك، ثم اضغط «ابدأ الجسر».\n\n"
            "النتيجة: هم يدخلون ChatGPT عبر A، ورد ChatGPT يرجع لهم عبر B. لا يوجد مسار يعيد صوتهم إليهم."
        )
        tk.Label(win, text=text, justify="right", wraplength=650, font=("Segoe UI", 12),
                 fg=self.TEXT, bg=self.BG).pack(anchor="e", padx=24, pady=8)
        tk.Button(win, text="افتح إعدادات صوت Windows", command=self.open_sound_settings, bd=0,
                  font=("Segoe UI", 11, "bold"), padx=18, pady=10, bg=self.ACCENT,
                  fg="#00131d", cursor="hand2").pack(anchor="e", padx=24, pady=12)

    def refresh_devices(self):
        if sd is None:
            self.driver_status.configure(text="محرك الصوت غير متوفر", fg=self.RED)
            self.status.configure(text=f"خطأ: {IMPORT_ERROR}")
            return
        try:
            self.inputs, self.outputs, self.all_devices = enumerate_audio_devices()
        except Exception as exc:
            self.driver_status.configure(text="تعذر قراءة أجهزة الصوت", fg=self.RED)
            self.status.configure(text=str(exc))
            return

        input_labels = [d["label"] for d in self.inputs]
        output_labels = [d["label"] for d in self.outputs]
        self.phone_combo["values"] = input_labels
        self.ai_combo["values"] = input_labels
        self.monitor_combo["values"] = output_labels

        cable_a = find_best(self.inputs, ["cable-a", "output"]) or find_best(self.inputs, ["cable a", "output"])
        cable_b = find_best(self.inputs, ["cable-b", "output"]) or find_best(self.inputs, ["cable b", "output"])

        def restore(combo, key, preferred, values):
            saved = self.config_data.get(key)
            if saved in values:
                combo.set(saved)
            elif preferred:
                combo.set(preferred["label"])
            elif values:
                combo.current(0)

        restore(self.phone_combo, "phone_capture", cable_a, input_labels)
        restore(self.ai_combo, "ai_capture", cable_b, input_labels)

        saved_monitor = self.config_data.get("monitor_output")
        if saved_monitor in output_labels:
            self.monitor_combo.set(saved_monitor)
        else:
            physical = next((d for d in self.outputs if not any(k in d["name"].lower()
                             for k in ["cable", "voicemeeter", "virtual"])), None)
            if physical:
                self.monitor_combo.set(physical["label"])
            elif output_labels:
                self.monitor_combo.current(0)

        if cable_a and cable_b:
            self.driver_status.configure(text="✓ تم العثور على Cable A وCable B", fg=self.GREEN)
            self.status.configure(text="الأجهزة جاهزة. نفّذ الإعداد السريع ثم ابدأ الجسر.")
        else:
            self.driver_status.configure(text="يلزم مساران افتراضيان A وB", fg="#f59e0b")
            self.status.configure(text="بدون ميكسر: يلزم مساران صوت افتراضيان منفصلان لمنع الصدى.")

    @staticmethod
    def _index_from_label(label):
        try:
            return int(label.split(":", 1)[0])
        except Exception:
            raise ValueError("اختر جهاز صوت صحيح")

    def start_monitor(self):
        if self.monitor_engine and self.monitor_engine.running:
            return
        try:
            p = self._index_from_label(self.phone_combo.get())
            a = self._index_from_label(self.ai_combo.get())
            o = self._index_from_label(self.monitor_combo.get())
            if p == a:
                raise ValueError("لا تختَر نفس مدخل الصوت للمكالمة وChatGPT؛ لازم يكونان مسارين منفصلين A وB.")
            self.monitor_engine = MonitorMixer(p, a, o, samplerate=int(self.rate_var.get()))
            self.monitor_engine.start()
            self.save_config()
        except Exception as exc:
            messagebox.showerror("تعذر تشغيل الجسر",
                                 f"{exc}\n\nجرّب 48000 أو 44100، وتأكد أن الأجهزة ليست مستخدمة بوضع Exclusive.")
            self.status.configure(text=f"فشل التشغيل: {exc}")
            self.monitor_engine = None
            return
        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self.status.configure(text="● الجسر يعمل — إذا تحركت القناتان فالربط صحيح.", fg=self.GREEN)

    def stop_monitor(self):
        if self.monitor_engine:
            self.monitor_engine.stop()
            self.monitor_engine = None
        self.start_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")
        self.phone_meter["value"] = 0
        self.ai_meter["value"] = 0
        self.status.configure(text="تم إيقاف الجسر", fg=self.MUTED)

    def _tick_levels(self):
        if self.monitor_engine and self.monitor_engine.running:
            def pct(x):
                if x <= 0:
                    return 0
                db = 20 * np.log10(max(x, 1e-6))
                return max(0, min(100, (db + 60) / 60 * 100))
            self.phone_meter["value"] = pct(self.monitor_engine.level_phone)
            self.ai_meter["value"] = pct(self.monitor_engine.level_ai)
        self.after(120, self._tick_levels)

    def on_close(self):
        try:
            self.stop_monitor()
        finally:
            self.destroy()


if __name__ == "__main__":
    App().mainloop()
