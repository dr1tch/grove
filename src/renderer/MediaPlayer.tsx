import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Check,
  Gauge,
  Music,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Tooltip } from "./Tooltip";

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const EVENTS = [
  "play",
  "pause",
  "ended",
  "timeupdate",
  "progress",
  "loadedmetadata",
  "durationchange",
  "volumechange",
  "waiting",
  "playing",
  "canplay",
  "seeked",
  "ratechange",
];

/** Re-renders on media events and returns the element's current playback state. */
export function useMediaState(ref: RefObject<HTMLMediaElement | null>) {
  const [, render] = useState(0);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const update = (event: Event) => {
      if (event.type === "waiting") setWaiting(true);
      if (["playing", "canplay", "seeked", "pause", "ended"].includes(event.type))
        setWaiting(false);
      render((n) => n + 1);
    };
    for (const name of EVENTS) media.addEventListener(name, update);
    return () => {
      for (const name of EVENTS) media.removeEventListener(name, update);
    };
  }, [ref]);
  const media = ref.current;
  const duration = media && Number.isFinite(media.duration) ? media.duration : 0;
  const time = media?.currentTime ?? 0;
  const buffered =
    media && duration && media.buffered.length
      ? media.buffered.end(media.buffered.length - 1) / duration
      : 0;
  return {
    playing: Boolean(media && !media.paused && !media.ended),
    waiting,
    time,
    duration,
    progress: duration ? Math.min(1, time / duration) : 0,
    buffered: Math.min(1, buffered),
    volume: media?.volume ?? 1,
    muted: Boolean(media && (media.muted || media.volume === 0)),
    rate: media?.playbackRate ?? 1,
  };
}

export function togglePlay(media: HTMLMediaElement) {
  if (media.paused || media.ended) {
    if (media.ended) media.currentTime = 0;
    void media.play().catch(() => {});
  } else media.pause();
}

export function skip(media: HTMLMediaElement, seconds: number) {
  const end = Number.isFinite(media.duration) ? media.duration : Infinity;
  media.currentTime = Math.min(end, Math.max(0, media.currentTime + seconds));
}

const lastVolume = new WeakMap<HTMLMediaElement, number>();
export function toggleMute(media: HTMLMediaElement) {
  if (media.muted || media.volume === 0) {
    media.muted = false;
    media.volume = lastVolume.get(media) || 1;
  } else {
    lastVolume.set(media, media.volume);
    media.muted = true;
  }
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** Steps the playback speed one notch up or down the SPEEDS list. */
export function setRate(media: HTMLMediaElement, step: number) {
  const index = SPEEDS.findIndex((speed) => speed >= media.playbackRate);
  media.playbackRate =
    SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (index < 0 ? 2 : index) + step))];
}

