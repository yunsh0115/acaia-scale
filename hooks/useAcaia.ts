"use client";

import { useState, useRef, useCallback } from "react";

// ─── Acaia BLE Constants ───────────────────────────────────────────────────
const SERVICE_UUID        = "00001820-0000-1000-8000-00805f9b34fb";
const CHARACTERISTIC_UUID = "00002a80-0000-1000-8000-00805f9b34fb";

const HANDSHAKE_PACKET = new Uint8Array([
  0xef, 0xdd, 0x00,
  0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
  0xbb,
]);

function toBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function buildPacket(cmd: number, payload: number[]): Uint8Array {
  const inner = [cmd, payload.length, ...payload];
  const sum   = inner.reduce((acc, b) => acc + b, 0);
  return new Uint8Array([0xef, 0xdd, ...inner, sum % 256, (~sum) & 0xff]);
}

const TARE_PACKET = buildPacket(0x04, []);

function toHex(bytes: number[]): string {
  return bytes.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(" ");
}

// ─── Types ─────────────────────────────────────────────────────────────────
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ParsedPacket {
  timestamp: string;
  hex: string;
  byteLength: number;
  isAcaiaFrame: boolean;
  cmd: number | null;
  unit: number | null;        // 1=gram, 2=ounce
  rawWeight: number | null;
  weight: number | null;
  byte0: number; byte1: number; byte2: number; byte3: number;
  byte4: number; byte5: number; byte6: number;
  allBytes: number[];
}

export interface AcaiaState {
  weight: number;
  unit: number | null;
  rawWeight: number | null;
  status: ConnectionStatus;
  deviceName: string | null;
  lastPacket: ParsedPacket | null;
  packetLog: ParsedPacket[];
  connect: () => Promise<void>;
  disconnect: () => void;
  tare: () => Promise<void>;
  clearLog: () => void;
}

// ─── Packet Parser ─────────────────────────────────────────────────────────
function parsePacket(data: DataView): ParsedPacket {
  const allBytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

  const base: ParsedPacket = {
    timestamp: ts,
    hex: toHex(allBytes),
    byteLength: allBytes.length,
    isAcaiaFrame: false,
    cmd: null,
    unit: null,
    rawWeight: null,
    weight: null,
    byte0: allBytes[0] ?? 0,
    byte1: allBytes[1] ?? 0,
    byte2: allBytes[2] ?? 0,
    byte3: allBytes[3] ?? 0,
    byte4: allBytes[4] ?? 0,
    byte5: allBytes[5] ?? 0,
    byte6: allBytes[6] ?? 0,
    allBytes,
  };

  if (allBytes.length < 2) return base;
  if (allBytes[0] !== 0xef || allBytes[1] !== 0xdd) return base;

  base.isAcaiaFrame = true;
  base.cmd = allBytes[2] ?? null;

  if (allBytes.length >= 7) {
    const unit      = allBytes[4];
    const rawWeight = (allBytes[6] << 8) | allBytes[5];
    const weight    = rawWeight / 10.0;

    base.unit      = unit;
    base.rawWeight = rawWeight;
    base.weight    = unit === 1 ? weight : weight * 28.3495;
  }

  return base;
}

// ─── Hook ──────────────────────────────────────────────────────────────────
const MAX_LOG = 50;

export function useAcaia(): AcaiaState {
  const [weight,     setWeight]     = useState<number>(0);
  const [unit,       setUnit]       = useState<number | null>(null);
  const [rawWeight,  setRawWeight]  = useState<number | null>(null);
  const [status,     setStatus]     = useState<ConnectionStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [lastPacket, setLastPacket] = useState<ParsedPacket | null>(null);
  const [packetLog,  setPacketLog]  = useState<ParsedPacket[]>([]);

  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const deviceRef         = useRef<BluetoothDevice | null>(null);

  const handleNotification = useCallback((event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target.value) return;

    const parsed = parsePacket(target.value);
    console.log("[Acaia] RX:", parsed.hex, "→", parsed);

    setLastPacket(parsed);
    setPacketLog((prev) => [parsed, ...prev].slice(0, MAX_LOG));

    if (parsed.weight !== null) {
      setWeight(Math.round(parsed.weight * 10) / 10);
      setUnit(parsed.unit);
      setRawWeight(parsed.rawWeight);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      alert("Web Bluetooth를 지원하지 않는 브라우저입니다.");
      return;
    }
    try {
      setStatus("connecting");
      console.log("[Acaia] 장치 검색 — 필터 없음 (all devices)");

      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      });

      device.addEventListener("gattserverdisconnected", () => {
        console.log("[Acaia] 연결 끊김");
        setStatus("disconnected");
        setDeviceName(null);
        characteristicRef.current = null;
      });

      deviceRef.current = device;
      const name = device.name ?? "(이름 없음)";
      console.log(`[Acaia] 선택된 장치: ${name}`);
      setDeviceName(name);

      console.log("[Acaia] GATT 연결 중...");
      const server  = await device.gatt!.connect();
      console.log("[Acaia] Service 탐색:", SERVICE_UUID);
      const service = await server.getPrimaryService(SERVICE_UUID);
      console.log("[Acaia] Characteristic 탐색:", CHARACTERISTIC_UUID);
      const char    = await service.getCharacteristic(CHARACTERISTIC_UUID);
      characteristicRef.current = char;

      console.log("[Acaia] Notification 구독...");
      await char.startNotifications();
      char.addEventListener("characteristicvaluechanged", handleNotification);

      await new Promise((r) => setTimeout(r, 80));
      console.log("[Acaia] Handshake TX:", toHex(Array.from(HANDSHAKE_PACKET)));
      await char.writeValueWithoutResponse(toBuffer(HANDSHAKE_PACKET));
      console.log("[Acaia] Handshake 완료");

      setStatus("connected");
    } catch (err) {
      console.error("[Acaia] 연결 오류:", err);
      setStatus("error");
    }
  }, [handleNotification]);

  const disconnect = useCallback(() => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    setStatus("disconnected");
    setDeviceName(null);
    setWeight(0);
    setUnit(null);
    setRawWeight(null);
    characteristicRef.current = null;
  }, []);

  const tare = useCallback(async () => {
    const char = characteristicRef.current;
    if (!char) return;
    console.log("[Acaia] Tare TX:", toHex(Array.from(TARE_PACKET)));
    await char.writeValueWithoutResponse(toBuffer(TARE_PACKET));
    setWeight(0);
  }, []);

  const clearLog = useCallback(() => setPacketLog([]), []);

  return {
    weight, unit, rawWeight, status, deviceName,
    lastPacket, packetLog,
    connect, disconnect, tare, clearLog,
  };
}
