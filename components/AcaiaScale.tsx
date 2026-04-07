"use client";

import { useAcaia } from "@/hooks/useAcaia";

export default function AcaiaScale() {
  const { weight, status, deviceName, connect, disconnect, tare } = useAcaia();

  const isConnected   = status === "connected";
  const isConnecting  = status === "connecting";

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-yellow-50 flex flex-col items-center justify-center p-6 font-sans">

      {/* ── 헤더 ── */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-extrabold text-orange-500 tracking-tight drop-shadow-sm">
          🍳 키즈 쿠킹 클래스
        </h1>
        <p className="mt-1 text-lg text-orange-300 font-semibold">
          재료를 정확히 달아봐요!
        </p>
      </div>

      {/* ── 저울 카드 ── */}
      <div className="bg-white rounded-3xl shadow-xl p-10 w-full max-w-sm flex flex-col items-center gap-6 border-4 border-orange-200">

        {/* 연결 상태 배지 */}
        <div className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full ${
              isConnected  ? "bg-green-400 animate-pulse" :
              isConnecting ? "bg-yellow-400 animate-pulse" :
              status === "error" ? "bg-red-400" :
              "bg-gray-300"
            }`}
          />
          <span className="text-sm font-bold text-gray-500">
            {isConnected   ? `✅ 연결됨 — ${deviceName}` :
             isConnecting  ? "🔄 연결 중…" :
             status === "error" ? "❌ 연결 오류" :
             "저울이 연결되지 않았어요"}
          </span>
        </div>

        {/* 무게 표시 */}
        <div className="flex flex-col items-center">
          <span
            className={`text-8xl font-black tabular-nums tracking-tighter transition-all duration-300 ${
              isConnected ? "text-orange-500" : "text-gray-200"
            }`}
            style={{ fontFamily: "'Nunito', 'Fredoka One', sans-serif" }}
          >
            {isConnected ? weight.toFixed(1) : "---"}
          </span>
          <span className="text-2xl font-bold text-orange-300 mt-1">g</span>
        </div>

        {/* 버튼 영역 */}
        <div className="flex gap-3 w-full">
          {!isConnected ? (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="flex-1 py-4 rounded-2xl bg-orange-400 hover:bg-orange-500 active:scale-95 text-white text-xl font-extrabold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? "연결 중…" : "🔗 연결하기"}
            </button>
          ) : (
            <>
              <button
                onClick={tare}
                className="flex-1 py-4 rounded-2xl bg-green-400 hover:bg-green-500 active:scale-95 text-white text-xl font-extrabold shadow-md transition-all"
              >
                ⚖️ 영점
              </button>
              <button
                onClick={disconnect}
                className="flex-1 py-4 rounded-2xl bg-gray-200 hover:bg-gray-300 active:scale-95 text-gray-600 text-xl font-extrabold shadow-md transition-all"
              >
                🔌 해제
              </button>
            </>
          )}
        </div>

        {/* 안내 문구 */}
        {!isConnected && !isConnecting && (
          <p className="text-center text-sm text-gray-400 leading-relaxed">
            블루투스가 켜져 있는지 확인하고<br />
            <strong>연결하기</strong> 버튼을 눌러봐요 🎉
          </p>
        )}
      </div>

      {/* ── 장식 이모지 ── */}
      <div className="mt-10 flex gap-6 text-4xl select-none">
        <span className="animate-bounce" style={{ animationDelay: "0ms" }}>🥕</span>
        <span className="animate-bounce" style={{ animationDelay: "150ms" }}>🧁</span>
        <span className="animate-bounce" style={{ animationDelay: "300ms" }}>🍎</span>
        <span className="animate-bounce" style={{ animationDelay: "450ms" }}>🥚</span>
        <span className="animate-bounce" style={{ animationDelay: "600ms" }}>🧀</span>
      </div>
    </div>
  );
}
