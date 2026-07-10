# SmartWaterFiller

React + TypeScript dashboard for a fridge water dispenser project. It tracks daily water intake across profiles, bottle sizes, last-fill history, and simulated filling sessions.

## Run Locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`.

For iPad access on the same Wi-Fi:

```powershell
npm.cmd run dev -- --host 0.0.0.0
```

Then open `http://YOUR_COMPUTER_IP:5173` on the iPad.

## Environment

Secrets and local device URLs belong in `.env`, which is ignored by git. Use `.env.example` as the template.
