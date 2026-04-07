"use client";

import { useState, useRef, useCallback } from "react";

// ─── Nordic UART Acaia (Pearl v1) UUIDs ───────────────────────────────────
const SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const RX_UUID      = "49535343-1e4d-4bd9-ba61-23c647249616"; // 저울 → 앱 (notify)
const TX_UUID      = "49535343-8841-43f4-a8d4-ecbe34729bb3"; // 앱 → 저울 (write)

// ─── 패킷 빌더 ─────────────────────────────────────────────────────────────
function toBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function buildPacket(cmd: number, payload: number[]): Uint8Array {
  const inner = [cmd, payload.length, ...payload];
  const sum   = inner.reduce((a, b) => a + b, 0);
  return new Uint8Array([0xef, 0xdd, ...inner, sum % 256, (~sum) & 0xff]);
}

function toHex(bytes: number[]): string {
  return bytes.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(" ");
}

// AcaiaArduinoBLE 소스 기준 정확한 패킷 (모두 하드코딩된 값)
// ref: https://github.com/tatemazer/AcaiaArduinoBLE

/**
 * Pearl 2025 전용 21바이트 인증 패킷 (가장 먼저 전송)
 * [HEADER1, HEADER2, CMD=0x00, LEN=0x0f, 0x30×15, CKSUM1=0x93, CKSUM2=0x6c]
 */
const AUTH_PACKET = new Uint8Array([
  0xef, 0xdd, 0x00, 0x0f,
  0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x30,
  0x93, 0x6c,
]);

/** 로그인/인증 패킷 (CMD=0x0b) */
const IDENTIFY_PACKET = new Uint8Array([
  0xef, 0xdd, 0x0b,
  0x30, 0x31, 0x32, 0x33, 0x34,
  0x35, 0x36, 0x37, 0x38, 0x39,
  0x30, 0x31, 0x32, 0x33, 0x34,
  0x9a, 0x6d,
]);

/** 무게 알림 요청 (CMD=0x0c) — 이걸 보내야 weight 패킷이 오기 시작 */
const NOTIFICATION_REQUEST = new Uint8Array([
  0xef, 0xdd, 0x0c,
  0x09, 0x00, 0x01, 0x01, 0x02,
  0x02, 0x05, 0x03, 0x04, 0x15, 0x06,
]);

/** 하트비트 — 2750ms마다 or 패킷 수신마다 (7바이트 고정) */
const HEARTBEAT_PACKET = new Uint8Array([
  0xef, 0xdd, 0x00, 0x02, 0x00, 0x02, 0x00,
]);

/** Tare (6바이트 고정) */
const TARE_PACKET = new Uint8Array([
  0xef, 0xdd, 0x04, 0x00, 0x00, 0x00,
]);

// ─── 파서: 모든 패킷을 그대로 노출, 가능하면 무게도 시도 ────────────────────
export interface ParsedPacket {
  timestamp: string;
  hex: string;
  byteLength: number;
  allBytes: number[];
  isAcaiaFrame: boolean;       // EF DD 헤더 여부
  cmd: number | null;          // byte[2]
  payloadLen: number | null;   // byte[3]
  subEvent: number | null;     // byte[4] — 서브이벤트 타입 (0x02=weight 추정)
  // 모든 가능한 2바이트 조합으로 weight 후보 계산 (디버그용)
  weightCandidates: { label: string; raw: number; gram: number }[];
  weight: number | null;       // 확정된 무게 (아직 확신 없으면 null)
}

function parsePacket(data: DataView): ParsedPacket {
  const allBytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  const ts = new Date().toISOString().slice(11, 23);

  const base: ParsedPacket = {
    timestamp: ts,
    hex: toHex(allBytes),
    byteLength: allBytes.length,
    allBytes,
    isAcaiaFrame: false,
    cmd: null,
    payloadLen: null,
    subEvent: null,
    weightCandidates: [],
    weight: null,
  };

  // 모든 2바이트 LE 조합으로 후보 생성 (무게 파악용)
  for (let i = 0; i + 1 < allBytes.length; i++) {
    const raw  = (allBytes[i + 1] << 8) | allBytes[i];
    const gram = raw / 10.0;
    if (gram >= 0 && gram <= 5000) {
      base.weightCandidates.push({ label: `[${i}][${i+1}]LE`, raw, gram });
    }
  }

  if (allBytes.length < 4) return base;
  if (allBytes[0] !== 0xef || allBytes[1] !== 0xdd) return base;

  base.isAcaiaFrame = true;
  base.cmd        = allBytes[2] ?? null;
  base.payloadLen = allBytes[3] ?? null;
  base.subEvent   = allBytes[4] ?? null;

  // NEW 프로토콜 (AcaiaArduinoBLE 기준):
  // subEvent(input[4]) == 0x05 → weight 패킷
  //   raw      = (input[6] << 8) | input[5]  (LE 16bit)
  //   decimals = input[9]
  //   sign     = (input[10] & 0x02) ? -1 : 1
  if (base.subEvent === 0x05 && allBytes.length >= 11) {
    const raw      = (allBytes[6] << 8) | allBytes[5];
    const decimals = allBytes[9];
    const sign     = (allBytes[10] & 0x02) ? -1 : 1;
    base.weight    = (raw / Math.pow(10, decimals)) * sign;
  }

  return base;
}

