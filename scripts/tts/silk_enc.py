"""Encode 16-bit PCM WAV -> SILK_V3 (WeChat style) via VoipEngine.dll SKP Silk SDK."""
import ctypes, struct, sys, wave

import os
DLL_PATH = os.environ['WECHATAGENT_VOIP_DLL']
lib = ctypes.WinDLL(DLL_PATH)
lib.SKP_Silk_SDK_Get_Encoder_Size.restype = ctypes.c_int
lib.SKP_Silk_SDK_Get_Encoder_Size.argtypes = [ctypes.POINTER(ctypes.c_int32)]
lib.SKP_Silk_SDK_InitEncoder.restype = ctypes.c_int
lib.SKP_Silk_SDK_InitEncoder.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
lib.SKP_Silk_SDK_Encode.restype = ctypes.c_int
lib.SKP_Silk_SDK_Encode.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int16),
                                    ctypes.c_int, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int32)]

def ctrl(api, maxint, pkt, bitrate, payload_ms, complexity, loss, fec, dtx):
    return (ctypes.c_int32 * 12)(api, maxint, pkt, bitrate, payload_ms, complexity, loss, fec, dtx, 0, 0, 0)

def read_wav(path):
    with wave.open(path, 'rb') as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        data = w.readframes(n)
    if sw != 2 or ch != 1:
        raise SystemExit("need mono 16-bit PCM wav")
    return rate, struct.unpack('<%dh' % (len(data) // 2), data)

def encode(wav_path, rate, bitrate=16000, complexity=2, dtx=0, fec=0):
    sr, samples = read_wav(wav_path)
    if sr != rate:
        raise SystemExit(f"wav {sr} Hz != requested {rate} Hz")
    n = ctypes.c_int32(0)
    lib.SKP_Silk_SDK_Get_Encoder_Size(ctypes.byref(n))
    if not 0 < n.value <= 16 * 1024 * 1024:
        raise SystemExit("Invalid encoder state size")
    state = ctypes.create_string_buffer(n.value)
    pkt = rate * 20 // 1000          # 20ms 一帧
    c = ctrl(rate, rate, pkt, bitrate, 20, complexity, 0, fec, dtx)
    if lib.SKP_Silk_SDK_InitEncoder(state, ctypes.byref(c)) != 0:
        raise SystemExit("InitEncoder failed")
    frames = []
    for i in range(0, len(samples) - pkt + 1, pkt):
        c2 = ctrl(rate, rate, pkt, bitrate, 20, complexity, 0, fec, dtx)
        chunk = (ctypes.c_int16 * pkt)(*samples[i:i + pkt])
        out = ctypes.create_string_buffer(4000)
        olen = ctypes.c_int32(4000)
        ret = lib.SKP_Silk_SDK_Encode(state, ctypes.byref(c2), chunk, pkt, out, ctypes.byref(olen))
        if ret != 0:
            raise SystemExit(f"encode ret={ret} frame={len(frames)}")
        frames.append(out.raw[:olen.value])
    if not frames or len(frames)>3000:
        raise SystemExit("Voice must be 20 ms to 60 seconds")
    return frames

def write_silk(path, frames):
    with open(path, 'wb') as f:
        f.write(b'\x02' + b'#!SILK_V3')
        for fr in frames:
            f.write(struct.pack('<H', len(fr)))
            f.write(fr)

if __name__ == '__main__':
    wav, out = sys.argv[1], sys.argv[2]
    rate = int(sys.argv[3], 0) if len(sys.argv) > 3 else 24000
    bitrate = int(sys.argv[4], 0) if len(sys.argv) > 4 else 16000
    frames = encode(wav, rate, bitrate)
    write_silk(out, frames)
    sizes = [len(f) for f in frames]
    print(f"frames={len(frames)} dur_ms={len(frames)*20} bytes={sum(sizes)} min={min(sizes)} max={max(sizes)}")
    print(f"OUT {out}")