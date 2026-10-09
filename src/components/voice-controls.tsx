"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<SpeechResult>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
const subscribe = () => () => {};
function recognitionConstructor() {
  const w = window as SpeechWindow;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}
export function Dictation({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const supported = useSyncExternalStore(
    subscribe,
    () => !!recognitionConstructor(),
    () => false,
  );
  const recognition = useRef<Recognition | null>(null),
    [listening, setListening] = useState(false),
    [lang, setLang] = useState("en-MY");
  useEffect(
    () => () => {
      if (recognition.current) {
        recognition.current.onresult = null;
        recognition.current.onend = null;
        recognition.current.onerror = null;
        recognition.current.abort();
      }
    },
    [],
  );
  function start() {
    const Constructor = recognitionConstructor();
    if (!Constructor)
      return toast.error(
        "Dictation is unavailable in this browser. Type your message instead.",
      );
    const speech = new Constructor();
    recognition.current = speech;
    speech.lang = lang;
    speech.continuous = false;
    speech.interimResults = false;
    speech.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++)
        if (event.results[i].isFinal)
          text += event.results[i][0].transcript + " ";
      if (text.trim()) onTranscript(text.trim());
    };
    speech.onerror = (event) => {
      setListening(false);
      toast.error(
        event.error === "not-allowed"
          ? "Allow microphone access to dictate"
          : "Dictation stopped. You can type your message.",
      );
    };
    speech.onend = () => {
      setListening(false);
      if (recognition.current === speech) recognition.current = null;
    };
    try {
      speech.start();
      setListening(true);
    } catch {
      toast.error("Could not start dictation");
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="native-select"
          aria-label="Voice language"
          value={lang}
          disabled={listening}
          onChange={(e) => setLang(e.target.value)}
        >
          <option value="en-MY">English</option>
          <option value="ms-MY">Bahasa Melayu</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !supported}
          aria-pressed={listening}
          onClick={() => (listening ? recognition.current?.stop() : start())}
        >
          {listening ? <Square size={14} /> : <Mic size={14} />}
          {listening ? "Stop dictation" : "Dictate message"}
        </Button>
        {!supported ? (
          <small className="muted-text">
            Dictation unavailable in this browser.
          </small>
        ) : null}
      </div>
      <p className="muted-text text-xs">
        Dictation uses your browser’s speech service. Review the text before
        sending. No message is sent automatically.
      </p>
      <span className="sr-only" role="status">
        {listening ? "Listening" : "Microphone stopped"}
      </span>
    </div>
  );
}
export function ReadAnswer({ text }: { text: string }) {
  const supported = useSyncExternalStore(
    subscribe,
    () => "speechSynthesis" in window,
    () => false,
  );
  const [speaking, setSpeaking] = useState(false),
    current = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(
    () => () => {
      if (current.current) {
        current.current.onend = null;
        current.current.onerror = null;
        window.speechSynthesis?.cancel();
      }
    },
    [],
  );
  function speak() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      text
        .replace(/\[source:[^\]]+\]/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*#`]/g, ""),
    );
    current.current = utterance;
    utterance.lang = "en-MY";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!supported}
      aria-pressed={speaking}
      onClick={speak}
    >
      {speaking ? <Square size={14} /> : <Volume2 size={14} />}
      {speaking ? "Stop reading" : "Read aloud"}
    </Button>
  );
}
