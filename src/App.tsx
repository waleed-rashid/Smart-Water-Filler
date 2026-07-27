import { type CSSProperties, useMemo, useEffect, useState } from "react";

type Bottle = {
  id: string;
  name: string;
  ml: number;
};

type FillSource = "sensor" | "dashboard" | "manual";

type FillSession = {
  id: string;
  amountMl: number;
  seconds: number;
  bottleId: string;
  source: FillSource;
  at: string;
};

type Profile = {
  id: string;
  name: string;
  color: string;
  goalMl: number;
  bottles: Bottle[];
  history: FillSession[];
};

type WaterState = {
  activeProfileId: string;
  flowRateMlSec: number;
  bottlePresent: boolean;
  selectedBottleId: string;
  profiles: Profile[];
};

type EspStatus = {
  bottleDetected: boolean;
  distanceMm: number;
  dispensing: boolean;
  elapsedMs: number;
};

const ESP32_API_URL = import.meta.env.VITE_ESP32_API_URL?.replace(/\/$/, "") ?? "";
const isEspConfigured = ESP32_API_URL.length > 0 && !ESP32_API_URL.includes("YOUR_ESP32_IP");
const STORAGE_KEY = "aqua-panel-tablet:v2";
const RING_RADIUS = 62;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const GOAL_STEP_ML = 100;
const MIN_GOAL_ML = 500;
const MAX_GOAL_ML = 10000;
const FLOW_RATE_ML_SEC = 40.7;
const FILL_STOP_BUFFER_ML = 0;
const sharedBottles: Bottle[] = [
  { id: "cup", name: "Cup", ml: 250 },
  { id: "half-liter", name: "Bottle", ml: 500 },
  { id: "tumbler", name: "Owala", ml: 710 },
  { id: "bottle", name: "Stanley", ml: 1183 },
];
const profileNames = ["User 1", "User 2", "User 3", "User 4", "User 5", "User 6"];
const profileColorOptions = ["#5fc8f8", "#ff8f70", "#8ea7ff", "#8ddbb4", "#d59cff", "#f7da7e", "#ff6b8a", "#e8b86d", "#f2a7b5", "#b8c7d9"];

function todayAt(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const seedState: WaterState = {
  activeProfileId: "user1",
  flowRateMlSec: FLOW_RATE_ML_SEC,
  bottlePresent: true,
  selectedBottleId: "tumbler",
  profiles: [
    {
      id: "user1",
      name: "User 1",
      color: "#5fc8f8",
      goalMl: 2500,
      bottles: sharedBottles,
      history: [
        { id: "s1", amountMl: 830, seconds: 46.1, bottleId: "tumbler", source: "sensor", at: todayAt(8, 14) },
        { id: "s2", amountMl: 620, seconds: 34.4, bottleId: "tumbler", source: "dashboard", at: todayAt(11, 48) },
      ],
    },
    {
      id: "user2",
      name: "User 2",
      color: "#ff8f70",
      goalMl: 2100,
      bottles: sharedBottles,
      history: [{ id: "s3", amountMl: 350, seconds: 19.4, bottleId: "glass", source: "sensor", at: todayAt(9, 5) }],
    },
    {
      id: "user3",
      name: "User 3",
      color: "#70a8ff",
      goalMl: 2400,
      bottles: sharedBottles,
      history: [{ id: "s4", amountMl: 720, seconds: 40, bottleId: "sport", source: "dashboard", at: todayAt(7, 36) }],
    },
    {
      id: "user4",
      name: "User 4",
      color: "#8ddbb4",
      goalMl: 1800,
      bottles: sharedBottles,
      history: [],
    },
    {
      id: "user5",
      name: "User 5",
      color: "#d59cff",
      goalMl: 2200,
      bottles: sharedBottles,
      history: [],
    },
    {
      id: "user6",
      name: "User 6",
      color: "#f4d35e",
      goalMl: 2200,
      bottles: sharedBottles,
      history: [],
    },
  ],
};

function loadState(): WaterState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return seedState;

  try {
    const parsed = { ...seedState, ...JSON.parse(saved) } as WaterState;
    const savedProfiles = parsed.profiles ?? [];
    const profiles = seedState.profiles.map((seedProfile, index) => {
      const savedProfile = savedProfiles.find((profile) => profile.id === seedProfile.id) ?? savedProfiles[index];

      return {
        ...seedProfile,
        history: savedProfile?.history ?? seedProfile.history,
        goalMl: savedProfile?.goalMl ?? seedProfile.goalMl,
        name: profileNames[index] ?? `User ${index + 1}`,
        color: savedProfile?.color ?? seedProfile.color,
        bottles: sharedBottles,
      };
    });

    return {
      ...parsed,
      flowRateMlSec: FLOW_RATE_ML_SEC,
      selectedBottleId: sharedBottles.some((bottle) => bottle.id === parsed.selectedBottleId) ? parsed.selectedBottleId : sharedBottles[0].id,
      activeProfileId: profiles.some((profile) => profile.id === parsed.activeProfileId) ? parsed.activeProfileId : profiles[0].id,
      profiles,
    };
  } catch {
    return seedState;
  }
}

