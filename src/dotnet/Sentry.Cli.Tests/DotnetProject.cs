namespace Sentry.Cli.Tests;

internal sealed class DotnetProject
{
    private readonly FileInfo _project;
    private readonly string _configuration;

    public DotnetProject(string projectPath)
        : this(new FileInfo(projectPath))
    {
    }

    public DotnetProject(FileInfo project)
    {
        _project = project;

#if DEBUG
        _configuration = "Debug";
#else
        _configuration = "Release";
#endif
    }

    public Task<ProcessResult> RunAsync()
    {
        return ExecAsync("dotnet", ["run",
            "--project", _project.FullName,
            "--configuration", _configuration]);
    }

    public Task<ProcessResult> PublishAsync(string rid, string outputDirectory)
    {
        return ExecAsync("dotnet", ["publish", _project.FullName,
            "--configuration", _configuration,
            "--runtime", rid,
            "--output", outputDirectory,
            "--property:PublishAot=true"]);
    }

    public static Task<ProcessResult> ExecAsync(string fileName)
    {
        return ExecAsync(fileName, []);
    }

    public static async Task<ProcessResult> ExecAsync(string fileName, ICollection<string> arguments)
    {
        ProcessStartInfo startInfo = new(fileName, arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        using var process = Process.Start(startInfo);

        await Assert.That(process).IsNotNull();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await process.WaitForExitAsync(cts.Token);

        var stdout = await process.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var stderr = await process.StandardError.ReadToEndAsync(CancellationToken.None);

        return new ProcessResult(process.ExitCode, stdout.Trim(), stderr.Trim());
    }
}
