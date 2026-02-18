#if _PLATFORM_SPECIFIC
return RunNativeExecutable(args);
#else
return RunPlatformAgnostic(args);
#endif

#if _PLATFORM_SPECIFIC
static int RunNativeExecutable(string[] args)
{
    string exeName = GetNativeExecutableName();
    string exePath = Path.Combine(AppContext.BaseDirectory, exeName);
    return StartExecutable(exePath, args);
}

static string GetNativeExecutableName()
{
#if _PLATFORM_LINUX_ARM64
    Debug.Assert(RuntimeInformation.IsOSPlatform(OSPlatform.Linux));
    Debug.Assert(RuntimeInformation.OSArchitecture == Architecture.Arm64);
    return "sentry-linux-arm64";
#elif _PLATFORM_LINUX_X64
    Debug.Assert(RuntimeInformation.IsOSPlatform(OSPlatform.Linux));
    Debug.Assert(RuntimeInformation.OSArchitecture == Architecture.X64);
    return "sentry-linux-x64";
#elif _PLATFORM_OSX_ARM64
    Debug.Assert(RuntimeInformation.IsOSPlatform(OSPlatform.OSX));
    Debug.Assert(RuntimeInformation.OSArchitecture == Architecture.Arm64);
    return "sentry-darwin-arm64";
#elif _PLATFORM_OSX_X64
    Debug.Assert(RuntimeInformation.IsOSPlatform(OSPlatform.OSX));
    Debug.Assert(RuntimeInformation.OSArchitecture == Architecture.X64);
    return "sentry-darwin-x64";
#elif _PLATFORM_WIN_X64
    Debug.Assert(RuntimeInformation.IsOSPlatform(OSPlatform.Windows));
    Debug.Assert(RuntimeInformation.OSArchitecture == Architecture.X64);
    return "sentry-windows-x64.exe";
#else
    throw new PlatformNotSupportedException($"Unsupported platform: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})");
#error Platform not defined.
#endif
}

static int StartExecutable(string fileName, string[] args)
{
    ProcessStartInfo startInfo = new(fileName, args)
    {
        CreateNoWindow = true,
        UseShellExecute = false,
    };

    var process = Process.Start(startInfo);
    if (process is null)
    {
        throw new InvalidOperationException("Sentry CLI could not be started.");
    }

    process.WaitForExit();
    return process.ExitCode;
}
#else
static int RunPlatformAgnostic(string[] args)
{
    Console.Error.WriteLine($"Unsupported platform: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})");
    return 1;
}
#endif