function formatMl(amount: number) {
  return `${Math.round(amount).toLocaleString()} mL`;
}

function formatLitersValue(amountMl: number) {
  return (amountMl / 1000).toLocaleString([], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

async function requestEsp<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ESP32_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `ESP32 request failed: ${response.status}`);
  }

  return payload as T;
}

function createSessionId() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatHardwareError(error: unknown) {
  const message = error instanceof Error ? error.message : "ESP32 status unavailable";
  const normalized = message.toLowerCase();

  if (normalized.includes("load failed") || normalized.includes("failed to fetch") || normalized.includes("networkerror")) {
    return "ESP32 offline";
  }

  return message;
}

function isSameDay(left: Date, right: Date) {
  return left.toDateString() === right.toDateString();
}

function dailyTotal(profile: Profile) {
  const today = new Date();
  return profile.history
    .filter((session) => isSameDay(new Date(session.at), today))
    .reduce((sum, session) => sum + session.amountMl, 0);
}

function lastFill(profile: Profile) {
  return [...profile.history].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
}

function formatLastFillDate(dateValue: string) {
  const fillDate = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const time = fillDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isSameDay(fillDate, today)) return `Today, ${time}`;
  if (isSameDay(fillDate, yesterday)) return `Yesterday, ${time}`;

  return fillDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function getLastSevenDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    date.setHours(0, 0, 0, 0);
    return date;
  });
}

