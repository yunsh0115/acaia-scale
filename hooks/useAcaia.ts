"use client";

import { useState, useRef, useCallback } from "react";

// ─── Acaia BLE Constants ───────────────────────────────────────────────────
const SERVICE_UUID        = "00001820-0000-1000-8000-00805f9b34fb";
const CHARACTERISTIC_UUID = "00002a80-0000-1000-8000-00805f9b34fb";

/** 21-byte handshake packet (Beanconqueror protocol) */
const HANDSHAKE_PACKET = new Uint8Array([
  0xef, 0xdd,
  0x00,
  0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30,
  0xbb,
]);

// ─── Packet Builder ────────────────────────────────────────────────────────
/**
 * 구조: [0xEF, 0xDD, CMD, PAYLOAD_LEN, ...PAYLOAD, CKSUM1, CKSUM2]
 * CKSUM1: (CMD + PAYLOAD_LEN + ...PAYLOAD)의 합 % 256
 * CKSUM2: 동일 합 % 256의 비트 반전 (~) & 0xFF
 */
/** Uint8Array를 Web Bluetooth가 요구하는 ArrayBuffer로 변환 */
function toBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function buildPacket(cmd: number, payload: number[]): Uint8Array {
  const inner = [cmd, payload.length, ...payload];
  const sum   = inner.reduce((acc, b) => acc + b, 0);
  const ck1   = sum % 256;
  const ck2   = (~sum) & 0xff;
  return new Uint8Array([0xef, 0xdd, ...inner, ck1, ck2]);
}

/** Tare 커맨드 (CMD=0x04, payload=[]) */
const TARE_PACKET = buildPacket(0x04, []);

// ─── Weight Parsing ────────────────────────────────────────────────────────
function parseWeight(data: DataView): number | null {
  // 최소 패킷 길이 확인
  if (data.byteLength < 7) return null;

  const header0 = data.getUint8(0);
  const header1 = data.getUint8(1);
  if (header0 !== 0xef || header1 !== 0xdd) return null;

  const unit      = data.getUint8(4); // 1 = gram, 2 = ounce
  const rawWeight = (data.getUint8(6) << 8) | data.getUint8(5);

  const weight = rawWeight / 10.0;
  console.log(
    `[Acaia] 수신 패킷 → unit=${unit}, rawWeight=${rawWeight}, weight=${weight}g`
  );
  return unit === 1 ? weight : weight * 28.3495; // ounce → gram 변환
}

// ─── Types ─────────────────────────────────────────────────────────────────
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AcaiaState {
  weight: number;
  status: ConnectionStatus;
  deviceName: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  tare: () => Promise<void>;
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useAcaia(): AcaiaState {
  const [weight,     setWeight]     = useState<number>(0);
  const [status,     setStatus]     = useState<ConnectionStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const deviceRef         = useRef<BluetoothDevice | null>(null);

  // ── 알림 수신 핸들러 ───────────────────────────────────────────────────
  const handleNotification = useCallback((event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const data   = target.value;
    if (!data) return;

    console.log(
      "[Acaia] 알림 수신:",
      Array.from(new Uint8Array(data.buffer))
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(" ")
    );

    const w = parseWeight(data);
    if (w !== null) setWeight(Math.round(w * 10) / 10);
  }, []);

  // ── 연결 ───────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      alert("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
      return;
    }

    try {
      setStatus("connecting");
      console.log("[Acaia] 블루투스 장치 검색 시작...");

      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: "ACAIA" },
          { namePrefix: "Acaia" },
          { namePrefix: "PEARL" },
        ],
        optionalServices: [SERVICE_UUID],
      });

      device.addEventListener("gattserverdisconnected", () => {
        console.log("[Acaia] 장치 연결 끊김");
        setStatus("disconnected");
        setDeviceName(null);
        characteristicRef.current = null;
      });

      deviceRef.current = device;
      console.log(`[Acaia] 장치 발견: ${device.name}`);
      setDeviceName(device.name ?? "Acaia Scale");

      console.log("[Acaia] GATT 서버 연결 중...");
      const server  = await device.gatt!.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const char    = await service.getCharacteristic(CHARACTERISTIC_UUID);
      characteristicRef.current = char;

      console.log("[Acaia] 알림(Notification) 구독 시작...");
      await char.startNotifications();
      char.addEventListener("characteristicvaluechanged", handleNotification);

      // 핸드쉐이크: startNotifications 후 100ms 이내 전송
      await new Promise((r) => setTimeout(r, 80));
      console.log(
        "[Acaia] 핸드쉐이크 전송:",
        Array.from(HANDSHAKE_PACKET)
          .map((b) => "0x" + b.toString(16).padStart(2, "0"))
          .join(" ")
      );
      await char.writeValueWithoutResponse(toBuffer(HANDSHAKE_PACKET));
      console.log("[Acaia] 핸드쉐이크 완료 → 무게 데이터 수신 대기 중");

      setStatus("connected");
    } catch (err) {
      console.error("[Acaia] 연결 오류:", err);
      setStatus("error");
    }
  }, [handleNotification]);

  // ── 연결 해제 ──────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
      console.log("[Acaia] 수동 연결 해제");
    }
    setStatus("disconnected");
    setDeviceName(null);
    setWeight(0);
    characteristicRef.current = null;
  }, []);

  // ── 영점 조절 (Tare) ───────────────────────────────────────────────────
  const tare = useCallback(async () => {
    const char = characteristicRef.current;
    if (!char) {
      console.warn("[Acaia] Tare 실패: 저울이 연결되지 않음");
      return;
    }
    console.log(
      "[Acaia] Tare 패킷 전송:",
      Array.from(TARE_PACKET)
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(" ")
    );
    await char.writeValueWithoutResponse(toBuffer(TARE_PACKET));
    console.log("[Acaia] Tare 완료");
    setWeight(0);
  }, []);

  return { weight, status, deviceName, connect, disconnect, tare };
}
