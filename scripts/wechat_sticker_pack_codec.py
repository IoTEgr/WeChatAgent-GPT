"""Decode one locally installed store sticker, with bounded, read-only access.

The 4.1.10.27 account cache secret stays in this process, is never serialized,
and is obtained only from the configured client's known account object.
"""
import ctypes
from ctypes import wintypes as w
import hashlib
import io
import os
import pathlib
import struct

from Crypto.Cipher import AES
from PIL import Image

MAX_IMAGE = 8 * 1024 * 1024
MAX_PACK = 256 * 1024 * 1024
ACCOUNT_MASK = struct.pack('<QQQQ', 0x971df3297cd3346c, 0xa86b01857d9b897e,
                           0x890bf2c008608282, 0xd4cc507feaf85165)


class PackCodecError(RuntimeError):
    pass


def decode_slice(stream, key, offset, size, expected_md5):
    """CBC permits reading just the selected image and its preceding block."""
    if not isinstance(key, bytes) or len(key) != 16:
        raise PackCodecError('STICKER_PACK_KEY_UNAVAILABLE')
    if type(offset) is not int or type(size) is not int or not 0 <= offset < MAX_PACK or not 0 < size <= MAX_IMAGE:
        raise PackCodecError('STICKER_PACK_INVALID_RANGE')
    stream.seek(0, 2)
    length = stream.tell()
    start, stop = offset // 16 * 16, (offset + size + 15) // 16 * 16
    if length % 16 or not 0 < length <= MAX_PACK or stop > length:
        raise PackCodecError('STICKER_PACK_CACHE_INCOMPLETE')
    stream.seek(start - 16 if start else 0)
    iv = stream.read(16) if start else key
    encrypted = stream.read(stop - start)
    if len(encrypted) != stop - start:
        raise PackCodecError('STICKER_PACK_CACHE_INCOMPLETE')
    plain = AES.new(key, AES.MODE_CBC, iv).decrypt(encrypted)
    raw = plain[offset - start:offset - start + size]
    if hashlib.md5(raw).hexdigest() != expected_md5:
        raise PackCodecError('STICKER_PACK_IMAGE_INTEGRITY_FAILED')
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ('GIF', 'PNG', 'JPEG', 'WEBP') or not 0 < image.width <= 4096 or not 0 < image.height <= 4096:
                raise ValueError()
            if image.width * image.height * getattr(image, 'n_frames', 1) > 80_000_000:
                raise ValueError()
    except Exception:
        raise PackCodecError('STICKER_PACK_IMAGE_UNSUPPORTED') from None
    return raw


