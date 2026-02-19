using System.Text.Json;

namespace Sentry.Cli.Tests;

internal static class JsonUtilities
{
    internal static async Task<string> GetVersionAsync(FileInfo packageJson)
    {
        await using var stream = File.OpenRead(packageJson.FullName);
        using var document = await JsonDocument.ParseAsync(stream);

        var version = document.RootElement.GetProperty("version");
        return version.GetString()!;
    }
}