function formatHistoryDay(date: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function App() {
  const [waterState, setWaterState] = useState<WaterState>(loadState);
  const [fillStartedAt, setFillStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activityDayKey, setActivityDayKey] = useState<string | null>(null);
  const [isGoalOpen, setIsGoalOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [colorProfileId, setColorProfileId] = useState<string | null>(null);
  const [draftProfileColor, setDraftProfileColor] = useState(seedState.profiles[0].color);
  const [draftGoalMl, setDraftGoalMl] = useState(seedState.profiles[0].goalMl);
  const [espStatus, setEspStatus] = useState<EspStatus | null>(null);
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [isCommandPending, setIsCommandPending] = useState(false);

  const activeProfile = useMemo(
    () => waterState.profiles.find((profile) => profile.id === waterState.activeProfileId) ?? waterState.profiles[0],
    [waterState.activeProfileId, waterState.profiles],
  );

  const selectedBottle = activeProfile.bottles.find((bottle) => bottle.id === waterState.selectedBottleId) ?? activeProfile.bottles[0];
  const colorProfile = colorProfileId ? waterState.profiles.find((profile) => profile.id === colorProfileId) : null;
  const totalToday = dailyTotal(activeProfile);
  const latestFill = lastFill(activeProfile);
  const liveSeconds = fillStartedAt ? (now - fillStartedAt) / 1000 : 0;
  const liveAmount = liveSeconds * waterState.flowRateMlSec;
  const fillCutoffMl = Math.max(0, selectedBottle.ml - FILL_STOP_BUFFER_ML);
  const liveFillAmount = fillStartedAt ? Math.min(liveAmount, fillCutoffMl) : 0;
  const displayedTotalToday = totalToday + liveFillAmount;
  const displayedProgress = Math.round((displayedTotalToday / activeProfile.goalMl) * 100);
  const displayedRingProgress = Math.min(100, displayedProgress);
  const displayedRemaining = Math.max(0, activeProfile.goalMl - displayedTotalToday);
  const historyDays = getLastSevenDays().map((date) => {
    const sessions = activeProfile.history
      .filter((session) => isSameDay(new Date(session.at), date))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return {
      date,
      dateKey: date.toDateString(),
      sessions,
      total: sessions.reduce((sum, session) => sum + session.amountMl, 0),
    };
  });
  const activityDay = activityDayKey ? historyDays.find((day) => day.dateKey === activityDayKey) : null;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(waterState));
  }, [waterState]);

  useEffect(() => {
    const preventDefault = (event: Event) => event.preventDefault();

    document.addEventListener("touchmove", preventDefault, { passive: false });
    document.addEventListener("gesturestart", preventDefault);
    document.addEventListener("gesturechange", preventDefault);

    return () => {
      document.removeEventListener("touchmove", preventDefault);
      document.removeEventListener("gesturestart", preventDefault);
      document.removeEventListener("gesturechange", preventDefault);
    };
  }, []);

  useEffect(() => {
    if (!isEspConfigured) {
      setHardwareError("ESP32 not configured");
      return;
    }

    let cancelled = false;

    async function pollStatus() {
      try {
        const status = await requestEsp<EspStatus>("/status");
        if (cancelled) return;

        setEspStatus(status);
        setHardwareError(null);
        setWaterState((current) =>
          current.bottlePresent === status.bottleDetected
            ? current
            : {
                ...current,
                bottlePresent: status.bottleDetected,
              },
        );
      } catch (error) {
        if (cancelled) return;
        setHardwareError(formatHardwareError(error));
      }
    }

    void pollStatus();
    const interval = window.setInterval(pollStatus, 500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!fillStartedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [fillStartedAt]);

  useEffect(() => {
    if (!fillStartedAt || isCommandPending || liveAmount < fillCutoffMl) return;

    void stopFill(fillCutoffMl, fillCutoffMl / waterState.flowRateMlSec);
  }, [fillStartedAt, isCommandPending, fillCutoffMl, liveAmount, waterState.flowRateMlSec]);

  useEffect(() => {
    if (!isEspConfigured || !fillStartedAt || !espStatus || espStatus.bottleDetected) return;

    if (liveSeconds >= 0.8) {
      addSession("sensor", liveAmount, liveSeconds);
    }

    setFillStartedAt(null);
    setNow(Date.now());
  }, [espStatus, fillStartedAt, liveAmount, liveSeconds]);

  function updateProfile(profileId: string, updater: (profile: Profile) => Profile) {
    setWaterState((current) => ({
      ...current,
      profiles: current.profiles.map((profile) => (profile.id === profileId ? updater(profile) : profile)),
    }));
  }

  function addSession(source: FillSource, amountMl: number, seconds: number) {
    updateProfile(activeProfile.id, (profile) => ({
      ...profile,
      history: [
        ...profile.history,
        {
          id: createSessionId(),
          amountMl: Math.round(amountMl),
          seconds: Number(seconds.toFixed(1)),
          bottleId: selectedBottle.id,
          source,
          at: new Date().toISOString(),
        },
      ],
    }));
  }

  async function startFill() {
    if (!waterState.bottlePresent || fillStartedAt) return;

    setIsCommandPending(true);
    setHardwareError(null);

    try {
      if (!isEspConfigured) {
        throw new Error("Set VITE_ESP32_API_URL in .env first");
      }

      const startResponse = await requestEsp<{ ok: boolean; dispensing?: boolean; elapsedMs?: number }>("/fill/start", { method: "POST" });
      const status = await requestEsp<EspStatus>("/status");

      if (!startResponse.dispensing && !status.dispensing) {
        throw new Error("Servo did not start");
      }

      const startedAt = Date.now() - (status.elapsedMs || startResponse.elapsedMs || 0);
      setEspStatus(status);
      setNow(Date.now());
      setFillStartedAt(startedAt);
    } catch (error) {
      setHardwareError(formatHardwareError(error));
    } finally {
      setIsCommandPending(false);
    }
  }

  async function stopFill(amountToSave = liveAmount, secondsToSave = liveSeconds) {
    if (!fillStartedAt) return;

    setIsCommandPending(true);
    setHardwareError(null);

    try {
      if (isEspConfigured) {
        await requestEsp<{ ok: boolean; elapsedMs?: number }>("/fill/stop", { method: "POST" });
      }

      if (secondsToSave >= 0.8) {
        addSession("dashboard", amountToSave, secondsToSave);
      }

      setFillStartedAt(null);
      setNow(Date.now());
    } catch (error) {
      setHardwareError(formatHardwareError(error));
    } finally {
      setIsCommandPending(false);
    }
  }

  function selectProfile(profile: Profile) {
    setFillStartedAt(null);
    setWaterState((current) => ({
      ...current,
      activeProfileId: profile.id,
      selectedBottleId: profile.bottles[0].id,
    }));
  }

  function handleProfileClick(profile: Profile) {
    selectProfile(profile);
    setIsProfileMenuOpen(false);
  }

  function closeColorEditor() {
    setDraftProfileColor(colorProfile?.color ?? seedState.profiles[0].color);
    setColorProfileId(null);
  }

  function confirmProfileColor() {
    if (!colorProfile) return;

    updateProfile(colorProfile.id, (profile) => ({
      ...profile,
      color: draftProfileColor,
    }));
    setColorProfileId(null);
  }

  function selectNextBottle() {
    const currentIndex = activeProfile.bottles.findIndex((bottle) => bottle.id === selectedBottle.id);
    const nextBottle = activeProfile.bottles[(currentIndex + 1) % activeProfile.bottles.length];
    setWaterState((current) => ({ ...current, selectedBottleId: nextBottle.id }));
  }

  function adjustGoal(amount: number) {
    setDraftGoalMl((goal) => Math.min(MAX_GOAL_ML, Math.max(MIN_GOAL_ML, goal + amount)));
  }

  function openGoalEditor() {
    setDraftGoalMl(activeProfile.goalMl);
    setIsGoalOpen(true);
  }

  function cancelGoalEditor() {
    setDraftGoalMl(activeProfile.goalMl);
    setIsGoalOpen(false);
  }

  function confirmGoalEditor() {
    updateProfile(activeProfile.id, (profile) => ({
      ...profile,
      goalMl: draftGoalMl,
    }));
    setIsGoalOpen(false);
  }

  function closeHistory() {
    setActivityDayKey(null);
    setIsHistoryOpen(false);
  }

  return (
    <main className="screen">
      <section className="tabletFrame" aria-label="Water tracking dashboard">
        <div className="dashboard">
          <header className="modernTopGrid" aria-label="Water dashboard summary">
            <section className="modernCard profileSummaryCard" aria-label="Profile">
              <button
                className="modernIcon userIcon profilePanelIcon"
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  setDraftProfileColor(activeProfile.color);
                  setColorProfileId(activeProfile.id);
                  setIsProfileMenuOpen(false);
                }}
                type="button"
                aria-label={`Change ${activeProfile.name}'s profile color`}
              >
                <span className="profileCircle" style={{ "--profile-color": activeProfile.color } as CSSProperties}>
                  {activeProfile.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
              </button>
              <div className="modernCardText">
                <span>Profile</span>
                <div className="profileDropdown">
                  <button
                    className="profileSelectButton"
                    onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
                    type="button"
                    aria-expanded={isProfileMenuOpen}
                    aria-label="Choose profile"
                  >
                    <strong>{activeProfile.name}</strong>
                    <img className="dropdownArrow" src={isProfileMenuOpen ? "/up-arrow.png" : "/down-arrow.png"} alt="" aria-hidden="true" />
                  </button>
                  {isProfileMenuOpen ? (
                    <div className="profileDropdownMenu" aria-label="Select profile">
                      {waterState.profiles.map((profile) => (
                        <button
                          className={`profileOption ${profile.id === activeProfile.id ? "active" : ""}`}
                          key={profile.id}
                          onClick={() => handleProfileClick(profile)}
                          type="button"
                          aria-label={`Select ${profile.name}`}
                        >
                          <span className="profileCircle" style={{ "--profile-color": profile.color } as CSSProperties}>
                            {profile.name
                              .split(" ")
                              .map((part) => part[0])
                              .join("")}
                          </span>
                          <span>{profile.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section
              className="modernCard intakeSummaryCard"
              onClick={openGoalEditor}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openGoalEditor();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Today's intake. Change daily goal"
            >
              <div className="modernIcon waterIcon" aria-hidden="true">
                <img src="/filled-water-drop.png" alt="" />
              </div>
              <div className="modernCardText">
                <span>Today's Intake</span>
                <strong className="splitMetric intakeMetric">
                  <span className="metricMain">{formatLitersValue(displayedTotalToday)}</span>
                  <span className="metricUnit">L</span>
                  <span className="metricDivider">/</span>
                  <span className="goalValueButton">
                    <span className="goalMetricMain">{formatLitersValue(activeProfile.goalMl)}</span>
                    <span className="goalMetricUnit">L</span>
                  </span>
                </strong>
              </div>
            </section>

            <section className="modernCard remainingSummaryCard" aria-label="Remaining">
              <div className="modernIcon remainingIcon" aria-hidden="true">
                <img src="/green-cup.png" alt="" />
              </div>
              <div className="modernCardText">
                <span>Remaining</span>
                <strong className="splitMetric remainingMetric">
                  <span className="metricMain">{formatLitersValue(displayedRemaining)}</span>
                  <span className="metricUnit">L</span>
                </strong>
                <small>{displayedRemaining === 0 ? "Goal reached" : "to reach your goal"}</small>
              </div>
            </section>
          </header>

          <section className="modernMainGrid">
            <section className="modernCard modernProgressCard" aria-label="Daily progress">
              <div className="progressRing" aria-label={`${displayedProgress}% of daily goal`}>
                <svg viewBox="0 0 150 150" role="img">
                  <defs>
                    <linearGradient id="progressRingGradient" x1="0" y1="0" x2="0" y2="150" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#4ec9ff" />
                      <stop offset="48%" stopColor="#2e9cff" />
                      <stop offset="100%" stopColor="#1764ff" />
                    </linearGradient>
                  </defs>
                  <circle className="ringTrack" cx="75" cy="75" r={RING_RADIUS} />
                  <circle
                    className="ringFill"
                    cx="75"
                    cy="75"
                    r={RING_RADIUS}
                    style={{
                      strokeDasharray: RING_CIRCUMFERENCE,
                      strokeDashoffset: RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * displayedRingProgress) / 100,
                    }}
                  />
                </svg>
                <strong>
                  <span className="progressPercentNumber">{displayedProgress}</span>
                  <span className="progressPercentSign">%</span>
                </strong>
                <small>of your daily goal</small>
                <em>
                  <img className="progressDropIcon" src="/filled-water-drop.png" alt="" />
                  <span className="progressCurrent">{formatLitersValue(displayedTotalToday)} L</span>
                  <span className="progressSlash"> / </span>
                  <span className="progressGoal">{formatLitersValue(activeProfile.goalMl)} L</span>
                </em>
              </div>
            </section>

            <section className="modernCard bottleSizeCard" aria-label="Bottle size">
              <h2>Bottle Size</h2>
              <div className="bottleChoiceGrid">
                {activeProfile.bottles.map((bottle) => (
                  <button
                    className={`bottleChoice ${bottle.id === selectedBottle.id ? "selected" : ""}`}
                    key={bottle.id}
                    onClick={() => setWaterState((current) => ({ ...current, selectedBottleId: bottle.id }))}
                    type="button"
                  >
                    <span aria-hidden="true">
                      <img src="/grey-bottle.png" alt="" />
                    </span>
                    <strong>{formatMl(bottle.ml)}</strong>
                    <small>{bottle.name}</small>
                  </button>
                ))}
              </div>
            </section>
          </section>

          <section className="modernBottomGrid">
            <button className="modernCard modernLastFillCard" onClick={() => setIsHistoryOpen(true)} type="button">
              <div className="modernIcon clockIcon" aria-hidden="true">
                <img src="/blue-clock.png" alt="" />
              </div>
              <div className="modernCardText">
                <span>Last Fill</span>
                <strong>{latestFill ? formatMl(latestFill.amountMl) : "--"}</strong>
                <small>{latestFill ? formatLastFillDate(latestFill.at) : "No fills yet"}</small>
              </div>
              <img className="lastFillBottleArt" src="/bottle-level.png" alt="" aria-hidden="true" />
            </button>

            <section className="modernCard modernStatusCard" aria-label="Bottle status">
              <div className="modernIcon checkIcon" aria-hidden="true">
                <img src="/green-check.png" alt="" />
              </div>
              <div className="modernCardText">
                <span>Bottle Status</span>
                <div className={`liveReadout ${waterState.bottlePresent ? "hasBottle" : "noBottle"}`}>
                  <span>
                    {hardwareError
                      ? hardwareError
                      : fillStartedAt
                        ? "Dispensing"
                        : !isEspConfigured
                          ? "Set ESP32 IP"
                          : waterState.bottlePresent
                          ? "Bottle detected"
                          : "No bottle"}
                  </span>
                  {fillStartedAt ? <strong>{formatMl(liveAmount)}</strong> : <i aria-hidden="true" />}
                </div>
                <small>{waterState.bottlePresent ? "You're good to go!" : "Place a bottle to start"}</small>
              </div>
              {waterState.bottlePresent ? <img className="bottlePresentArt" src="/green-bottle-present.png" alt="" aria-hidden="true" /> : null}
            </section>
          </section>

          <footer className="fillControls modernDispenseFooter">
            <button
              className={`startButton ${fillStartedAt ? "isStopping" : ""}`}
              disabled={isCommandPending || !isEspConfigured || (!waterState.bottlePresent && !fillStartedAt)}
              onClick={() => {
                void (fillStartedAt ? stopFill() : startFill());
              }}
              type="button"
            >
              <img src="/outlined-water-drop.png" alt="" />
              {isCommandPending ? "Working..." : fillStartedAt ? "Stop Dispensing" : "Dispense Water"}
            </button>
          </footer>
        </div>
      </section>

      {isHistoryOpen ? (
        <div className="modalBackdrop" role="presentation" onClick={closeHistory}>
          <section className="historyModal" aria-label="Last 7 days filling history" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="modalHeader">
              <div>
                <span>Water History</span>
                <h2>Last 7 Days</h2>
              </div>
              <button className="closeButton" onClick={closeHistory} type="button" aria-label="Close history">
                X
              </button>
            </header>

            <div className="historyDays">
              {historyDays.map((day) => (
                <article className="historyDay" key={day.date.toISOString()}>
                  <div className="daySummary">
                    <span>{formatHistoryDay(day.date)}</span>
                    <strong>{formatMl(day.total)}</strong>
                  </div>

                  <div className="sessionList">
                    {day.sessions.length > 1 ? (
                      <button className="historyActivityButton historyActivityButtonFull" onClick={() => setActivityDayKey(day.dateKey)} type="button">
                        View All Activity
                      </button>
                    ) : day.sessions.length ? (
                      (() => {
                        const session = day.sessions[0];

                        return (
                          <div className="sessionRow" key={session.id}>
                            <span>{new Date(session.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                            <strong>{formatMl(session.amountMl)}</strong>
                          </div>
                        );
                      })()
                    ) : (
                      <p>No fills</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activityDay ? (
        <div className="modalBackdrop activityBackdrop" role="presentation" onClick={() => setActivityDayKey(null)}>
          <section className="activityModal" aria-label={`${formatHistoryDay(activityDay.date)} filling activity`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="modalHeader">
              <div>
                <span>Water Activity</span>
                <h2>{formatHistoryDay(activityDay.date)}</h2>
              </div>
              <button className="closeButton" onClick={() => setActivityDayKey(null)} type="button" aria-label="Close activity">
                X
              </button>
            </header>

            <div className="activityList">
              {activityDay.sessions.map((session) => (
                <div className="activityRow" key={session.id}>
                  <span>{new Date(session.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  <strong>{formatMl(session.amountMl)}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {isGoalOpen ? (
        <div className="modalBackdrop" role="presentation" onClick={cancelGoalEditor}>
          <section className="goalModal" aria-label="Daily goal editor" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="modalHeader">
              <div>
                <span>Daily Goal</span>
                <h2>{activeProfile.name}</h2>
              </div>
              <button className="closeButton" onClick={cancelGoalEditor} type="button" aria-label="Close goal editor">
                X
              </button>
            </header>

            <div className="goalEditor">
              <button className="goalAdjustButton" onClick={() => adjustGoal(-GOAL_STEP_ML)} type="button" aria-label="Decrease daily goal">
                -
              </button>
              <strong>{formatMl(draftGoalMl)}</strong>
              <button className="goalAdjustButton" onClick={() => adjustGoal(GOAL_STEP_ML)} type="button" aria-label="Increase daily goal">
                +
              </button>
            </div>
            <div className="goalActions">
              <button className="goalActionButton secondary" onClick={cancelGoalEditor} type="button">
                Cancel
              </button>
              <button className="goalActionButton primary" onClick={confirmGoalEditor} type="button">
                Confirm
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {colorProfile ? (
        <div className="modalBackdrop" role="presentation" onClick={closeColorEditor}>
          <section className="colorModal" aria-label="Profile color picker" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="modalHeader">
              <div>
                <span>Profile Colour</span>
                <h2>{colorProfile.name}</h2>
              </div>
              <button className="closeButton" onClick={closeColorEditor} type="button" aria-label="Close color picker">
                X
              </button>
            </header>

            <div className="colorPreview">
              <span className="profileCircle" style={{ "--profile-color": draftProfileColor } as CSSProperties}>
                {colorProfile.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </span>
            </div>

            <div className="colorGrid">
              {profileColorOptions.map((color) => (
                <button
                  className={`colorSwatch ${draftProfileColor === color ? "selected" : ""}`}
                  key={color}
                  onClick={() => setDraftProfileColor(color)}
                  style={{ "--swatch-color": color } as CSSProperties}
                  type="button"
                  aria-label={`Use profile color ${color}`}
                />
              ))}
            </div>
            <div className="goalActions">
              <button className="goalActionButton secondary" onClick={closeColorEditor} type="button">
                Cancel
              </button>
              <button className="goalActionButton primary" onClick={confirmProfileColor} type="button">
                Confirm
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function MetricCard({ label, primary, secondary }: { label: string; primary: string; secondary: string }) {
  return (
    <div className="metricCard">
      <span>{label}</span>
      <strong>{primary}</strong>
      <small>{secondary}</small>
    </div>
  );
}

export default App;
