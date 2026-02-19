namespace Sentry.Cli.Tests;

internal static class PlatformUtilities
{
    internal static string GetNativeExecutableName()
    {
        var platform = RuntimeInformation.IsOSPlatform(OSPlatform.Linux) ? "linux" :
            RuntimeInformation.IsOSPlatform(OSPlatform.OSX) ? "darwin" :
            RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "windows" :
            throw new PlatformNotSupportedException($"Unsupported platform: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})");

        var architecture = RuntimeInformation.OSArchitecture switch
        {
            Architecture.Arm64 => "arm64",
            Architecture.X64 => "x64",
            _ => throw new PlatformNotSupportedException($"Unsupported platform: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})"),
        };

        return OperatingSystem.IsWindows()
            ? $"sentry-{platform}-{architecture}.exe"
            : $"sentry-{platform}-{architecture}";
    }
}
