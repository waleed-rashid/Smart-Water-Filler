import { type CSSProperties, useEffect, useMemo, useState } from "react";

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

const STORAGE_KEY = "aqua-panel-tablet:v2";
const RING_RADIUS = 62;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const sharedBottles: Bottle[] = [
  { id: "cup", name: "Cup", ml: 250 },
  { id: "tumbler", name: "Owala", ml: 710 },
  { id: "bottle", name: "Stanley", ml: 1183 },
];
const profileNames = ["User 1", "User 2", "User 3", "User 4"];

function todayAt(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const seedState: WaterState = {
  activeProfileId: "waleed",
  flowRateMlSec: 18,
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
  ],
};

function loadState(): WaterState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return seedState;

  try {
    const parsed = { ...seedState, ...JSON.parse(saved) } as WaterState;
    return {
      ...parsed,
      selectedBottleId: sharedBottles.some((bottle) => bottle.id === parsed.selectedBottleId) ? parsed.selectedBottleId : sharedBottles[0].id,
      profiles: parsed.profiles.map((profile, index) => ({
        ...profile,
        name: profileNames[index] ?? `User ${index + 1}`,
        bottles: sharedBottles,
      })),
    };
  } catch {
    return seedState;
  }
}

function formatMl(amount: number) {
  return `${Math.round(amount).toLocaleString()} mL`;
}

function createSessionId() {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  const activeProfile = useMemo(
    () => waterState.profiles.find((profile) => profile.id === waterState.activeProfileId) ?? waterState.profiles[0],
    [waterState.activeProfileId, waterState.profiles],
  );

  const selectedBottle = activeProfile.bottles.find((bottle) => bottle.id === waterState.selectedBottleId) ?? activeProfile.bottles[0];
  const totalToday = dailyTotal(activeProfile);
  const latestFill = lastFill(activeProfile);
  const liveSeconds = fillStartedAt ? (now - fillStartedAt) / 1000 : 0;
  const liveAmount = liveSeconds * waterState.flowRateMlSec;
  const liveFillAmount = fillStartedAt ? Math.min(liveAmount, selectedBottle.ml) : 0;
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
      sessions,
      total: sessions.reduce((sum, session) => sum + session.amountMl, 0),
    };
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(waterState));
  }, [waterState]);

  useEffect(() => {
    if (!fillStartedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [fillStartedAt]);

  useEffect(() => {
    if (!fillStartedAt || liveAmount < selectedBottle.ml) return;

    addSession("dashboard", selectedBottle.ml, selectedBottle.ml / waterState.flowRateMlSec);
    setFillStartedAt(null);
    setNow(Date.now());
  }, [fillStartedAt, liveAmount, selectedBottle.ml, waterState.flowRateMlSec]);

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

  function startFill() {
    if (!waterState.bottlePresent || fillStartedAt) return;
    const startedAt = Date.now();
    setNow(startedAt);
    setFillStartedAt(startedAt);
  }

  function stopFill() {
    if (!fillStartedAt) return;
    if (liveSeconds >= 0.8) {
      addSession("dashboard", liveAmount, liveSeconds);
    }
    setFillStartedAt(null);
    setNow(Date.now());
  }

  function selectProfile(profile: Profile) {
    setFillStartedAt(null);
    setWaterState((current) => ({
      ...current,
      activeProfileId: profile.id,
      selectedBottleId: profile.bottles[0].id,
    }));
  }

  function selectNextBottle() {
    const currentIndex = activeProfile.bottles.findIndex((bottle) => bottle.id === selectedBottle.id);
    const nextBottle = activeProfile.bottles[(currentIndex + 1) % activeProfile.bottles.length];
    setWaterState((current) => ({ ...current, selectedBottleId: nextBottle.id }));
  }

  return (
    <main className="screen">
      <section className="tabletFrame" aria-label="Water tracking dashboard">
        <div className="dashboard">
          <header className="hero">
            <div className="headline">
              <p>Welcome, {activeProfile.name}!</p>
              <span>Today's Intake</span>
              <h1>
                {Math.round(displayedTotalToday).toLocaleString()} / {activeProfile.goalMl.toLocaleString()} mL
              </h1>
            </div>

            <div className="progressRing" aria-label={`${displayedProgress}% of daily goal`}>
              <svg viewBox="0 0 150 150" role="img">
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
              <strong>{displayedProgress}%</strong>
            </div>
          </header>

          <section className="profileSection" aria-label="Select profile">
            <h2>Select Your Profile</h2>
            <div className="profiles">
              {waterState.profiles.map((profile) => (
                <button
                  className={`profileButton ${profile.id === activeProfile.id ? "active" : ""}`}
                  key={profile.id}
                  onClick={() => selectProfile(profile)}
                  type="button"
                >
                  <span className="profileCircle" style={{ "--profile-color": profile.color } as CSSProperties}>
                    {profile.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")}
                  </span>
                  <span className="profileName">{profile.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="metricGrid" aria-label="Water stats">
            <button className="metricCard interactive" onClick={() => setIsHistoryOpen(true)} type="button">
              <span>Last Fill</span>
              <strong>{latestFill ? formatMl(latestFill.amountMl) : "--"}</strong>
              <small>{latestFill ? formatLastFillDate(latestFill.at) : "No fills yet"}</small>
            </button>
            <button className="metricCard interactive" onClick={selectNextBottle} type="button">
              <span>Bottle Size</span>
              <strong>{formatMl(selectedBottle.ml)}</strong>
              <small>{selectedBottle.name}</small>
            </button>
            <MetricCard label="Remaining" primary={formatMl(displayedRemaining)} secondary={displayedRemaining === 0 ? "Goal reached" : "Left today"} />
          </section>

          <footer className="fillControls">
            <button
              className={`startButton ${fillStartedAt ? "isStopping" : ""}`}
              disabled={!waterState.bottlePresent && !fillStartedAt}
              onClick={fillStartedAt ? stopFill : startFill}
              type="button"
            >
              {fillStartedAt ? "Stop Dispensing" : "Start Dispensing"}
            </button>
            <div className="liveReadout">
              <span>{fillStartedAt ? "Dispensing" : waterState.bottlePresent ? "Bottle detected" : "No bottle"}</span>
              <strong>{formatMl(liveAmount)}</strong>
            </div>
          </footer>
        </div>
      </section>

      {isHistoryOpen ? (
        <div className="modalBackdrop" role="presentation" onClick={() => setIsHistoryOpen(false)}>
          <section className="historyModal" aria-label="Last 7 days filling history" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="modalHeader">
              <div>
                <span>Water History</span>
                <h2>Last 7 Days</h2>
              </div>
              <button className="closeButton" onClick={() => setIsHistoryOpen(false)} type="button" aria-label="Close history">
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
                    {day.sessions.length ? (
                      day.sessions.map((session) => {
                        const bottle = activeProfile.bottles.find((item) => item.id === session.bottleId);
                        return (
                          <div className="sessionRow" key={session.id}>
                            <span>{new Date(session.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                            <strong>{formatMl(session.amountMl)}</strong>
                            <small>{bottle?.name ?? "Custom"} / {session.source}</small>
                          </div>
                        );
                      })
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
