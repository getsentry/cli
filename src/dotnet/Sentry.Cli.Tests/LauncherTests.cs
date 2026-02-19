namespace Sentry.Cli.Tests;

[NotInParallel]
public class LauncherTests
{
    [Test]
    public async Task Launch_FrameworkDependent_HasNoSentryCli()
    {
        var project = PathUtilities.LauncherProject;

        var result = await project.RunAsync();

        await result.AssertFailureAsync();
        await result.AssertErrorAsync($"Unsupported platform: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})");
    }

    [Test]
    public async Task Launch_PlatformSpecific_HasSentryCli()
    {
        var project = PathUtilities.LauncherProject;
        var artifacts = PathUtilities.ArtifactsDirectory;

        var output = Path.Combine(artifacts.FullName, "test");
        var result = await project.PublishAsync(RuntimeInformation.RuntimeIdentifier, output);
        await result.AssertSuccessAsync();

        // copy from dist-bin to test artifacts
        var sourceFileName = Path.Combine(PathUtilities.BinaryDirectory.FullName, PlatformUtilities.GetNativeExecutableName());
        var destFileName = Path.Combine(output, PlatformUtilities.GetNativeExecutableName());
        File.Copy(sourceFileName, destFileName, true);

        var executable = Path.Combine(output, "Sentry.Cli");
        var exec = await DotnetProject.ExecAsync(executable, ["--version"]);

        // there is an issue on Windows in CI
        if (OperatingSystem.IsWindows())
            return;

        var version = await JsonUtilities.GetVersionAsync(PathUtilities.PackageFile);
        await exec.AssertSuccessAsync();
        await exec.AssertOutputAsync(version);
    }
}