/** Space/K play, arrows ±5 s, J/L ±10 s, M mute, F fullscreen, < > speed, Esc leaves fullscreen. */
export function handleMediaKey(
  event: KeyboardEvent,
  media: HTMLMediaElement | null,
  onFullscreen?: () => void,
) {
  if (!media || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, [contenteditable='true']")) return false;
  const key = event.key.toLowerCase();
  if ((key === " " && target.tagName !== "BUTTON") || key === "k") togglePlay(media);
  else if (key === "arrowleft" && !target.closest("[role=slider]")) skip(media, -5);
  else if (key === "arrowright" && !target.closest("[role=slider]")) skip(media, 5);
  else if (key === "j") skip(media, -10);
  else if (key === "l") skip(media, 10);
  else if (key === "m") toggleMute(media);
  else if (key === "f" && onFullscreen) onFullscreen();
  else if (event.key === ">" || event.key === "<") setRate(media, event.key === ">" ? 1 : -1);
  else if (key === "escape" && document.fullscreenElement) void document.exitFullscreen();
  else return false;
  event.preventDefault();
  return true;
}

export function PlayerControls({
  media,
  children,
  className = "",
}: {
  media: RefObject<HTMLMediaElement | null>;
  children?: ReactNode;
  className?: string;
}) {
  const state = useMediaState(media);
  const track = useRef<HTMLDivElement>(null);
  const scrub = useRef<{ wasPaused: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const at = (x: number) => {
    const rect = track.current!.getBoundingClientRect();
    return rect.width ? Math.min(1, Math.max(0, (x - rect.left) / rect.width)) : 0;
  };
  const seek = (fraction: number) => {
    if (media.current && state.duration) media.current.currentTime = fraction * state.duration;
  };
  const endScrub = () => {
    if (scrub.current && !scrub.current.wasPaused) void media.current?.play().catch(() => {});
    scrub.current = null;
  };
  const button = (label: string, onClick: () => void, icon: ReactNode, extra = "") => (
    <Tooltip text={label}>
      <button type="button" className={extra} aria-label={label} onClick={onClick}>
        {icon}
      </button>
    </Tooltip>
  );
  return (
    <div
      className={`player-bar ${className}`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={track}
        className="player-track"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(state.duration)}
        aria-valuenow={Math.round(state.time)}
        aria-valuetext={`${formatTime(state.time)} of ${formatTime(state.duration)}`}
        onKeyDown={(event) => {
          if (!media.current) return;
          if (event.key === "ArrowLeft") skip(media.current, -5);
          else if (event.key === "ArrowRight") skip(media.current, 5);
          else if (event.key === "Home") media.current.currentTime = 0;
          else if (event.key === "End" && state.duration)
            media.current.currentTime = state.duration;
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerMove={(event) => {
          const fraction = at(event.clientX);
          setHover(fraction);
          if (scrub.current) seek(fraction);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(event) => {
          if (!media.current || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          scrub.current = { wasPaused: media.current.paused };
          media.current.pause();
          seek(at(event.clientX));
        }}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
      >
        <span className="player-rail" />
        <span className="player-buffered" style={{ width: `${state.buffered * 100}%` }} />
        {hover !== null && <span className="player-hover" style={{ width: `${hover * 100}%` }} />}
        <span className="player-progress" style={{ width: `${state.progress * 100}%` }} />
        <span className="player-thumb" style={{ left: `${state.progress * 100}%` }} />
        {hover !== null && state.duration > 0 && (
          <span className="player-time-tip" style={{ left: `${hover * 100}%` }}>
            {formatTime(hover * state.duration)}
          </span>
        )}
      </div>
      <div className="player-row">
        <div className="player-group">
          {button(
            "Back 10 seconds (J)",
            () => media.current && skip(media.current, -10),
            <span className="player-skip">
              <RotateCcw />
              <b>10</b>
            </span>,
          )}
          {button(
            state.playing ? "Pause (K)" : "Play (K)",
            () => media.current && togglePlay(media.current),
            state.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />,
            "player-play",
          )}
          {button(
            "Forward 10 seconds (L)",
            () => media.current && skip(media.current, 10),
            <span className="player-skip">
              <RotateCw />
              <b>10</b>
            </span>,
          )}
          <div className="player-volume">
            {button(
              state.muted ? "Unmute (M)" : "Mute (M)",
              () => media.current && toggleMute(media.current),
              state.muted ? <VolumeX /> : <Volume2 />,
            )}
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Volume"
              value={state.muted ? 0 : Math.round(state.volume * 100)}
              onChange={(event) => {
                const element = media.current;
                if (!element) return;
                element.volume = Number(event.target.value) / 100;
                element.muted = element.volume === 0;
              }}
            />
          </div>
          <span className="player-clock">
            {formatTime(state.time)} / {formatTime(state.duration)}
          </span>
        </div>
        <div className="player-group">
          <SpeedMenu media={media} rate={state.rate} />
          {children}
        </div>
      </div>
    </div>
  );
}

function SpeedMenu({ media, rate }: { media: RefObject<HTMLMediaElement | null>; rate: number }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      ) {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [open]);
  return (
    <div className="player-speed" ref={root}>
      <Tooltip text="Playback speed (< >)" hidden={open}>
        <button
          type="button"
          aria-label="Playback speed"
          aria-haspopup="menu"
          aria-expanded={open}
          className={rate !== 1 ? "player-speed-active" : ""}
          onClick={() => setOpen(!open)}
        >
          {rate === 1 ? <Gauge /> : <span className="player-rate">{rate}×</span>}
        </button>
      </Tooltip>
      {open && (
        <div className="player-menu" role="menu" aria-label="Playback speed">
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              role="menuitemradio"
              aria-checked={speed === rate}
              onClick={() => {
                if (media.current) media.current.playbackRate = speed;
                setOpen(false);
              }}
            >
              <span>{speed === 1 ? "Normal" : `${speed}×`}</span>
              {speed === rate && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AudioPlayer({
  url,
  name,
  onError,
}: {
  url: string;
  name: string;
  onError: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const state = useMediaState(audio);
  return (
    <section
      className={`audio-player${state.playing ? " playing" : ""}`}
      aria-label="Audio player"
      tabIndex={0}
      onKeyDown={(event) => handleMediaKey(event, audio.current)}
    >
      <audio ref={audio} src={url} preload="metadata" onError={onError} />
      <div className="audio-head">
        <button
          type="button"
          className="audio-big-play"
          aria-label={state.playing ? "Pause" : "Play"}
          onClick={() => audio.current && togglePlay(audio.current)}
        >
          {state.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <div className="audio-meta">
          <span className="audio-icon" aria-hidden="true">
            <Music />
          </span>
          <strong>{name}</strong>
          <span className="audio-length">{formatTime(state.duration)}</span>
        </div>
        <span className="audio-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      <PlayerControls media={audio} className="audio" />
    </section>
  );
}
