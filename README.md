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

For older iPads such as iOS 12.5.x, use the production legacy build instead of the dev server:

```powershell
npm.cmd run build
npm.cmd run preview:host
```

Then open `http://YOUR_COMPUTER_IP:4173` on the iPad.

## Environment

Secrets and local device URLs belong in `.env`, which is ignored by git. Use `.env.example` as the template.

For the dashboard to talk to the ESP32, set:

```env
VITE_ESP32_API_URL=http://YOUR_ESP32_IP
```

## ESP32 Firmware

The Arduino sketch is in `firmware/SmartWaterFillerESP32`.

1. Copy `firmware/SmartWaterFillerESP32/secrets.example.h` to `firmware/SmartWaterFillerESP32/secrets.h`.
2. Put your Wi-Fi name and password in `secrets.h`.
3. Upload `SmartWaterFillerESP32.ino` to the ESP32.
4. Open Serial Monitor and copy the printed ESP32 IP address.
5. Put that IP in `.env` as `VITE_ESP32_API_URL`.
