"use client";

import { useAcaia, type ParsedPacket } from "@/hooks/useAcaia";

const SERVICE_UUID        = "00001820-0000-1000-8000-00805f9b34fb";
const CHARACTERISTIC_UUID = "00002a80-0000-1000-8000-00805f9b34fb";

// ─── 상태 배지 ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    connected:    { color: "bg-green-500",  label: "CONNECTED" },
    connecting:   { color: "bg-yellow-400", label: "CONNECTING…" },
    disconnected: { color: "bg-zinc-600",   label: "DISCONNECTED" },
    error:        { color: "bg-red-500",    label: "ERROR" },
  };
  const { color, label } = map[status] ?? map.disconnected;
  return (
    <span className="flex items-center gap-2 text-xs font-mono font-bold tracking-widest">
      <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />
      {label}
    </span>
  );
}

// ─── 값 카드 ────────────────────────────────────────────────────────────────
function ValueCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-3 flex flex-col gap-1">
      <span className="text-zinc-500 text-xs font-mono uppercase tracking-widest">{label}</span>
      <span className="text-white font-mono text-xl font-bold">{value}</span>
      {sub && <span className="text-zinc-500 text-xs font-mono">{sub}</span>}
    </div>
  );
}

// ─── 패킷 행 ────────────────────────────────────────────────────────────────
function PacketRow({ p, index }: { p: ParsedPacket; index: number }) {
  return (
    <div className={`px-3 py-2 border-b border-zinc-800 font-mono text-xs flex gap-3 items-start ${index === 0 ? "bg-zinc-800/60" : ""}`}>
      <span className="text-zinc-500 shrink-0">{p.timestamp}</span>
      <span className={`shrink-0 px-1 rounded text-xs font-bold ${p.isAcaiaFrame ? "bg-green-900 text-green-400" : "bg-zinc-700 text-zinc-400"}`}>
        {p.isAcaiaFrame ? "ACAIA" : "RAW"}
      </span>
      <span className="text-zinc-300 break-all leading-relaxed">{p.hex}</span>
      {p.weight !== null && (
        <span className="shrink-0 text-green-400 font-bold">{p.weight.toFixed(1)}g</span>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function AcaiaScale() {
  const {
    weight, unit, rawWeight, status, deviceName,
    lastPacket, packetLog,
    connect, disconnect, tare, clearLog,
  } = useAcaia();

  const isConnected  = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="min-h-screen bg-black text-white font-mono p-4 flex flex-col gap-4">

      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h1 className="text-sm font-bold tracking-widest text-zinc-400 uppercase">
            Acaia Scale · BLE Debug
          </h1>
          <p className="text-xs text-zinc-600 mt-0.5">Web Bluetooth Test Interface</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* ── 연결 정보 ── */}
      <div className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs flex flex-col gap-1">
        <div className="flex justify-between">
          <span className="text-zinc-500">SERVICE UUID</span>
          <span className="text-zinc-300">{SERVICE_UUID}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">CHARACTERISTIC</span>
          <span className="text-zinc-300">{CHARACTERISTIC_UUID}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">DEVICE</span>
          <span className="text-zinc-300">{deviceName ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">BT FILTER</span>
          <span className="text-yellow-400">acceptAllDevices: true</span>
        </div>
      </div>

      {/* ── 측정값 그리드 ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ValueCard
          label="Weight"
          value={isConnected ? `${weight.toFixed(1)}` : "—"}
          sub="gram (parsed)"
        />
        <ValueCard
          label="Raw Weight"
          value={rawWeight !== null ? rawWeight : "—"}
          sub="(byte5 | byte6<<8)"
        />
        <ValueCard
          label="Unit"
          value={unit !== null ? (unit === 1 ? "1 (gram)" : "2 (ounce)") : "—"}
          sub="byte4"
        />
        <ValueCard
          label="Packets"
          value={packetLog.length}
          sub={`max ${50} stored`}
        />
      </div>

      {/* ── 마지막 패킷 바이트 상세 ── */}
      {lastPacket && (
        <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
          <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Last Packet — Byte Map</p>
          <div className="flex flex-wrap gap-2">
            {lastPacket.allBytes.map((b, i) => (
              <div key={i} className="flex flex-col items-center">
                <span className="text-zinc-600 text-[10px]">[{i}]</span>
                <span className={`text-xs font-bold px-1 rounded ${
                  i === 0 || i === 1 ? "text-blue-400" :
                  i === 2 ? "text-purple-400" :
                  i === 4 ? "text-yellow-400" :
                  i === 5 || i === 6 ? "text-green-400" :
                  "text-zinc-300"
                }`}>
                  {("0x" + b.toString(16).padStart(2, "0")).toUpperCase()}
                </span>
                <span className="text-zinc-700 text-[10px]">{b}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-zinc-600">
            <span><span className="text-blue-400">■</span> Header (EF DD)</span>
            <span><span className="text-purple-400">■</span> CMD</span>
            <span><span className="text-yellow-400">■</span> Unit</span>
            <span><span className="text-green-400">■</span> Weight bytes</span>
          </div>
        </div>
      )}

      {/* ── 버튼 ── */}
      <div className="flex gap-2 flex-wrap">
        {!isConnected ? (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="px-4 py-2 bg-zinc-100 text-black text-xs font-bold rounded hover:bg-white active:scale-95 transition-all disabled:opacity-40"
          >
            {isConnecting ? "CONNECTING…" : "▶ CONNECT"}
          </button>
        ) : (
          <>
            <button
              onClick={tare}
              className="px-4 py-2 bg-zinc-800 border border-zinc-600 text-zinc-100 text-xs font-bold rounded hover:bg-zinc-700 active:scale-95 transition-all"
            >
              TARE
            </button>
            <button
              onClick={disconnect}
              className="px-4 py-2 bg-zinc-800 border border-red-900 text-red-400 text-xs font-bold rounded hover:bg-red-950 active:scale-95 transition-all"
            >
              DISCONNECT
            </button>
          </>
        )}
        <button
          onClick={clearLog}
          className="px-4 py-2 bg-zinc-900 border border-zinc-700 text-zinc-500 text-xs font-bold rounded hover:bg-zinc-800 active:scale-95 transition-all"
        >
          CLEAR LOG
        </button>
      </div>

      {/* ── 패킷 로그 ── */}
      <div className="flex-1 border border-zinc-800 rounded overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
          <span className="text-xs text-zinc-500 uppercase tracking-widest">Packet Log</span>
          <span className="text-xs text-zinc-600">{packetLog.length} packets</span>
        </div>
        <div className="overflow-y-auto max-h-64 bg-black">
          {packetLog.length === 0 ? (
            <p className="text-zinc-700 text-xs p-4 text-center">No packets yet — connect the scale</p>
          ) : (
            packetLog.map((p, i) => <PacketRow key={i} p={p} index={i} />)
          )}
        </div>
      </div>

    </div>
  );
}