// ─── Types ─────────────────────────────────────────────────────────────────
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AcaiaState {
  weight: number;
  status: ConnectionStatus;
  deviceName: string | null;
  lastPacket: ParsedPacket | null;
  packetLog: ParsedPacket[];
  txUuid: string;
  rxUuid: string;
  hasTxChar: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  tare: () => Promise<void>;
  clearLog: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────
const MAX_LOG = 100;

export function useAcaia(): AcaiaState {
  const [weight,     setWeight]     = useState<number>(0);
  const [status,     setStatus]     = useState<ConnectionStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [lastPacket, setLastPacket] = useState<ParsedPacket | null>(null);
  const [packetLog,  setPacketLog]  = useState<ParsedPacket[]>([]);
  const [hasTxChar,  setHasTxChar]  = useState<boolean>(false);

  const rxCharRef    = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const txCharRef    = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const deviceRef    = useRef<BluetoothDevice | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── write helper: TX 있으면 TX로, 없으면 RX로 ──────────────────────────
  const writeCmd = useCallback(async (pkt: Uint8Array, label: string) => {
    const char = txCharRef.current ?? rxCharRef.current;
    if (!char) { console.warn(`[Acaia] ${label} 실패: char 없음`); return; }
    console.log(`[Acaia] ${label} TX → ${toHex(Array.from(pkt))}`);
    await char.writeValueWithoutResponse(toBuffer(pkt));
  }, []);

  // ── 알림 핸들러: 패킷 저장 + 즉시 ACK ──────────────────────────────────
  const handleNotification = useCallback((event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target.value) return;

    const parsed = parsePacket(target.value);
    console.log("[Acaia] RX:", parsed.hex);

    setLastPacket(parsed);
    setPacketLog((prev) => [parsed, ...prev].slice(0, MAX_LOG));
    if (parsed.weight !== null) setWeight(Math.round(parsed.weight * 10) / 10);

    // 패킷 수신마다 즉시 heartbeat로 응답 — 안 하면 저울이 disconnect함
    writeCmd(HEARTBEAT_PACKET, "ACK");
  }, [writeCmd]);

  // ── 연결 ────────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) { alert("Web Bluetooth 미지원 브라우저"); return; }

    try {
      setStatus("connecting");

      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: "PEARL" },
          { namePrefix: "ACAIA" },
          { namePrefix: "Acaia" },
        ],
        optionalServices: [SERVICE_UUID],
      });

      device.addEventListener("gattserverdisconnected", () => {
        console.log("[Acaia] GATT 연결 끊김");
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        setStatus("disconnected");
        setDeviceName(null);
        rxCharRef.current = null;
        txCharRef.current = null;
      });

      deviceRef.current = device;
      setDeviceName(device.name ?? "(이름 없음)");

      const server  = await device.gatt!.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      console.log("[Acaia] Service 연결 ✓");

      // RX characteristic (notify)
      const rxChar = await service.getCharacteristic(RX_UUID);
      rxCharRef.current = rxChar;
      await rxChar.startNotifications();
      rxChar.addEventListener("characteristicvaluechanged", handleNotification);
      console.log("[Acaia] RX(notify) 구독 ✓");

      // TX characteristic (write) — 없으면 RX 겸용
      try {
        const txChar = await service.getCharacteristic(TX_UUID);
        txCharRef.current = txChar;
        setHasTxChar(true);
        console.log("[Acaia] TX(write) char 발견 ✓ — TX/RX 분리 모드");
      } catch {
        console.warn("[Acaia] TX char 없음 → RX char로 쓰기 겸용");
        setHasTxChar(false);
      }

      // 초기화 시퀀스
      await new Promise((r) => setTimeout(r, 100));

      // 1. AUTH — Pearl 2025 전용 21바이트 인증 (먼저!)
      await writeCmd(AUTH_PACKET, "AUTH");
      await new Promise((r) => setTimeout(r, 500));

      // 2. IDENTIFY — 저울 인증 (CMD=0x0b)
      await writeCmd(IDENTIFY_PACKET, "IDENTIFY");
      await new Promise((r) => setTimeout(r, 100));

      // 3. NOTIFICATION_REQUEST — weight 스트리밍 시작 (CMD=0x0c)
      await writeCmd(NOTIFICATION_REQUEST, "NOTIFICATION_REQUEST");

      setStatus("connected");
    } catch (err) {
      console.error("[Acaia] 연결 오류:", err);
      setStatus("error");
    }
  }, [handleNotification, writeCmd]);

  const disconnect = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    deviceRef.current?.gatt?.disconnect();
    setStatus("disconnected");
    setDeviceName(null);
    setWeight(0);
    rxCharRef.current = null;
    txCharRef.current = null;
  }, []);

  const tare     = useCallback(() => writeCmd(TARE_PACKET, "Tare"), [writeCmd]);
  const clearLog = useCallback(() => setPacketLog([]), []);

  return {
    weight, status, deviceName,
    lastPacket, packetLog,
    txUuid: TX_UUID, rxUuid: RX_UUID, hasTxChar,
    connect, disconnect, tare, clearLog,
  };
}