class ClientMemory:
    def __init__(self, pid):
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        k = self.kernel
        k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        k.OpenProcess.restype = w.HANDLE
        k.ReadProcessMemory.argtypes = [w.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
        k.ReadProcessMemory.restype = w.BOOL
        k.CloseHandle.argtypes = [w.HANDLE]
        k.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        k.CreateToolhelp32Snapshot.restype = w.HANDLE
        self.handle = k.OpenProcess(0x1010, False, pid)
        if not self.handle:
            raise PackCodecError('STICKER_PACK_CLIENT_ACCESS_DENIED')
        self.pid = pid

    def close(self):
        self.kernel.CloseHandle(self.handle)

    def read(self, address, size):
        if not 0x10000 < address < 0x7fffffffffff or not 0 < size <= 4096:
            raise PackCodecError('STICKER_PACK_CLIENT_NOT_LOGGED_IN')
        buffer, got = ctypes.create_string_buffer(size), ctypes.c_size_t()
        if not self.kernel.ReadProcessMemory(self.handle, address, buffer, size, ctypes.byref(got)) or got.value != size:
            raise PackCodecError('STICKER_PACK_CLIENT_READ_FAILED')
        return buffer.raw

    def ptr(self, address):
        return struct.unpack('<Q', self.read(address, 8))[0]

    def module(self, executable):
        class Module(ctypes.Structure):
            _fields_ = [('dwSize', w.DWORD), ('th32ModuleID', w.DWORD), ('th32ProcessID', w.DWORD),
                        ('GlblcntUsage', w.DWORD), ('ProccntUsage', w.DWORD), ('modBaseAddr', ctypes.c_void_p),
                        ('modBaseSize', w.DWORD), ('hModule', w.HMODULE), ('szModule', w.WCHAR * 256),
                        ('szExePath', w.WCHAR * 260)]
        k = self.kernel
        k.Module32FirstW.argtypes = k.Module32NextW.argtypes = [w.HANDLE, ctypes.POINTER(Module)]
        k.Module32FirstW.restype = k.Module32NextW.restype = w.BOOL
        snapshot = k.CreateToolhelp32Snapshot(0x18, self.pid)
        if snapshot == ctypes.c_void_p(-1).value:
            raise PackCodecError('STICKER_PACK_CLIENT_READ_FAILED')
        try:
            item = Module(); item.dwSize = ctypes.sizeof(item)
            exists = k.Module32FirstW(snapshot, ctypes.byref(item))
            while exists:
                if item.szModule.casefold() == 'weixin.dll':
                    actual = pathlib.Path(item.szExePath).resolve()
                    expected = executable.parent / '4.1.10.27' / 'Weixin.dll'
                    if actual != expected.resolve() or item.modBaseSize < 0xa83ab28:
                        raise PackCodecError('STICKER_PACK_CLIENT_VERSION_UNSUPPORTED')
                    return item.modBaseAddr
                exists = k.Module32NextW(snapshot, ctypes.byref(item))
        finally:
            k.CloseHandle(snapshot)
        raise PackCodecError('STICKER_PACK_CLIENT_UNAVAILABLE')


def runtime_cache_key(executable):
    if os.name != 'nt' or struct.calcsize('P') != 8:
        raise PackCodecError('STICKER_PACK_CLIENT_VERSION_UNSUPPORTED')
    from reader_setup import wechat_pids
    try:
        executable = pathlib.Path(executable).resolve()
        pids = wechat_pids(str(executable))
        if len(pids) != 1:
            raise PackCodecError('STICKER_PACK_CLIENT_UNAVAILABLE')
        memory = ClientMemory(pids[0])
        try:
            base = memory.module(executable)
            # Pin both public account accessors before following any pointer.
            if memory.read(base + 0x410c0, 8) != bytes.fromhex('488b05599a7f0ac3'):
                raise PackCodecError('STICKER_PACK_CLIENT_VERSION_UNSUPPORTED')
            manager = memory.ptr(base + 0xa83ab20)
            if memory.ptr(memory.ptr(manager) + 0x60) != base + 0x41d20:
                raise PackCodecError('STICKER_PACK_CLIENT_VERSION_UNSUPPORTED')
            account = memory.ptr(manager + 0x68)
            value = memory.read(account + 0x298, 32)
            length, capacity = struct.unpack('<QQ', value[16:])
            if not 16 <= length <= 64 or capacity < length or capacity > 4095:
                raise PackCodecError('STICKER_PACK_KEY_UNAVAILABLE')
            encoded = memory.read(struct.unpack('<Q', value[:8])[0], length)
            key = bytes(byte ^ ACCOUNT_MASK[index % 32] for index, byte in enumerate(encoded))[:16]
            if memory.ptr(manager + 0x68) != account:
                raise PackCodecError('STICKER_PACK_ACCOUNT_CHANGED')
            return key
        finally:
            memory.close()
    except PackCodecError:
        raise
    except Exception:
        raise PackCodecError('STICKER_PACK_KEY_UNAVAILABLE') from None


class PackImageDecoder:
    def __init__(self, account, executable, *, key_provider=runtime_cache_key):
        self.account = pathlib.Path(account).resolve()
        self.executable, self.key_provider = executable, key_provider

    def __call__(self, package, md5, offset, size):
        digest = hashlib.md5(package.encode()).hexdigest()
        file = self.account / 'business/emoticon/PersistStore' / digest[:2] / digest
        for part in (file, *file.parents):
            if part == self.account:
                break
            if part.is_symlink() or getattr(part, 'is_junction', lambda: False)():
                raise PackCodecError('STICKER_PACK_PATH_INVALID')
        if not file.resolve().is_relative_to(self.account):
            raise PackCodecError('STICKER_PACK_PATH_INVALID')
        try:
            # Reacquire after relogin; never persist a secret or bulk-export a pack.
            key = self.key_provider(self.executable)
            with file.open('rb') as stream:
                return decode_slice(stream, key, offset, size, md5)
        except PackCodecError:
            raise
        except Exception:
            raise PackCodecError('STICKER_PACK_CACHE_UNAVAILABLE') from None
