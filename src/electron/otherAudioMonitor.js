const { spawn } = require("child_process");

const SAMPLE_INTERVAL_MS = 200;
const ACTIVE_AFTER_MS = 500;
const INACTIVE_AFTER_MS = 1000;
const RESTART_DELAY_MS = 2000;
const PEAK_THRESHOLD = 0.001;

// ponytail: polling avoids a native addon/build toolchain; switch to Core Audio session/device callbacks if 200 ms sampling becomes too costly.
const WINDOWS_MONITOR_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace HydrogenMusic.OtherAudio
{
    enum EDataFlow
    {
        eRender,
        eCapture,
        eAll
    }

    enum ERole
    {
        eConsole,
        eMultimedia,
        eCommunications
    }

    enum AudioSessionState
    {
        Inactive,
        Active,
        Expired
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject
    {
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig]
        int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);

        [PreserveSig]
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);

        [PreserveSig]
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);

        [PreserveSig]
        int RegisterEndpointNotificationCallback(IntPtr client);

        [PreserveSig]
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig]
        int Activate(
            ref Guid interfaceId,
            uint classContext,
            IntPtr activationParameters,
            [MarshalAs(UnmanagedType.IUnknown)] out object instance);

        [PreserveSig]
        int OpenPropertyStore(uint access, out IntPtr properties);

        [PreserveSig]
        int GetId(out IntPtr id);

        [PreserveSig]
        int GetState(out uint state);
    }

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig]
        int GetAudioSessionControl(ref Guid sessionId, uint flags, out IntPtr sessionControl);

        [PreserveSig]
        int GetSimpleAudioVolume(ref Guid sessionId, uint flags, out IntPtr audioVolume);

        [PreserveSig]
        int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnumerator);

        [PreserveSig]
        int RegisterSessionNotification(IntPtr notification);

        [PreserveSig]
        int UnregisterSessionNotification(IntPtr notification);

        [PreserveSig]
        int RegisterDuckNotification(
            [MarshalAs(UnmanagedType.LPWStr)] string sessionId,
            IntPtr notification);

        [PreserveSig]
        int UnregisterDuckNotification(IntPtr notification);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig]
        int GetCount(out int count);

        [PreserveSig]
        int GetSession(int index, out IAudioSessionControl session);
    }

    [ComImport]
    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl
    {
        [PreserveSig]
        int GetState(out AudioSessionState state);

        [PreserveSig]
        int GetDisplayName(out IntPtr displayName);

        [PreserveSig]
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);

        [PreserveSig]
        int GetIconPath(out IntPtr iconPath);

        [PreserveSig]
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);

        [PreserveSig]
        int GetGroupingParam(out Guid groupingId);

        [PreserveSig]
        int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);

        [PreserveSig]
        int RegisterAudioSessionNotification(IntPtr client);

        [PreserveSig]
        int UnregisterAudioSessionNotification(IntPtr client);
    }

    [ComImport]
    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig]
        int GetState(out AudioSessionState state);

        [PreserveSig]
        int GetDisplayName(out IntPtr displayName);

        [PreserveSig]
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);

        [PreserveSig]
        int GetIconPath(out IntPtr iconPath);

        [PreserveSig]
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);

        [PreserveSig]
        int GetGroupingParam(out Guid groupingId);

        [PreserveSig]
        int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);

        [PreserveSig]
        int RegisterAudioSessionNotification(IntPtr client);

        [PreserveSig]
        int UnregisterAudioSessionNotification(IntPtr client);

        [PreserveSig]
        int GetSessionIdentifier(out IntPtr sessionIdentifier);

        [PreserveSig]
        int GetSessionInstanceIdentifier(out IntPtr sessionInstanceIdentifier);

        [PreserveSig]
        int GetProcessId(out uint processId);

        [PreserveSig]
        int IsSystemSoundsSession();

        [PreserveSig]
        int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport]
    [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioMeterInformation
    {
        [PreserveSig]
        int GetPeakValue(out float peak);

        [PreserveSig]
        int GetMeteringChannelCount(out int channelCount);

        [PreserveSig]
        int GetChannelsPeakValues(int channelCount, [Out] float[] peaks);

        [PreserveSig]
        int QueryHardwareSupport(out int hardwareSupportMask);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    public static class Monitor
    {
        const uint CLSCTX_ALL = 23;
        const uint TH32CS_SNAPPROCESS = 2;

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);

        static void ReleaseComObject(object value)
        {
            if (value == null || !Marshal.IsComObject(value)) return;
            try
            {
                Marshal.ReleaseComObject(value);
            }
            catch
            {
            }
        }

        static Dictionary<uint, uint> ReadProcessParents()
        {
            Dictionary<uint, uint> parents = new Dictionary<uint, uint>();
            IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == new IntPtr(-1)) return parents;

            try
            {
                PROCESSENTRY32 entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (!Process32FirstW(snapshot, ref entry)) return parents;

                do
                {
                    parents[entry.th32ProcessID] = entry.th32ParentProcessID;
                    entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                }
                while (Process32NextW(snapshot, ref entry));
            }
            finally
            {
                CloseHandle(snapshot);
            }

            return parents;
        }

        static bool IsHydrogenProcess(
            uint processId,
            uint rootProcessId,
            Dictionary<uint, uint> parents)
        {
            if (processId == 0) return false;
            uint current = processId;
            HashSet<uint> visited = new HashSet<uint>();

            for (int depth = 0; depth < 64 && current != 0; depth++)
            {
                if (current == rootProcessId) return true;
                if (!visited.Add(current)) return false;
                uint parent;
                if (!parents.TryGetValue(current, out parent)) return false;
                current = parent;
            }

            return false;
        }

        public static bool IsOtherAudioPlaying(uint rootProcessId, float peakThreshold)
        {
            IMMDeviceEnumerator deviceEnumerator = null;
            IMMDevice device = null;
            IAudioSessionManager2 sessionManager = null;
            IAudioSessionEnumerator sessionEnumerator = null;

            try
            {
                deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                if (deviceEnumerator.GetDefaultAudioEndpoint(
                    EDataFlow.eRender,
                    ERole.eMultimedia,
                    out device) < 0 || device == null)
                {
                    return false;
                }

                Guid sessionManagerId = typeof(IAudioSessionManager2).GUID;
                object managerObject;
                if (device.Activate(
                    ref sessionManagerId,
                    CLSCTX_ALL,
                    IntPtr.Zero,
                    out managerObject) < 0 || managerObject == null)
                {
                    return false;
                }
                sessionManager = (IAudioSessionManager2)managerObject;

                if (sessionManager.GetSessionEnumerator(out sessionEnumerator) < 0 ||
                    sessionEnumerator == null)
                {
                    return false;
                }

                int count;
                if (sessionEnumerator.GetCount(out count) < 0) return false;
                Dictionary<uint, uint> parents = ReadProcessParents();

                for (int index = 0; index < count; index++)
                {
                    IAudioSessionControl session = null;
                    try
                    {
                        if (sessionEnumerator.GetSession(index, out session) < 0 ||
                            session == null)
                        {
                            continue;
                        }

                        AudioSessionState state;
                        if (session.GetState(out state) < 0 ||
                            state != AudioSessionState.Active)
                        {
                            continue;
                        }

                        uint sessionProcessId = 0;
                        IAudioSessionControl2 session2 = session as IAudioSessionControl2;
                        if (session2 != null) session2.GetProcessId(out sessionProcessId);
                        if (IsHydrogenProcess(
                            sessionProcessId,
                            rootProcessId,
                            parents))
                        {
                            continue;
                        }

                        IAudioMeterInformation meter = session as IAudioMeterInformation;
                        if (meter == null) continue;
                        float peak;
                        if (meter.GetPeakValue(out peak) >= 0 && peak > peakThreshold)
                        {
                            return true;
                        }
                    }
                    catch (COMException)
                    {
                    }
                    finally
                    {
                        ReleaseComObject(session);
                    }
                }

                return false;
            }
            finally
            {
                ReleaseComObject(sessionEnumerator);
                ReleaseComObject(sessionManager);
                ReleaseComObject(device);
                ReleaseComObject(deviceEnumerator);
            }
        }
    }
}
'@

$rootProcessId = [uint32]__ROOT_PROCESS_ID__
$peakThreshold = [single]__PEAK_THRESHOLD__

while ($true) {
    if ([HydrogenMusic.OtherAudio.Monitor]::IsOtherAudioPlaying(
        $rootProcessId,
        $peakThreshold
    )) {
        [Console]::Out.WriteLine("1")
    } else {
        [Console]::Out.WriteLine("0")
    }
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds __SAMPLE_INTERVAL_MS__
}
`;

function createStableStateFilter({
  activeAfterMs = ACTIVE_AFTER_MS,
  inactiveAfterMs = INACTIVE_AFTER_MS,
  onChange = () => {},
} = {}) {
  let stableState = false;
  let candidateState = null;
  let candidateSince = null;

  const push = (rawState, now = Date.now()) => {
    const nextState = rawState === true;
    if (nextState === stableState) {
      candidateState = null;
      candidateSince = null;
      return stableState;
    }

    if (candidateState !== nextState) {
      candidateState = nextState;
      candidateSince = now;
      return stableState;
    }

    const threshold = nextState ? activeAfterMs : inactiveAfterMs;
    if (now - candidateSince < threshold) return stableState;

    stableState = nextState;
    candidateState = null;
    candidateSince = null;
    onChange(stableState);
    return stableState;
  };

  const reset = (nextState = false, emit = true) => {
    const normalizedState = nextState === true;
    const changed = stableState !== normalizedState;
    stableState = normalizedState;
    candidateState = null;
    candidateSince = null;
    if (emit && changed) onChange(stableState);
    return stableState;
  };

  return {
    get value() {
      return stableState;
    },
    push,
    reset,
  };
}

class WindowsOtherAudioMonitor {
  constructor({ onStateChange = () => {} } = {}) {
    this.supported = process.platform === "win32";
    this.enabled = false;
    this.disposed = false;
    this.child = null;
    this.restartTimer = null;
    this.stderr = "";
    this.filter = createStableStateFilter({
      onChange: onStateChange,
    });
  }

  getState() {
    return {
      supported: this.supported,
      active: this.filter.value,
    };
  }

  setEnabled(enabled) {
    const nextEnabled = this.supported && enabled === true;
    if (this.disposed || nextEnabled === this.enabled) return;
    this.enabled = nextEnabled;

    if (!nextEnabled) {
      this.stopProcess();
      this.filter.reset(false);
      return;
    }
    this.startProcess();
  }

  startProcess() {
    if (
      this.disposed ||
      !this.enabled ||
      !this.supported ||
      this.child
    )
      return;

    const script = WINDOWS_MONITOR_SCRIPT
      .replace("__ROOT_PROCESS_ID__", String(process.pid))
      .replace("__PEAK_THRESHOLD__", String(PEAK_THRESHOLD))
      .replace("__SAMPLE_INTERVAL_MS__", String(SAMPLE_INTERVAL_MS));
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$source = [Console]::In.ReadToEnd(); Invoke-Expression $source",
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.stderr = "";

    let stdoutBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const value = line.trim();
        if (value === "1" || value === "0") {
          this.filter.push(value === "1");
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (this.stderr.length < 4000) this.stderr += chunk;
    });

    child.once("error", (error) => {
      this.handleProcessExit(child, error);
    });
    child.once("exit", (code, signal) => {
      this.handleProcessExit(
        child,
        code || signal
          ? new Error(`PowerShell exited with ${code ?? signal}`)
          : null,
      );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  }

  handleProcessExit(child, error) {
    if (this.child !== child) return;
    this.child = null;
    this.filter.reset(false);

    if (error && this.enabled && !this.disposed) {
      const detail = this.stderr.trim();
      console.warn(
        "其他应用声音监听器异常，稍后重试:",
        detail || error.message,
      );
    }
    if (!this.enabled || this.disposed) return;

    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startProcess();
    }, RESTART_DELAY_MS);
  }

  stopProcess() {
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.stopProcess();
    this.filter.reset(false);
  }
}

let currentMonitor = null;

function replaceOtherAudioMonitor(options) {
  currentMonitor?.destroy();
  currentMonitor = new WindowsOtherAudioMonitor(options);
  return currentMonitor;
}

function disposeOtherAudioMonitor() {
  currentMonitor?.destroy();
  currentMonitor = null;
}

module.exports = {
  createStableStateFilter,
  disposeOtherAudioMonitor,
  replaceOtherAudioMonitor,
};
